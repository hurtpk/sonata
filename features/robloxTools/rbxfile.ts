/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reading Roblox item files (.rbxm / .rbxmx): which meshes, textures,
// clothing templates, sounds and animations they point to.

export type FileKind = "rbxm" | "rbxmx" | "mesh" | "png" | "jpeg" | "gif" | "webp" | "ogg" | "mp3" | "ktx" | "unknown";

export interface AssetRef {
    /** The property it came from, like MeshId or TextureID. */
    prop: string;
    /** The kind of thing it belongs to, like MeshPart or SpecialMesh. */
    owner: string;
    id: string;
}

export interface FileInfo { kind: FileKind; refs: AssetRef[]; classes: string[]; compressed?: "zstd"; }

const text = (b: Uint8Array, from = 0, to = b.length) => new TextDecoder("latin1").decode(b.subarray(from, to));

export function sniff(b: Uint8Array): FileKind {
    const head = text(b, 0, Math.min(16, b.length));
    if (head.startsWith("<roblox!")) return "rbxm";
    if (head.startsWith("<roblox")) return "rbxmx";
    if (head.startsWith("version ")) return "mesh";
    if (b[0] === 0x89 && head.slice(1, 4) === "PNG") return "png";
    if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
    if (head.startsWith("GIF8")) return "gif";
    if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
    if (head.startsWith("OggS")) return "ogg";
    if (head.startsWith("ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
    if (head.slice(1, 4) === "KTX") return "ktx";
    return "unknown";
}

const ID_RE = /(?:rbxassetid:\/\/|[?&]id=|rbxthumb:\/\/type=Asset&id=)(\d{1,19})/gi;
const KEEP = /Id$|ID$|Template$|^Graphic$|^Texture$|^Image$|^SoundId$|^AnimationId$|^Shirt|^Pants/;
/** Roblox's own bookkeeping, not something you'd want. */
const SKIP = /^HSRAssetId$|^PhysicsData|^InitialSize/;

/** LZ4 block format (no frame), as Roblox uses it. */
function lz4(src: Uint8Array, outLen: number): Uint8Array {
    const dst = new Uint8Array(outLen);
    let s = 0, d = 0;
    while (s < src.length) {
        const tok = src[s++];
        let lit = tok >> 4;
        if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
        dst.set(src.subarray(s, s + lit), d);
        s += lit; d += lit;
        if (s >= src.length) break;
        const off = src[s] | (src[s + 1] << 8);
        s += 2;
        let ml = tok & 15;
        if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
        ml += 4;
        let p = d - off;
        for (let i = 0; i < ml; i++) dst[d++] = dst[p++];
    }
    return dst;
}

/** Every "length, then text" string in a property's values — read exactly, so neighbouring bytes never join an ID. */
function lengthPrefixed(d: Uint8Array, from: number): string[] {
    const out: string[] = [];
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    for (let i = from; i + 4 <= d.length;) {
        const n = v.getUint32(i, true);
        if (n >= 4 && n <= 2048 && i + 4 + n <= d.length) {
            const s = text(d, i + 4, i + 4 + n);
            if (/^[ -~]+$/.test(s) && (s.includes("://") || s.includes("id="))) { out.push(s); i += 4 + n; continue; }
        }
        i++;
    }
    return out;
}

function readBinary(b: Uint8Array): FileInfo {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const classes = new Map<number, string>();
    const refs: AssetRef[] = [];
    let compressed: "zstd" | undefined;
    let o = 32;
    while (o + 16 <= b.length) {
        const name = text(b, o, o + 4).replace(/\0/g, "");
        const clen = v.getUint32(o + 4, true), ulen = v.getUint32(o + 8, true);
        o += 16;
        const raw = b.subarray(o, o + (clen || ulen));
        o += clen || ulen;
        if (name === "END") break;
        let data: Uint8Array;
        if (!clen) data = raw;
        else if (raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd) { compressed = "zstd"; continue; }
        else data = lz4(raw, ulen);
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (name === "INST") {
            const id = dv.getUint32(0, true), len = dv.getUint32(4, true);
            classes.set(id, text(data, 8, 8 + len));
        } else if (name === "PROP") {
            const id = dv.getUint32(0, true), len = dv.getUint32(4, true);
            const prop = text(data, 8, 8 + len);
            if (!KEEP.test(prop) || SKIP.test(prop)) continue;
            for (const str of lengthPrefixed(data, 8 + len + 1))
                for (const m of str.matchAll(ID_RE)) refs.push({ prop, owner: classes.get(id) ?? "", id: m[1] });
        }
    }
    return { kind: "rbxm", refs: dedupe(refs), classes: [...new Set(classes.values())], compressed };
}

function readXml(b: Uint8Array): FileInfo {
    const s = new TextDecoder().decode(b);
    const refs: AssetRef[] = [];
    // Walk items so each reference knows what it belongs to.
    const stack: string[] = [];
    const re = /<Item class="([^"]+)"|<\/Item>|<(?:Content|string|url)\s+name="([^"]+)">\s*(?:<url>)?([^<]*)/g;
    for (const m of s.matchAll(re)) {
        if (m[1]) { stack.push(m[1]); continue; }
        if (m[0] === "</Item>") { stack.pop(); continue; }
        if (!m[2] || !KEEP.test(m[2]) || SKIP.test(m[2])) continue;
        for (const x of (m[3] ?? "").matchAll(ID_RE)) refs.push({ prop: m[2], owner: stack[stack.length - 1] ?? "", id: x[1] });
    }
    const classes = [...new Set([...s.matchAll(/<Item class="([^"]+)"/g)].map(m => m[1]))];
    return { kind: "rbxmx", refs: dedupe(refs), classes };
}

function dedupe(refs: AssetRef[]) {
    const seen = new Set<string>();
    return refs.filter(r => { const k = `${r.prop}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function readFile(b: Uint8Array): FileInfo {
    const kind = sniff(b);
    if (kind === "rbxm") return readBinary(b);
    if (kind === "rbxmx") return readXml(b);
    return { kind, refs: [], classes: [] };
}

/** What a property holds, in plain words. */
export function refLabel(r: AssetRef): { what: "mesh" | "texture" | "template" | "sound" | "animation" | "image" | "other"; label: string; } {
    const p = r.prop.toLowerCase();
    if (p === "meshid") return { what: "mesh", label: "3D mesh" };
    if (p === "cagemeshid") return { what: "mesh", label: "Cage mesh (for layered clothing)" };
    if (p.startsWith("shirt")) return { what: "template", label: "Shirt template" };
    if (p.startsWith("pants")) return { what: "template", label: "Pants template" };
    if (p === "graphic") return { what: "template", label: "T-shirt image" };
    if (p.includes("texture") || p === "colormap") return { what: "texture", label: "Texture" };
    if (p.includes("normalmap")) return { what: "texture", label: "Normal map" };
    if (p.includes("metalness")) return { what: "texture", label: "Metalness map" };
    if (p.includes("roughness")) return { what: "texture", label: "Roughness map" };
    if (p === "soundid") return { what: "sound", label: "Sound" };
    if (p === "animationid") return { what: "animation", label: "Animation" };
    if (p === "image" || p === "texture") return { what: "image", label: "Image" };
    return { what: "other", label: r.prop };
}
