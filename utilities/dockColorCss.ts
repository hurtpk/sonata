/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The CSS that colours every dock button at once. Buttons that are lit up (on, warning,
 * picked) keep their own colour. `strong` is Sonata → Dock's own colour, which wins over
 * a Theme Studio theme's.
 */
export function dockColorCss(color: string, strong = true) {
    const scope = strong ? ":root[data-sonata-dock-color] " : "";
    const idle = `${scope}.vc-plugin-dock-item:not(.vc-plugin-dock-glowing, .vc-plugin-dock-glow-green, .vc-plugin-dock-selected)`;
    return `${idle} button, ${idle} button svg { color: ${color} !important; }
${idle}:hover button, ${idle}:hover button svg { color: color-mix(in srgb, ${color} 80%, white) !important; }`;
}
