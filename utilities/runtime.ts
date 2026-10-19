/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Plugin Utilities' always-on parts: global keybinds and the dock under the
// user panel. Started and stopped by Sonata.

import { Settings } from "@api/Settings";

import { setDockOverride } from "./dock";
import { DOCK_ICON_MAP } from "./icons";
import { clearCustomDockButtons, matchKeybind, parseKeybind, parseStringArray, parseStringMap, syncCustomDockButtons } from "./shared";
import type { UtilitiesStore } from "./UtilitiesView";

interface RuntimeStore extends UtilitiesStore { keybindMap: string; }

let store: RuntimeStore | null = null;

function handleKeybind(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target) {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        if (target.isContentEditable) return;
    }
    if (!store) return;

    const map = parseStringMap(store.keybindMap);
    for (const [id, kbStr] of Object.entries(map)) {
        const kb = parseKeybind(kbStr);
        if (!kb || !matchKeybind(e, kb)) continue;

        const dot = id.indexOf(".");
        if (dot < 0) continue;
        const bucket = Settings.plugins[id.slice(0, dot)];
        if (!bucket) continue;

        const key = id.slice(dot + 1);
        bucket[key] = !bucket[key];
        e.preventDefault();
        e.stopPropagation();
        return;
    }
}

export function startUtilities(s: RuntimeStore) {
    store = s;
    document.addEventListener("keydown", handleKeybind, true);
    try {
        setDockOverride({
            getHidden: () => new Set(parseStringArray(s.dockHidden)),
            getOrder: () => parseStringArray(s.dockOrder),
            getIcon: id => {
                const key = parseStringMap(s.dockIcons)[id];
                return key ? DOCK_ICON_MAP[key]?.Icon : undefined;
            },
        });
        syncCustomDockButtons(s.customDock);
    } catch (e) {
        console.warn("[Sonata] couldn't set up dock buttons", e);
    }
}

export function stopUtilities() {
    document.removeEventListener("keydown", handleKeybind, true);
    try {
        setDockOverride(null);
        if (store) clearCustomDockButtons(store.customDock);
    } catch { }
    store = null;
}
