/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Calculator's Tools tab: statistics for a list of numbers, aspect
// ratios, numbers in words and Roman numerals, programmer number bases, and
// a little graph of y = f(x).

import { useMemo, useState } from "@webpack/common";

import { evaluate } from "./engine";
import { Card, Chips, Field, fmtN, num, ok, Out, Row } from "./ui";
import { getVars } from "./variables";
import { fromRoman, numberToWords, toRoman } from "./words";

function StatsCard() {
    const [text, setText] = useState("4, 8, 15, 16, 23, 42");
    const xs = useMemo(() => (text.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite), [text]);
    const n = xs.length;
    const s = useMemo(() => {
        if (!n) return null;
        const sorted = [...xs].sort((a, b) => a - b), sum = xs.reduce((a, b) => a + b, 0), mean = sum / n;
        const median = n % 2 ? sorted[n >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
        const counts = new Map<number, number>();
        xs.forEach(x => counts.set(x, (counts.get(x) ?? 0) + 1));
        const top = Math.max(...counts.values());
        const mode = top > 1 ? [...counts].filter(([, c]) => c === top).map(([v]) => v) : [];
        const varP = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
        return { sum, mean, median, mode, min: sorted[0], max: sorted[n - 1], sdP: Math.sqrt(varP), sdS: n > 1 ? Math.sqrt(varP * n / (n - 1)) : NaN };
    }, [xs]);
    return (
        <Card title="Statistics" icon="📉" wide>
            <textarea className="vc-tool-area vc-calc-area" value={text} onChange={e => setText(e.currentTarget.value)} placeholder="Paste numbers — any way they're separated (commas, spaces, lines)" />
            <Row>
                <Out label="Count" value={String(n)} />
                <Out label="Sum" value={s ? fmtN(s.sum) : "—"} />
                <Out label="Average" value={s ? fmtN(s.mean) : "—"} big />
                <Out label="Median" value={s ? fmtN(s.median) : "—"} />
                <Out label="Most common" value={s ? (s.mode.length ? s.mode.slice(0, 4).map(v => fmtN(v)).join(", ") : "none repeat") : "—"} />
            </Row>
            <Row>
                <Out label="Smallest" value={s ? fmtN(s.min) : "—"} />
                <Out label="Largest" value={s ? fmtN(s.max) : "—"} />
                <Out label="Range" value={s ? fmtN(s.max - s.min) : "—"} />
                <Out label="Spread (std. dev.)" value={s ? fmtN(s.sdS) : "—"} hint={s ? `of everyone: ${fmtN(s.sdP)}` : undefined} />
            </Row>
        </Card>
    );
}

const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

function RatioCard() {
    const [w, setW] = useState("1920");
    const [h, setH] = useState("1080");
    const [nw, setNw] = useState("1280");
    const [nh, setNh] = useState("");
    const W = num(w), H = num(h);
    let ratio = "—";
    if (ok(W, H) && W > 0 && H > 0 && Number.isInteger(W) && Number.isInteger(H)) { const g = gcd(W, H); ratio = `${W / g}:${H / g}`; }
    else if (ok(W, H) && H > 0) ratio = `${fmtN(W / H, 3)}:1`;
    return (
        <Card title="Aspect ratio" icon="🖥️">
            <Row>
                <Field label="Width" value={w} onChange={setW} />
                <Field label="Height" value={h} onChange={setH} />
            </Row>
            <Row>
                <Out label="Ratio" value={ratio} big />
                <Out label="As a number" value={ok(W, H) && H > 0 ? fmtN(W / H, 4) : "—"} />
            </Row>
            <Row>
                <Field label="New width" value={nw} onChange={v => { setNw(v); setNh(""); }} />
                <Field label="…or new height" value={nh} onChange={v => { setNh(v); setNw(""); }} />
            </Row>
            <Out label="Keeps the shape at" value={ok(W, H) ? (nh ? `${fmtN(num(nh) * W / H, 1)} × ${nh}` : nw ? `${nw} × ${fmtN(num(nw) * H / W, 1)}` : "—") : "—"} />
        </Card>
    );
}

function WordsCard() {
    const [text, setText] = useState("1999");
    const t = text.trim();
    const fromR = fromRoman(t);
    const n = fromR ?? num(t);
    return (
        <Card title="Words & Roman numerals" icon="🔤">
            <Field label="A number (or Roman numerals)" value={text} onChange={setText} />
            <Out label="In words" value={Number.isFinite(n) ? numberToWords(n) : "—"} />
            <Row>
                <Out label="Roman numerals" value={fromR != null ? t.toUpperCase() : Number.isFinite(n) ? (toRoman(n) ?? "only 1–3999") : "—"} big />
                {fromR != null && <Out label="As a number" value={String(fromR)} big />}
            </Row>
        </Card>
    );
}

function ProgrammerCard() {
    const [text, setText] = useState("255");
    const [base, setBase] = useState<10 | 16 | 2 | 8>(10);
    const clean = text.trim().replace(/[\s_]/g, "").replace(/^0[xbo]/i, "");
    let n: bigint | null = null;
    try {
        const valid = { 10: /^-?\d+$/, 16: /^-?[0-9a-f]+$/i, 2: /^-?[01]+$/, 8: /^-?[0-7]+$/ }[base];
        if (valid.test(clean)) {
            const neg = clean.startsWith("-"), body = neg ? clean.slice(1) : clean;
            n = BigInt(base === 10 ? body : `0${{ 16: "x", 2: "b", 8: "o" }[base]}${body}`) * (neg ? -1n : 1n);
        }
    } catch { n = null; }
    const abs = n == null ? null : n < 0n ? -n : n, sign = n != null && n < 0n ? "-" : "";
    const bits = abs != null ? abs.toString(2).length : 0;
    return (
        <Card title="Programmer" icon="👩‍💻">
            <Chips value={base} options={[[10, "Decimal"], [16, "Hex"], [2, "Binary"], [8, "Octal"]]} onChange={setBase} />
            <Field label="Number" value={text} onChange={setText} />
            <Out label="Decimal" value={n != null ? n.toLocaleString() : "—"} />
            <Out label="Hex" value={abs != null ? `${sign}${abs.toString(16).toUpperCase()}` : "—"} />
            <Out label="Binary" value={abs != null ? `${sign}${abs.toString(2).replace(/\B(?=(\d{4})+(?!\d))/g, " ")}` : "—"} hint={abs != null ? `${bits} bit${bits === 1 ? "" : "s"}` : undefined} />
            <Out label="Octal" value={abs != null ? `${sign}${abs.toString(8)}` : "—"} />
            <span className="vc-tool-hint">In the calculator you can type 0xff, 0b1010, 0o17, and use and( ), or( ), xor( ), not, shl( ), shr( ).</span>
        </Card>
    );
}

function GraphCard() {
    const [fx, setFx] = useState("x^2 - 3");
    const [from, setFrom] = useState("-5");
    const [to, setTo] = useState("5");
    const W = 520, H = 260;
    const graph = useMemo(() => {
        const a = num(from), b = num(to);
        if (!ok(a, b) || a >= b) return { error: "Pick a range where \"from\" is less than \"to\"" };
        const pts: [number, number][] = [];
        const saved = getVars();
        let error: string | null = null;
        for (let i = 0; i <= 400; i++) {
            const x = a + (b - a) * i / 400;
            try { const y = evaluate(fx, { mode: "rad", vars: { ...saved, x } }); pts.push([x, y]); } catch (e) { if (!error && i === 200) error = (e as Error).message; pts.push([x, NaN]); }
        }
        const ys = pts.map(p => p[1]).filter(Number.isFinite);
        if (!ys.length) return { error: error ?? "Nothing to draw — use x, like x^2 or sin(x)" };
        // Ignore wild spikes (like 1/x near 0) when choosing the height.
        const sorted = [...ys].sort((p, q) => p - q);
        let lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.ceil(sorted.length * 0.98) - 1];
        if (lo === hi) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.08;
        lo -= pad; hi += pad;
        const sx = (x: number) => (x - a) / (b - a) * W, sy = (y: number) => H - (y - lo) / (hi - lo) * H;
        let d = "", pen = false;
        for (const [x, y] of pts) {
            if (!Number.isFinite(y) || y < lo - (hi - lo) * 2 || y > hi + (hi - lo) * 2) { pen = false; continue; }
            d += `${pen ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`;
            pen = true;
        }
        return { d, x0: a <= 0 && b >= 0 ? sx(0) : null, y0: lo <= 0 && hi >= 0 ? sy(0) : null, lo, hi, a, b };
    }, [fx, from, to]);
    return (
        <Card title="Graph" icon="📈" wide>
            <Row>
                <Field label="y =" value={fx} onChange={setFx} placeholder="x^2 - 3, sin(x), 2x + 1" />
                <Field label="x from" value={from} onChange={setFrom} width={90} />
                <Field label="to" value={to} onChange={setTo} width={90} />
            </Row>
            {"error" in graph ? <div className="vc-tool-hint">{graph.error}</div> : (
                <svg className="vc-calc-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Graph of y = ${fx}`}>
                    {graph.x0 != null && <line x1={graph.x0} x2={graph.x0} y1={0} y2={H} className="vc-calc-axis" />}
                    {graph.y0 != null && <line x1={0} x2={W} y1={graph.y0} y2={graph.y0} className="vc-calc-axis" />}
                    <path d={graph.d} className="vc-calc-curve" />
                    <text x={4} y={12} className="vc-calc-tick">{fmtN(graph.hi, 2)}</text>
                    <text x={4} y={H - 4} className="vc-calc-tick">{fmtN(graph.lo, 2)}</text>
                    <text x={W - 4} y={H - 4} className="vc-calc-tick" textAnchor="end">x = {fmtN(graph.b, 2)}</text>
                </svg>
            )}
            <span className="vc-tool-hint">Angles here are in radians. Anything the calculator understands works: sin(x), sqrt(x), abs(x - 2), your saved variables…</span>
        </Card>
    );
}

export function ToolsTab() {
    return (
        <div className="vc-calc-tools">
            <StatsCard />
            <GraphCard />
            <RatioCard />
            <WordsCard />
            <ProgrammerCard />
        </div>
    );
}
