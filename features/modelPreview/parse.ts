/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reading 3D files into one triangle list: positions, normals and colours
// (three floats per vertex each), ready for the viewer. GLB / glTF (with
// embedded data), OBJ and STL (binary or text).

export interface Mesh { positions: Float32Array; normals: Float32Array; colors: Float32Array; triangles: number; }

const DEFAULT: [number, number, number] = [0.72, 0.75, 0.82];
const MAX_TRIANGLES = 3_000_000;

/** Builds the final arrays; flat normals are worked out where the file had none. */
class Builder {
    pos: number[] = [];
    nrm: number[] = [];
    col: number[] = [];
    tri(a: number[], b: number[], c: number[], color = DEFAULT, na?: number[], nb?: number[], nc?: number[]) {
        if (this.pos.length / 9 >= MAX_TRIANGLES) throw new Error("This model is too detailed to preview.");
        if (!na || !nb || !nc) {
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const l = Math.hypot(nx, ny, nz) || 1;
            nx /= l; ny /= l; nz /= l;
            na = nb = nc = [nx, ny, nz];
        }
        this.pos.push(...a, ...b, ...c);
        this.nrm.push(...na, ...nb, ...nc);
        this.col.push(...color, ...color, ...color);
    }
    done(): Mesh {
        if (!this.pos.length) throw new Error("No shapes found in this file.");
        return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), colors: new Float32Array(this.col), triangles: this.pos.length / 9 };
    }
}

// ─── STL ───

function parseStl(buf: ArrayBuffer): Mesh {
    const b = new Builder();
    const view = new DataView(buf);
    const count = buf.byteLength >= 84 ? view.getUint32(80, true) : 0;
    const isBinary = buf.byteLength === 84 + count * 50;
    if (isBinary) {
        for (let i = 0; i < count; i++) {
            const o = 84 + i * 50;
            const v = (k: number) => [view.getFloat32(o + 12 + k * 12, true), view.getFloat32(o + 16 + k * 12, true), view.getFloat32(o + 20 + k * 12, true)];
            b.tri(v(0), v(1), v(2));
        }
        return b.done();
    }
    const text = new TextDecoder().decode(buf);
    const verts = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
    for (let i = 0; i + 2 < verts.length; i += 3) b.tri(verts[i], verts[i + 1], verts[i + 2]);
    return b.done();
}

// ─── OBJ ───

function parseObj(buf: ArrayBuffer): Mesh {
    const b = new Builder();
    const v: number[][] = [];
    const vn: number[][] = [];
    const text = new TextDecoder().decode(buf);
    for (const line of text.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === "v") v.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
        else if (parts[0] === "vn") vn.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
        else if (parts[0] === "f") {
            const idx = parts.slice(1).map(p => {
                const [vi, , ni] = p.split("/");
                const a = Number(vi), n = Number(ni);
                return { p: a < 0 ? v.length + a : a - 1, n: ni ? (n < 0 ? vn.length + n : n - 1) : -1 };
            });
            // Polygons become a fan of triangles.
            for (let i = 1; i + 1 < idx.length; i++) {
                const [x, y, z] = [idx[0], idx[i], idx[i + 1]];
                if (!v[x.p] || !v[y.p] || !v[z.p]) continue;
                const hasN = x.n >= 0 && y.n >= 0 && z.n >= 0 && vn[x.n] && vn[y.n] && vn[z.n];
                b.tri(v[x.p], v[y.p], v[z.p], DEFAULT, hasN ? vn[x.n] : undefined, hasN ? vn[y.n] : undefined, hasN ? vn[z.n] : undefined);
            }
        }
    }
    return b.done();
}

// ─── glTF / GLB ───

type M4 = number[];
const identity = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
}
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): M4 {
    const [x, y, z, w] = q;
    return [
        (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
        2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
        2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
        t[0], t[1], t[2], 1,
    ];
}
const apply = (m: M4, p: number[], w = 1) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w, m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w, m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w];
const norm3 = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function parseGltfJson(json: any, bin: ArrayBuffer | null): Mesh {
    if ((json.extensionsUsed ?? []).includes("KHR_draco_mesh_compression") || (json.extensionsUsed ?? []).includes("EXT_meshopt_compression"))
        throw new Error("This model is compressed in a way the preview can't read yet.");
    const buffers: ArrayBuffer[] = (json.buffers ?? []).map((b: any, i: number) => {
        if (b.uri?.startsWith("data:")) {
            const raw = atob(b.uri.split(",")[1]);
            return Uint8Array.from(raw, c => c.charCodeAt(0)).buffer;
        }
        if (i === 0 && bin) return bin;
        throw new Error("This model keeps its data in a separate file, so it can't be previewed on its own.");
    });

    const read = (ai: number): number[][] => {
        const a = json.accessors[ai];
        const bv = json.bufferViews[a.bufferView];
        const buf = buffers[bv.buffer];
        const size = SIZES[a.type];
        const comp = a.componentType;
        const bytes = comp === 5126 || comp === 5125 ? 4 : comp === 5123 || comp === 5122 ? 2 : 1;
        const stride = bv.byteStride || size * bytes;
        const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
        const dv = new DataView(buf);
        const out: number[][] = [];
        for (let i = 0; i < a.count; i++) {
            const row: number[] = [];
            for (let k = 0; k < size; k++) {
                const o = base + i * stride + k * bytes;
                let val = comp === 5126 ? dv.getFloat32(o, true) : comp === 5125 ? dv.getUint32(o, true) : comp === 5123 ? dv.getUint16(o, true) : comp === 5122 ? dv.getInt16(o, true) : comp === 5121 ? dv.getUint8(o) : dv.getInt8(o);
                if (a.normalized) val /= comp === 5121 ? 255 : comp === 5123 ? 65535 : comp === 5120 ? 127 : 32767;
                row.push(val);
            }
            out.push(row);
        }
        return out;
    };

    const b = new Builder();
    const drawMesh = (meshIndex: number, m: M4) => {
        for (const prim of json.meshes[meshIndex].primitives ?? []) {
            if ((prim.mode ?? 4) !== 4 || prim.attributes?.POSITION == null) continue;
            const pos = read(prim.attributes.POSITION).map(p => apply(m, p));
            const nrm = prim.attributes.NORMAL != null ? read(prim.attributes.NORMAL).map(n => norm3(apply(m, n, 0))) : null;
            const vcol = prim.attributes.COLOR_0 != null ? read(prim.attributes.COLOR_0) : null;
            const factor = json.materials?.[prim.material]?.pbrMetallicRoughness?.baseColorFactor ?? [DEFAULT[0], DEFAULT[1], DEFAULT[2], 1];
            const idx = prim.indices != null ? read(prim.indices).map(r => r[0]) : pos.map((_, i) => i);
            for (let i = 0; i + 2 < idx.length; i += 3) {
                const [x, y, z] = [idx[i], idx[i + 1], idx[i + 2]];
                const color = vcol ? [vcol[x][0] * factor[0], vcol[x][1] * factor[1], vcol[x][2] * factor[2]] : [factor[0], factor[1], factor[2]];
                b.tri(pos[x], pos[y], pos[z], color as [number, number, number], nrm?.[x], nrm?.[y], nrm?.[z]);
            }
        }
    };
    const visit = (ni: number, parent: M4) => {
        const n = json.nodes[ni];
        const local = n.matrix ? n.matrix : trs(n.translation, n.rotation, n.scale);
        const m = mul(parent, local);
        if (n.mesh != null) drawMesh(n.mesh, m);
        for (const c of n.children ?? []) visit(c, m);
    };
    const scene = json.scenes?.[json.scene ?? 0];
    if (scene) for (const ni of scene.nodes ?? []) visit(ni, identity());
    else (json.meshes ?? []).forEach((_: any, i: number) => drawMesh(i, identity()));
    return b.done();
}

function parseGlb(buf: ArrayBuffer): Mesh {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error("Not a GLB file.");
    let offset = 12, json: any = null, bin: ArrayBuffer | null = null;
    while (offset + 8 <= buf.byteLength) {
        const len = dv.getUint32(offset, true), type = dv.getUint32(offset + 4, true);
        const chunk = buf.slice(offset + 8, offset + 8 + len);
        if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk));
        else if (type === 0x004E4942) bin = chunk;
        offset += 8 + len;
    }
    if (!json) throw new Error("This GLB has no scene in it.");
    return parseGltfJson(json, bin);
}

export const MODEL_EXT = /\.(glb|gltf|obj|stl)$/i;

export function parseModel(name: string, buf: ArrayBuffer): Mesh {
    const ext = name.toLowerCase().match(MODEL_EXT)?.[1];
    if (ext === "stl") return parseStl(buf);
    if (ext === "obj") return parseObj(buf);
    if (ext === "glb") return parseGlb(buf);
    if (ext === "gltf") return parseGltfJson(JSON.parse(new TextDecoder().decode(buf)), null);
    throw new Error("Unsupported file type.");
}
