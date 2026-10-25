/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Appearance's "New messages" tab: how messages that arrive while you're
// looking come into the chat. The little chat shows it, and plays it again
// whenever you pick something.

import { classes } from "@utils/misc";
import { React, useState } from "@webpack/common";

import { settings } from "./index";

const STYLES: [string, string, string][] = [
    ["slide", "Slide up", "Rises in from just below"],
    ["fade", "Fade in", "Appears softly in place"],
    ["pop", "Pop", "A quick little bounce"],
    ["side", "Glide in", "Comes in from the side"],
];
const SPEEDS: [number, string][] = [[0.18, "Quick"], [0.3, "Normal"], [0.5, "Relaxed"]];

export function SmoothBody() {
    const s = settings.use(["style", "speed", "mine", "highlight"]);
    const [play, setPlay] = useState(0);
    const style = String(s.style ?? "slide"), speed = Number(s.speed) || 0.3;
    const set = (patch: Partial<typeof s>) => { Object.assign(settings.store, patch); setPlay(n => n + 1); };
    return (
        <div className="vc-tool-wrap vc-smooth-panel">
            <div className="vc-smooth-demo" aria-hidden>
                <div className="vc-smooth-demo-msg"><span className="vc-smooth-demo-pic" /><span className="vc-smooth-demo-lines"><i /><i /></span></div>
                <div key={play} className={classes("vc-smooth-demo-msg", "vc-smooth-in", `vc-smooth-${style}`, s.highlight && "vc-smooth-glow")} style={{ "--smooth-speed": `${speed}s` } as React.CSSProperties}>
                    <span className="vc-smooth-demo-pic" /><span className="vc-smooth-demo-lines"><i /><i /></span>
                </div>
                <button type="button" className="vc-tool-link vc-smooth-replay" onClick={() => setPlay(n => n + 1)}>Play again</button>
            </div>

            <span className="vc-tool-label">How new messages come in</span>
            <div className="vc-smooth-styles">
                {STYLES.map(([id, name, sub]) => (
                    <button key={id} type="button" className={classes("vc-smooth-style", style === id && "vc-smooth-style-on")} onClick={() => set({ style: id })}>
                        <b>{name}</b><span>{sub}</span>
                    </button>
                ))}
            </div>

            <div className="vc-tool-row">
                <span className="vc-tool-label">Speed</span>
                <div className="vc-tool-seg">
                    {SPEEDS.map(([v, label]) => (
                        <button key={v} type="button" className={classes("vc-tool-seg-btn", speed === v && "vc-tool-seg-on")} onClick={() => set({ speed: v })}>{label}</button>
                    ))}
                </div>
            </div>

            <label className="vc-tool-check"><input type="checkbox" checked={s.mine !== false} onChange={e => set({ mine: e.currentTarget.checked })} /> Animate my own messages too</label>
            <label className="vc-tool-check"><input type="checkbox" checked={!!s.highlight} onChange={e => set({ highlight: e.currentTarget.checked })} /> Give new messages a brief soft glow</label>
            <span className="vc-tool-hint">Only messages that arrive while you're looking animate; scrolling back through older ones stays instant.</span>
        </div>
    );
}
