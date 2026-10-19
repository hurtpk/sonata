/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A small, safe calculator: a real parser (never eval), so whatever is typed
// can only ever be maths.
//
//   + − × ÷ * / ^ %(percent) !(factorial) ( )   implicit ×: 2π, 3(4+1), 2√9
//   200 + 10% = 220 · 20% of 150 = 30 · 0xff 0b1010 0o17
//   sqrt cbrt abs round floor ceil sin cos tan asin acos atan ln log log2 exp
//   sum avg mean median min max stdev count gcd lcm mod ncr npr hypot
//   and or xor not shl shr (whole numbers)
//   √x   π / pi   e   ans (the previous result)   rent = 1200 (saved variables)

export type AngleMode = "deg" | "rad";

export class CalcError extends Error { }

type Tok =
    | { t: "num"; v: number; }
    | { t: "id"; v: string; }
    | { t: "op"; v: string; };

const OPS = "+-*/^%!()√=,";
const ALIASES: Record<string, string> = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-", "π": "pi" };

function tokenize(src: string): Tok[] {
    const out: Tok[] = [];
    let i = 0;
    const s = src.replace(/[×·÷−–π]/g, c => ALIASES[c] === "pi" ? " pi " : ALIASES[c])
        // "3x4" and "3 x 4" mean times (but "0x1f" is hex, and a lone x is the graph's x).
        .replace(/(?<!0)(\d|\))\s*x\s*(?=[\d(.])/gi, "$1*");
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "." && !/[0-9]/.test(s[i + 1] ?? "")) throw new CalcError("Unexpected \".\"");
        const based = /^0([xbo])([0-9a-f]+)/i.exec(s.slice(i));
        if (based) {
            const v = parseInt(based[2], based[1].toLowerCase() === "x" ? 16 : based[1].toLowerCase() === "b" ? 2 : 8);
            if (Number.isNaN(v) || !(based[1].toLowerCase() === "x" ? /^[0-9a-f]+$/i : based[1].toLowerCase() === "b" ? /^[01]+$/ : /^[0-7]+$/).test(based[2])) throw new CalcError(`"${based[0]}" isn't a valid number`);
            out.push({ t: "num", v });
            i += based[0].length;
            continue;
        }
        if (/[0-9.]/.test(c)) {
            const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
            if (!m) throw new CalcError("That number doesn't look right");
            out.push({ t: "num", v: Number(m[0]) });
            i += m[0].length;
            continue;
        }
        if (/[a-z_]/i.test(c)) {
            const m = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i))!;
            out.push({ t: "id", v: m[0].toLowerCase() });
            i += m[0].length;
            continue;
        }
        if (OPS.includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
        throw new CalcError(`Unexpected "${c}"`);
    }
    return out;
}

const toRad = (x: number, m: AngleMode) => m === "deg" ? x * Math.PI / 180 : x;
const fromRad = (x: number, m: AngleMode) => m === "deg" ? x * 180 / Math.PI : x;

const FUNCS: Record<string, (x: number, mode: AngleMode) => number> = {
    sqrt: x => { if (x < 0) throw new CalcError("Can't take the square root of a negative number"); return Math.sqrt(x); },
    cbrt: x => Math.cbrt(x),
    abs: x => Math.abs(x),
    floor: x => Math.floor(x),
    ceil: x => Math.ceil(x),
    sin: (x, m) => Math.sin(toRad(x, m)),
    cos: (x, m) => Math.cos(toRad(x, m)),
    tan: (x, m) => {
        if (m === "deg" && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-12) throw new CalcError("tan is undefined there");
        return Math.tan(toRad(x, m));
    },
    asin: (x, m) => fromRad(Math.asin(x), m),
    acos: (x, m) => fromRad(Math.acos(x), m),
    atan: (x, m) => fromRad(Math.atan(x), m),
    ln: x => { if (x <= 0) throw new CalcError("ln needs a number above 0"); return Math.log(x); },
    log2: x => { if (x <= 0) throw new CalcError("log2 needs a number above 0"); return Math.log2(x); },
    exp: x => Math.exp(x),
    not: x => ~whole(x, "not"),
};

const whole = (x: number, name: string) => {
    if (!Number.isInteger(x)) throw new CalcError(`${name} works on whole numbers`);
    return x;
};

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const gcd2 = (a: number, b: number): number => { a = Math.abs(whole(a, "gcd")); b = Math.abs(whole(b, "gcd")); while (b) [a, b] = [b, a % b]; return a; };

/** Functions that take several numbers: sum(1, 2, 3). */
const MULTI: Record<string, { min: number; max?: number; fn: (xs: number[], mode: AngleMode) => number; }> = {
    sum: { min: 1, fn: xs => xs.reduce((a, b) => a + b, 0) },
    avg: { min: 1, fn: mean },
    mean: { min: 1, fn: mean },
    median: { min: 1, fn: xs => { const s = sorted(xs), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; } },
    min: { min: 1, fn: xs => Math.min(...xs) },
    max: { min: 1, fn: xs => Math.max(...xs) },
    count: { min: 0, fn: xs => xs.length },
    stdev: { min: 2, fn: xs => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); } },
    gcd: { min: 2, fn: xs => xs.reduce(gcd2) },
    lcm: { min: 2, fn: xs => xs.reduce((a, b) => Math.abs(a * b) / gcd2(a, b)) },
    mod: { min: 2, max: 2, fn: ([a, b]) => { if (b === 0) throw new CalcError("Can't divide by zero"); return ((a % b) + b) % b; } },
    ncr: { min: 2, max: 2, fn: ([n, r]) => choose(n, r) },
    npr: { min: 2, max: 2, fn: ([n, r]) => choose(n, r) * factorial(r) },
    hypot: { min: 2, fn: xs => Math.hypot(...xs) },
    round: { min: 1, max: 2, fn: ([x, d = 0]) => { const k = 10 ** whole(d, "round's second number"); return Math.round(x * k) / k; } },
    log: { min: 1, max: 2, fn: ([x, b = 10]) => { if (x <= 0) throw new CalcError("log needs a number above 0"); return Math.log(x) / Math.log(b); } },
    and: { min: 2, fn: xs => xs.map(x => whole(x, "and")).reduce((a, b) => a & b) },
    or: { min: 2, fn: xs => xs.map(x => whole(x, "or")).reduce((a, b) => a | b) },
    xor: { min: 2, fn: xs => xs.map(x => whole(x, "xor")).reduce((a, b) => a ^ b) },
    shl: { min: 2, max: 2, fn: ([a, b]) => whole(a, "shl") * 2 ** whole(b, "shl") },
    shr: { min: 2, max: 2, fn: ([a, b]) => Math.floor(whole(a, "shr") / 2 ** whole(b, "shr")) },
};

function factorial(n: number) {
    if (n < 0 || !Number.isInteger(n)) throw new CalcError("Factorial needs a whole number ≥ 0");
    if (n > 170) throw new CalcError("That factorial is too big");
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
}

function choose(n: number, r: number) {
    if (!Number.isInteger(n) || !Number.isInteger(r) || r < 0 || n < 0 || r > n) throw new CalcError("nCr needs whole numbers with r ≤ n");
    let out = 1;
    for (let k = 1; k <= r; k++) out = out * (n - r + k) / k;
    return Math.round(out);
}

const CONSTANTS = new Set(["pi", "e", "ans", "of", "x"]);
/** Names that can't be used for variables. */
export const isReserved = (name: string) => CONSTANTS.has(name) || name in FUNCS || name in MULTI;

export interface EvalOptions {
    mode?: AngleMode;
    ans?: number;
    /** Saved variables (and "x" when graphing). */
    vars?: Record<string, number>;
}

export interface Evaluated { value: number; /** Set when the input was "name = …". */ assigned?: string; }

export function evaluateFull(src: string, opts: EvalOptions = {}): Evaluated {
    let toks = tokenize(src);
    let assigned: string | undefined;
    // "rent = 1200"
    if (toks.length > 2 && toks[0].t === "id" && toks[1].t === "op" && toks[1].v === "=") {
        assigned = toks[0].v;
        if (isReserved(assigned)) throw new CalcError(`"${assigned}" is already taken — pick another name`);
        toks = toks.slice(2);
    }
    if (toks.some(t => t.t === "op" && t.v === "=")) throw new CalcError("Use = only to save a value, like rent = 1200");
    return { value: run(toks, opts), assigned };
}

export function evaluate(src: string, opts: EvalOptions = {}): number {
    return evaluateFull(src, opts).value;
}

function run(toks: Tok[], opts: EvalOptions): number {
    const mode = opts.mode ?? "deg";
    if (!toks.length) throw new CalcError("Type something to calculate");
    let p = 0;
    // Whether the term just read was a plain percentage ("10%"), so "200 + 10%" can mean 220.
    let percentTerm = false;
    const peek = () => toks[p];
    const isOp = (v: string) => toks[p]?.t === "op" && toks[p].v === v;
    const isId = (v: string) => toks[p]?.t === "id" && toks[p].v === v;
    const startsPrimary = () => {
        const t = peek();
        return !!t && ((t.t === "num") || (t.t === "id" && t.v !== "of") || (t.t === "op" && (t.v === "(" || t.v === "√")));
    };

    function expr(): number {
        let v = term();
        while (isOp("+") || isOp("-")) {
            const op = toks[p++].v;
            const rhs = term();
            if (percentTerm) v = op === "+" ? v * (1 + rhs) : v * (1 - rhs);
            else v = op === "+" ? v + rhs : v - rhs;
        }
        percentTerm = false;
        return v;
    }

    function term(): number {
        let v = power();
        let pct = percentTerm;
        while (true) {
            if (isOp("*") || isId("of")) { p++; v *= power(); pct = false; }
            else if (isOp("/")) {
                p++;
                const d = power();
                if (d === 0) throw new CalcError("Can't divide by zero");
                v /= d;
                pct = false;
            } else if (startsPrimary()) { v *= power(); pct = false; } // implicit: 2π, 3(4+1)
            else { percentTerm = pct; return v; }
        }
    }

    // Unary minus binds looser than ^, so -2^2 = -4 (like on paper).
    function power(): number {
        percentTerm = false;
        if (isOp("-")) { p++; return -power(); }
        if (isOp("+")) { p++; return power(); }
        const base = postfix();
        if (isOp("^")) { p++; percentTerm = false; return Math.pow(base, power()); }
        return base;
    }

    function postfix(): number {
        let v = primary();
        let pct = false;
        while (isOp("!") || isOp("%")) {
            if (toks[p++].v === "!") { v = factorial(v); pct = false; } else { v /= 100; pct = true; }
        }
        percentTerm = pct;
        return v;
    }

    function args(): number[] {
        // After "(": numbers separated by commas, up to ")".
        const out: number[] = [];
        if (isOp(")")) { p++; return out; }
        while (true) {
            out.push(expr());
            if (isOp(",")) { p++; continue; }
            if (!isOp(")")) throw new CalcError("Missing a closing bracket )");
            p++;
            return out;
        }
    }

    function primary(): number {
        const t = toks[p];
        if (!t) throw new CalcError("The calculation ends too early");
        if (t.t === "num") { p++; return t.v; }
        if (t.t === "op" && t.v === "(") {
            p++;
            const v = expr();
            if (isOp(",")) throw new CalcError("Use a dot for decimals (3.5, not 3,5)");
            if (!isOp(")")) throw new CalcError("Missing a closing bracket )");
            p++;
            return v;
        }
        if (t.t === "op" && t.v === "√") { p++; return FUNCS.sqrt(power(), mode); }
        if (t.t === "id") {
            p++;
            if (t.v === "pi") return Math.PI;
            if (t.v === "e") return Math.E;
            if (t.v === "ans") {
                if (opts.ans == null) throw new CalcError("There's no previous answer yet");
                return opts.ans;
            }
            const multi = MULTI[t.v];
            if (multi) {
                if (!isOp("(")) {
                    // round / log also work without brackets for one number.
                    if (multi.min <= 1 && multi.max !== undefined) return multi.fn([power()], mode);
                    throw new CalcError(`${t.v} needs brackets, like ${t.v}(1, 2, 3)`);
                }
                p++;
                const a = args();
                if (a.length < multi.min) throw new CalcError(`${t.v} needs at least ${multi.min} number${multi.min > 1 ? "s" : ""}`);
                if (multi.max && a.length > multi.max) throw new CalcError(`${t.v} takes at most ${multi.max} number${multi.max > 1 ? "s" : ""}`);
                return multi.fn(a, mode);
            }
            const fn = FUNCS[t.v];
            if (fn) return fn(isOp("(") ? primary() : power(), mode);
            if (opts.vars && t.v in opts.vars) return opts.vars[t.v];
            throw new CalcError(`Unknown name "${t.v}"${/^[a-z_][a-z0-9_]*$/.test(t.v) ? ` — save it first, like ${t.v} = 5` : ""}`);
        }
        if (t.t === "op" && t.v === ",") throw new CalcError("Use a dot for decimals (3.5, not 3,5)");
        throw new CalcError(t.v === ")" ? "There's a closing bracket without an opening one" : `Unexpected "${t.v}"`);
    }

    const result = expr();
    if (p < toks.length) {
        const t = toks[p];
        throw new CalcError(t.t === "op" && t.v === ")" ? "There's a closing bracket without an opening one" : t.t === "op" && t.v === "," ? "Use a dot for decimals (3.5, not 3,5)" : `Unexpected "${t.v}"`);
    }
    if (Number.isNaN(result)) throw new CalcError("That isn't a real number");
    if (!Number.isFinite(result)) throw new CalcError("The result is too large");
    return result;
}

// ─── Showing results ───

export type Rounding = "auto" | "0" | "1" | "2" | "3" | "4" | "6" | "sig3" | "sig5";

/** Tidy display: 0.1+0.2 → 0.3, huge/tiny numbers in scientific notation, or the rounding asked for. */
export function formatResult(n: number, rounding: Rounding = "auto"): string {
    if (Object.is(n, -0)) n = 0;
    if (rounding.startsWith("sig")) return String(parseFloat(n.toPrecision(Number(rounding.slice(3)))));
    if (rounding !== "auto") return n.toFixed(Number(rounding));
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(8).replace(/\.?0+e/, "e").replace("e+", "e");
    if (Number.isInteger(n)) return String(n);
    return String(parseFloat(n.toPrecision(12)));
}

/** 0.583333 → "7/12" (null if it isn't a tidy fraction). */
export function asFraction(n: number, maxDen = 10000): string | null {
    if (!Number.isFinite(n) || Number.isInteger(n)) return null;
    const sign = n < 0 ? "-" : "";
    let x = Math.abs(n), [h0, h1, k0, k1] = [0, 1, 1, 0];
    for (let i = 0; i < 40; i++) {
        const a = Math.floor(x);
        [h0, h1] = [h1, a * h1 + h0];
        [k0, k1] = [k1, a * k1 + k0];
        if (k1 > maxDen) return null;
        if (Math.abs(h1 / k1 - Math.abs(n)) < 1e-10) break;
        x = 1 / (x - a);
        if (!Number.isFinite(x)) break;
    }
    if (k1 > maxDen || Math.abs(h1 / k1 - Math.abs(n)) > 1e-9) return null;
    const whole = Math.floor(h1 / k1), rest = h1 - whole * k1;
    return whole && rest ? `${sign}${h1}/${k1} (${sign}${whole} ${rest}/${k1})` : `${sign}${h1}/${k1}`;
}

/** For whole numbers: the same in hex, binary and octal. */
export function inBases(n: number) {
    if (!Number.isInteger(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) return null;
    const sign = n < 0 ? "-" : "", a = Math.abs(n);
    return { hex: `${sign}0x${a.toString(16).toUpperCase()}`, bin: `${sign}0b${a.toString(2)}`, oct: `${sign}0o${a.toString(8)}` };
}
