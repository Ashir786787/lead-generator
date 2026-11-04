"use client";

import * as React from "react";
import type { LiveEvent } from "@/lib/events/bus";
import type { LeadQuery } from "@/lib/data/filters";

/** Subscribe to workspace server-sent events. Calls `onEvent` for each event. */
export function useLiveEvents(onEvent?: (event: LiveEvent) => void, enabled = true): boolean {
  const [connected, setConnected] = React.useState(false);
  const callback = React.useRef(onEvent);

  React.useEffect(() => {
    callback.current = onEvent;
  }, [onEvent]);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const source = new EventSource("/api/events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as LiveEvent;
        if (event.type === "connected" as string) {
          setConnected(true);
          return;
        }
        callback.current?.(event);
      } catch {
        /* ignore malformed event */
      }
    };
    return () => {
      source.close();
      setConnected(false);
    };
  }, [enabled]);

  return connected;
}

export function leadQueryToParams(query: LeadQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  return params;
}

export function paramsToLeadQuery(params: URLSearchParams): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (value) output[key] = value;
  }
  return output;
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
