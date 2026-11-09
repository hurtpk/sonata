/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./nameEffects.css";

import { classes } from "@utils/misc";
import { SonataGlyph } from "../../utilities/icons";

const EFFECTS = [
    { id: "sparkles", name: "Sparkles", icon: "sparkles", blurb: "Little stars twinkle around the name." },
    { id: "shine", name: "Shine", icon: "stars", blurb: "A soft highlight sweeps across." },
    { id: "glow", name: "Glow", icon: "sparkles", blurb: "A halo slowly brightens and fades." },
    { id: "flow", name: "Flow", icon: "water", blurb: "The gradient drifts across the name.", gradientOnly: true },
    { id: "underline", name: "Underline", icon: "waveform", blurb: "A line fades out at the edges." },
    { id: "neon", name: "Neon", icon: "bolt", blurb: "A bright, steady outline in your colors." },
    { id: "orbit", name: "Orbit", icon: "planet", blurb: "Two lights travel around the edges." },
    { id: "ripple", name: "Ripple", icon: "live", blurb: "A thin ring expands and fades." },
    { id: "scanlines", name: "Scanlines", icon: "list", blurb: "Fine horizontal stripes give it a retro look." },
    { id: "frost", name: "Frost", icon: "snowflake", blurb: "A dotted, icy edge catches the light." },
] as const;

export type EffectId = typeof EFFECTS[number]["id"];

export function normalizeEffects(value: unknown): EffectId[] {
    return Array.isArray(value) ? EFFECTS.filter(effect => value.includes(effect.id)).map(effect => effect.id) : [];
}

export function effectClasses(effects: readonly EffectId[], gradient: boolean) {
    return effects.filter(effect => gradient || effect !== "flow").map(effect => effect === "sparkles" ? "vc-namefx-has-sparkles" : "vc-namefx-" + effect);
}

export function EffectPicker({ effects, gradient, onChange, compact }: {
    effects: readonly EffectId[];
    gradient: boolean;
    onChange(effects: EffectId[]): void;
    compact?: boolean;
}) {
    return <div className={classes("vc-namefx-picker", compact && "vc-namefx-picker-compact")}>
        {EFFECTS.map(effect => {
            const disabled = "gradientOnly" in effect && !gradient;
            const selected = effects.includes(effect.id);
            const hint = disabled ? "Needs a gradient" : effect.blurb;
            return <button key={effect.id} type="button" disabled={disabled} aria-pressed={selected}
                className={classes("vc-namefx-choice", selected && "vc-namefx-choice-on")}
                onClick={() => onChange(selected ? effects.filter(id => id !== effect.id) : [...effects, effect.id])} title={hint}>
                <span className="vc-namefx-emoji" aria-hidden><SonataGlyph name={effect.icon} /></span>
                <span className="vc-namefx-choice-name">{effect.name}</span>
                <span className="vc-namefx-hint">{hint}</span>
            </button>;
        })}
    </div>;
}

export function EffectDecorations({ effects }: { effects: readonly EffectId[]; }) {
    return <>
        {effects.includes("sparkles") && <span className="vc-namefx-sparkles" aria-hidden><i>✦</i><i>✧</i><i>✦</i><i>⋆</i></span>}
        {effects.includes("neon") && <span className="vc-namefx-neon-rim" aria-hidden />}
        {effects.includes("orbit") && <span className="vc-namefx-orbit-dots" aria-hidden><i /><i /></span>}
        {effects.includes("ripple") && <span className="vc-namefx-ripple-ring" aria-hidden />}
        {effects.includes("scanlines") && <span className="vc-namefx-scanline-overlay" aria-hidden />}
        {effects.includes("frost") && <span className="vc-namefx-frost-rim" aria-hidden />}
    </>;
}
