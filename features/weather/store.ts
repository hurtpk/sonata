/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Weather's settings (your city and °C or °F), the words for each kind of
// weather, and a short-lived cache so the same city isn't asked for twice.

import { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import type { Forecast, Place } from "./native";

export const settings = defineFeatureSettings("weather", {
    units: {
        type: OptionType.SELECT, description: "Temperature in",
        options: [{ label: "Celsius (°C)", value: "c" }, { label: "Fahrenheit (°F)", value: "f" }, { label: "Whatever my country uses", value: "auto", default: true }],
    },
    chatCards: { type: OptionType.BOOLEAN, description: "Show the weather under messages like \"weather in Tokyo\"", default: true },
    place: { type: OptionType.STRING, description: "Internal: your city", default: "", hidden: true },
});

const native = () => VencordNative.pluginHelpers.Sonata as any;

/** °F for the few countries that use it, °C everywhere else (unless you picked one). */
export function unitsOf(): "c" | "f" {
    const u = settings.store.units;
    if (u === "c" || u === "f") return u;
    const region = (navigator.language.split("-")[1] ?? "").toUpperCase();
    return ["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"].includes(region) ? "f" : "c";
}

export function myPlace(): Place | null {
    try { const p = JSON.parse(settings.store.place || "null"); return p && typeof p.lat === "number" ? p : null; } catch { return null; }
}
export const setMyPlace = (p: Place) => { settings.store.place = JSON.stringify(p); };
export const placeLabel = (p: Place) => [p.name, p.region && p.region !== p.name ? p.region : null, p.cc?.toUpperCase()].filter(Boolean).join(", ");

const found = new Map<string, Place[]>();
export async function findPlaces(q: string): Promise<Place[] | string> {
    const key = q.trim().toLowerCase();
    if (found.has(key)) return found.get(key)!;
    const r = await native().weatherFind(q).catch(() => null);
    if (!r?.ok) return r?.error ?? "Couldn't look that place up";
    found.set(key, r.places);
    return r.places;
}

const forecasts = new Map<string, Forecast>();
export async function forecastFor(p: Place): Promise<Forecast | string> {
    const units = unitsOf();
    const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)},${units}`;
    const hit = forecasts.get(key);
    if (hit && Date.now() - hit.checked < 20 * 60_000) return hit;
    const r = await native().weatherForecast(p, units).catch(() => null);
    if (!r?.ok) return hit ?? r?.error ?? "Couldn't get the weather";
    forecasts.set(key, r.forecast);
    return r.forecast;
}

/** WMO weather codes, in plain words, and which picture each gets. */
export function conditionOf(code: number): { label: string; kind: "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm"; } {
    if (code === 0) return { label: "Clear", kind: "clear" };
    if (code === 1) return { label: "Mostly clear", kind: "partly" };
    if (code === 2) return { label: "Partly cloudy", kind: "partly" };
    if (code === 3) return { label: "Cloudy", kind: "cloudy" };
    if (code === 45 || code === 48) return { label: "Foggy", kind: "fog" };
    if (code >= 51 && code <= 57) return { label: code >= 56 ? "Freezing drizzle" : "Drizzle", kind: "drizzle" };
    if (code >= 61 && code <= 67) return { label: code >= 66 ? "Freezing rain" : code === 65 ? "Heavy rain" : code === 61 ? "Light rain" : "Rain", kind: "rain" };
    if (code >= 71 && code <= 77) return { label: code === 75 ? "Heavy snow" : code === 71 ? "Light snow" : "Snow", kind: "snow" };
    if (code >= 80 && code <= 82) return { label: code === 82 ? "Heavy showers" : "Showers", kind: "rain" };
    if (code === 85 || code === 86) return { label: "Snow showers", kind: "snow" };
    if (code >= 95) return { label: code >= 96 ? "Thunderstorm with hail" : "Thunderstorm", kind: "storm" };
    return { label: "Unknown", kind: "cloudy" };
}

/** "weather in Tokyo", "what's the weather like in New York?", "weather for paris today". */
export function weatherQuery(text: string): string | null {
    const m = /\bweather\s+(?:like\s+)?(?:in|for|at)\s+([\p{L}][\p{L}\p{M}'.\- ]{1,40}?)(?=\s*(?:[?.!,;:)]|$|\s+(?:today|tomorrow|tonight|now|right now|rn|like|this week|lol|tho|though)\b))/iu.exec(text);
    const q = m?.[1]?.trim();
    return q && q.length >= 2 && !/^(the|a|my|your|here|there)$/i.test(q) ? q : null;
}
