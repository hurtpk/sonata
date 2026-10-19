/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Text encodings for Encoder Tools. No Discord code here, so it can be tested on its own.

export interface Codec {
    id: string;
    name: string;
    encode(text: string): string;
    /** Throws when the text isn't in this format. */
    decode(text: string): string;
    /** Does this look like text in this format? (For working out what a message is.) */
    looksLike(text: string): boolean;
}

const MORSE: Record<string, string> = {
    a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--",
    n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
    0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--", "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...",
    ":": "---...", ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-", "\"": ".-..-.", "$": "...-..-", "@": ".--.-.",
};
const FROM_MORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

const utf8 = new TextEncoder(), fromUtf8 = new TextDecoder("utf-8", { fatal: true });

function rot13(s: string) {
    return s.replace(/[a-z]/gi, c => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
}

export const CODECS: Codec[] = [
    {
        id: "morse", name: "Morse",
        encode: t => t.toLowerCase().split(/\n/).map(line => line.split(/\s+/).filter(Boolean)
            .map(word => [...word].map(c => MORSE[c] ?? "").filter(Boolean).join(" ")).join(" / ")).join("\n"),
        decode: t => t.trim().split(/\n/).map(line => line.trim().split(/\s*[/|]\s*|\s{3,}/).map(word => word.split(/\s+/).filter(Boolean).map(code => {
            const c = FROM_MORSE[code.replace(/[•·]/g, ".").replace(/[–—_]/g, "-")];
            if (c == null) throw new Error(`"${code}" isn't Morse code`);
            return c;
        }).join("")).join(" ")).join("\n").toUpperCase(),
        looksLike: t => /^[\s.\-–—•·/|_]+$/.test(t) && /[.\-•·]/.test(t),
    },
    {
        id: "binary", name: "Binary",
        encode: t => [...utf8.encode(t)].map(b => b.toString(2).padStart(8, "0")).join(" "),
        decode: t => {
            const bits = t.replace(/[^01]/g, "");
            if (!bits || bits.length % 8) throw new Error("Binary needs groups of 8 ones and zeros");
            return fromUtf8.decode(new Uint8Array(bits.match(/.{8}/g)!.map(b => parseInt(b, 2))));
        },
        looksLike: t => /^[01\s]+$/.test(t) && t.replace(/\s/g, "").length % 8 === 0 && t.replace(/\s/g, "").length >= 8,
    },
    {
        id: "base64", name: "Base64",
        encode: t => {
            let s = "";
            for (const b of utf8.encode(t)) s += String.fromCharCode(b);
            return btoa(s);
        },
        decode: t => {
            const clean = t.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("That isn't Base64");
            const bin = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "="));
            return fromUtf8.decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
        },
        looksLike: t => {
            const c = t.replace(/\s/g, "");
            return c.length >= 8 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(c) && /[0-9+/=A-Z]/.test(c) && /[a-z]/.test(c);
        },
    },
    {
        id: "hex", name: "Hex",
        encode: t => [...utf8.encode(t)].map(b => b.toString(16).padStart(2, "0")).join(" "),
        decode: t => {
            const hex = t.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
            if (!hex || hex.length % 2) throw new Error("Hex needs pairs of 0–9 / a–f");
            return fromUtf8.decode(new Uint8Array(hex.match(/.{2}/g)!.map(h => parseInt(h, 16))));
        },
        looksLike: t => /^(0x)?[0-9a-f\s]+$/i.test(t) && t.replace(/\s|0x/gi, "").length % 2 === 0 && t.replace(/\s/g, "").length >= 4,
    },
    {
        id: "rot13", name: "ROT13",
        encode: rot13,
        decode: rot13,
        looksLike: () => false,
    },
    {
        id: "reverse", name: "Reversed",
        encode: t => [...t].reverse().join(""),
        decode: t => [...t].reverse().join(""),
        looksLike: () => false,
    },
    {
        id: "url", name: "URL",
        encode: t => encodeURIComponent(t),
        decode: t => decodeURIComponent(t.replace(/\+/g, " ")),
        looksLike: t => /%[0-9a-f]{2}/i.test(t) && !/\s/.test(t.trim()),
    },
];

/** The formats a piece of text seems to be in, most likely first. */
export function detect(text: string): Codec[] {
    const t = text.trim();
    if (!t) return [];
    const found = CODECS.filter(c => {
        if (!c.looksLike(t)) return false;
        try { c.decode(t); return true; } catch { return false; }
    });
    // Ones and zeros are also valid hex, but they're binary.
    return found.some(c => c.id === "binary") ? found.filter(c => c.id !== "hex") : found;
}
