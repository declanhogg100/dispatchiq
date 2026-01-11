'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface LeafletMapProps {
  lat: number;
  lon: number;
  stationLat: number | null;
  stationLon: number | null;
  routeGeometry: any;
}

// Fix for default marker icons in Next.js
const incidentIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const stationIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export default function LeafletMap({ lat, lon, stationLat, stationLon, routeGeometry }: LeafletMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize map only once
    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        center: [lat, lon],
        zoom: 14,
        zoomControl: true,
      });

      // Add CartoDB Positron tile layer (clean, minimal look)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;

    // Clear existing layers (except tile layer)
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        map.removeLayer(layer);
      }
    });

    // Add incident marker
    const incidentMarker = L.marker([lat, lon], { icon: incidentIcon })
      .addTo(map)
      .bindPopup('<b>Incident Location</b>');

    // Add station marker if available
    let stationMarker: L.Marker | null = null;
    if (stationLat !== null && stationLon !== null) {
      stationMarker = L.marker([stationLat, stationLon], { icon: stationIcon })
        .addTo(map)
        .bindPopup('<b>Police Station</b>');
    }

    // Draw route if available
    if (routeGeometry && routeGeometry.coordinates) {
      // OSRM returns coordinates as [lon, lat], Leaflet uses [lat, lon]
      const latlngs = routeGeometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]] as [number, number]);
      
      const routeLine = L.polyline(latlngs, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.7,
        dashArray: '10, 5',
      }).addTo(map);

      // Fit map to show entire route
      const bounds = L.latLngBounds([
        [lat, lon],
        ...(stationLat && stationLon ? [[stationLat, stationLon]] : []),
      ]);
      map.fitBounds(bounds, { padding: [30, 30] });
    } else {
      // No route, just center on incident
      map.setView([lat, lon], 14);
    }

    // Cleanup on unmount
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [lat, lon, stationLat, stationLon, routeGeometry]);

  return <div ref={containerRef} className="h-full w-full" />;
}

