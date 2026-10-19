/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata's background: Minimal's layers — a drifting wash of your colour,
// music staves waving across, notes floating up and a soft equalizer along
// the bottom. Everything only moves or fades pictures that are drawn once
// (the graphics card does that), so it stays light. Motion off holds it
// all still. Nothing follows the mouse.

/** One staff: five lines riding the same gentle wave. The wave repeats every 1200 units, so sliding by half the width loops without a jump. */
function staffPaths(amp: number, phase: number) {
    const W = 4800, PERIOD = 1200, STEP = 40, GAP = 11;
    return Array.from({ length: 5 }, (_, line) => {
        let d = "";
        for (let x = 0; x <= W; x += STEP) {
            const y = 70 + (line - 2) * GAP + amp * Math.sin((x / PERIOD) * Math.PI * 2 + phase);
            d += `${x ? "L" : "M"}${x} ${y.toFixed(1)}`;
        }
        return d;
    });
}

const BANDS = [
    { id: "a", paths: staffPaths(26, 0) },
    { id: "b", paths: staffPaths(18, 1.9) },
    { id: "c", paths: staffPaths(30, 3.7) },
];

/** The same "random" every time, so the notes and bars don't jump around between openings. */
function seeded(seed: number) {
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

/** Three note shapes (a 24×24 picture each). */
const NOTE_SHAPES = [
    // ♪ eighth note
    "M14 3v11.2a3.6 3.6 0 1 1-1.8-3.1V3h1.8zm0 0c.6 2.4 2.6 3.4 4.2 4.6 1.4 1 1.8 2.7 1 4.4.1-1.6-.8-2.8-2.3-3.5-1.1-.5-2.2-.8-2.9-.9V3z",
    // ♫ two beamed notes
    "M8.5 6.5 19 4v10.6a3.2 3.2 0 1 1-1.6-2.8V7.6l-7.3 1.8v7.8a3.2 3.2 0 1 1-1.6-2.8V6.5z",
    // ♩ quarter note
    "M13.5 3h1.8v12a3.9 3.9 0 1 1-1.8-3.3V3z",
];

const NOTES = (() => {
    const r = seeded(7);
    return Array.from({ length: 18 }, (_, i) => {
        const far = i % 4 === 0;
        return {
            shape: NOTE_SHAPES[i % 3],
            left: `${(i * 5.6 + r() * 4) % 100}%`,
            size: Math.round(far ? 12 + r() * 8 : 18 + r() * 22),
            rise: (far ? 38 : 22) + r() * 16,
            delay: -r() * 40,
            sway: (far ? 12 : 22) + r() * 26,
            swayTime: 5 + r() * 5,
            spin: (r() - 0.5) * 50,
            opacity: far ? 0.16 + r() * 0.1 : 0.22 + r() * 0.2,
            far,
        };
    });
})();

/** Notes rising slowly up the canvas: each rises (the outer piece) and sways and turns (the inner one), then fades out near the top. */
function FloatingNotes() {
    return (
        <div className="sn-notes" aria-hidden>
            {NOTES.map((n, i) => (
                <span key={i} className={`sn-float${n.far ? " sn-float-far" : ""}`}
                    style={{ left: n.left, "--rise": `${n.rise.toFixed(1)}s`, "--delay": `${n.delay.toFixed(1)}s`, "--o": n.opacity.toFixed(2) } as React.CSSProperties}>
                    <svg viewBox="0 0 24 24" width={n.size} height={n.size}
                        style={{ "--sway": `${n.sway.toFixed(0)}px`, "--sway-time": `${n.swayTime.toFixed(1)}s`, "--spin": `${n.spin.toFixed(0)}deg` } as React.CSSProperties}>
                        <path d={n.shape} />
                    </svg>
                </span>
            ))}
        </div>
    );
}

const BARS = (() => {
    const r = seeded(31);
    return Array.from({ length: 56 }, () => ({ time: 1.4 + r() * 1.8, delay: -r() * 3, peak: 0.35 + r() * 0.65 }));
})();

/** A row of thin bars along the bottom, bouncing softly like a music player's equalizer. */
function Equalizer() {
    return (
        <div className="sn-eq" aria-hidden>
            {BARS.map((b, i) => (
                <i key={i} style={{ "--t": `${b.time.toFixed(2)}s`, "--d": `${b.delay.toFixed(2)}s`, "--peak": b.peak.toFixed(2) } as React.CSSProperties} />
            ))}
        </div>
    );
}

function Staves() {
    return (
        <div className="sn-staves" aria-hidden>
            {BANDS.map(b => (
                <div key={b.id} className={`sn-staff sn-staff-${b.id}`}>
                    <svg className="sn-staff-move" viewBox="0 0 4800 140" preserveAspectRatio="none">
                        {b.paths.map((d, i) => <path key={i} d={d} vectorEffect="non-scaling-stroke" />)}
                    </svg>
                </div>
            ))}
        </div>
    );
}

/** The layers of Minimal that are switched on (see scenes/presets). */
export function Ambience({ on }: { on: Set<string>; }) {
    return (
        <div className="sonata-ambience" aria-hidden>
            {on.has("glow") && <div className="sn-mn-glow"><i /><i /></div>}
            {on.has("grid") && <div className="sn-mn-grid" />}
            {on.has("staves") && <Staves />}
            {on.has("notes") && <FloatingNotes />}
            {on.has("eq") && <Equalizer />}
            {on.has("grain") && <div className="sonata-grain" />}
            {on.has("vignette") && <div className="sonata-vignette" />}
        </div>
    );
}
