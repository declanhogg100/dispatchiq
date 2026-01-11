import { NextResponse } from 'next/server';

type GeoResult = { lat: number; lon: number };
type Station = { name: string; lat: number; lon: number; distKm: number };

type CacheEntry<T> = { value: T; expires: number };

const USER_AGENT = 'dispatcher-helper/1.0 (contact: dispatchiq@example.com)';

// Caches and in-flight de-dupe
const cache = new Map<string, CacheEntry<any>>();
const inflight = new Map<string, Promise<any>>();

// Circuit breakers
const failures: Record<string, number[]> = {};
const openUntil: Record<string, number> = {};

// Rate limit configs
const limiterConfig = {
  nominatim: { minTime: 1100, maxConcurrent: 1 },
  overpass: { minTime: 2500, maxConcurrent: 1 },
  osrm: { minTime: 100, maxConcurrent: 4 },
};

const lastRun: Record<string, number> = {};
const running: Record<string, number> = { nominatim: 0, overpass: 0, osrm: 0 };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimit(key: keyof typeof limiterConfig) {
  const cfg = limiterConfig[key];
  while (running[key] >= cfg.maxConcurrent) {
    await sleep(25);
  }
  const now = Date.now();
  const last = lastRun[key] || 0;
  const wait = Math.max(0, cfg.minTime - (now - last));
  running[key]++;
  if (wait > 0) await sleep(wait);
  lastRun[key] = Date.now();
}
function done(key: keyof typeof limiterConfig) {
  running[key] = Math.max(0, (running[key] || 1) - 1);
}

function normalizeAddress(address: string) {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

function setCache<T>(k: string, v: T, ttlMs: number) {
  cache.set(k, { value: v, expires: Date.now() + ttlMs });
}
function getCache<T>(k: string): T | null {
  const entry = cache.get(k);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(k);
    return null;
  }
  return entry.value as T;
}

function jitter(ms: number, pct = 0.3) {
  const delta = ms * pct;
  return ms + (Math.random() * 2 - 1) * delta;
}

function recordFailure(key: string) {
  const now = Date.now();
  if (!failures[key]) failures[key] = [];
  failures[key].push(now);
  // keep last minute
  failures[key] = failures[key].filter((t) => now - t < 60_000);
  if (failures[key].length >= 5) {
    openUntil[key] = now + 60_000;
  }
}

function circuitOpen(key: string) {
  return openUntil[key] && openUntil[key] > Date.now();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function nominatim(address: string): Promise<GeoResult | null> {
  const key = `nominatim:${normalizeAddress(address)}`;
  const cached = getCache<GeoResult | null>(key);
  if (cached !== null && cached !== undefined) return cached;
  if (circuitOpen('nominatim')) return null;
  if (inflight.has(key)) return inflight.get(key)!;

  const task = (async () => {
    await rateLimit('nominatim');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        address,
      )}&addressdetails=0&limit=1`;
      const res = await fetchWithTimeout(
        url,
        {
          headers: { 'User-Agent': USER_AGENT },
        },
        8000,
      );
      if (res.status === 429) {
        // backoff retries
        for (const delay of [1000, 2000, 4000].map((d) => jitter(d))) {
          await sleep(delay);
          const retry = await fetchWithTimeout(
            url,
            { headers: { 'User-Agent': USER_AGENT } },
            8000,
          );
          if (retry.ok) {
            const data = await retry.json();
            if (data?.length) {
              const out = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
              setCache(key, out, 30 * 24 * 60 * 60 * 1000);
              return out;
            }
            setCache(key, null, 24 * 60 * 60 * 1000);
            return null;
          }
        }
        recordFailure('nominatim');
        return null;
      }
      if (!res.ok) {
        recordFailure('nominatim');
        return null;
      }
      const data = await res.json();
      if (data?.length) {
        const out = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        setCache(key, out, 30 * 24 * 60 * 60 * 1000);
        return out;
      }
      setCache(key, null, 24 * 60 * 60 * 1000);
      return null;
    } finally {
      done('nominatim');
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

function roundCoord(v: number) {
  return Math.round(v * 1000) / 1000;
}

async function overpassPolice(lat: number, lon: number, radius = 10000): Promise<Station[]> {
  const key = `police:${roundCoord(lat)}:${roundCoord(lon)}:${radius}`;
  const cached = getCache<Station[]>(key);
  if (cached) return cached;
  if (circuitOpen('overpass')) return [];
  if (inflight.has(key)) return inflight.get(key)!;

  const task = (async () => {
    await rateLimit('overpass');
    try {
      const query = `
        [out:json][timeout:15];
        (
          node["amenity"="police"](around:${radius},${lat},${lon});
          way["amenity"="police"](around:${radius},${lat},${lon});
          relation["amenity"="police"](around:${radius},${lat},${lon});
        );
        out center 50;
      `;
      const url = 'https://overpass-api.de/api/interpreter';
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: `data=${encodeURIComponent(query)}`,
        },
        15000,
      );
      if (!res.ok) {
        recordFailure('overpass');
        // retry if allowed
        for (const delay of [jitter(2000), jitter(6000)]) {
          await sleep(delay);
          const retry = await fetchWithTimeout(
            url,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT,
              },
              body: `data=${encodeURIComponent(query)}`,
            },
            15000,
          );
          if (retry.ok) {
            const data = await retry.json();
            const stations = parseOverpass(data, lat, lon);
            setCache(key, stations, 7 * 24 * 60 * 60 * 1000);
            return stations;
          }
        }
        return [];
      }
      const data = await res.json();
      const stations = parseOverpass(data, lat, lon);
      setCache(key, stations, 7 * 24 * 60 * 60 * 1000);
      return stations;
    } finally {
      done('overpass');
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

function parseOverpass(data: any, targetLat: number, targetLon: number): Station[] {
  if (!data?.elements) return [];
  return data.elements
    .map((el: any) => {
      const coords = el.center || el;
      if (!coords?.lat || !coords?.lon) return null;
      const distKm = haversine(targetLat, targetLon, coords.lat, coords.lon);
      return {
        name: el.tags?.name || 'Police Station',
        lat: coords.lat,
        lon: coords.lon,
        distKm,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a!.distKm - b!.distKm)
    .slice(0, 50) as Station[];
}

async function osrmEta(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): Promise<number | null> {
  const key = `route:${lonA.toFixed(5)},${latA.toFixed(5)}:${lonB.toFixed(5)},${latB.toFixed(5)}`;
  const cached = getCache<number>(key);
  if (cached !== null && cached !== undefined) return cached;
  if (circuitOpen('osrm')) return null;
  if (inflight.has(key)) return inflight.get(key)!;

  const task = (async () => {
    await rateLimit('osrm');
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${lonA},${latA};${lonB},${latB}?overview=false&alternatives=false&annotations=false&steps=false`;
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 5000);
      if (!res.ok) {
        recordFailure('osrm');
        return null;
      }
      const data = await res.json();
      const duration = data?.routes?.[0]?.duration;
      if (typeof duration === 'number') {
        setCache(key, duration, 45 * 60 * 1000);
        return duration;
      }
      return null;
    } finally {
      done('osrm');
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function fallbackDurationSeconds(latA: number, lonA: number, latB: number, lonB: number) {
  const distKm = haversine(latA, lonA, latB, lonB);
  const mph = distKm * 0.621371;
  const speed = mph < 10 ? 20 : mph < 30 ? 25 : 35;
  const hours = mph / speed;
  return hours * 3600 * 1.2; // +20% buffer
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }

  // Geocode
  const coords = await nominatim(address);
  if (!coords) {
    return NextResponse.json({ error: 'Unable to geocode address' }, { status: 502 });
  }

  // Find stations: try 10km then 25km
  let stations = await overpassPolice(coords.lat, coords.lon, 10000);
  if (!stations.length) {
    stations = await overpassPolice(coords.lat, coords.lon, 25000);
  }
  if (!stations.length) {
    return NextResponse.json(
      { lat: coords.lat, lon: coords.lon, etaMinutes: null, note: 'No nearby stations found' },
      { status: 200 },
    );
  }

  // Route top 3
  const top = stations.slice(0, 3);
  let bestEta: number | null = null;
  let bestStation: Station | null = null;
  for (const station of top) {
    const dur = await osrmEta(coords.lat, coords.lon, station.lat, station.lon);
    const useDur = dur ?? fallbackDurationSeconds(coords.lat, coords.lon, station.lat, station.lon);
    if (bestEta === null || useDur < bestEta) {
      bestEta = useDur;
      bestStation = station;
    }
  }

  const etaMinutes = bestEta ? Math.round(bestEta / 60) : null;
  return NextResponse.json({
    lat: coords.lat,
    lon: coords.lon,
    station: bestStation,
    etaMinutes,
  });
}
