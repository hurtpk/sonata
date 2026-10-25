/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Weather's network side: Open-Meteo (open-meteo.com), a free weather service
// that needs no account or key — places by name, then their forecast. Done
// here because Discord's page isn't allowed to contact other sites.

import { IpcMainInvokeEvent } from "electron";

export interface Place { name: string; region?: string; country?: string; cc?: string; lat: number; lon: number; }
export interface Forecast {
    place: Place;
    units: "c" | "f";
    now: { temp: number; feels: number; humidity: number; wind: number; code: number; day: boolean; rain: number; };
    hours: { t: number; temp: number; code: number; rain: number; day: boolean; }[];
    days: { t: number; hi: number; lo: number; code: number; rain: number; sunrise: number; sunset: number; }[];
    /** Hours to add to UTC for the place's own clock. */
    offset: number;
    checked: number;
}
type Fail = { ok: false; error: string; };

const str = (v: unknown, max = 80) => typeof v === "string" ? v.slice(0, max) : undefined;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0;

async function get(url: string): Promise<{ ok: true; body: any; } | Fail> {
    try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) return { ok: false, error: res.status === 429 ? "The weather service asked to slow down — try again in a minute" : `The weather service answered ${res.status}` };
        return { ok: true, body: await res.json() };
    } catch {
        return { ok: false, error: "Couldn't reach the weather service" };
    }
}

export async function weatherFind(_: IpcMainInvokeEvent, query: string): Promise<{ ok: true; places: Place[]; } | Fail> {
    const q = String(query ?? "").trim().slice(0, 80);
    if (q.length < 2) return { ok: true, places: [] };
    const r = await get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
    if (!r.ok) return r;
    return {
        ok: true,
        places: (r.body?.results ?? []).map((p: any) => ({
            name: str(p.name) ?? q, region: str(p.admin1), country: str(p.country), cc: str(p.country_code, 2),
            lat: num(p.latitude), lon: num(p.longitude),
        })),
    };
}

export async function weatherForecast(_: IpcMainInvokeEvent, place: Place, units: "c" | "f"): Promise<{ ok: true; forecast: Forecast; } | Fail> {
    const lat = num(place?.lat), lon = num(place?.lon);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, error: "That place has no map position" };
    const u = units === "f" ? "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch" : "";
    const r = await get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation"
        + "&hourly=temperature_2m,weather_code,precipitation_probability,is_day"
        + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset"
        + `&timezone=auto&forecast_days=7&timeformat=unixtime${u}`);
    if (!r.ok) return r;
    const b = r.body, c = b.current ?? {}, h = b.hourly ?? {}, d = b.daily ?? {};
    const nowS = Date.now() / 1000;
    const hours = (h.time ?? []).map((t: number, i: number) => ({ t: t * 1000, temp: num(h.temperature_2m?.[i]), code: num(h.weather_code?.[i]), rain: num(h.precipitation_probability?.[i]), day: !!h.is_day?.[i] }))
        .filter((x: any) => x.t / 1000 >= nowS - 3600).slice(0, 24);
    return {
        ok: true,
        forecast: {
            place: { name: str(place.name) ?? "", region: str(place.region), country: str(place.country), cc: str(place.cc, 2), lat, lon },
            units: units === "f" ? "f" : "c",
            now: { temp: num(c.temperature_2m), feels: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m), wind: num(c.wind_speed_10m), code: num(c.weather_code), day: !!c.is_day, rain: num(c.precipitation) },
            hours,
            days: (d.time ?? []).map((t: number, i: number) => ({ t: t * 1000, hi: num(d.temperature_2m_max?.[i]), lo: num(d.temperature_2m_min?.[i]), code: num(d.weather_code?.[i]), rain: num(d.precipitation_probability_max?.[i]), sunrise: num(d.sunrise?.[i]) * 1000, sunset: num(d.sunset?.[i]) * 1000 })),
            offset: num(b.utc_offset_seconds) / 3600,
            checked: Date.now(),
        },
    };
}
