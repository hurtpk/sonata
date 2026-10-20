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

export type DockLayout = "stack" | "line";
export type DockSize = "small" | "normal" | "large";

/** Button and icon sizes, in px. */
export const DOCK_SIZES: Record<DockSize, [number, number]> = { small: [26, 16], normal: [32, 20], large: [38, 24] };

/** How the dock lays its buttons out, and how big they are. */
export function dockLayoutCss(layout: DockLayout, size: DockSize) {
    const [btn, icon] = DOCK_SIZES[size];
    let css = "";
    if (size !== "normal") css += `.vc-plugin-dock-item button { width: ${btn}px !important; height: ${btn}px !important; min-width: 0 !important; padding: 0 !important; display: grid !important; place-items: center !important; }
.vc-plugin-dock-item button svg, .vc-plugin-dock-item button [class*="lottieIcon"] { width: ${icon}px !important; height: ${icon}px !important; }
.vc-plugin-dock-item.vc-plugin-dock-selected { width: ${btn}px; height: ${btn}px; }\n`;
    // One line: never wrap; each button takes an equal share of the room, up to its normal size, and the icons shrink with it.
    if (layout === "line") css += `.vc-plugin-dock-buttons { flex-wrap: nowrap !important; justify-content: space-between !important; gap: 0 !important; padding-left: 4px !important; padding-right: 4px !important; }
.vc-plugin-dock-buttons > .vc-plugin-dock-item { flex: 1 1 0; min-width: 0; max-width: ${btn}px; display: flex; justify-content: center; }
.vc-plugin-dock-buttons > .vc-plugin-dock-item button { width: 100% !important; max-width: ${btn}px !important; height: auto !important; aspect-ratio: 1; min-width: 0 !important; padding: 0 !important; display: grid !important; place-items: center !important; }
.vc-plugin-dock-buttons > .vc-plugin-dock-item button svg, .vc-plugin-dock-buttons > .vc-plugin-dock-item button [class*="lottieIcon"] { width: min(${icon}px, 70%) !important; height: auto !important; aspect-ratio: 1; }\n`;
    return css;
}
