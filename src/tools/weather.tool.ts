import { tool } from '@langchain/core/tools';
import { z } from 'zod';

interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

interface OpenMeteoCurrent {
  time: string;
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  wind_speed_10m: number;
  weather_code: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
  current_units?: Record<string, string>;
}

const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function describeWeatherCode(code: number): string {
  return WEATHER_CODES[code] ?? `Unknown weather code (${code})`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`upstream responded with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export const weatherTool = tool(
  async ({ location }) => {
    const query = location.trim();

    try {
      const geocoding = await getJson<GeocodingResponse>(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
      );
      const place = geocoding.results?.[0];

      if (!place) {
        return `No location found for "${query}". Ask the user for a more specific city name.`;
      }

      const weather = await getJson<OpenMeteoResponse>(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          '&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code' +
          '&timezone=auto',
      );

      if (!weather.current) {
        return `Weather data is currently unavailable for "${query}".`;
      }

      const current = weather.current;
      const units = weather.current_units ?? {};

      return JSON.stringify({
        location: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
        coordinates: { latitude: place.latitude, longitude: place.longitude },
        condition: describeWeatherCode(current.weather_code),
        temperature: `${current.temperature_2m}${units.temperature_2m ?? '°C'}`,
        feelsLike: `${current.apparent_temperature}${units.apparent_temperature ?? '°C'}`,
        humidity: `${current.relative_humidity_2m}${units.relative_humidity_2m ?? '%'}`,
        windSpeed: `${current.wind_speed_10m}${units.wind_speed_10m ?? 'km/h'}`,
        observedAt: current.time,
        source: 'Open-Meteo',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Weather lookup failed: ${message}. Tell the user the weather service is unavailable.`;
    }
  },
  {
    name: 'get_weather',
    description:
      'Get current weather conditions for a city or place. ' +
      'Uses the free Open-Meteo API (no API key required).',
    schema: z.object({
      location: z
        .string()
        .min(1)
        .max(100)
        .describe('City or place name, e.g. "Ho Chi Minh City" or "Hanoi"'),
    }),
  },
);
