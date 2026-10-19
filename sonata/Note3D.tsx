/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A solid eighth note that turns slowly round and bobs, on Sonata's page.
// It's a stack of flat copies of the note set a pixel apart in 3D (the
// front and back faces, and the edge in between), and only the stack is
// turned — the graphics card just moves pictures it already has, so it costs
// next to nothing. Faint rings spread out from it now and then. It all stops
// with Motion off, with reduced motion, and when animations are paused.

const DEPTH = 14;

function NoteShape({ fill }: { fill: string; }) {
    return (
        <svg viewBox="0 0 120 160" aria-hidden>
            <ellipse cx="44" cy="128" rx="27" ry="19" transform="rotate(-22 44 128)" fill={fill} />
            <rect x="61" y="18" width="10" height="112" rx="5" fill={fill} />
            <path d="M66 18c2 20 14 26 26 36 12 10 16 26 10 44-1-14-8-24-20-30-6-3-12-5-16-6z" fill={fill} />
        </svg>
    );
}

export function Note3D({ className }: { className?: string; }) {
    return (
        <div className={className} aria-hidden>
            <div className="sn-ripples"><i className="sn-ripple" /><i className="sn-ripple" /><i className="sn-ripple" /></div>
            <div className="sn-note-bob">
                <div className="sn-note-spin">
                    {/* The edge: copies between the faces, darker towards the middle. */}
                    {Array.from({ length: DEPTH - 1 }, (_, i) => (
                        <div key={i} className="sn-note-layer" style={{ transform: `translateZ(${(i + 1 - DEPTH / 2).toFixed(1)}px)` }}>
                            <NoteShape fill={`color-mix(in oklab, var(--sn-accent) ${62 - Math.abs(i + 1 - DEPTH / 2) * 2}%, black)`} />
                        </div>
                    ))}
                    {/* Its sides, seen when it's turned edge-on (where the flat copies all but vanish): strips down the stem and through the head, turned to face sideways. */}
                    <div className="sn-note-side sn-note-side-stem" style={{ width: DEPTH, marginLeft: -DEPTH / 2 }} />
                    <div className="sn-note-side sn-note-side-head" style={{ width: DEPTH, marginLeft: -DEPTH / 2 }} />
                    <div className="sn-note-layer sn-note-face" style={{ transform: `translateZ(${DEPTH / 2}px)` }}><NoteShape fill="url(#sn-note-front)" /></div>
                    {/* The back is the same picture, not flipped: seen from behind it reads as the mirror image, like a real solid note. */}
                    <div className="sn-note-layer sn-note-face" style={{ transform: `translateZ(${-DEPTH / 2}px)` }}><NoteShape fill="url(#sn-note-front)" /></div>
                </div>
            </div>
            <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
                <defs>
                    <linearGradient id="sn-note-front" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="var(--sn-hi)" />
                        <stop offset="0.55" stopColor="var(--sn-accent)" />
                        <stop offset="1" stopColor="var(--sn-accent-2)" />
                    </linearGradient>
                </defs>
            </svg>
        </div>
    );
}
