/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Texture painter: draw on a texture, erase parts of it, fill areas or pick
// colours from it — with the model's layout drawn on top, so you can see
// where each part of the picture ends up on the 3D model.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { showToast, useEffect, useRef, useState } from "@webpack/common";

import type { RobloxMesh } from "./mesh";
import { decode, encodePng } from "./recolor";

const rb = classNameFactory("vc-rbx-");
type Tool = "brush" | "eraser" | "fill" | "pick";
const TOOLS: [Tool, string, string][] = [["brush", "🖌", "Brush"], ["eraser", "🧽", "Eraser (makes it see-through)"], ["fill", "🪣", "Fill an area"], ["pick", "💧", "Pick a colour from it"]];
const SWATCHES = ["#000000", "#ffffff", "#e23b3b", "#f0b232", "#3ddc84", "#00a2ff", "#8b5cf6", "#ff66c4"];
const MAX_UNDO = 25;

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
const rgb = (h: string) => { const m = h.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0]; };

/** Fills the connected area around (x, y) that's close to its colour. */
function flood(img: ImageData, x: number, y: number, [r, g, b]: number[], a: number, tolerance: number) {
    const { width: w, height: h, data: d } = img;
    const at = (y * w + x) * 4;
    const t = [d[at], d[at + 1], d[at + 2], d[at + 3]];
    const near = (i: number) => Math.abs(d[i] - t[0]) + Math.abs(d[i + 1] - t[1]) + Math.abs(d[i + 2] - t[2]) + Math.abs(d[i + 3] - t[3]) <= tolerance * 4;
    const seen = new Uint8Array(w * h);
    const stack = [x, y];
    while (stack.length) {
        const cy = stack.pop()!, cx = stack.pop()!;
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const k = cy * w + cx;
        if (seen[k]) continue;
        seen[k] = 1;
        const i = k * 4;
        if (!near(i)) continue;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
        stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
    }
}

export function Painter({ bytes, mesh, name, onUse, onSave }: { bytes: Uint8Array; mesh?: RobloxMesh; name: string; onUse(b: Uint8Array): void; onSave(b: Uint8Array): void; }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const overlay = useRef<HTMLCanvasElement>(null);
    const [ready, setReady] = useState(false);
    const [tool, setTool] = useState<Tool>("brush");
    const [color, setColor] = useState("#00a2ff");
    const [size, setSize] = useState(12);
    const [opacity, setOpacity] = useState(100);
    const [tolerance, setTolerance] = useState(24);
    const [showLayout, setShowLayout] = useState(!!mesh);
    const [zoom, setZoom] = useState(1);
    const [changed, setChanged] = useState(false);
    const undo = useRef<ImageData[]>([]);
    const redo = useRef<ImageData[]>([]);
    const last = useRef<[number, number] | null>(null);
    const [, bump] = useState(0);

    const ctx = () => canvas.current!.getContext("2d", { willReadFrequently: true })!;

    useEffect(() => {
        let alive = true;
        setReady(false);
        decode(bytes).then(img => {
            if (!alive || !canvas.current) return;
            canvas.current.width = img.width; canvas.current.height = img.height;
            ctx().putImageData(img, 0, 0);
            undo.current = []; redo.current = []; setChanged(false); setReady(true);
        }).catch(() => showToast("Couldn't open this picture", "failure"));
        return () => { alive = false; };
    }, [bytes]);

    // The model's layout (its UV triangles) drawn on top.
    useEffect(() => {
        const o = overlay.current, c = canvas.current;
        if (!o || !c || !ready) return;
        o.width = c.width; o.height = c.height;
        const x = o.getContext("2d")!;
        x.clearRect(0, 0, o.width, o.height);
        if (!showLayout || !mesh) return;
        x.strokeStyle = "rgba(0, 220, 255, 0.55)";
        x.lineWidth = Math.max(1, o.width / 512);
        x.beginPath();
        const f = mesh.faces, uv = mesh.uvs;
        const max = Math.min(f.length, 60000 * 3);
        for (let i = 0; i < max; i += 3) {
            for (let k = 0; k < 3; k++) {
                const v = f[i + k], px = (uv[v * 2] - Math.floor(uv[v * 2])) * o.width, py = (uv[v * 2 + 1] - Math.floor(uv[v * 2 + 1])) * o.height;
                if (k === 0) x.moveTo(px, py); else x.lineTo(px, py);
            }
            x.closePath();
        }
        x.stroke();
    }, [mesh, showLayout, ready]);

    const pos = (e: React.PointerEvent) => {
        const c = canvas.current!, r = c.getBoundingClientRect();
        return [Math.floor((e.clientX - r.left) / r.width * c.width), Math.floor((e.clientY - r.top) / r.height * c.height)] as [number, number];
    };
    const snapshot = () => {
        const c = canvas.current!;
        undo.current.push(ctx().getImageData(0, 0, c.width, c.height));
        if (undo.current.length > MAX_UNDO) undo.current.shift();
        redo.current = [];
    };
    const stroke = (from: [number, number], to: [number, number]) => {
        const x = ctx();
        x.save();
        x.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
        x.globalAlpha = opacity / 100;
        x.strokeStyle = color; x.fillStyle = color;
        x.lineWidth = size; x.lineCap = "round"; x.lineJoin = "round";
        x.beginPath(); x.moveTo(from[0], from[1]); x.lineTo(to[0], to[1]); x.stroke();
        x.restore();
    };

    const down = (e: React.PointerEvent) => {
        if (!ready) return;
        const p = pos(e);
        if (tool === "pick") {
            const d = ctx().getImageData(p[0], p[1], 1, 1).data;
            setColor(hex(d[0], d[1], d[2])); setTool("brush");
            return;
        }
        snapshot();
        if (tool === "fill") {
            const c = canvas.current!, img = ctx().getImageData(0, 0, c.width, c.height);
            flood(img, p[0], p[1], rgb(color), Math.round(opacity / 100 * 255), tolerance);
            ctx().putImageData(img, 0, 0);
            setChanged(true); bump(n => n + 1);
            return;
        }
        (e.target as Element).setPointerCapture?.(e.pointerId);
        last.current = p;
        stroke(p, p);
        setChanged(true);
    };
    const move = (e: React.PointerEvent) => {
        if (!last.current) return;
        const p = pos(e);
        stroke(last.current, p);
        last.current = p;
    };
    const up = () => { last.current = null; bump(n => n + 1); };

    const step = (from: React.MutableRefObject<ImageData[]>, to: React.MutableRefObject<ImageData[]>) => {
        const img = from.current.pop();
        if (!img) return;
        const c = canvas.current!;
        to.current.push(ctx().getImageData(0, 0, c.width, c.height));
        ctx().putImageData(img, 0, 0);
        setChanged(true); bump(n => n + 1);
    };
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); step(undo, redo); }
            if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); step(redo, undo); }
        };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, []);

    const result = async () => encodePng(ctx().getImageData(0, 0, canvas.current!.width, canvas.current!.height));

    return (
        <div className={rb("pt")}>
            <div className={rb("pt-tools")}>
                {TOOLS.map(([t, icon, label]) => <button key={t} type="button" title={label} className={classes(rb("pt-tool"), tool === t && rb("pt-tool-on"))} onClick={() => setTool(t)}>{icon}</button>)}
                <span className={rb("pt-sep")} />
                <label className={rb("pt-color")} title="Colour"><input type="color" value={color} onChange={e => setColor(e.currentTarget.value)} /></label>
                {SWATCHES.map(s => <button key={s} type="button" className={classes(rb("pt-swatch"), color === s && rb("pt-swatch-on"))} style={{ background: s }} title={s} onClick={() => setColor(s)} />)}
                <span className={rb("pt-sep")} />
                <button type="button" className="vc-tool-icon" title="Undo (Ctrl+Z)" disabled={!undo.current.length} onClick={() => step(undo, redo)}>↶</button>
                <button type="button" className="vc-tool-icon" title="Redo (Ctrl+Y)" disabled={!redo.current.length} onClick={() => step(redo, undo)}>↷</button>
            </div>
            <div className={rb("pt-opts")}>
                {(tool === "brush" || tool === "eraser") && <label className={rb("rc-slider")}><span>Size<b>{size}px</b></span><input type="range" min={1} max={Math.max(64, Math.round((canvas.current?.width ?? 512) / 8))} value={size} onChange={e => setSize(Number(e.currentTarget.value))} /></label>}
                {tool !== "pick" && <label className={rb("rc-slider")}><span>Strength<b>{opacity}%</b></span><input type="range" min={5} max={100} value={opacity} onChange={e => setOpacity(Number(e.currentTarget.value))} /></label>}
                {tool === "fill" && <label className={rb("rc-slider")}><span>How alike<b>{tolerance}</b></span><input type="range" min={0} max={128} value={tolerance} onChange={e => setTolerance(Number(e.currentTarget.value))} /></label>}
                <label className={rb("rc-slider")}><span>Zoom<b>{zoom}×</b></span><input type="range" min={1} max={4} step={0.5} value={zoom} onChange={e => setZoom(Number(e.currentTarget.value))} /></label>
                {mesh && <label className={rb("rate-check")}><input type="checkbox" checked={showLayout} onChange={e => setShowLayout(e.currentTarget.checked)} /> Show where the model uses it</label>}
            </div>
            <div className={rb("pt-stage")}>
                <div className={rb("pt-board")} style={{ width: `${zoom * 100}%` }}>
                    <canvas ref={canvas} className={classes(rb("pt-canvas"), rb(`pt-cursor-${tool}`))} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
                    <canvas ref={overlay} className={rb("pt-overlay")} />
                </div>
            </div>
            <div className={rb("rate-edit-row")}>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!changed} onClick={async () => { onUse(await result()); setChanged(false); showToast("Painted — the 3D preview and downloads use it now", "success"); }}>Use this</button>
                <button type="button" className="vc-tool-btn" disabled={!ready} onClick={async () => onSave(await result())}>Save .png</button>
                <span className="vc-tool-hint">{name} · {canvas.current ? `${canvas.current.width} × ${canvas.current.height}` : ""} · Ctrl+Z to undo</span>
            </div>
        </div>
    );
}
