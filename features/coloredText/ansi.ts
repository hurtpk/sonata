/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's coloured text: a ```ansi code block with escape codes. Discord
// only supports these 8 text colours, 8 backgrounds, bold and underline.

export interface Swatch { code: number; name: string; color: string; }

export const TEXT_COLORS: Swatch[] = [
    { code: 30, name: "Grey", color: "#4f545c" },
    { code: 31, name: "Red", color: "#dc322f" },
    { code: 32, name: "Green", color: "#859900" },
    { code: 33, name: "Yellow", color: "#b58900" },
    { code: 34, name: "Blue", color: "#268bd2" },
    { code: 35, name: "Pink", color: "#d33682" },
    { code: 36, name: "Cyan", color: "#2aa198" },
    { code: 37, name: "White", color: "#ffffff" },
];

export const BACKGROUNDS: Swatch[] = [
    { code: 40, name: "Firefly dark blue", color: "#002b36" },
    { code: 41, name: "Orange", color: "#cb4b16" },
    { code: 42, name: "Marble blue", color: "#586e75" },
    { code: 43, name: "Greyish turquoise", color: "#657b83" },
    { code: 44, name: "Grey", color: "#839496" },
    { code: 45, name: "Indigo", color: "#6c71c4" },
    { code: 46, name: "Light grey", color: "#93a1a1" },
    { code: 47, name: "White", color: "#fdf6e3" },
];

export interface Style { fg: number | null; bg: number | null; bold: boolean; underline: boolean; }
export const PLAIN: Style = { fg: null, bg: null, bold: false, underline: false };

export const sameStyle = (a: Style, b: Style) => a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.underline === b.underline;
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

/** The message to send: the text with escape codes, in an ansi code block. */
export function toAnsi(text: string, styles: Style[]) {
    let body = "";
    let current = PLAIN;
    for (const r of runs(text, styles)) {
        if (!sameStyle(r.style, current)) {
            const codes = [0];
            if (r.style.bold) codes.push(1);
            if (r.style.underline) codes.push(4);
            if (r.style.fg) codes.push(r.style.fg);
            if (r.style.bg) codes.push(r.style.bg);
            body += `${ESC}[${codes.join(";")}m`;
            current = r.style;
        }
        body += r.text;
    }
    if (!isPlain(current)) body += `${ESC}[0m`;
    return "```ansi\n" + body + "\n```";
}

/** Reads coloured text back in (from a message or a pasted ansi block). */
export function fromAnsi(input: string): { text: string; styles: Style[]; } {
    const m = input.match(/```ansi\n?([\s\S]*?)\n?```/);
    const body = m ? m[1] : input;
    let text = "";
    const styles: Style[] = [];
    let st: Style = { ...PLAIN };
    const re = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");
    let last = 0;
    const push = (chunk: string) => {
        text += chunk;
        for (let i = 0; i < chunk.length; i++) styles.push(st);
    };
    for (let hit = re.exec(body); hit; hit = re.exec(body)) {
        push(body.slice(last, hit.index));
        last = re.lastIndex;
        st = { ...st };
        for (const n of (hit[1] || "0").split(";").map(Number)) {
            if (n === 0) st = { ...PLAIN };
            else if (n === 1) st.bold = true;
            else if (n === 4) st.underline = true;
            else if (n >= 30 && n <= 37) st.fg = n;
            else if (n >= 40 && n <= 47) st.bg = n;
        }
    }
    push(body.slice(last));
    return { text, styles };
}

export const colorOf = (code: number | null, list: Swatch[]) => list.find(s => s.code === code)?.color;
