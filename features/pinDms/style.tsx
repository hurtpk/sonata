/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How a pin category's name looks: a solid colour or a gradient (Sonata's
// presets or your own), plus optional effects. Used by the DM list header and
// the live preview in the category window.

import { classes } from "@utils/misc";

import { GRADIENTS } from "../../sonata/accent";

export type FillMode = "solid" | "gradient";
export type EffectId = "sparkles" | "shine" | "glow" | "flow" | "underline";

export interface CategoryStyle {
    mode: FillMode;
    /** A preset ID, or "custom". */
    gradient: string;
    a: string;
    b: string;
    angle: number;
    effects: EffectId[];
}

export interface GradientChoice { id: string; name: string; colors: string[]; }

export const GRADIENT_CHOICES: GradientChoice[] = [
    ...GRADIENTS.map(g => ({ id: g.id, name: g.name, colors: [g.a, g.b] })),
    { id: "gold", name: "Gold", colors: ["#fde68a", "#f59e0b", "#b45309"] },
    { id: "rose", name: "Rose", colors: ["#fecdd3", "#fb7185", "#be123c"] },
    { id: "mint", name: "Mint", colors: ["#a7f3d0", "#34d399", "#0d9488"] },
    { id: "dusk", name: "Dusk", colors: ["#c084fc", "#f472b6", "#fb923c"] },
    { id: "rainbow", name: "Rainbow", colors: ["#f87171", "#fbbf24", "#4ade80", "#38bdf8", "#c084fc"] },
];

export const EFFECTS: { id: EffectId; name: string; emoji: string; blurb: string; gradientOnly?: boolean; }[] = [
    { id: "sparkles", name: "Sparkles", emoji: "✨", blurb: "Little stars twinkle around the name" },
    { id: "shine", name: "Shine", emoji: "💫", blurb: "A soft light sweeps across the letters" },
    { id: "glow", name: "Glow", emoji: "🌟", blurb: "A gentle halo in the name's colours" },
    { id: "flow", name: "Flow", emoji: "🌊", blurb: "The gradient drifts slowly through the text", gradientOnly: true },
    { id: "underline", name: "Underline", emoji: "〰️", blurb: "A fading line in the same colours" },
];

export const DEFAULT_STYLE: CategoryStyle = { mode: "solid", gradient: "aurora", a: "#22d3ee", b: "#8b5cf6", angle: 90, effects: [] };

export const hexOf = (color: number) => `#${(color >>> 0 & 0xffffff).toString(16).padStart(6, "0")}`;
export const numOf = (hex: string) => parseInt(hex.replace("#", ""), 16) || 0;

export function normalizeStyle(style: Partial<CategoryStyle> | undefined): CategoryStyle {
    return { ...DEFAULT_STYLE, ...style, effects: [...(style?.effects ?? [])] };
}

/** The name's colours, first to last. */
export function colorsOf(style: CategoryStyle, color: number): string[] {
    if (style.mode === "solid") return [hexOf(color)];
    if (style.gradient === "custom") return [style.a, style.b];
    return GRADIENT_CHOICES.find(g => g.id === style.gradient)?.colors ?? GRADIENT_CHOICES[0].colors;
}

export function StyledName({ name, color, style: raw, className }: { name: string; color: number; style?: Partial<CategoryStyle>; className?: string; }) {
    const style = normalizeStyle(raw);
    const colors = colorsOf(style, color);
    const has = (e: EffectId) => style.effects.includes(e) && !(e === "flow" && style.mode === "solid");
    const fill = colors.length === 1
        ? `linear-gradient(${colors[0]}, ${colors[0]})`
        : has("flow")
            // Mirrored, so the flowing loop is seamless.
            ? `linear-gradient(90deg, ${[...colors, ...colors.slice(0, -1).reverse()].join(", ")})`
            : `linear-gradient(${style.angle}deg, ${colors.join(", ")})`;

    const vars = {
        "--pd-fill": fill,
        "--pd-a": colors[0],
        "--pd-b": colors[colors.length - 1],
    } as React.CSSProperties;

    return (
        <span
            className={classes("vc-pindms-name", ...style.effects.filter(has).map(e => `vc-pindms-fx-${e}`), className)}
            style={vars}
        >
            <span className="vc-pindms-name-text" data-text={name}>{name}</span>
            {has("sparkles") && (
                <span className="vc-pindms-sparkles" aria-hidden>
                    <i>✦</i><i>✧</i><i>✦</i><i>⋆</i>
                </span>
            )}
        </span>
    );
}
