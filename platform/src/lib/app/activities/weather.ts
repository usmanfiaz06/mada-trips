/*
 * Today's weather for a city, from Open-Meteo (free, no key; data CC BY 4.0, "Weather data by Open-Meteo.com").
 * Used only to turn a very hot or rainy day towards indoor ideas. No server-only import: tests pass a fake fetch.
 */
import { moodOf, type TodayWeather } from "@mada/shared";
import type { Fetch } from "../places/wiki";
import { getJson } from "./opendata";

export const OPEN_METEO_URL = process.env.OPEN_METEO_URL ?? "https://api.open-meteo.com/v1/forecast";

export function openMeteoUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), current: "temperature_2m,precipitation,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code", timezone: "auto", forecast_days: "1",
  });
  return `${OPEN_METEO_URL}?${q.toString()}`;
}

type OpenMeteo = {
  current?: { temperature_2m?: number; precipitation?: number; weather_code?: number };
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[]; weather_code?: number[] };
};

export function parseOpenMeteo(data: unknown, at: Date): TodayWeather | null {
  const d = data as OpenMeteo;
  const tempC = d.current?.temperature_2m;
  const maxC = d.daily?.temperature_2m_max?.[0];
  const minC = d.daily?.temperature_2m_min?.[0];
  if (typeof tempC !== "number" || typeof maxC !== "number" || typeof minC !== "number") return null;
  const rainChance = Math.max(0, Math.min(100, Math.round(d.daily?.precipitation_probability_max?.[0] ?? 0)));
  const code = Math.round(d.current?.weather_code ?? d.daily?.weather_code?.[0] ?? 0);
  const raining = (d.current?.precipitation ?? 0) > 0.2;
  const mood = moodOf({ tempC, maxC, rainChance: raining ? Math.max(rainChance, 80) : rainChance, code });
  return { tempC: Math.round(tempC), maxC: Math.round(maxC), minC: Math.round(minC), rainChance, code, mood, indoorFirst: mood !== "fine", at: at.toISOString() };
}

export async function fetchWeather(f: Fetch, lat: number, lon: number, at = new Date()): Promise<TodayWeather | null> {
  const r = await getJson(f, openMeteoUrl(lat, lon), {}, 5000);
  return r.ok ? parseOpenMeteo(r.data, at) : null;
}

/** Mock mode: believable and steady. Hot in the Gulf, mild elsewhere. */
export function mockWeather(lat: number, countryCode: string, at = new Date()): TodayWeather {
  const gulf = ["SA", "AE", "QA", "KW", "BH", "OM"].includes(countryCode);
  const maxC = gulf ? 41 : lat > 45 ? 14 : 24;
  const tempC = maxC - 3;
  const mood = moodOf({ tempC, maxC, rainChance: lat > 50 ? 70 : 5, code: lat > 50 ? 61 : 1 });
  return { tempC, maxC, minC: maxC - 10, rainChance: lat > 50 ? 70 : 5, code: lat > 50 ? 61 : 1, mood, indoorFirst: mood !== "fine", at: at.toISOString() };
}
