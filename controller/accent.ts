/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";

import { accentColors, DEFAULT_ACCENT } from "../sonata/accent";

/**
 * The accent color picked in Sonata's Plugin Utilities → About tab (or, if
 * Sonata isn't set up yet, the old ChannelSettings one). Only a plain hex
 * color is accepted, since it's written straight into CSS. Undefined = Auto.
 */
export function getChannelSettingsAccent(): string | undefined {
    const plugins = Settings.plugins as any;
    // Sonata's accent (a gradient's first colour, or today's season or holiday colour).
    if (plugins.Sonata?.sonataAccentMode && plugins.Sonata.sonataAccentMode !== "solid") return accentColors(plugins.Sonata)[0];
    const value = (plugins.Sonata?.aboutAmbientColor || plugins.ChannelSettings?.aboutAmbientColor)?.trim();
    return value && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : undefined;
}

/**
 * The colour for a feature's window: always Sonata's theme colour, so every
 * window matches. (Features where you pick colours yourself — like Birthday
 * Reminders — use those on top.)
 */
export function windowAccent(_feature?: string): string {
    return getChannelSettingsAccent() ?? DEFAULT_ACCENT;
}
