/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

export interface ZonePlace { label: string; zone: string; }
const LIMIT = 512 * 1024;
let catalog: { at: number; places: ZonePlace[]; } | undefined;

async function read(url: string) {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok || !response.body) throw new Error("The location service is unavailable.");
    let total = 0;
    let text = "";
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
        total += chunk.length;
        if (total > LIMIT) throw new Error("The location response is too large.");
        text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
}

function valid(zone: string) {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; }
    catch { return false; }
}

async function regions() {
    if (catalog && Date.now() - catalog.at < 86_400_000) return catalog.places;
    const text = await read("https://data.iana.org/time-zones/tzdb/zone.tab");
    const names = new Intl.DisplayNames("en", { type: "region" });
    const places = text.split("\n").filter(line => line && !line.startsWith("#")).flatMap(line => {
        const [country, , zone, description] = line.split("\t");
        if (!zone || !valid(zone)) return [];
        return [{ label: [names.of(country), zone.replaceAll("_", " "), description].filter(Boolean).join(" · "), zone }];
    });
    catalog = { at: Date.now(), places };
    return places;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export async function timezoneSearch(_: IpcMainInvokeEvent, input: unknown): Promise<{ ok: true; places: ZonePlace[]; } | { ok: false; error: string; }> {
    if (typeof input !== "string" || input.length > 100) return { ok: false, error: "Enter a location of up to 100 characters." };
    const query = input.trim();
    if (query.length < 2) return { ok: true, places: [] };
    if ((query.includes("/") || ["UTC", "GMT"].includes(query.toUpperCase())) && valid(query)) return { ok: true, places: [{ label: query.replaceAll("_", " "), zone: query }] };
    const [table, cities] = await Promise.allSettled([
        regions(), read(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=30&language=en&format=json`),
    ]);
    const places: ZonePlace[] = [];
    if (cities.status === "fulfilled") {
        try {
            const body: unknown = JSON.parse(cities.value);
            if (record(body) && Array.isArray(body.results)) for (const place of body.results) {
                if (!record(place) || typeof place.timezone !== "string" || !valid(place.timezone)) continue;
                const label = [place.name, place.admin1, place.country].filter((v): v is string => typeof v === "string").join(", ");
                places.push({ label, zone: place.timezone });
            }
        } catch { if (table.status === "rejected") return { ok: false, error: "The location service returned an unreadable response. Try again." }; }
    }
    const search = ({ usa: "united states", uk: "united kingdom", uae: "united arab emirates" } as Record<string, string>)[query.toLowerCase()] ?? query.toLowerCase().replaceAll("_", " ");
    if (table.status === "fulfilled") places.push(...table.value.filter(place => place.label.toLowerCase().includes(search) || place.zone.toLowerCase().replaceAll("_", " ").includes(search)));
    if (table.status === "rejected" && cities.status === "rejected") return { ok: false, error: "Couldn't reach the location services. Search again when you're online." };
    const seen = new Set<string>();
    return { ok: true, places: places.filter(place => { const key = `${place.label}:${place.zone}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 80) };
}
