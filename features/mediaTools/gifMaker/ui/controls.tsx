/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Small building blocks for the editor's panels.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { React, Select, useEffect, useState } from "@webpack/common";

import { GRADIENT_CHOICES } from "../../../pinDms/style";
import { fetchAllGoogleFonts, getFontFamilyCss, loadGoogleFont } from "../fonts";
import type { Fill, GoogleFontMetadata } from "../types";

export const cl = classNameFactory("vc-gifmaker-");

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode; }) {
    return (
        <section className={cl("sec")}>
            <div className={cl("sec-head")}>
                <span className={cl("sec-title")}>{title}</span>
                {aside}
            </div>
            {children}
        </section>
    );
}

export function Seg<T extends string | number>({ value, options, onChange, wrap }: { value: T; options: { value: T; label: React.ReactNode; title?: string; }[]; onChange(v: T): void; wrap?: boolean; }) {
    return (
        <div className={cl("seg", wrap && "seg-wrap")} role="radiogroup">
            {options.map(o => (
                <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title}
                    className={cl("seg-btn", o.value === value && "seg-on")} onClick={() => onChange(o.value)}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function Range({ label, value, min, max, step = 1, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void; format?(v: number): string; }) {
    return (
        <label className={cl("range")}>
            <span className={cl("range-label")}>{label}</span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.currentTarget.value))}
                style={{ "--vc-gm-fill": `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} />
            <span className={cl("range-value")}>{format ? format(value) : value}</span>
        </label>
    );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string; }) {
    return (
        <label className={cl("toggle")}>
            <span>
                <span className={cl("toggle-label")}>{label}</span>
                {hint && <span className={cl("hint")}>{hint}</span>}
            </span>
            <input type="checkbox" checked={checked} onChange={e => onChange(e.currentTarget.checked)} />
            <span className={cl("switch")} aria-hidden />
        </label>
    );
}

export function Btn({ children, onClick, primary, danger, disabled, title, on, small }: { children: React.ReactNode; onClick(): void; primary?: boolean; danger?: boolean; disabled?: boolean; title?: string; on?: boolean; small?: boolean; }) {
    return (
        <button type="button" title={title} disabled={disabled} onClick={onClick}
            className={classes(cl("btn"), primary && cl("btn-primary"), danger && cl("btn-danger"), on && cl("btn-on"), small && cl("btn-small"))}>
            {children}
        </button>
    );
}

export function Row({ children }: { children: React.ReactNode; }) {
    return <div className={cl("row")}>{children}</div>;
}

export function ColorInput({ value, onChange, title }: { value: string; onChange(v: string): void; title?: string; }) {
    return <input type="color" className={cl("color")} value={value} title={title} onChange={e => onChange(e.currentTarget.value)} />;
}

/** Solid colour or a gradient (the same gradients as Pin DMs), plus custom colours. */
export function FillPicker({ fill, onChange }: { fill: Fill; onChange(f: Fill): void; }) {
    return (
        <div className={cl("fill")}>
            <Seg value={fill.mode} onChange={mode => onChange({ ...fill, mode })} options={[{ value: "solid", label: "Solid" }, { value: "gradient", label: "Gradient" }]} />
            {fill.mode === "solid" ? (
                <div className={cl("swatches")}>
                    {["#ffffff", "#000000", "#facc15", "#f43f5e", "#22d3ee", "#a855f7", "#22c55e", "#fb923c"].map(c => (
                        <button key={c} type="button" title={c} className={cl("swatch", fill.color === c && "swatch-on")} style={{ background: c }} onClick={() => onChange({ ...fill, color: c })} />
                    ))}
                    <ColorInput value={fill.color} onChange={color => onChange({ ...fill, color })} title="Any colour" />
                </div>
            ) : (
                <>
                    <div className={cl("swatches")}>
                        {GRADIENT_CHOICES.map(g => (
                            <button key={g.id} type="button" title={g.name} className={cl("swatch", fill.colors.join() === g.colors.join() && "swatch-on")}
                                style={{ background: `linear-gradient(135deg, ${g.colors.join(", ")})` }} onClick={() => onChange({ ...fill, colors: [...g.colors] })} />
                        ))}
                    </div>
                    <div className={cl("row")}>
                        {fill.colors.map((c, i) => (
                            <ColorInput key={i} value={c} title={`Colour ${i + 1}`} onChange={v => onChange({ ...fill, colors: fill.colors.map((x, j) => j === i ? v : x) })} />
                        ))}
                        {fill.colors.length < 4 && <Btn small onClick={() => onChange({ ...fill, colors: [...fill.colors, fill.colors[fill.colors.length - 1]] })} title="Add a colour">+</Btn>}
                        {fill.colors.length > 2 && <Btn small onClick={() => onChange({ ...fill, colors: fill.colors.slice(0, -1) })} title="Remove a colour">−</Btn>}
                    </div>
                    <Range label="Angle" value={fill.angle} min={0} max={360} step={5} onChange={angle => onChange({ ...fill, angle })} format={v => `${v}°`} />
                </>
            )}
        </div>
    );
}

/** Fonts you'd reach for, one click away; the rest of Google Fonts in the list below. */
const QUICK_FONTS = ["Arial", "Anton", "Bangers", "Oswald", "Playfair Display", "Pacifico", "Comic Neue", "Permanent Marker", "Bebas Neue", "Roboto Mono"];

interface SelectOption { key: string; label: string; value: string; }

function FontLabel({ family, label }: { family: string; label: string; }) {
    useEffect(() => void loadGoogleFont(family), [family]);
    return <span style={{ fontFamily: getFontFamilyCss(family) }}>{label}</span>;
}

export function FontPicker({ value, onChange }: { value: string; onChange(f: string): void; }) {
    const [fonts, setFonts] = useState<GoogleFontMetadata[]>([]);
    const [more, setMore] = useState(false);
    useEffect(() => { if (more) void fetchAllGoogleFonts().then(setFonts); }, [more]);
    const pick = (f: string) => { void loadGoogleFont(f); onChange(f); };

    return (
        <div className={cl("fonts")}>
            <div className={cl("font-chips")}>
                {QUICK_FONTS.map(f => (
                    <button key={f} type="button" className={cl("font-chip", value === f && "font-chip-on")} onClick={() => pick(f)}>
                        <FontLabel family={f} label={f} />
                    </button>
                ))}
                {!QUICK_FONTS.includes(value) && <span className={cl("font-chip", "font-chip-on")}><FontLabel family={value} label={value} /></span>}
                <button type="button" className={cl("font-chip")} onClick={() => setMore(m => !m)}>{more ? "Fewer fonts" : "More fonts…"}</button>
            </div>
            {more && (fonts.length ? (
                <Select
                    placeholder="Search Google Fonts…"
                    options={fonts.map<SelectOption>(f => ({ key: f.family, label: f.displayName, value: f.family }))}
                    maxVisibleItems={8}
                    closeOnSelect
                    select={pick}
                    isSelected={v => v === value}
                    serialize={v => String(v)}
                    renderOptionLabel={(o: SelectOption) => <FontLabel family={o.value} label={o.label} />}
                />
            ) : <span className={cl("hint")}>Loading fonts…</span>)}
        </div>
    );
}
