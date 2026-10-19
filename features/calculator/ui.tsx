/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Small pieces the Calculator's Money, Dates and Tools tabs are built from.

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import { showToast } from "@webpack/common";
import type { ReactNode } from "react";

export const cc = classNameFactory("vc-calc-");

/** A typed number ("1,200.50" → 1200.5), NaN when empty or not a number. */
export const num = (s: string) => s.trim() === "" ? NaN : Number(s.replace(/[,\s]/g, "").replace(/^[$€£¥₹]/, ""));
export const ok = (...ns: number[]) => ns.every(n => Number.isFinite(n));

/** Money-style: 1,234.50. */
export const fmt = (n: number, digits = 2) => Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
/** Plain numbers: up to 4 decimals, no trailing zeros. */
export const fmtN = (n: number, max = 4) => Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: max }) : "—";

export function Card({ title, icon, children, wide }: { title: string; icon: string; children: ReactNode; wide?: boolean; }) {
    return (
        <section className={classes(cc("tool"), wide && cc("tool-wide"))}>
            <h3 className={cc("tool-title")}><span aria-hidden>{icon}</span> {title}</h3>
            {children}
        </section>
    );
}

export function Field({ label, value, onChange, prefix, suffix, placeholder, type = "text", width }: {
    label: string; value: string; onChange(v: string): void; prefix?: string; suffix?: string; placeholder?: string; type?: string; width?: number;
}) {
    return (
        <label className={cc("field")} style={width ? { flex: `0 0 ${width}px` } : undefined}>
            <span className={cc("field-label")}>{label}</span>
            <span className={cc("field-box")}>
                {prefix && <span className={cc("affix")}>{prefix}</span>}
                <input type={type} inputMode={type === "text" ? "decimal" : undefined} value={value} placeholder={placeholder} onChange={e => onChange(e.currentTarget.value)} />
                {suffix && <span className={cc("affix")}>{suffix}</span>}
            </span>
        </label>
    );
}

export function Row({ children }: { children: ReactNode; }) {
    return <div className={cc("fields")}>{children}</div>;
}

export function Out({ label, value, big, hint }: { label: string; value: string; big?: boolean; hint?: string; }) {
    const usable = value !== "—";
    return (
        <div className={classes(cc("out"), big && cc("out-big"))}>
            <span className={cc("out-label")}>{label}</span>
            <button type="button" className={cc("out-value")} disabled={!usable} title="Copy (right-click to put it in your message)"
                onClick={() => navigator.clipboard.writeText(value).then(() => showToast("Copied", "success"))}
                onContextMenu={e => { e.preventDefault(); insertTextIntoChatInputBox(`${value} `); showToast("Added to your message", "success"); }}>
                {value}
            </button>
            {hint && <span className={cc("out-hint")}>{hint}</span>}
        </div>
    );
}

export function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: [NoInfer<T>, string][]; onChange(v: NoInfer<T>): void; }) {
    return (
        <div className={cc("chips")}>
            {options.map(([v, label]) => <button key={String(v)} type="button" className={classes(cc("chip"), value === v && cc("chip-on"))} onClick={() => onChange(v)}>{label}</button>)}
        </div>
    );
}
