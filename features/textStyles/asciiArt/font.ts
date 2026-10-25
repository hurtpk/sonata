/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A 5×5 pixel font, drawn in different styles: solid blocks, a compact
// half-block style (square pixels, half the height), 3D shadow, #, dots,
// any character you like, or emoji squares.

const G: Record<string, string> = {
    A: ".###. #...# ##### #...# #...#", B: "####. #...# ####. #...# ####.", C: ".#### #.... #.... #.... .####",
    D: "####. #...# #...# #...# ####.", E: "##### #.... ####. #.... #####", F: "##### #.... ####. #.... #....",
    G: ".#### #.... #..## #...# .###.", H: "#...# #...# ##### #...# #...#", I: "##### ..#.. ..#.. ..#.. #####",
    J: "..### ....# ....# #...# .###.", K: "#...# #..#. ###.. #..#. #...#", L: "#.... #.... #.... #.... #####",
    M: "#...# ##.## #.#.# #...# #...#", N: "#...# ##..# #.#.# #..## #...#", O: ".###. #...# #...# #...# .###.",
    P: "####. #...# ####. #.... #....", Q: ".###. #...# #.#.# #..#. .##.#", R: "####. #...# ####. #..#. #...#",
    S: ".#### #.... .###. ....# ####.", T: "##### ..#.. ..#.. ..#.. ..#..", U: "#...# #...# #...# #...# .###.",
    V: "#...# #...# #...# .#.#. ..#..", W: "#...# #...# #.#.# ##.## #...#", X: "#...# .#.#. ..#.. .#.#. #...#",
    Y: "#...# .#.#. ..#.. ..#.. ..#..", Z: "##### ...#. ..#.. .#... #####",
    0: ".###. #..## #.#.# ##..# .###.", 1: "..#.. .##.. ..#.. ..#.. .###.", 2: ".###. #...# ..##. .#... #####",
    3: "####. ....# .###. ....# ####.", 4: "#..#. #..#. ##### ...#. ...#.", 5: "##### #.... ####. ....# ####.",
    6: ".###. #.... ####. #...# .###.", 7: "##### ....# ...#. ..#.. ..#..", 8: ".###. #...# .###. #...# .###.",
    9: ".###. #...# .#### ....# .###.",
    "!": "# # # . #", "?": ".###. #...# ..##. ..... ..#..", ".": ". . . . #", ",": ".. .. .. .# #.", "-": "... ... ### ... ...",
    "+": "... .#. ### .#. ...", ":": ". # . # .", "'": "# # . . .", "\"": "#.# #.# ... ... ...", "/": "....# ...#. ..#.. .#... #....",
    "(": ".# #. #. #. .#", ")": "#. .# .# .# #.", "=": "... ### ... ### ...", "_": "..... ..... ..... ..... #####",
    "#": ".#.#. ##### .#.#. ##### .#.#.", "*": "..... #.#.# .###. #.#.# .....", "<": "..# .#. #.. .#. ..#", ">": "#.. .#. ..# .#. #..",
    "♥": ".#.#. ##### ##### .###. ..#..", "★": "..#.. ..#.. ##### .###. #...#", "&": ".##.. #..#. .##.# #..#. .##.#",
    "@": ".###. #.### #.### #.... .###.", "%": "##..# ##.#. ..#.. .#.## #..##", "$": ".#### #.#.. .###. ..#.# ####.",
};

export type Grid = boolean[][];

const glyph = (ch: string): Grid | null => {
    const g = G[ch.toUpperCase()] ?? G[ch];
    return g ? g.split(" ").map(row => [...row].map(c => c === "#")) : null;
};

/** One line of text as a pixel grid, 5 rows tall. Unknown characters become a gap. */
export function rasterize(line: string): Grid {
    const rows: boolean[][] = [[], [], [], [], []];
    const chars = [...line];
    chars.forEach((ch, i) => {
        const g = ch === " " ? null : glyph(ch);
        const width = g ? g[0].length : ch === " " ? 3 : 0;
        for (let r = 0; r < 5; r++) rows[r].push(...(g ? g[r] : Array(width).fill(false)));
        if (i < chars.length - 1 && width) rows.forEach(r => r.push(false));
    });
    return rows;
}

export const supported = (ch: string) => ch === " " || ch === "\n" || !!glyph(ch);

export type Style = "blocks" | "compact" | "shadow" | "hash" | "dots" | "custom" | "emoji";

export const STYLES: { id: Style; name: string; }[] = [
    { id: "compact", name: "Compact" },
    { id: "blocks", name: "Blocks" },
    { id: "shadow", name: "3D shadow" },
    { id: "hash", name: "Hash" },
    { id: "dots", name: "Dots" },
    { id: "custom", name: "Any character" },
    { id: "emoji", name: "Emoji" },
];

export interface Options { style: Style; char: string; fg: string; bg: string; }

function drawGrid(g: Grid, o: Options): string[] {
    const h = g.length, w = g[0]?.length ?? 0;
    const at = (r: number, c: number) => r >= 0 && c >= 0 && r < h && c < w && g[r][c];
    switch (o.style) {
        case "compact": {
            // Two rows per line with half blocks — pixels come out square.
            const out: string[] = [];
            for (let r = 0; r < h; r += 2) {
                let line = "";
                for (let c = 0; c < w; c++) {
                    const top = at(r, c), bottom = at(r + 1, c);
                    line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
                }
                out.push(line);
            }
            return out;
        }
        case "shadow": {
            const out: string[] = [];
            for (let r = 0; r <= h; r++) {
                let line = "";
                for (let c = 0; c <= w; c++) line += at(r, c) ? "██" : at(r - 1, c - 1) ? "░░" : "  ";
                out.push(line);
            }
            return out;
        }
        case "emoji": return g.map(row => row.map(p => p ? o.fg : o.bg).join(""));
        default: {
            const on = o.style === "blocks" ? "██" : o.style === "hash" ? "##" : o.style === "dots" ? "●" : (o.char || "#");
            const off = " ".repeat([...on].length);
            return g.map(row => row.map(p => p ? on : off).join(""));
        }
    }
}

/** The whole text drawn; each line of text becomes a block, with a blank line between. */
export function render(text: string, o: Options): string {
    const lines = text.split("\n").map(l => l.trimEnd()).filter((l, i, a) => l || i < a.length - 1);
    const blocks = lines.map(l => l ? drawGrid(rasterize(l), o).map(x => x.trimEnd()) : [""]);
    const joiner = o.style === "emoji" ? [] : [""];
    return blocks.flatMap((b, i) => i ? [...joiner, ...b] : b).join("\n");
}

/** How the art is sent: in a code block (so it lines up), or as is for emoji. */
export const asMessage = (art: string, o: Options) => o.style === "emoji" ? art : `\`\`\`\n${art}\n\`\`\``;

export const widthOf = (art: string) => Math.max(0, ...art.split("\n").map(l => [...l].length));
