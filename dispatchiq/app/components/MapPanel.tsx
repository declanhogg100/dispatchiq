'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

interface MapPanelProps {
  lat: number | null;
  lon: number | null;
  etaMinutes: number | null;
  address: string | null;
  routeGeometry: any;
  stationLat: number | null;
  stationLon: number | null;
}

// Dynamically import the map component (client-only)
const LeafletMap = dynamic(() => import('./LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="h-56 w-full flex items-center justify-center bg-muted rounded-lg">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading map...</p>
      </div>
    </div>
  ),
});

type LoadingState = 'idle' | 'detecting' | 'geocoding' | 'calculating' | 'ready' | 'error';

export function MapPanel({ lat, lon, etaMinutes, address, routeGeometry, stationLat, stationLon }: MapPanelProps) {
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [prevAddress, setPrevAddress] = useState<string | null>(null);
  const [prevCoords, setPrevCoords] = useState<{ lat: number | null; lon: number | null }>({ lat: null, lon: null });

  useEffect(() => {
    console.log('[MapPanel] props changed', { lat, lon, etaMinutes, address, hasRoute: !!routeGeometry });

    // Detect state transitions
    if (!address && lat === null && lon === null) {
      setLoadingState('idle');
    } else if (address && address !== prevAddress && lat === null) {
      // New address detected, waiting for geocoding
      setLoadingState('geocoding');
      setPrevAddress(address);
    } else if (lat !== null && lon !== null) {
      if (prevCoords.lat !== lat || prevCoords.lon !== lon) {
        // Coordinates changed, calculating route
        setLoadingState('calculating');
        setPrevCoords({ lat, lon });
      }
      
      if (etaMinutes !== null && routeGeometry) {
        // Everything is ready
        setLoadingState('ready');
      } else if (etaMinutes !== null) {
        // Have ETA but no route yet
        setLoadingState('ready');
      }
    }
  }, [lat, lon, etaMinutes, address, routeGeometry, prevAddress, prevCoords]);

  const getLoadingMessage = () => {
    switch (loadingState) {
      case 'idle':
        return 'Map will appear when a location is available.';
      case 'detecting':
        return 'Detecting location...';
      case 'geocoding':
        return `Locating "${address}"...`;
      case 'calculating':
        return 'Finding nearest police station and calculating route...';
      case 'ready':
        return null;
      case 'error':
        return 'Unable to load map. Location may be unavailable.';
      default:
        return 'Map will appear when a location is available.';
    }
  };

  const loadingMessage = getLoadingMessage();

  if (loadingState === 'idle' || loadingMessage) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          {loadingState !== 'idle' && loadingState !== 'error' && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          <span>{loadingMessage}</span>
        </div>
      </div>
    );
  }

  // If we have coordinates but no ETA yet, show "calculating" overlay
  const showCalculating = (lat !== null && lon !== null && etaMinutes === null);

  return (
    <div className="space-y-0">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">Incident Map</h3>
          <p className="text-xs text-muted-foreground">
            {address || 'Location detected'}
          </p>
        </div>
        {etaMinutes !== null ? (
          <div className="rounded-full bg-blue-100 text-blue-800 text-xs font-semibold px-3 py-1 border border-blue-200">
            ETA: {etaMinutes} min
          </div>
        ) : showCalculating ? (
          <div className="rounded-full bg-gray-100 text-gray-600 text-xs font-semibold px-3 py-1 border border-gray-200 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Calculating ETA...
          </div>
        ) : null}
      </div>
      <div className="relative h-56 w-full overflow-hidden rounded-lg border">
        {lat !== null && lon !== null ? (
          <LeafletMap
            lat={lat}
            lon={lon}
            stationLat={stationLat}
            stationLon={stationLon}
            routeGeometry={routeGeometry}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-muted/30 text-xs text-muted-foreground">
            Waiting for coordinates...
          </div>
        )}
        {showCalculating && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-[2px] flex items-center justify-center">
            <div className="bg-card border border-border rounded-lg p-3 shadow-lg flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">Finding route...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
