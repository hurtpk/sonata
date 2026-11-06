/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Picking how a tag looks: a colour (from the palette or your own), or a
// gradient (a ready-made one, or your own with 2–5 colours).

import { classes } from "@utils/misc";
import { useState } from "@webpack/common";

import { effectClasses, EffectDecorations, EffectPicker, normalizeEffects } from "../_shared/NameEffects";
import { COLORS, GRADIENTS, isGradient, Look, lookStyle, sameLook } from "./store";

const MAX_STOPS = 5;

/** A tag chip, in any look. */
export function TagChip({ look, name, title, className }: { look: Look; name: string; title?: string; className?: string; }) {
    const gradient = isGradient(look);
    const effects = normalizeEffects(look.effects);
    const style = {
        ...lookStyle(look, gradient && effects.includes("flow")),
        "--namefx-a": look.gradient?.[0] ?? look.color,
        "--namefx-b": look.gradient?.at(-1) ?? look.color,
    } as React.CSSProperties;
    return <span className={classes("vc-ptag", gradient && "vc-ptag-grad", ...effectClasses(effects, gradient), className)} style={style} title={title}>
        {effects.length > 0 && <EffectDecorations effects={effects} />}
        <span className="vc-ptag-text">{name}</span>
    </span>;
}

/** A colour swatch that opens your computer's colour picker. */
function CustomColor({ value, on, onPick, title }: { value: string; on: boolean; onPick(c: string): void; title: string; }) {
    return (
        <label className={classes("vc-ptag-color", "vc-ptag-custom", on && "vc-ptag-color-on")} style={on ? { background: value } : undefined} title={title}>
            {!on && <span aria-hidden>+</span>}
            <input type="color" value={value} onChange={e => onPick(e.currentTarget.value)} />
        </label>
    );
}

export function LookPicker({ value, onChange }: { value: Look; onChange(look: Look): void; }) {
    const [mode, setMode] = useState<"solid" | "gradient">(isGradient(value) ? "gradient" : "solid");
    const custom = !isGradient(value) && !COLORS.includes(value.color.toLowerCase());
    const stops = isGradient(value) ? value.gradient! : [value.color, COLORS[(COLORS.indexOf(value.color) + 5) % COLORS.length] ?? "#eb459e"];
    const effects = normalizeEffects(value.effects);
    const setStops = (list: string[]) => onChange({ ...value, color: list[0], gradient: list });
    const setSolid = (color: string) => onChange({ ...value, color, gradient: undefined });
    const presetOn = isGradient(value) && GRADIENTS.some(([, g]) => sameLook(value, { color: g[0], gradient: g }));

    return (
        <div className="vc-ptag-look">
            <div className="vc-tool-tabs vc-ptag-look-tabs">
                <button type="button" className={classes("vc-tool-tab", mode === "solid" && "vc-tool-tab-on")} onClick={() => { setMode("solid"); if (isGradient(value)) setSolid(value.color); }}>Colour</button>
                <button type="button" className={classes("vc-tool-tab", mode === "gradient" && "vc-tool-tab-on")} onClick={() => { setMode("gradient"); if (!isGradient(value)) setStops(stops); }}>Gradient</button>
            </div>

            {mode === "solid" ? (
                <div className="vc-ptag-solid">
                    <div className="vc-ptag-colors">
                        {COLORS.map(c => (
                            <button key={c} type="button" className={classes("vc-ptag-color", !isGradient(value) && value.color.toLowerCase() === c && "vc-ptag-color-on")} style={{ background: c }} title={c} onClick={() => setSolid(c)} />
                        ))}
                    </div>
                    <div className="vc-ptag-custom-wrap">
                        <CustomColor value={custom ? value.color : "#ff8800"} on={custom} onPick={setSolid} title="Your own colour" />
                        <span>{custom ? value.color : "Custom"}</span>
                    </div>
                </div>
            ) : (
                <>
                    <div className="vc-ptag-grads">
                        {GRADIENTS.map(([name, g]) => (
                            <button key={name} type="button" className={classes("vc-ptag-grad-pick", sameLook(value, { color: g[0], gradient: g }) && "vc-ptag-color-on")}
                                style={{ background: `linear-gradient(90deg, ${g.join(", ")})` }} title={name} onClick={() => setStops(g)} />
                        ))}
                    </div>
                    <div className="vc-ptag-stops">
                        <span className="vc-tool-hint">{presetOn ? "Change it:" : "Your gradient:"}</span>
                        {stops.map((c, i) => (
                            <span key={i} className="vc-ptag-stop">
                                <CustomColor value={c} on onPick={nc => setStops(stops.map((x, j) => j === i ? nc : x))} title="Change this colour" />
                                {stops.length > 2 && <button type="button" className="vc-ptag-stop-x" title="Remove this colour" onClick={() => setStops(stops.filter((_, j) => j !== i))}>×</button>}
                            </span>
                        ))}
                        {stops.length < MAX_STOPS && <button type="button" className="vc-tool-btn vc-ptag-stop-add" onClick={() => setStops([...stops, stops[stops.length - 1]])}>+ Colour</button>}
                        <button type="button" className="vc-tool-icon" title="Flip the gradient" onClick={() => setStops([...stops].reverse())}>⇄</button>
                    </div>
                </>
            )}
            <details className="vc-ptag-effects">
                <summary>Effects{effects.length > 0 && ` · ${effects.length}`}</summary>
                <EffectPicker compact effects={effects} gradient={isGradient(value)} onChange={effects => onChange({ ...value, effects })} />
                {effects.length > 0 && <button type="button" className="vc-tool-link" onClick={() => onChange({ ...value, effects: [] })}>Clear effects</button>}
            </details>
        </div>
    );
}
