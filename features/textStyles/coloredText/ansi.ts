/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's coloured text: a ```ansi code block with escape codes. Since
// Discord's 2026 code block update its reader takes far more than the old 8
// colours: 16 named colours for text and background (30–37, 90–97 and
// 40–47, 100–107), any colour at all (38;2;R;G;B and 48;2;R;G;B), the
// 256-colour table (38;5;N), and bold, italic, underline, strikethrough and
// overline (1, 3, 4, 9, 53). Named colours follow the reader's theme.

export interface Swatch { code: number; name: string; color: string; }

// Discord draws the 16 named colours with its theme's --ansi-* colours; the hex is its dark theme's, for anywhere they're missing.
const NAMED: [string, string, string][] = [
    ["Black", "black", "#000000"], ["Red", "red", "#ec6361"], ["Green", "green", "#45a366"], ["Yellow", "yellow", "#ce8100"],
    ["Blue", "blue", "#4591ec"], ["Pink", "magenta", "#f549c9"], ["Teal", "cyan", "#049faa"], ["Light grey", "white", "#b6b7bc"],
    ["Grey", "bright-black", "#70717a"], ["Light red", "bright-red", "#ff938e"], ["Light green", "bright-green", "#21bb63"], ["Gold", "bright-yellow", "#e79418"],
    ["Lavender", "bright-blue", "#a0a9fa"], ["Light pink", "bright-magenta", "#fd99e9"], ["Light teal", "bright-cyan", "#5fbfc8"], ["White", "bright-white", "#ffffff"],
];
const swatches = (base: number, bright: number): Swatch[] => NAMED.map(([name, v, hex], i) => ({
    code: i < 8 ? base + i : bright + i - 8,
    name,
    color: `var(--ansi-${v}, ${hex})`,
}));

export const TEXT_COLORS = swatches(30, 90);
export const BACKGROUNDS = swatches(40, 100);

/** A named colour's code, or any colour as "#rrggbb". */
export type Colour = number | string;

export interface Style {
    fg: Colour | null;
    bg: Colour | null;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    overline: boolean;
}
export type Mark = "bold" | "italic" | "underline" | "strike" | "overline";
export const MARKS: Mark[] = ["bold", "italic", "underline", "strike", "overline"];
const MARK_CODE: Record<Mark, number> = { bold: 1, italic: 3, underline: 4, strike: 9, overline: 53 };

export const PLAIN: Style = { fg: null, bg: null, bold: false, italic: false, underline: false, strike: false, overline: false };

export const sameStyle = (a: Style, b: Style) => a.fg === b.fg && a.bg === b.bg && MARKS.every(m => !!a[m] === !!b[m]);
const isPlain = (s: Style) => sameStyle(s, PLAIN);

const ESC = "\u001b";

/** Runs of text that share a style. Styles are per UTF-16 unit, like the text box's selection. */
export function runs(text: string, styles: Style[]) {
    const out: { text: string; style: Style; }[] = [];
    for (let i = 0; i < text.length; i++) {
        const st = styles[i] ?? PLAIN;
        const last = out[out.length - 1];
        if (last && sameStyle(last.style, st)) last.text += text[i];
        else out.push({ text: text[i], style: st });
    }
    return out;
}

/* ── Colours ── */

const rgbOf = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb: number[]) => `#${rgb.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;

/** xterm's 256 colours (the table Discord reads 38;5;N from): 16 named, a 6×6×6 cube, 24 greys. */
const CUBE = [0, 95, 135, 175, 215, 255];
function tableColour(n: number, base: number): Colour | null {
    if (n < 0 || n > 255) return null;
    if (n < 8) return base + n;
    if (n < 16) return base + 60 + n - 8;
    if (n < 232) { const i = n - 16; return hexOf([CUBE[Math.floor(i / 36)], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]]); }
    const g = 8 + (n - 232) * 10;
    return hexOf([g, g, g]);
}

/** The closest of the 240 fixed table colours (shorter to send than an exact colour). */
function nearestTable(hex: string): number {
    const [r, g, b] = rgbOf(hex);
    const step = (v: number) => CUBE.reduce((best, c, i) => Math.abs(c - v) < Math.abs(CUBE[best] - v) ? i : best, 0);
    const [ri, gi, bi] = [step(r), step(g), step(b)];
    const cube = [CUBE[ri], CUBE[gi], CUBE[bi]];
    const grey = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
    const gv = 8 + grey * 10;
    const dist = (c: number[]) => (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    return dist(cube) <= dist([gv, gv, gv]) ? 16 + ri * 36 + gi * 6 + bi : 232 + grey;
}

/** How a colour is written: its own code, or 38;2;R;G;B (38;5;N when `compact`). */
function colourCodes(c: Colour, back: boolean, compact: boolean): string {
    if (typeof c === "number") return String(c);
    const lead = back ? 48 : 38;
    return compact ? `${lead};5;${nearestTable(c)}` : `${lead};2;${rgbOf(c).join(";")}`;
}

/** What a colour looks like (for the preview and swatches). */
export function cssColour(c: Colour | null, list: Swatch[]): string | undefined {
    if (c == null) return undefined;
    return typeof c === "string" ? c : list.find(s => s.code === c)?.color;
}

/* ── Writing and reading ── */

/**
 * The message to send: the text with escape codes, in an ansi code block.
 * Only what changes is written each time, so colourful text fits in more
 * words. `compact` writes exact colours from the 256-colour table instead
 * (a little less exact, about half as long).
 */
export function toAnsi(text: string, styles: Style[], compact = false) {
    let body = "";
    let cur = PLAIN;
    for (const r of runs(text, styles)) {
        const st = r.style;
        if (!sameStyle(st, cur)) {
            // Taking something off is shortest as a full reset (0) and putting the rest back.
            const dropped = (cur.fg != null && st.fg == null) || (cur.bg != null && st.bg == null) || MARKS.some(m => cur[m] && !st[m]);
            const from = dropped ? PLAIN : cur;
            const codes: string[] = dropped ? ["0"] : [];
            for (const m of MARKS) if (st[m] && !from[m]) codes.push(String(MARK_CODE[m]));
            if (st.fg != null && st.fg !== from.fg) codes.push(colourCodes(st.fg, false, compact));
            if (st.bg != null && st.bg !== from.bg) codes.push(colourCodes(st.bg, true, compact));
            if (codes.length) body += `${ESC}[${codes.join(";")}m`;
            cur = st;
        }
        body += r.text;
    }
    if (!isPlain(cur)) body += `${ESC}[0m`;
    return "```ansi\n" + body + "\n```";
}

/** Reads coloured text back in (from a message or a pasted ansi block), the same way Discord does. */
export function fromAnsi(input: string): { text: string; styles: Style[]; } {
    const m = input.match(/```ansi\n?([\s\S]*?)\n?```/);
    const body = m ? m[1] : input;
    let text = "";
    const styles: Style[] = [];
    let st: Style = { ...PLAIN };
    const re = new RegExp(`${ESC}\\[([0-?]*)([ -/]*)([@-~])`, "g");
    let last = 0;
    const push = (chunk: string) => {
        text += chunk;
        for (let i = 0; i < chunk.length; i++) styles.push(st);
    };
    /** 38/48's "2;R;G;B" or "5;N". */
    const extended = (parts: string[], base: number): Colour | null => {
        const kind = parts.shift();
        if (kind === "2") {
            const rgb = parts.splice(0, 3).map(Number);
            return rgb.length === 3 && rgb.every(n => !Number.isNaN(n)) ? hexOf(rgb) : null;
        }
        if (kind === "5") return tableColour(Number(parts.shift()), base);
        return null;
    };
    for (let hit = re.exec(body); hit; hit = re.exec(body)) {
        push(body.slice(last, hit.index));
        last = re.lastIndex;
        // Only "m" (style) sequences count; anything else is dropped, like Discord does.
        if (hit[3] !== "m" || hit[2] || /^[<=>?]/.test(hit[1])) continue;
        st = { ...st };
        const parts = (hit[1] || "0").split(";");
        while (parts.length) {
            const raw = parts.shift();
            if (!raw) continue;
            const n = Number(raw);
            if (Number.isNaN(n)) continue;
            if (n === 0) st = { ...PLAIN };
            else if (n === 1) st.bold = true;
            else if (n === 3) st.italic = true;
            else if (n === 4) st.underline = true;
            else if (n === 9) st.strike = true;
            else if (n === 53) st.overline = true;
            else if (n === 22) st.bold = false;
            else if (n === 23) st.italic = false;
            else if (n === 24) st.underline = false;
            else if (n === 29) st.strike = false;
            else if (n === 55) st.overline = false;
            else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) st.fg = n;
            else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) st.bg = n;
            else if (n === 38) st.fg = extended(parts, 30) ?? st.fg;
            else if (n === 48) st.bg = extended(parts, 40) ?? st.bg;
            else if (n === 39) st.fg = null;
            else if (n === 49) st.bg = null;
        }
    }
    push(body.slice(last));
    return { text, styles };
}

/* ── Effects ── */

function hsvHex(h: number, s: number, v: number) {
    const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return hexOf([f(5) * 255, f(3) * 255, f(1) * 255]);
}

/**
 * Colours for each character of `chunk`: a rainbow, or a fade from one colour
 * to another. Spaces keep the colour before them, so they cost nothing to send.
 */
export function effectColours(chunk: string, effect: { kind: "rainbow"; } | { kind: "gradient"; from: string; to: string; }): (string | null)[] {
    const units = chunk.split(""); // per UTF-16 unit, like the styles
    const visible = units.filter(c => c.trim()).length;
    const out: (string | null)[] = [];
    let n = 0;
    let prev: string | null = null;
    for (const ch of units) {
        if (!ch.trim()) { out.push(prev); continue; }
        const t = visible > 1 ? n / (visible - 1) : 0;
        let hex: string;
        if (effect.kind === "rainbow") hex = hsvHex(t * 300, 0.65, 1);
        else {
            const a = rgbOf(effect.from), b = rgbOf(effect.to);
            hex = hexOf(a.map((v, i) => v + (b[i] - v) * t));
        }
        out.push(hex);
        prev = hex;
        n++;
    }
    return out;
}
