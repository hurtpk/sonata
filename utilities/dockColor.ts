/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The dock's look, set in Sonata → Dock: its buttons' colour (all together),
// whether they stack into rows or squeeze onto one line, and how big they are.
// The colour can also come from the Theme Studio theme that's on; the dock
// setting wins over the theme, and with neither the buttons keep Discord's own
// colour. Buttons that are lit up (on, warning, picked) keep their own colour.

import { Settings, SettingsStore } from "@api/Settings";

import { getChannelSettingsAccent } from "../controller/accent";
import { DEFAULT_ACCENT } from "../sonata/accent";
import { dockColorCss, DockLayout, dockLayoutCss, DockSize } from "./dockColorCss";

const STYLE_ID = "sonata-dock-color";
const HEX = /^#[0-9a-f]{6}$/i;

/** "" = Discord's colour, "accent" = Sonata's accent, or a hex code. */
export type DockColor = "" | "accent" | string;

export const dockColorOf = (store: any): DockColor => {
    const v = String(store?.dockColor ?? "").trim();
    return v === "accent" || HEX.test(v) ? v : "";
};

export const dockLayoutOf = (store: any): DockLayout => store?.dockLayout === "line" ? "line" : "stack";
export const dockSizeOf = (store: any): DockSize => store?.dockSize === "small" || store?.dockSize === "large" ? store.dockSize : "normal";

function apply() {
    const store = (Settings.plugins as any).Sonata;
    const v = dockColorOf(store);
    const root = document.documentElement;
    let css = dockLayoutCss(dockLayoutOf(store), dockSizeOf(store));
    if (v) css += dockColorCss(v === "accent" ? (getChannelSettingsAccent() ?? DEFAULT_ACCENT) : v);
    root.toggleAttribute("data-sonata-dock-color", !!v);

    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!css) { el?.remove(); return; }
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    el.textContent = css;
}

const KEYS = new Set(["dockColor", "dockLayout", "dockSize", "aboutAmbientColor", "sonataAccentMode", "sonataGradient", "sonataGradientA", "sonataGradientB", "sonataHolidays", "sonataSouthern"]);
const onChange = (_: unknown, path: string) => {
    const m = /^plugins\.Sonata\.(.+)$/.exec(path);
    if (m && KEYS.has(m[1])) apply();
};

export function startDockColor() {
    apply();
    SettingsStore.addGlobalChangeListener(onChange);
}

export function stopDockColor() {
    SettingsStore.removeGlobalChangeListener(onChange);
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.removeAttribute("data-sonata-dock-color");
}
