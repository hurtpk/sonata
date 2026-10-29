/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A Sonata setup — appearance, dock and which features are on — packed into a
// short code (JSON, compressed, base64), and applied back from one. Nothing
// personal goes in it: no channels, DMs, webhooks or IDs other than plugin names.

import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";

import { QOL_NAME } from "../../featureSettings";
import { GRADIENTS } from "../../sonata/accent";
import { refreshDock } from "../../utilities/dock";
import { clearCustomDockButtons, FEATURE_PREFIX, parseStringMap, syncCustomDockButtons } from "../../utilities/shared";

export type Part = "look" | "dock" | "features";

const LOOK_KEYS = [
    "aboutAmbientColor", "sonataAccentMode", "sonataGradient",
    "sonataGradientA", "sonataGradientB", "sonataHolidays", "sonataSouthern", "sonataOccasion",
    "sonataFeatureIcons", "sonataFeatureIconMap",
] as const;
const DOCK_KEYS = ["dockOrder", "dockHidden", "customDock", "dockIcons"] as const;

export interface Setup {
    v: 1;
    from?: string;
    look?: Record<string, unknown>;
    dock?: Record<string, unknown>;
    /** Feature keys that are switched off (everything else is on). */
    off?: string[];
}

const store = () => (Settings.plugins as any)[QOL_NAME] ?? {};

export function collect(parts: Part[], from?: string): Setup {
    const s = store();
    const setup: Setup = { v: 1, from };
    if (parts.includes("look")) setup.look = Object.fromEntries(LOOK_KEYS.filter(k => s[k] !== undefined).map(k => [k, s[k]]));
    if (parts.includes("dock")) setup.dock = Object.fromEntries(DOCK_KEYS.filter(k => s[k] !== undefined).map(k => [k, s[k]]));
    if (parts.includes("features")) setup.off = Object.keys(s).filter(k => k.startsWith("on_") && s[k] === false).map(k => k.slice(3));
    return setup;
}

// ─── Packing ───

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
    const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as any);
    return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encode(setup: Setup) {
    const json = new TextEncoder().encode(JSON.stringify(setup));
    return toB64(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decode(code: string): Promise<Setup | null> {
    try {
        const raw = code.trim().replace(/^sset1\./, "");
        const json = await pipe(fromB64(raw), new DecompressionStream("deflate-raw"));
        const setup = JSON.parse(new TextDecoder().decode(json));
        return setup?.v === 1 ? setup : null;
    } catch {
        return null;
    }
}

export const CODE_RE = /\|\|sset1\.([A-Za-z0-9_-]+)\|\|/;

// ─── Describing ───

export interface Summary { look?: string; accent?: string; colors?: string[]; dock?: string; features?: string; }

export function describe(setup: Setup): Summary {
    const out: Summary = {};
    const l = setup.look as any;
    if (l) {
        out.look = "Sonata";
        const mode = l.sonataAccentMode ?? "solid";
        if (mode === "gradient") {
            const g = l.sonataGradient === "custom" ? { name: "Custom", a: l.sonataGradientA, b: l.sonataGradientB } : GRADIENTS.find(x => x.id === l.sonataGradient) ?? GRADIENTS[0];
            out.accent = `${g.name} gradient`;
            out.colors = [g.a, g.b];
        } else if (mode === "seasonal") {
            out.accent = "Seasons & holidays";
        } else if (mode === "album") {
            out.accent = "Album art";
            if (l.aboutAmbientColor) out.colors = [l.aboutAmbientColor];
        } else {
            out.accent = "Solid colour";
            if (l.aboutAmbientColor) out.colors = [l.aboutAmbientColor];
        }
    }
    if (setup.dock) {
        const custom = Object.keys(parseStringMap(setup.dock.customDock as string));
        out.dock = custom.length ? `${custom.length} button${custom.length === 1 ? "" : "s"} added, plus order and icons` : "Button order and icons";
    }
    if (setup.off) out.features = setup.off.length ? `${setup.off.length} feature${setup.off.length === 1 ? "" : "s"} switched off` : "Every feature on";
    return out;
}

/** One line for people without Sonata. */
export function summaryLine(setup: Setup) {
    const d = describe(setup);
    return [d.look && `🎨 ${d.look}`, d.accent && `🌈 ${d.accent}`, d.dock && "🧩 dock", d.features && "⚙️ features"].filter(Boolean).join(" · ");
}

// ─── Applying (with undo) ───

export type Snapshot = Record<string, unknown>;

/** Plugins named in a shared dock that you don't have are left out. */
function onlyYourPlugins(customDock: string) {
    const map = parseStringMap(customDock);
    const allPlugins: Record<string, unknown> = (window as any).Vencord?.Plugins?.plugins ?? {};
    return JSON.stringify(Object.fromEntries(Object.entries(map).filter(([name]) => name.startsWith(FEATURE_PREFIX) || (name in allPlugins && isPluginEnabled(name)))));
}

/** Applies the chosen parts; returns what they replaced, for Undo, and whether a reload is needed. */
export function apply(setup: Setup, parts: Part[]): { before: Snapshot; reload: boolean; } {
    const s = store();
    const before: Snapshot = {};
    const set = (k: string, v: unknown) => {
        if (!(k in before)) before[k] = s[k];
        s[k] = v;
    };
    let reload = false;

    if (parts.includes("look") && setup.look) {
        for (const [k, v] of Object.entries(setup.look)) if ((LOOK_KEYS as readonly string[]).includes(k)) set(k, v);
    }
    if (parts.includes("dock") && setup.dock) {
        clearCustomDockButtons(s.customDock);
        for (const [k, v] of Object.entries(setup.dock)) {
            if (!(DOCK_KEYS as readonly string[]).includes(k)) continue;
            set(k, k === "customDock" ? onlyYourPlugins(String(v)) : v);
        }
        syncCustomDockButtons(s.customDock);
        refreshDock();
    }
    if (parts.includes("features") && setup.off) {
        const off = new Set(setup.off);
        for (const k of Object.keys(s)) {
            if (!k.startsWith("on_")) continue;
            const want = !off.has(k.slice(3));
            if ((s[k] !== false) !== want) { set(k, want); reload = true; }
        }
    }
    return { before, reload };
}

export function undo(before: Snapshot) {
    const s = store();
    const dockTouched = "customDock" in before;
    if (dockTouched) clearCustomDockButtons(s.customDock);
    for (const [k, v] of Object.entries(before)) s[k] = v;
    if (dockTouched) { syncCustomDockButtons(s.customDock); refreshDock(); }
    return Object.keys(before).some(k => k.startsWith("on_"));
}
