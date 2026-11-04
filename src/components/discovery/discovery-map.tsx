"use client";

import * as React from "react";
import type * as Leaflet from "leaflet";

async function loadLeaflet() {
  return import("leaflet");
}

type LeafletModule = Awaited<ReturnType<typeof loadLeaflet>>;

export interface DiscoveryMapMarker {
  name: string;
  lat: number;
  lng: number;
}

export interface DiscoveryMapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface DiscoveryMapProps {
  center: { lat: number; lng: number } | null;
  bounds: DiscoveryMapBounds | null;
  markers: DiscoveryMapMarker[];
  heightClassName?: string;
  label: string;
}

/**
 * Small Leaflet preview over OpenStreetMap tiles.
 *
 * Leaflet is imported only in the browser so the server bundle never touches
 * `window`. Markers are drawn as vector circles, which avoids bundling the
 * default marker image assets.
 */
export function DiscoveryMap({
  center,
  bounds,
  markers,
  heightClassName = "h-[280px]",
  label,
}: DiscoveryMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<Leaflet.Map | null>(null);
  const layerRef = React.useRef<Leaflet.LayerGroup | null>(null);
  const leafletRef = React.useRef<LeafletModule | null>(null);
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !containerRef.current) return;
        leafletRef.current = L;
        const map = L.map(containerRef.current, {
          scrollWheelZoom: false,
          zoomControl: true,
          attributionControl: true,
        }).setView([20, 0], 2);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const L = leafletRef.current;
    if (!ready || !map || !layer || !L) return;

    layer.clearLayers();
    const points: Leaflet.LatLngExpression[] = [];

    if (bounds) {
      const rectangle = L.rectangle(
        [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ],
        {
          color: "#14634a",
          weight: 2,
          fillColor: "#14634a",
          fillOpacity: 0.08,
        },
      );
      rectangle.addTo(layer);
    }

    for (const marker of markers) {
      const circle = L.circleMarker([marker.lat, marker.lng], {
        radius: 7,
        color: "#14634a",
        weight: 2,
        fillColor: "#e7a33e",
        fillOpacity: 0.9,
      });
      const popup = document.createElement("span");
      popup.textContent = marker.name || "Business";
      circle.bindPopup(popup);
      circle.addTo(layer);
      points.push([marker.lat, marker.lng]);
    }

    if (center && !markers.length && !bounds) {
      L.circleMarker([center.lat, center.lng], {
        radius: 9,
        color: "#14634a",
        weight: 2,
        fillColor: "#14634a",
        fillOpacity: 0.35,
      })
        .bindPopup(label)
        .addTo(layer);
      points.push([center.lat, center.lng]);
    }

    if (bounds) {
      map.fitBounds(
        L.latLngBounds(
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ),
        { padding: [20, 20], maxZoom: 14 },
      );
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 15 });
    } else if (points.length === 1) {
      map.setView(points[0] as Leaflet.LatLngExpression, 13);
    } else if (center) {
      map.setView([center.lat, center.lng], 11);
    }
    const resizeTimer = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(resizeTimer);
  }, [ready, center, bounds, markers, label]);

  React.useEffect(() => {
    if (!ready || !containerRef.current) return;
    const element = containerRef.current;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      <div ref={containerRef} className={`${heightClassName} w-full`} aria-label={label} role="region" />
      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-muted/80 p-4 text-center text-sm text-muted-foreground">
          The map could not load. Results are still available in the list.
        </div>
      ) : null}
      {!ready && !failed ? (
        <div className="absolute inset-0 grid place-items-center bg-muted/60 text-xs text-muted-foreground">
          Loading map…
        </div>
      ) : null}
    </div>
  );
}
