/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The layouts Sonata's windows share: a list with the picked thing's details
// beside it, settings with the name on the left and the control on the right,
// and the switches, counters and choices those use.

import { classes } from "@utils/misc";
import type { ReactNode } from "react";

/* ── List + details ── */

/** A list on the left and the picked item's details on the right. Put it in a `flush` Window. */
export function Split({ list, children, listWidth }: { list: ReactNode; children: ReactNode; listWidth?: number; }) {
    return (
        <div className="vc-sw-split" style={listWidth ? { gridTemplateColumns: `${listWidth}px minmax(0, 1fr)` } : undefined}>
            <div className="vc-sw-split-list">{list}</div>
            <div className="vc-sw-split-detail">{children}</div>
        </div>
    );
}

/** The small heading over a list: a name and a count on the left, anything on the right. */
export function ListHead({ children, right }: { children: ReactNode; right?: ReactNode; }) {
    return <div className="vc-sw-listhead"><span>{children}</span>{right != null && <span>{right}</span>}</div>;
}

/** One row in a Split's list. */
export function ListRow({ pic, title, sub, dot, on, onClick, right }: { pic?: ReactNode; title: ReactNode; sub?: ReactNode; dot?: string; on?: boolean; onClick?(): void; right?: ReactNode; }) {
    return (
        <button type="button" className={classes("vc-sw-row", on && "vc-sw-row-on")} aria-pressed={on} onClick={onClick}>
            {pic != null && <span className="vc-sw-pic">{pic}</span>}
            <span className="vc-sw-row-text">
                <span className="vc-sw-row-title">{title}</span>
                {sub != null && <span className="vc-sw-row-sub">{dot && <i className="vc-sw-status" style={{ background: dot }} />}{sub}</span>}
            </span>
            {right}
        </button>
    );
}

/** The top of a details pane: a big picture, a name and a line about it. */
export function DetailHead({ pic, title, sub, dot, children }: { pic?: ReactNode; title: ReactNode; sub?: ReactNode; dot?: string; children?: ReactNode; }) {
    return (
        <div className="vc-sw-dhead">
            {pic != null && <span className="vc-sw-pic vc-sw-pic-big">{pic}</span>}
            <div className="vc-sw-dhead-text">
                <b>{title}</b>
                {sub != null && <span>{dot && <i className="vc-sw-status" style={{ background: dot }} />}{sub}</span>}
            </div>
            {children}
        </div>
    );
}

/** Numbers in boxes: [label, value]. */
export function Facts({ items }: { items: [ReactNode, ReactNode][]; }) {
    return (
        <div className="vc-sw-facts" style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
            {items.map(([label, value], i) => <div key={i} className="vc-sw-fact"><span>{label}</span><b>{value}</b></div>)}
        </div>
    );
}

/** A row of buttons at the bottom of a details pane, all the same width. */
export function ActionRow({ children }: { children: ReactNode; }) {
    return <div className="vc-sw-actrow">{children}</div>;
}

/* ── Settings: labels left, controls right ── */

/** A titled card of settings rows. */
export function FormGroup({ title, children }: { title?: ReactNode; children: ReactNode; }) {
    return (
        <div className="vc-sw-group">
            {title != null && <div className="vc-sw-group-title">{title}</div>}
            <div className="vc-sw-form">{children}</div>
        </div>
    );
}

/** One setting: its name and a line about it on the left, the control on the right. */
export function FormRow({ label, help, children, stack }: { label: ReactNode; help?: ReactNode; children?: ReactNode; /** The control goes under the label instead (big text boxes, long lists). */ stack?: boolean; }) {
    return (
        <div className={classes("vc-sw-frow", stack && "vc-sw-frow-stack")}>
            <div className="vc-sw-frow-label"><span>{label}</span>{help != null && <small>{help}</small>}</div>
            <div className="vc-sw-frow-control">{children}</div>
        </div>
    );
}

/* ── Controls ── */

export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange(v: boolean): void; label?: string; disabled?: boolean; }) {
    return (
        <button type="button" role="switch" aria-checked={value} aria-label={label} disabled={disabled}
            className={classes("vc-sw-switch", value && "vc-sw-switch-on")} onClick={() => onChange(!value)}>
            <i />
        </button>
    );
}

export function Stepper({ value, onChange, min = 0, max = Infinity, step = 1, label }: { value: number; onChange(v: number): void; min?: number; max?: number; step?: number; label?: string; }) {
    return (
        <div className="vc-sw-stepper" role="group" aria-label={label}>
            <button type="button" aria-label="Fewer" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>−</button>
            <span>{value}</span>
            <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>+</button>
        </div>
    );
}

export function Choice<T extends string | number | boolean>({ value, options, onChange }: { value: T; options: readonly (readonly [T, ReactNode])[]; onChange(v: T): void; }) {
    return (
        <div className="vc-sw-choice" role="radiogroup">
            {options.map(([id, label]) => (
                <button key={String(id)} type="button" role="radio" aria-checked={value === id} className={classes(value === id && "vc-sw-choice-on")} onClick={() => onChange(id)}>{label}</button>
            ))}
        </div>
    );
}
