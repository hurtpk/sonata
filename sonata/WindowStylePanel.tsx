/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Appearance → Windows: how every Sonata feature window looks — its corners,
// how dark it is, its borders and the status line — with a small live preview.

import "../features/_shared/window.css";

import { classes } from "@utils/misc";

import { DEFAULT_WINDOW_STYLE, readWindowStyle, ROUNDNESS_MAX, ROUNDNESS_MIN, windowStyleProps } from "../features/_shared/Window";

function Seg<T extends string | boolean>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void; }) {
    return (
        <div className="sonata-segment sonata-segment-left">
            {options.map(([id, label]) => (
                <button key={String(id)} type="button" className={classes("sonata-seg", value === id && "sonata-seg-on")} onClick={() => onChange(id)}>{label}</button>
            ))}
        </div>
    );
}

/** A small window in the chosen style. */
function Preview({ store }: { store: any; }) {
    const style = readWindowStyle(store);
    return (
        <div {...windowStyleProps(style)} className="vc-sw-styled vc-sw-mini" aria-hidden>
            <div className="vc-sw-mini-top">sonata <span className="vc-sw-dash">—</span> <span className="vc-sw-here">preview</span></div>
            <div className="vc-sw-mini-tabs"><span className="vc-sw-mini-tab-on">Main</span><span>Settings</span><span>Help</span></div>
            <div className="vc-sw-mini-body">
                <div className="vc-sw-mini-card"><i /><span><b /><small /></span></div>
                <div className="vc-sw-mini-card"><i /><span><b /><small /></span></div>
                <div className="vc-sw-mini-btns"><span className="vc-sw-mini-primary" /><span /></div>
            </div>
            {style.footer && <div className="vc-sw-mini-foot"><i className="vc-sw-dot" />all good</div>}
        </div>
    );
}

export function WindowStylePanel({ store }: { store: any; }) {
    const style = readWindowStyle(store);
    const changed = JSON.stringify(style) !== JSON.stringify(DEFAULT_WINDOW_STYLE);
    const reset = () => {
        store.sonataWinRound = DEFAULT_WINDOW_STYLE.roundness;
        store.sonataWinDark = DEFAULT_WINDOW_STYLE.darkness;
        store.sonataWinBorders = DEFAULT_WINDOW_STYLE.borders;
        store.sonataWinFooter = DEFAULT_WINDOW_STYLE.footer;
    };
    return (
        <div className="sonata-panel sonata-appearance">
            <h3 className="sonata-panel-title">Windows</h3>
            <Preview store={store} />
            <div className="sonata-field">
                <div className="sonata-field-label">Roundness · {Math.round(style.roundness * 100)}%</div>
                <input type="range" className="vc-sw-range" min={ROUNDNESS_MIN} max={ROUNDNESS_MAX} step={0.1} value={style.roundness}
                    aria-label="Roundness" onChange={e => { store.sonataWinRound = Number(e.currentTarget.value); }} />
            </div>
            <div className="sonata-field">
                <div className="sonata-field-label">Darkness</div>
                <Seg value={style.darkness} options={[["dark", "Dark"], ["darker", "Darker"], ["black", "Black"]]} onChange={v => { store.sonataWinDark = v; }} />
            </div>
            <div className="sonata-field">
                <div className="sonata-field-label">Borders</div>
                <Seg value={style.borders} options={[["subtle", "Subtle"], ["clear", "Clear"]]} onChange={v => { store.sonataWinBorders = v; }} />
            </div>
            <div className="sonata-field">
                <div className="sonata-field-label">Status line</div>
                <Seg value={style.footer} options={[[true, "Show"], [false, "Hide"]]} onChange={v => { store.sonataWinFooter = v; }} />
                <div className="sonata-field-hint">The line along the bottom of each window that says what's going on.</div>
            </div>
            {changed && <button type="button" className="sonata-btn vc-sw-reset" onClick={reset}>Reset windows</button>}
        </div>
    );
}
