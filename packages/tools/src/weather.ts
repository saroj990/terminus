import type { ToolSpec } from "@lca/agent-core";

export interface WeatherInput {
  location: string;
  latitude?: number;
  longitude?: number;
}

/** Small geocode table for Phase 1 demos (no API key). */
const GEOCODE: Record<string, { lat: number; lon: number; label: string }> = {
  london: { lat: 51.5074, lon: -0.1278, label: "London" },
  "new york": { lat: 40.7128, lon: -74.006, label: "New York" },
  "san francisco": { lat: 37.7749, lon: -122.4194, label: "San Francisco" },
  tokyo: { lat: 35.6762, lon: 139.6503, label: "Tokyo" },
  mumbai: { lat: 19.076, lon: 72.8777, label: "Mumbai" },
  delhi: { lat: 28.6139, lon: 77.209, label: "Delhi" },
  bangalore: { lat: 12.9716, lon: 77.5946, label: "Bangalore" },
  bengaluru: { lat: 12.9716, lon: 77.5946, label: "Bengaluru" },
  paris: { lat: 48.8566, lon: 2.3522, label: "Paris" },
  sydney: { lat: -33.8688, lon: 151.2093, label: "Sydney" },
};

export function resolveLocation(location: string): { lat: number; lon: number; label: string } {
  const key = location.trim().toLowerCase();
  const hit = GEOCODE[key];
  if (hit) return hit;

  const lat = Number(process.env.WEATHER_LAT);
  const lon = Number(process.env.WEATHER_LON);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon, label: location };
  }

  throw new Error(
    `Unknown location '${location}'. Supported: ${Object.keys(GEOCODE).join(", ")}`,
  );
}

export function createWeatherTool(options?: {
  fetchImpl?: typeof fetch;
}): ToolSpec {
  const fetchImpl = options?.fetchImpl ?? fetch;

  return {
    name: "get_weather",
    description:
      "Get current weather for a city using Open-Meteo. Prefer this for weather questions.",
    sideEffect: "external",
    inputSchema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City name, e.g. London, Mumbai, Tokyo",
        },
        latitude: { type: "number" },
        longitude: { type: "number" },
      },
      required: ["location"],
      additionalProperties: false,
    },
    maxObservationTokens: 400,
    async execute(input) {
      try {
        const location = String(input.location ?? "");
        const coords =
          typeof input.latitude === "number" && typeof input.longitude === "number"
            ? { lat: input.latitude, lon: input.longitude, label: location }
            : resolveLocation(location);

        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", String(coords.lat));
        url.searchParams.set("longitude", String(coords.lon));
        url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");

        const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
          return {
            ok: false,
            error: `Weather API HTTP ${res.status}`,
            summary: `Weather lookup failed for ${coords.label}`,
          };
        }

        const body = (await res.json()) as {
          current?: {
            temperature_2m?: number;
            weather_code?: number;
            wind_speed_10m?: number;
          };
        };

        const current = body.current;
        if (!current || typeof current.temperature_2m !== "number") {
          return {
            ok: false,
            error: "Unexpected weather payload",
            summary: `Weather lookup returned no current data for ${coords.label}`,
          };
        }

        const data = {
          location: coords.label,
          latitude: coords.lat,
          longitude: coords.lon,
          temperatureC: current.temperature_2m,
          weatherCode: current.weather_code,
          windSpeedKph: current.wind_speed_10m,
        };

        return {
          ok: true,
          data,
          summary: `${data.location}: ${data.temperatureC}°C, wind ${data.windSpeedKph ?? "?"} km/h`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: message,
          summary: `Weather tool error: ${message}`,
        };
      }
    },
  };
}
