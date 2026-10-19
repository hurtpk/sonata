/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata's designs. For now there's just Minimal: flat black with a few
// still layers you can switch on and off, shaded by your accent colour.
// (The old animated designs were taken out on 2026-10-18; saved settings
// that name one of them fall back to Minimal.)

export type PresetId = "minimal";

export interface Layer { id: string; name: string; on: boolean; }

export interface Preset {
    id: PresetId;
    name: string;
    blurb: string;
    layers: Layer[];
}

const L = (id: string, name: string, on = true): Layer => ({ id, name, on });

export const PRESETS: Preset[] = [
    {
        id: "minimal", name: "Minimal", blurb: "A drifting wash of your colour, waving music staves, notes floating up and a soft equalizer along the bottom.",
        layers: [L("glow", "Colour wash"), L("staves", "Music staves"), L("notes", "Floating notes"), L("eq", "Equalizer"), L("grid", "Grid lines"), L("grain", "Film grain", false), L("vignette", "Vignette", false)],
    },
];

export const presetOf = (id: unknown) => PRESETS.find(p => p.id === id) ?? PRESETS[0];

/** Saved layer switches: { preset: { layer: on } }. Anything not saved uses the preset's default. */
export type LayerState = Record<string, Record<string, boolean>>;

export function readLayers(raw: unknown): LayerState {
    try { const v = JSON.parse(typeof raw === "string" && raw ? raw : "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

/** Which of a preset's layers are on. */
export function layersOn(preset: Preset, state: LayerState): Set<string> {
    const saved = state[preset.id] ?? {};
    return new Set(preset.layers.filter(l => saved[l.id] ?? l.on).map(l => l.id));
}
