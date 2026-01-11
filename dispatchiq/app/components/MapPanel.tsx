import React from 'react';

interface MapPanelProps {
  lat: number | null;
  lon: number | null;
  etaMinutes: number | null;
  address: string | null;
}

export function MapPanel({ lat, lon, etaMinutes, address }: MapPanelProps) {
  if (lat === null || lon === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Map will appear when a location is available.
      </div>
    );
  }

  const bboxPadding = 0.01;
  const bbox = [
    lon - bboxPadding,
    lat - bboxPadding,
    lon + bboxPadding,
    lat + bboxPadding,
  ].join('%2C');
  const marker = `${lat}%2C${lon}`;
  const iframeSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&marker=${marker}&layer=mapnik`;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">Incident Map</h3>
          <p className="text-xs text-muted-foreground">
            {address || 'Location detected'}
          </p>
        </div>
        {etaMinutes !== null && (
          <div className="rounded-full bg-blue-100 text-blue-800 text-xs font-semibold px-3 py-1 border border-blue-200">
            ETA: {etaMinutes} min
          </div>
        )}
      </div>
      <div className="relative h-56 w-full overflow-hidden rounded-lg border">
        <iframe
          title="Incident Map"
          src={iframeSrc}
          className="h-full w-full border-0"
          loading="lazy"
        />
      </div>
    </div>
  );
}
