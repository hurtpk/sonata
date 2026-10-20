/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The dock buttons' colour, all together: set in Sonata → Dock, or by the
// Theme Studio theme that's on. The dock setting wins over the theme; with
// neither, the buttons keep Discord's own colour. Buttons that are lit up
// (on, warning, picked) keep their own colour either way.

import { Settings, SettingsStore } from "@api/Settings";

import { getChannelSettingsAccent } from "../controller/accent";
import { DEFAULT_ACCENT } from "../sonata/accent";
import { dockColorCss } from "./dockColorCss";

const STYLE_ID = "sonata-dock-color";
const HEX = /^#[0-9a-f]{6}$/i;

/** "" = Discord's colour, "accent" = Sonata's accent, or a hex code. */
export type DockColor = "" | "accent" | string;

export const dockColorOf = (store: any): DockColor => {
    const v = String(store?.dockColor ?? "").trim();
    return v === "accent" || HEX.test(v) ? v : "";
};

function apply() {
    const v = dockColorOf((Settings.plugins as any).Sonata);
    const root = document.documentElement;
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!v) {
        root.removeAttribute("data-sonata-dock-color");
        el?.remove();
        return;
    }
    const color = v === "accent" ? (getChannelSettingsAccent() ?? DEFAULT_ACCENT) : v;
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    el.textContent = dockColorCss(color);
    root.setAttribute("data-sonata-dock-color", "");
}

const KEYS = new Set(["dockColor", "aboutAmbientColor", "sonataAccentMode", "sonataGradient", "sonataGradientA", "sonataGradientB", "sonataHolidays", "sonataSouthern"]);
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
