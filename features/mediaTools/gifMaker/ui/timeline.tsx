/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The trim strip, the crop box and the frame editor.

import { React, useMemo, useRef, useState } from "@webpack/common";

import type { Source } from "../render/source";
import type { BaseFrame } from "../render/timeline";
import type { Crop, FrameEdit } from "../types";
import { Btn, cl } from "./controls";

const fmt = (t: number) => t >= 60 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}` : `${t.toFixed(2)}s`;

// ─── Trim ───

export function TrimBar({ duration, start, end, playheadRef, thumbs, onChange }: {
    duration: number; start: number; end: number; playheadRef: React.RefObject<HTMLDivElement | null>; thumbs: string[];
    onChange(start: number, end: number): void;
}) {
    const bar = useRef<HTMLDivElement>(null);
    const drag = useRef<{ what: "start" | "end" | "both"; x: number; start: number; end: number; } | null>(null);
    const at = (clientX: number) => {
        const r = bar.current!.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
    };
    const down = (what: "start" | "end" | "both") => (e: React.PointerEvent) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { what, x: at(e.clientX), start, end };
    };
    const move = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const t = at(e.clientX);
        const min = 0.1;
        if (d.what === "start") onChange(Math.min(t, d.end - min), d.end);
        else if (d.what === "end") onChange(d.start, Math.max(t, d.start + min));
        else {
            const len = d.end - d.start;
            const s = Math.max(0, Math.min(duration - len, d.start + t - d.x));
            onChange(s, s + len);
        }
    };
    const up = () => { drag.current = null; };
    const pct = (t: number) => `${t / duration * 100}%`;

    return (
        <div className={cl("trim")}>
            <div className={cl("trim-bar")} ref={bar} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                <div className={cl("trim-thumbs")}>
                    {thumbs.map((t, i) => <img key={i} src={t} alt="" draggable={false} />)}
                </div>
                <div className={cl("trim-dim")} style={{ left: 0, width: pct(start) }} />
                <div className={cl("trim-dim")} style={{ left: pct(end), right: 0 }} />
                <div className={cl("trim-window")} style={{ left: pct(start), width: pct(end - start) }} onPointerDown={down("both")} title="Drag to move the trimmed part">
                    <div className={cl("trim-handle", "trim-handle-start")} onPointerDown={down("start")} title="Start" />
                    <div className={cl("trim-handle", "trim-handle-end")} onPointerDown={down("end")} title="End" />
                </div>
                <div className={cl("trim-playhead")} ref={playheadRef} />
            </div>
            <div className={cl("trim-times")}>
                <span>{fmt(start)}</span>
                <span className={cl("trim-len")}>{fmt(end - start)} selected</span>
                <span>{fmt(end)}</span>
            </div>
        </div>
    );
}

// ─── Crop ───

type Handle = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

/** `ratio` is the box's width ÷ height in 0–1 units (already adjusted for the picture's shape), or null for free. */
export function CropBox({ crop, ratio, round, onChange }: { crop: Crop; ratio: number | null; round: boolean; onChange(c: Crop): void; }) {
    const box = useRef<HTMLDivElement>(null);
    const drag = useRef<{ h: Handle; x: number; y: number; c: Crop; } | null>(null);
    const norm = (e: React.PointerEvent) => {
        const r = box.current!.parentElement!.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
    };
    const down = (h: Handle) => (e: React.PointerEvent) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const [x, y] = norm(e);
        drag.current = { h, x, y, c: { ...crop } };
    };
    const move = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const [x, y] = norm(e);
        const dx = x - d.x, dy = y - d.y;
        let { x: cx, y: cy, w, h } = d.c;
        const MIN = 0.05;
        if (d.h === "move") {
            cx = Math.max(0, Math.min(1 - w, cx + dx));
            cy = Math.max(0, Math.min(1 - h, cy + dy));
        } else {
            const left = d.h.includes("w"), right = d.h.includes("e"), top = d.h.includes("n"), bottom = d.h.includes("s");
            let x0 = cx, y0 = cy, x1 = cx + w, y1 = cy + h;
            if (left) x0 = Math.max(0, Math.min(x1 - MIN, x0 + dx));
            if (right) x1 = Math.min(1, Math.max(x0 + MIN, x1 + dx));
            if (top) y0 = Math.max(0, Math.min(y1 - MIN, y0 + dy));
            if (bottom) y1 = Math.min(1, Math.max(y0 + MIN, y1 + dy));
            w = x1 - x0; h = y1 - y0;
            if (ratio) {
                // Keep the shape: follow whichever side moved more, anchored at the opposite corner.
                if ((left || right) && !(top || bottom) || Math.abs(dx) > Math.abs(dy)) h = w / ratio; else w = h * ratio;
                if (w > 1) { w = 1; h = w / ratio; }
                if (h > 1) { h = 1; w = h * ratio; }
                if (left) x0 = x1 - w;
                if (top) y0 = y1 - h;
                x0 = Math.max(0, Math.min(1 - w, x0));
                y0 = Math.max(0, Math.min(1 - h, y0));
            }
            cx = x0; cy = y0;
        }
        onChange({ x: cx, y: cy, w, h });
    };
    const up = () => { drag.current = null; };
    const handles: Handle[] = ratio ? ["nw", "ne", "sw", "se"] : ["nw", "ne", "sw", "se", "n", "s", "e", "w"];

    return (
        <div className={cl("crop-layer")} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <div ref={box} className={cl("crop-box", round && "crop-round")} onPointerDown={down("move")}
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}>
                <div className={cl("crop-grid")} />
                {handles.map(h => <div key={h} className={cl("crop-handle", `crop-${h}`)} onPointerDown={down(h)} />)}
            </div>
        </div>
    );
}

// ─── Frames ───

export function FrameEditor({ src, base, edits, selected, onSelect, onEdit, onReset }: {
    src: Source; base: BaseFrame[]; edits: Record<number, FrameEdit>; selected: number | null;
    onSelect(i: number | null): void; onEdit(i: number, e: FrameEdit | null): void; onReset(): void;
}) {
    const [showAll, setShowAll] = useState(false);
    const thumbs = useMemo(() => {
        const c = document.createElement("canvas");
        c.height = 40;
        c.width = Math.max(1, Math.round(40 * src.width / src.height));
        const ctx = c.getContext("2d")!;
        return base.map(f => {
            const img = src.frameAt(f.t);
            ctx.clearRect(0, 0, c.width, c.height);
            if (img) ctx.drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL("image/jpeg", 0.6);
        });
    }, [src, base]);
    const shown = showAll ? base : base.slice(0, 60);
    const edit = selected != null ? edits[selected] ?? {} : null;
    const edited = Object.keys(edits).length;

    return (
        <div className={cl("frames")}>
            <div className={cl("frame-grid")}>
                {shown.map((_, i) => {
                    const e = edits[i];
                    return (
                        <button key={i} type="button" className={cl("frame", selected === i && "frame-on", e?.drop && "frame-dropped")} onClick={() => onSelect(selected === i ? null : i)} title={`Frame ${i + 1}`}>
                            <img src={thumbs[i]} alt="" draggable={false} />
                            <span className={cl("frame-num")}>{i + 1}</span>
                            {(e?.hold ?? 1) > 1 && <span className={cl("frame-tag")}>×{e!.hold}</span>}
                            {(e?.dup ?? 0) > 0 && <span className={cl("frame-tag")}>+{e!.dup}</span>}
                        </button>
                    );
                })}
            </div>
            {base.length > 60 && <Btn small onClick={() => setShowAll(v => !v)}>{showAll ? "Show fewer" : `Show all ${base.length} frames`}</Btn>}
            {edit && selected != null ? (
                <div className={cl("row")}>
                    <span className={cl("hint")}>Frame {selected + 1}:</span>
                    <Btn small on={edit.drop} onClick={() => onEdit(selected, { ...edit, drop: !edit.drop })}>{edit.drop ? "Bring back" : "Remove"}</Btn>
                    <Btn small onClick={() => onEdit(selected, { ...edit, dup: Math.min(5, (edit.dup ?? 0) + 1) })}>Duplicate</Btn>
                    <Btn small on={(edit.hold ?? 1) > 1} onClick={() => onEdit(selected, { ...edit, hold: (edit.hold ?? 1) >= 8 ? 1 : (edit.hold ?? 1) * 2 })}>Hold ×{(edit.hold ?? 1) >= 8 ? 1 : (edit.hold ?? 1) * 2}</Btn>
                    <Btn small onClick={() => onEdit(selected, null)}>Reset</Btn>
                </div>
            ) : <span className={cl("hint")}>Pick a frame to remove it, duplicate it or hold it longer (great for a freeze on the punchline).</span>}
            {edited > 0 && <Btn small onClick={onReset}>Reset all {edited} edited frame{edited === 1 ? "" : "s"}</Btn>}
        </div>
    );
}
