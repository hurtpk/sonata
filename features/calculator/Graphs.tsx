/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Calculator's Graphs tab: draw up to five functions, drag to move
// around, scroll to zoom, hover to read every curve, and see where each one
// crosses zero and turns around. Anything the calculator understands works.

import { classes } from "@utils/misc";
import { useEffect, useMemo, useRef, useState } from "@webpack/common";

import { AngleMode, evaluate } from "./engine";
import { fmtN } from "./ui";
import { getVars } from "./variables";

const COLORS = ["#5b8cff", "#ff5c6c", "#3ddc84", "#ffb020", "#d36bff"];
const EXAMPLES = ["x^2 - 3", "sin(x)", "1/x", "sqrt(x)", "abs(x) - 2", "2^x", "ln(x)", "tan(x)", "x^3 - 3x"];

interface Fn { id: number; text: string; on: boolean; }
interface View { x0: number; x1: number; y0: number; y1: number; }
const START: View = { x0: -10, x1: 10, y0: -6, y1: 6 };

/** "y = x^2", "f(x) = x^2" and "x^2" all mean x^2. */
const body = (s: string) => s.trim().replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, "");

/** A tidy grid step: 1, 2 or 5 × a power of ten. */
function step(span: number, lines = 8) {
    const raw = span / lines, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

function compile(text: string, mode: AngleMode) {
    const src = body(text);
    if (!src) return null;
    const vars = getVars();
    return (x: number) => { try { return evaluate(src, { mode, vars: { ...vars, x } }); } catch { return NaN; } };
}

/** Where a curve crosses zero, and where it turns (highest / lowest points), in what's on screen. */
function special(f: (x: number) => number, v: View) {
    const n = 600, zeros: number[] = [], turns: { x: number; y: number; kind: "max" | "min"; }[] = [];
    let px = v.x0, py = f(px), pd = NaN;
    for (let i = 1; i <= n; i++) {
        const x = v.x0 + (v.x1 - v.x0) * i / n, y = f(x);
        if (Number.isFinite(py) && Number.isFinite(y)) {
            // A sign change that isn't a jump (like tan's) is a real crossing — narrow it down.
            if (py === 0) zeros.push(px);
            else if (py * y < 0 && Math.abs(y - py) < (v.y1 - v.y0)) {
                let a = px, b = x, fa = py;
                for (let k = 0; k < 40; k++) { const m = (a + b) / 2, fm = f(m); if (fa * fm <= 0) b = m; else { a = m; fa = fm; } }
                zeros.push((a + b) / 2);
            }
            const d = y - py;
            if (Number.isFinite(pd) && pd * d < 0 && Math.abs(d) < (v.y1 - v.y0) / 4) turns.push({ x: px, y: py, kind: pd > 0 ? "max" : "min" });
            pd = d;
        } else pd = NaN;
        px = x; py = y;
    }
    const uniq = (xs: number[]) => xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > (v.x1 - v.x0) / 400);
    return { zeros: uniq(zeros).slice(0, 8), turns: turns.slice(0, 6) };
}

export function GraphsTab() {
    const [fns, setFns] = useState<Fn[]>([{ id: 1, text: "x^2 - 3", on: true }, { id: 2, text: "", on: true }]);
    const [view, setView] = useState<View>(START);
    const [mode, setMode] = useState<AngleMode>("rad");
    const [hoverX, setHoverX] = useState<number | null>(null);
    const [size, setSize] = useState({ w: 640, h: 360 });
    const box = useRef<HTMLDivElement>(null);
    const drag = useRef<{ x: number; y: number; v: View; } | null>(null);

    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) }));
        ro.observe(el);
        // Scroll to zoom around the pointer (a real listener, so the page doesn't scroll too).
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            const r = el.getBoundingClientRect(), k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            setView(v => {
                const mx = v.x0 + (e.clientX - r.left) / r.width * (v.x1 - v.x0), my = v.y1 - (e.clientY - r.top) / r.height * (v.y1 - v.y0);
                return { x0: mx - (mx - v.x0) * k, x1: mx + (v.x1 - mx) * k, y0: my - (my - v.y0) * k, y1: my + (v.y1 - my) * k };
            });
        };
        el.addEventListener("wheel", wheel, { passive: false });
        return () => { ro.disconnect(); el.removeEventListener("wheel", wheel); };
    }, []);

    const curves = useMemo(() => fns.map((fn, i) => {
        const f = fn.on ? compile(fn.text, mode) : null;
        let error: string | null = null;
        if (fn.on && body(fn.text)) {
            try { evaluate(body(fn.text), { mode, vars: { ...getVars(), x: 1.2345 } }); } catch (e) { error = e instanceof Error ? e.message : "Can't draw that"; }
        }
        return { fn, f: error ? null : f, color: COLORS[i % COLORS.length], error };
    }), [fns, mode]);

    const W = size.w, H = size.h;
    const sx = (x: number) => (x - view.x0) / (view.x1 - view.x0) * W;
    const sy = (y: number) => H - (y - view.y0) / (view.y1 - view.y0) * H;
    const toX = (px: number) => view.x0 + px / W * (view.x1 - view.x0);

    const paths = useMemo(() => curves.map(c => {
        if (!c.f) return "";
        const n = Math.round(W * 1.5), span = view.y1 - view.y0;
        let d = "", pen = false, prev = NaN;
        for (let i = 0; i <= n; i++) {
            const x = view.x0 + (view.x1 - view.x0) * i / n, y = c.f(x);
            // Lift the pen where it isn't defined or jumps (like tan or 1/x).
            if (!Number.isFinite(y) || y < view.y0 - span * 3 || y > view.y1 + span * 3 || (Number.isFinite(prev) && Math.abs(y - prev) > span * 1.5)) { pen = false; prev = y; continue; }
            d += `${pen ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`;
            pen = true; prev = y;
        }
        return d;
    }), [curves, view, W, H]);

    const points = useMemo(() => curves.map(c => c.f ? special(c.f, view) : null), [curves, view]);

    const gx = step(view.x1 - view.x0, W / 80), gy = step(view.y1 - view.y0, H / 60);
    const lines = (lo: number, hi: number, s: number) => { const out: number[] = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(Math.abs(v) < s / 1e6 ? 0 : v); return out.slice(0, 80); };

    const fitY = () => {
        const ys: number[] = [];
        for (const c of curves) if (c.f) for (let i = 0; i <= 300; i++) { const y = c.f(view.x0 + (view.x1 - view.x0) * i / 300); if (Number.isFinite(y)) ys.push(y); }
        if (!ys.length) return;
        ys.sort((a, b) => a - b);
        let lo = ys[Math.floor(ys.length * 0.02)], hi = ys[Math.ceil(ys.length * 0.98) - 1];
        if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.1;
        setView(v => ({ ...v, y0: lo - pad, y1: hi + pad }));
    };
    const zoom = (k: number) => setView(v => { const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2; return { x0: cx - (cx - v.x0) * k, x1: cx + (v.x1 - cx) * k, y0: cy - (cy - v.y0) * k, y1: cy + (v.y1 - cy) * k }; });
    const setFn = (id: number, patch: Partial<Fn>) => setFns(list => list.map(f => f.id === id ? { ...f, ...patch } : f));
    const addFn = (text = "") => setFns(list => list.length >= 5 ? list : [...list, { id: Math.max(0, ...list.map(f => f.id)) + 1, text, on: true }]);

    const digits = Math.max(0, 3 - Math.floor(Math.log10(view.x1 - view.x0)));
    const hx = hoverX != null ? toX(hoverX) : null;

    return (
        <div className="vc-calc-graphs">
            <div className="vc-calc-fns">
                {fns.map((fn, i) => {
                    const c = curves[i];
                    return (
                        <div key={fn.id} className="vc-calc-fn">
                            <button type="button" className={classes("vc-calc-fn-dot", !fn.on && "vc-calc-fn-off")} style={{ background: c.color }} title={fn.on ? "Hide this one" : "Show it"} onClick={() => setFn(fn.id, { on: !fn.on })} />
                            <span className="vc-calc-fn-y">y =</span>
                            <input className={classes("vc-tool-input", c.error && "vc-calc-fn-bad")} value={fn.text} spellCheck={false} placeholder={i === 0 ? "x^2 - 3" : "Another one, like sin(x)"} onChange={e => setFn(fn.id, { text: e.currentTarget.value })} />
                            {fns.length > 1 && <button type="button" className="vc-tool-icon" title="Remove" onClick={() => setFns(list => list.filter(f => f.id !== fn.id))}>✕</button>}
                            {c.error && <span className="vc-calc-fn-err">{c.error}</span>}
                        </div>
                    );
                })}
                <div className="vc-calc-fn-tools">
                    {fns.length < 5 && <button type="button" className="vc-tool-btn" onClick={() => addFn()}>＋ Add a line</button>}
                    <span className="vc-tool-hint">Try:</span>
                    {EXAMPLES.map(x => <button key={x} type="button" className="vc-tool-chip" onClick={() => { const empty = fns.find(f => !f.text.trim()); if (empty) setFn(empty.id, { text: x, on: true }); else addFn(x); }}>{x}</button>)}
                </div>
            </div>

            <div className="vc-calc-plot-wrap">
                <div ref={box} className="vc-calc-plot"
                    onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, v: view }; }}
                    onPointerMove={e => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setHoverX(e.clientX - r.left);
                        const d = drag.current;
                        if (!d) return;
                        const dx = (e.clientX - d.x) / W * (d.v.x1 - d.v.x0), dy = (e.clientY - d.y) / H * (d.v.y1 - d.v.y0);
                        setView({ x0: d.v.x0 - dx, x1: d.v.x1 - dx, y0: d.v.y0 + dy, y1: d.v.y1 + dy });
                    }}
                    onPointerUp={() => { drag.current = null; }}
                    onPointerLeave={() => { if (!drag.current) setHoverX(null); }}>
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="vc-calc-plot-svg">
                        {lines(view.x0, view.x1, gx).map(x => <line key={`gx${x}`} x1={sx(x)} x2={sx(x)} y1={0} y2={H} className={x === 0 ? "vc-calc-axis2" : "vc-calc-grid"} />)}
                        {lines(view.y0, view.y1, gy).map(y => <line key={`gy${y}`} x1={0} x2={W} y1={sy(y)} y2={sy(y)} className={y === 0 ? "vc-calc-axis2" : "vc-calc-grid"} />)}
                        {lines(view.x0, view.x1, gx).filter(x => x !== 0).map(x => <text key={`tx${x}`} x={sx(x) + 3} y={Math.min(H - 4, Math.max(12, sy(0) + 13))} className="vc-calc-tick">{fmtN(x, 4)}</text>)}
                        {lines(view.y0, view.y1, gy).filter(y => y !== 0).map(y => <text key={`ty${y}`} x={Math.min(W - 40, Math.max(3, sx(0) + 4))} y={sy(y) - 3} className="vc-calc-tick">{fmtN(y, 4)}</text>)}
                        {curves.map((c, i) => paths[i] && <path key={c.fn.id} d={paths[i]} className="vc-calc-line" style={{ stroke: c.color }} />)}
                        {points.map((p, i) => p && curves[i].f && <g key={`p${i}`} style={{ fill: curves[i].color }}>
                            {p.zeros.map(z => <circle key={`z${z}`} cx={sx(z)} cy={sy(0)} r={3.5} className="vc-calc-pt" />)}
                            {p.turns.map(t => <circle key={`t${t.x}`} cx={sx(t.x)} cy={sy(t.y)} r={3.5} className="vc-calc-pt" />)}
                        </g>)}
                        {hoverX != null && <line x1={hoverX} x2={hoverX} y1={0} y2={H} className="vc-calc-cross" />}
                        {hx != null && curves.map(c => {
                            if (!c.f) return null;
                            const y = c.f(hx);
                            return Number.isFinite(y) && y >= view.y0 && y <= view.y1 ? <circle key={`h${c.fn.id}`} cx={hoverX!} cy={sy(y)} r={4.5} style={{ fill: c.color }} className="vc-calc-hover" /> : null;
                        })}
                    </svg>
                    {hx != null && (
                        <div className="vc-calc-readout" style={hoverX! > W - 180 ? { right: W - hoverX! + 10 } : { left: hoverX! + 10 }}>
                            <b>x = {hx.toFixed(digits)}</b>
                            {curves.filter(c => c.f).map(c => { const y = c.f!(hx); return <span key={c.fn.id}><i style={{ background: c.color }} />{Number.isFinite(y) ? y.toFixed(digits + 1) : "—"}</span>; })}
                        </div>
                    )}
                </div>
                <div className="vc-calc-plot-tools">
                    <button type="button" className="vc-tool-icon" title="Zoom in" onClick={() => zoom(1 / 1.5)}>＋</button>
                    <button type="button" className="vc-tool-icon" title="Zoom out" onClick={() => zoom(1.5)}>－</button>
                    <button type="button" className="vc-tool-chip" title="Fit the height to what's drawn" onClick={fitY}>Fit</button>
                    <button type="button" className="vc-tool-chip" onClick={() => setView(START)}>Reset</button>
                    <span className="vc-tool-spacer" />
                    <div className="vc-tool-seg">
                        <button type="button" className={classes("vc-tool-seg-btn", mode === "rad" && "vc-tool-seg-on")} onClick={() => setMode("rad")}>Radians</button>
                        <button type="button" className={classes("vc-tool-seg-btn", mode === "deg" && "vc-tool-seg-on")} onClick={() => setMode("deg")}>Degrees</button>
                    </div>
                </div>
            </div>

            <div className="vc-calc-facts">
                {curves.map((c, i) => {
                    const p = points[i];
                    if (!c.f || !p) return null;
                    const parts = [
                        p.zeros.length ? `crosses zero at x = ${p.zeros.map(z => fmtN(z, 4)).join(", ")}` : null,
                        ...p.turns.map(t => `${t.kind === "max" ? "highest" : "lowest"} point (${fmtN(t.x, 4)}, ${fmtN(t.y, 4)})`),
                    ].filter(Boolean);
                    return <span key={c.fn.id}><i style={{ background: c.color }} /><b>y = {body(c.fn.text)}</b>{parts.length ? ` — ${parts.join(" · ")}` : " — no crossings or turns in view"}</span>;
                })}
                <span className="vc-tool-hint">Drag to move around, scroll to zoom, hover to read the values. Your saved variables work here too.</span>
            </div>
        </div>
    );
}
