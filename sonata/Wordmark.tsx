/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The "Sonata" wordmark: retro script lettering (Lobster, a free Google Font)
// framed by two royal flourishes, one centred above the word and the same one
// turned over below it. Each flourish is three calligraphic strokes per side
// (a long scrolling arm, a curl rising off it and a small inner curl), all
// tapering to fine points, meeting at a diamond in the middle.

import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import { Seg, swashPath, SwashSpec } from "./swash";

const FONT_URL = "https://fonts.googleapis.com/css2?family=Lobster&display=swap";
const FONT = "230px Lobster";

// One half of a flourish, drawn to the right of its centre at 0,0.
const ARM: SwashSpec[] = [
    // Sweeps out, rises, rolls down into a scroll and spirals in.
    { segs: [[[10, 1], [44, -7], [96, -12], [138, -3]], [[138, -3], [176, 5], [186, 34], [158, 39]], [[158, 39], [136, 42], [131, 20], [147, 17]], [[147, 17], [157, 15], [160, 27], [152, 29]]], widths: [[0, 2], [0.12, 6], [0.36, 10], [0.52, 7], [0.68, 11], [0.8, 8], [1, 0.4]] },
    // Curls up off the arm.
    { segs: [[[92, -10], [100, -30], [128, -37], [140, -24]], [[140, -24], [147, -15], [136, -7], [129, -13]], [[129, -13], [125, -17], [129, -22], [134, -20]]], widths: [[0, 1.5], [0.32, 5.5], [0.62, 4.2], [1, 0.35]] },
    // Small inner curl near the centre.
    { segs: [[[30, -3], [36, 10], [52, 15], [58, 7]], [[58, 7], [61, 2], [56, -1], [53, 2]]], widths: [[0, 1.2], [0.45, 3.8], [1, 0.3]] },
];

const mirror = (s: SwashSpec): SwashSpec => ({ ...s, segs: s.segs.map(seg => seg.map(([x, y]) => [-x, y]) as Seg) });
const JEWEL = "M0 -10C3 -4 6 -1 9 0C6 1 3 4 0 10C-3 4 -6 1 -9 0C-6 -1 -3 -4 0 -10Z";
const FLOURISH = [...ARM, ...ARM.map(mirror)].map(s => swashPath(s)).join("") + JEWEL;

/** Loaded once (Equicord allows Google Fonts); resolves when it's ready to draw. */
function loadFont(): Promise<boolean> {
    if (!document.getElementById("sonata-font")) {
        const link = document.createElement("link");
        link.id = "sonata-font";
        link.rel = "stylesheet";
        link.href = FONT_URL;
        document.head.appendChild(link);
    }
    if (document.fonts.check(FONT)) return Promise.resolve(true);
    return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(false), 6000);
        const attempt = (tries: number) => document.fonts.load(FONT).then(() => {
            if (document.fonts.check(FONT)) { clearTimeout(timeout); resolve(true); } else if (tries > 0) setTimeout(() => attempt(tries - 1), 250);
        }).catch(() => { if (tries > 0) setTimeout(() => attempt(tries - 1), 250); });
        attempt(20);
    });
}

/** `compact` is just the word, for the top bar (the flourishes are too fine to see that small). */
export function Wordmark({ compact }: { compact?: boolean; } = {}) {
    const [ready, setReady] = useState(() => document.fonts.check(FONT));
    useEffect(() => {
        let alive = true;
        loadFont().then(ok => { if (alive) setReady(ok); });
        return () => { alive = false; };
    }, []);

    return (
        <h1 className={classes("sonata-wordmark", ready && "sonata-wordmark-ready")} aria-label="Sonata">
            <svg viewBox={compact ? "200 96 600 182" : "170 -20 670 385"} aria-hidden>
                <defs>
                    {/* One gradient across the whole mark, so the flourishes shade with the word. */}
                    <linearGradient id="sonata-ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="360">
                        <stop offset="0.2" style={{ stopColor: "var(--sn-ink-top, #ffffff)" }} />
                        <stop offset="1" style={{ stopColor: "var(--sn-ink)" }} />
                    </linearGradient>
                </defs>
                <g fill="url(#sonata-ink)">
                    {!compact && <path d={FLOURISH} transform="translate(500 32)" />}
                    <text x="500" y="250" textAnchor="middle" fontFamily="Lobster, 'Brush Script MT', cursive" fontSize="230">Sonata</text>
                    {!compact && <path d={FLOURISH} transform="translate(500 312) rotate(180)" />}
                </g>
            </svg>
        </h1>
    );
}
