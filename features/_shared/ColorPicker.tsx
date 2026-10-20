/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata's colour picker: a square for how bright and how strong, a strip
// for the colour itself, an eyedropper, and the colour as a hex code you can
// type or copy. Used instead of the system's picker, which shows R, G and B.

import "./colorPicker.css";

import { classes } from "@utils/misc";
import { useEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties, ReactNode } from "react";

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc" or "abc" → "#aabbcc"; anything else → null. */
export function fullHex(v: string): string | null {
    const m = HEX.exec(v.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join("") : m[1];
    return `#${h.toLowerCase()}`;
}

interface Hsv { h: number; s: number; v: number; }

function toHsv(hex: string): Hsv {
    const h = (fullHex(hex) ?? "#000000").slice(1);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let hue = 0;
    if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (hue * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function toHex({ h, s, v }: Hsv) {
    const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return `#${[f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Follows the pointer from a press until it's let go, reporting where it is (0–1) in the element. */
function useDrag(onMove: (x: number, y: number) => void) {
    return (e: React.PointerEvent<HTMLElement>) => {
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const at = (ev: { clientX: number; clientY: number; }) => {
            const r = el.getBoundingClientRect();
            onMove(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        };
        at(e);
        const move = (ev: PointerEvent) => at(ev);
        const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
    };
}

function Popover({ value, onChange, onClose, anchor }: { value: string; onChange(v: string): void; onClose(): void; anchor: DOMRect; }) {
    const [hsv, setHsv] = useState<Hsv>(() => toHsv(value));
    const [text, setText] = useState(fullHex(value) ?? "#000000");
    const box = useRef<HTMLDivElement>(null);
    const hex = toHex(hsv);

    // Someone else changed it (like the hex box beside the swatch): follow, unless it's the same colour.
    useEffect(() => { if (fullHex(value) !== hex) { setHsv(toHsv(value)); setText(fullHex(value) ?? text); } }, [value]);

    const pick = (next: Hsv) => { setHsv(next); const h = toHex(next); setText(h); onChange(h); };

    // Clicking anywhere else, or Esc, closes it (without closing the window too).
    useEffect(() => {
        const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
        const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); } };
        const t = setTimeout(() => document.addEventListener("pointerdown", down, true));
        document.addEventListener("keydown", key, true);
        return () => { clearTimeout(t); document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
    }, []);

    const square = useDrag((x, y) => pick({ ...hsv, s: x, v: 1 - y }));
    const strip = useDrag(x => pick({ ...hsv, h: Math.min(359.9, x * 360) }));
    const dropper = typeof (window as any).EyeDropper === "function";

    // Under the swatch, or above it when there isn't room, and never off the side of the screen.
    const W = 232, H = 236;
    const top = anchor.bottom + 8 + H > innerHeight ? Math.max(8, anchor.top - 8 - H) : anchor.bottom + 8;
    const left = Math.min(innerWidth - W - 8, Math.max(8, anchor.left));

    return (
        <div ref={box} className="vc-cp" role="dialog" aria-label="Pick a colour" style={{ top, left, width: W } as CSSProperties}>
            <div className="vc-cp-square" style={{ "--cp-hue": `hsl(${hsv.h} 100% 50%)` } as CSSProperties} onPointerDown={square}>
                <i className="vc-cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
            </div>
            <div className="vc-cp-strip" onPointerDown={strip}>
                <i className="vc-cp-knob" style={{ left: `${hsv.h / 360 * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
            </div>
            <div className="vc-cp-row">
                {dropper && (
                    <button type="button" className="vc-cp-drop" title="Pick a colour from the screen" aria-label="Pick a colour from the screen"
                        onClick={async () => { try { const r = await new (window as any).EyeDropper().open(); const h = fullHex(r.sRGBHex); if (h) pick(toHsv(h)); } catch { } }}>
                        <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" /></svg>
                    </button>
                )}
                <span className="vc-cp-now" style={{ background: hex }} />
                <label className="vc-cp-hex">
                    <span>HEX</span>
                    <input value={text} spellCheck={false} maxLength={7} aria-label="Hex code"
                        onChange={e => { const v = e.currentTarget.value; setText(v); const h = fullHex(v); if (h) { setHsv(toHsv(h)); onChange(h); } }}
                        onBlur={() => setText(hex)}
                        onKeyDown={e => { if (e.key === "Enter") onClose(); }} />
                </label>
            </div>
        </div>
    );
}

/**
 * A colour swatch that opens Sonata's picker. Give it the swatch's own class (so it keeps its size and
 * shape); `children` goes inside the button, for swatches with a label like "Own".
 */
export function ColorPicker({ value, onChange, label, className, children }: { value: string; onChange(v: string): void; label?: string; className?: string; children?: ReactNode; }) {
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const btn = useRef<HTMLButtonElement>(null);
    const hex = fullHex(value) ?? "#000000";
    return (
        <>
            <button ref={btn} type="button" aria-label={label ?? "Pick a colour"} aria-expanded={!!anchor} title={label}
                className={classes("vc-cp-swatch", className)} style={{ "--cp-color": hex } as CSSProperties}
                onClick={() => setAnchor(a => a ? null : btn.current!.getBoundingClientRect())}>
                {children}
            </button>
            {anchor && <Popover value={hex} onChange={onChange} onClose={() => setAnchor(null)} anchor={anchor} />}
        </>
    );
}
