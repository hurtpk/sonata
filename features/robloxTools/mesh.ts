/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Roblox's .mesh files (versions 1 to 7) turned into .obj, and into a
// coloured preview for the 3D viewer (the texture painted onto the model).

export interface RobloxMesh {
    version: string;
    /** x, y, z per vertex. */
    positions: Float32Array;
    normals: Float32Array;
    /** u, v per vertex. */
    uvs: Float32Array;
    /** Three vertex numbers per triangle (the most detailed level only). */
    faces: Uint32Array;
}

export class MeshError extends Error { }

const dec = new TextDecoder("latin1");

function parseV1(b: Uint8Array, version: string): RobloxMesh {
    const s = dec.decode(b);
    const lines = s.split(/\r?\n/);
    const count = parseInt(lines[1], 10);
    const nums = [...(lines.slice(2).join("")).matchAll(/\[([^\]]*)\]/g)].map(m => m[1].split(",").map(Number));
    const verts = count * 3;
    if (!Number.isFinite(count) || nums.length < verts * 3) throw new MeshError("This mesh file looks damaged.");
    const scale = version === "1.00" ? 0.5 : 1;
    const positions = new Float32Array(verts * 3), normals = new Float32Array(verts * 3), uvs = new Float32Array(verts * 2), faces = new Uint32Array(verts);
    for (let i = 0; i < verts; i++) {
        const [p, n, t] = [nums[i * 3], nums[i * 3 + 1], nums[i * 3 + 2]];
        positions.set([p[0] * scale, p[1] * scale, p[2] * scale], i * 3);
        normals.set([n[0], n[1], n[2]], i * 3);
        uvs.set([t[0], 1 - t[1]], i * 2); // v1 stores v upside down compared to the others
        faces[i] = i;
    }
    return { version, positions, normals, uvs, faces };
}

/** Vertices are 36 or 40 bytes: position, normal, uv (+ w or tangent + colour). */
function readVerts(v: DataView, at: number, n: number, size: number) {
    const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
        const o = at + i * size;
        for (let k = 0; k < 3; k++) { positions[i * 3 + k] = v.getFloat32(o + k * 4, true); normals[i * 3 + k] = v.getFloat32(o + 12 + k * 4, true); }
        uvs[i * 2] = v.getFloat32(o + 24, true);
        uvs[i * 2 + 1] = v.getFloat32(o + 28, true);
    }
    return { positions, normals, uvs };
}

function readFaces(v: DataView, at: number, from: number, to: number) {
    const f = new Uint32Array((to - from) * 3);
    for (let i = from; i < to; i++) for (let k = 0; k < 3; k++) f[(i - from) * 3 + k] = v.getUint32(at + i * 12 + k * 4, true);
    return f;
}

function parseBinary(b: Uint8Array, version: string, start: number): RobloxMesh {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const major = version[0];
    const hsize = v.getUint16(start, true);
    let numVerts: number, numFaces: number, vsize: number, numLods = 0, envSize = 0;
    if (major === "2") {
        vsize = v.getUint8(start + 2);
        numVerts = v.getUint32(start + 4, true); numFaces = v.getUint32(start + 8, true);
    } else if (major === "3") {
        vsize = v.getUint8(start + 2);
        numLods = v.getUint16(start + 6, true);
        numVerts = v.getUint32(start + 8, true); numFaces = v.getUint32(start + 12, true);
    } else {
        // 4 and 5: lodType u16, verts u32, faces u32, lods u16, bones u16, boneNames u32, subsets u16, hq u8, pad u8 (5 adds facs info)
        vsize = 40;
        numVerts = v.getUint32(start + 4, true); numFaces = v.getUint32(start + 8, true);
        numLods = v.getUint16(start + 12, true);
        const bones = v.getUint16(start + 14, true);
        if (bones > 0) envSize = numVerts * 8;
    }
    const vertsAt = start + hsize;
    const facesAt = vertsAt + numVerts * vsize + envSize;
    const lodAt = facesAt + numFaces * 12;
    if (facesAt + numFaces * 12 > b.length) throw new MeshError("This mesh file looks damaged.");
    let lastFace = numFaces;
    if (numLods >= 2) lastFace = Math.min(numFaces, v.getUint32(lodAt + 4, true)) || numFaces;
    const verts = readVerts(v, vertsAt, numVerts, vsize);
    return { version, ...verts, faces: readFaces(v, facesAt, 0, lastFace) };
}

/** 6.00 and 7.00: named chunks. Only the uncompressed kind can be read here. */
function parseChunked(b: Uint8Array, version: string, start: number): RobloxMesh {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let o = start;
    let core: RobloxMesh | null = null;
    let lods: number[] = [];
    while (o + 16 <= b.length) {
        const type = dec.decode(b.subarray(o, o + 8)).replace(/\0/g, "");
        const ver = v.getUint32(o + 8, true), size = v.getUint32(o + 12, true);
        const at = o + 16;
        if (type === "COREMESH") {
            if (ver !== 1) throw new MeshError("This mesh is stored in Roblox's compressed format, which can't be turned into an .obj here — the original .mesh file can still be saved.");
            const nv = v.getUint32(at, true);
            const verts = readVerts(v, at + 4, nv, 40);
            const fAt = at + 4 + nv * 40;
            const nf = v.getUint32(fAt, true);
            core = { version, ...verts, faces: readFaces(v, fAt + 4, 0, nf) };
        } else if (type === "LODS" && ver === 1) {
            const n = v.getUint32(at + 3, true);
            lods = Array.from({ length: n }, (_, i) => v.getUint32(at + 7 + i * 4, true));
        }
        o = at + size;
    }
    if (!core) throw new MeshError("Couldn't find the shape in this mesh file.");
    if (lods.length >= 2 && lods[1] * 3 <= core.faces.length) core.faces = core.faces.slice(0, lods[1] * 3);
    return core;
}

export function parseMesh(bytes: Uint8Array): RobloxMesh {
    const head = dec.decode(bytes.subarray(0, 13));
    const m = head.match(/^version (\d\.\d\d)/);
    if (!m) throw new MeshError("This isn't a Roblox mesh file.");
    const version = m[1];
    const start = bytes.indexOf(0x0a) + 1;
    if (version.startsWith("1.")) return parseV1(bytes, version);
    if (/^[2-5]\./.test(version)) return parseBinary(bytes, version, start);
    if (/^[67]\./.test(version)) return parseChunked(bytes, version, start);
    throw new MeshError(`Mesh version ${version} isn't supported yet.`);
}

/** An .obj file (and its .mtl, if there's a texture). `file` is the file name without its ending; the .mtl is saved as `file`.mtl. */
export function toObj(mesh: RobloxMesh, file: string, texture?: string): { obj: string; mtl?: string; } {
    const out: string[] = [`# ${file} — Roblox mesh ${mesh.version}, saved by Sonata Roblox Tools`];
    const safe = file.replace(/[^\w-]+/g, "_") || "mesh";
    if (texture) out.push(`mtllib ${file}.mtl`);
    out.push(`o ${safe}`);
    const n = mesh.positions.length / 3;
    const f = (x: number) => Number.isFinite(x) ? +x.toFixed(6) : 0;
    for (let i = 0; i < n; i++) out.push(`v ${f(mesh.positions[i * 3])} ${f(mesh.positions[i * 3 + 1])} ${f(mesh.positions[i * 3 + 2])}`);
    for (let i = 0; i < n; i++) out.push(`vt ${f(mesh.uvs[i * 2])} ${f(1 - mesh.uvs[i * 2 + 1])}`);
    for (let i = 0; i < n; i++) out.push(`vn ${f(mesh.normals[i * 3])} ${f(mesh.normals[i * 3 + 1])} ${f(mesh.normals[i * 3 + 2])}`);
    if (texture) out.push(`usemtl ${safe}`);
    for (let i = 0; i < mesh.faces.length; i += 3) {
        const a = mesh.faces[i] + 1, b = mesh.faces[i + 1] + 1, c = mesh.faces[i + 2] + 1;
        out.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
    }
    const mtl = texture ? `newmtl ${safe}\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\nd 1\nillum 1\nmap_Kd ${texture}\n` : undefined;
    return { obj: out.join("\n") + "\n", mtl };
}

/** What the 3D viewer needs: loose triangles, with the texture's colour at each corner. */
export function toPreview(mesh: RobloxMesh, tex?: ImageData) {
    const tris = mesh.faces.length / 3;
    const positions = new Float32Array(tris * 9), normals = new Float32Array(tris * 9), colors = new Float32Array(tris * 9);
    for (let i = 0; i < mesh.faces.length; i++) {
        const vi = mesh.faces[i];
        for (let k = 0; k < 3; k++) { positions[i * 3 + k] = mesh.positions[vi * 3 + k]; normals[i * 3 + k] = mesh.normals[vi * 3 + k]; }
        let r = 0.78, g = 0.8, b = 0.84;
        if (tex) {
            const u = mesh.uvs[vi * 2] - Math.floor(mesh.uvs[vi * 2]), v = mesh.uvs[vi * 2 + 1] - Math.floor(mesh.uvs[vi * 2 + 1]);
            const x = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width))), y = Math.min(tex.height - 1, Math.max(0, Math.floor(v * tex.height)));
            const p = (y * tex.width + x) * 4;
            const a = tex.data[p + 3] / 255;
            r = (tex.data[p] / 255) * a + 0.78 * (1 - a); g = (tex.data[p + 1] / 255) * a + 0.8 * (1 - a); b = (tex.data[p + 2] / 255) * a + 0.84 * (1 - a);
        }
        colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    }
    return { positions, normals, colors, triangles: tris };
}
