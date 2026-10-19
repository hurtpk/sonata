/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Assets: paste a catalog or Creator Store link and get the item's files —
// its 3D mesh (as .obj, with the texture), textures, clothing templates,
// decal images, sounds and animations — with a 3D preview, a sound player
// and a texture recolourer.

import "../modelPreview/styles.css";

import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import { showToast, useEffect, useRef, useState } from "@webpack/common";
import { zipSync } from "fflate";

import { mountViewer, Viewer } from "../modelPreview/viewer";
import { ApiKeyBox } from "./ApiKey";
import { rb } from "./Card";
import { fetchAssetFile, fetchAssetInfo, RbxAssetInfo, sources } from "./data";
import { ItemCompare } from "./ItemCompare";
import { MeshError, parseMesh, RobloxMesh, toObj, toPreview } from "./mesh";
import { Painter } from "./Painter";
import { AssetRef, FileKind, readFile, refLabel, sniff } from "./rbxfile";
import { decode, encodePng, isUnchanged, NO_CHANGE, Recolor, recolor } from "./recolor";

export const TYPES: Record<number, string> = {
    1: "Image", 2: "T-shirt", 3: "Audio", 4: "Mesh", 8: "Hat", 9: "Place", 10: "Model", 11: "Shirt", 12: "Pants", 13: "Decal", 17: "Head", 18: "Face",
    19: "Gear", 24: "Animation", 27: "Torso", 28: "Right arm", 29: "Left arm", 30: "Left leg", 31: "Right leg", 38: "Plugin", 40: "Mesh part", 41: "Hair",
    42: "Face accessory", 43: "Neck accessory", 44: "Shoulder accessory", 45: "Front accessory", 46: "Back accessory", 47: "Waist accessory",
    48: "Climb animation", 49: "Death animation", 50: "Fall animation", 51: "Idle animation", 52: "Jump animation", 53: "Run animation", 54: "Swim animation", 55: "Walk animation",
    56: "Pose animation", 61: "Emote", 62: "Video", 64: "T-shirt (3D)", 65: "Shirt (3D)", 66: "Pants (3D)", 67: "Jacket", 68: "Sweater", 69: "Shorts",
    70: "Left shoe", 71: "Right shoe", 72: "Dress / skirt", 73: "Font family", 76: "Eyebrows", 77: "Eyelashes", 78: "Mood animation", 79: "Dynamic head",
};
const EXT: Partial<Record<FileKind, string>> = { rbxm: "rbxm", rbxmx: "rbxmx", mesh: "mesh", png: "png", jpeg: "jpg", gif: "gif", webp: "webp", ogg: "ogg", mp3: "mp3", ktx: "ktx" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", ogg: "audio/ogg", mp3: "audio/mpeg", obj: "text/plain", mtl: "text/plain" };
const isImage = (k?: FileKind) => !!k && /^(png|jpeg|gif|webp)$/.test(k);
const isSound = (k?: FileKind) => k === "ogg" || k === "mp3";

/** A catalog, library, marketplace or Creator Store link, or just the number. */
export function parseAssetInput(text: string): { id: string; bundle?: boolean; } | null {
    const t = text.trim();
    const m = t.match(/(?:catalog|library|marketplace\/asset|store\/asset|asset\/?\?id=|assetId=)\/?(\d{3,19})/i) ?? t.match(/^(\d{3,19})$/);
    if (m) return { id: m[1] };
    const b = t.match(/bundles\/(\d+)/i);
    return b ? { id: b[1], bundle: true } : null;
}

export interface Part {
    ref: AssetRef;
    label: string;
    what: ReturnType<typeof refLabel>["what"];
    bytes?: Uint8Array;
    /** Before recolouring. */
    original?: Uint8Array;
    kind?: FileKind;
    /** Roblox's picture instead of the file (when Roblox wouldn't hand the file out). */
    preview?: boolean;
    url?: string;
    mesh?: RobloxMesh;
    error?: string;
}
export interface Main { bytes?: Uint8Array; kind?: FileKind; error?: string; }

const size = (n: number) => n < 1024 ? `${n} bytes` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
/** A part's file name (no ending): no spaces, so an .obj finds its .mtl and the .mtl its texture. */
const partFile = (base: string, p: Part) => `${base}_${p.label}_${p.ref.id}`.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
export const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "item";
const blobUrl = (b: Uint8Array, type: string) => URL.createObjectURL(new Blob([b as BlobPart], { type }));

export function download(name: string, data: Uint8Array | string, type = "application/octet-stream") {
    saveFile(new File([data as BlobPart], name, { type }));
}

async function imageData(bytes: Uint8Array): Promise<ImageData | undefined> {
    try {
        const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
        const c = document.createElement("canvas");
        c.width = Math.min(1024, bmp.width); c.height = Math.min(1024, bmp.height);
        const x = c.getContext("2d")!;
        x.drawImage(bmp, 0, 0, c.width, c.height);
        return x.getImageData(0, 0, c.width, c.height);
    } catch { return undefined; }
}

function withUrl(p: Part): Part {
    if (p.bytes && isImage(p.kind)) p.url = blobUrl(p.bytes, MIME[EXT[p.kind!]!] ?? "image/png");
    if (p.bytes && isSound(p.kind)) p.url = blobUrl(p.bytes, MIME[EXT[p.kind!]!]);
    return p;
}

/** Fetches the files an item points to, each once. */
async function loadParts(refs: AssetRef[], status: (s: string) => void, depth = 0): Promise<Part[]> {
    const out: Part[] = [];
    const list = refs.slice(0, 14);
    for (let i = 0; i < list.length; i++) {
        const ref = list[i];
        const { what, label } = refLabel(ref);
        status(`Getting the ${label.toLowerCase()} (${i + 1} of ${list.length})…`);
        const p: Part = { ref, label, what };
        let r = await fetchAssetFile(ref.id);
        if (!r.ok && (what === "texture" || what === "template" || what === "image")) {
            const pv = await fetchAssetFile(ref.id, true);
            if (pv.ok) { r = pv; p.preview = true; }
        }
        if (!r.ok) { p.error = r.error; out.push(p); continue; }
        p.bytes = r.bytes;
        p.kind = sniff(r.bytes);
        if (p.kind === "mesh") {
            try { p.mesh = parseMesh(r.bytes); } catch (e) { p.error = e instanceof MeshError ? e.message : "Couldn't read this mesh."; }
        }
        // A decal or clothing item's file points at its image — follow it once.
        if ((p.kind === "rbxm" || p.kind === "rbxmx") && what !== "animation" && depth < 1) {
            const inner = readFile(r.bytes).refs.filter(x => refLabel(x).what !== "other");
            if (inner.length && out.length + inner.length < 20) out.push(...await loadParts(inner, status, depth + 1));
        }
        out.push(withUrl(p));
    }
    return out;
}

/** Everything about one item: its own file and what it points to. */
export async function collectItem(id: string, status: (s: string) => void): Promise<{ main: Main; parts: Part[]; }> {
    const f = await fetchAssetFile(id);
    if (!f.ok) {
        // Some images and decals only come as Roblox's picture.
        const pv = await fetchAssetFile(id, true);
        return { main: { error: f.error }, parts: pv.ok ? [withUrl({ ref: { prop: "Image", owner: "", id }, label: "Picture", what: "image", bytes: pv.bytes, kind: sniff(pv.bytes), preview: true })] : [] };
    }
    const kind = sniff(f.bytes);
    const main: Main = { bytes: f.bytes, kind };
    if (kind === "rbxm" || kind === "rbxmx") return { main, parts: await loadParts(readFile(f.bytes).refs, status) };
    if (kind === "mesh") {
        const p: Part = { ref: { prop: "MeshId", owner: "", id }, label: "3D mesh", what: "mesh", bytes: f.bytes, kind };
        try { p.mesh = parseMesh(f.bytes); } catch (e) { p.error = (e as Error).message; }
        return { main, parts: [p] };
    }
    if (isImage(kind)) return { main, parts: [withUrl({ ref: { prop: "Image", owner: "", id }, label: "Image", what: "image", bytes: f.bytes, kind })] };
    if (isSound(kind)) return { main, parts: [withUrl({ ref: { prop: "SoundId", owner: "", id }, label: "Sound", what: "sound", bytes: f.bytes, kind })] };
    return { main, parts: [] };
}

const mainTexture = (parts: Part[]) => parts.find(p => p.what === "texture" && p.bytes && !p.label.includes("map"));

/** The files for a zip: the item, every part, and .obj + .mtl for each mesh — inside `folder` if given. */
export function zipEntries(base: string, main: Main | null, parts: Part[], folder = ""): Record<string, Uint8Array> {
    const files: Record<string, Uint8Array> = {};
    const enc = new TextEncoder();
    const at = folder ? `${folder}/` : "";
    const tex = mainTexture(parts);
    const texName = tex?.kind ? `${partFile(base, tex)}.${EXT[tex.kind] ?? "png"}` : undefined;
    if (main?.bytes && main.kind) files[`${at}${base} (original).${EXT[main.kind] ?? "bin"}`] = main.bytes;
    for (const p of parts) {
        if (!p.bytes) continue;
        const name = partFile(base, p);
        files[`${at}${name}.${p.kind ? EXT[p.kind] ?? "bin" : "bin"}`] = p.bytes;
        if (p.mesh) { const o = toObj(p.mesh, name, texName); files[`${at}${name}.obj`] = enc.encode(o.obj); if (o.mtl) files[`${at}${name}.mtl`] = enc.encode(o.mtl); }
    }
    return files;
}

/** A number for each texture's bytes, so a recoloured texture gets a fresh 3D view. */
const byteIds = new WeakMap<Uint8Array, number>();
let nextByteId = 1;
const idOf = (b?: Uint8Array) => { if (!b) return 0; if (!byteIds.has(b)) byteIds.set(b, nextByteId++); return byteIds.get(b)!; };

export function Preview({ parts }: { parts: Part[]; }) {
    const meshes = parts.filter(p => p.mesh && p.what === "mesh" && !p.label.startsWith("Cage"));
    const [which, setWhich] = useState(0);
    const [spin, setSpin] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const viewer = useRef<Viewer | null>(null);
    const chosen = meshes[Math.min(which, meshes.length - 1)];
    const tex = chosen ? parts.find(p => p.what === "texture" && p.bytes && p.ref.owner === chosen.ref.owner && !p.label.includes("map")) ?? mainTexture(parts) : undefined;
    useEffect(() => {
        if (!chosen?.mesh || !canvas.current) return;
        let alive = true;
        (async () => {
            const data = tex?.bytes ? await imageData(tex.bytes) : undefined;
            if (!alive || !canvas.current) return;
            try { viewer.current?.destroy(); viewer.current = mountViewer(canvas.current, toPreview(chosen.mesh!, data)); viewer.current.setSpin(spin); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't show it in 3D."); }
        })();
        return () => { alive = false; viewer.current?.destroy(); viewer.current = null; };
    }, [chosen, tex?.bytes]);
    useEffect(() => { viewer.current?.setSpin(spin); }, [spin]);
    if (!chosen) return null;
    return (
        <div className={rb("asset-3d")}>
            <canvas key={`${chosen.ref.id}-${idOf(tex?.bytes)}`} ref={canvas} className="vc-m3d-canvas" />
            {err && <span className="vc-tool-error">{err}</span>}
            <div className={rb("asset-3d-bar")}>
                {meshes.length > 1 && meshes.map((m, i) => <button key={m.ref.id} type="button" className={classes("vc-tool-chip", i === which && "vc-tool-chip-on")} onClick={() => setWhich(i)}>Part {i + 1}</button>)}
                <span className={rb("spacer")} />
                <button type="button" className="vc-tool-btn" onClick={() => setSpin(s => !s)}>{spin ? "⏸ Stop turning" : "▶ Turn"}</button>
                <button type="button" className="vc-tool-btn" onClick={() => viewer.current?.reset()}>↺ Reset</button>
            </div>
            <span className="vc-tool-hint">Drag to turn it, scroll to zoom. The colours come from its texture{tex?.original ? " (edited)" : ""}.</span>
        </div>
    );
}

/* ── Recolouring a texture ── */

function Slider({ label, value, min, max, onChange, unit = "" }: { label: string; value: number; min: number; max: number; onChange(v: number): void; unit?: string; }) {
    return (
        <label className={rb("rc-slider")}>
            <span>{label}<b>{value > 0 && min < 0 ? "+" : ""}{value}{unit}</b></span>
            <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.currentTarget.value))} />
        </label>
    );
}

function RecolorPanel({ p, name, onUse }: { p: Part; name: string; onUse(bytes: Uint8Array | null): void; }) {
    const [o, setO] = useState<Recolor>(NO_CHANGE);
    const [src, setSrc] = useState<ImageData | null>(null);
    const [busy, setBusy] = useState(false);
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => { void decode(p.bytes!).then(setSrc).catch(() => setSrc(null)); }, [p.bytes]);
    useEffect(() => {
        if (!src || !canvas.current) return;
        const id = requestAnimationFrame(() => {
            const c = canvas.current!;
            c.width = src.width; c.height = src.height;
            c.getContext("2d")!.putImageData(isUnchanged(o) ? src : recolor(src, o), 0, 0);
        });
        return () => cancelAnimationFrame(id);
    }, [src, o]);
    const set = (k: keyof Recolor) => (v: any) => setO(x => ({ ...x, [k]: v }));
    const out = async () => encodePng(recolor(src!, o));
    if (!src) return <div className={rb("loading")}><span className={rb("spin")} /> Opening the picture…</div>;
    return (
        <div className={rb("rc")}>
            <canvas ref={canvas} className={rb("rc-canvas")} />
            <div className={rb("rc-controls")}>
                <Slider label="Hue" value={o.hue} min={-180} max={180} unit="°" onChange={set("hue")} />
                <Slider label="Saturation" value={o.saturation} min={0} max={200} unit="%" onChange={set("saturation")} />
                <Slider label="Brightness" value={o.brightness} min={-100} max={100} onChange={set("brightness")} />
                <Slider label="Contrast" value={o.contrast} min={-100} max={100} onChange={set("contrast")} />
                <div className={rb("rc-tint")}>
                    <label className={rb("rc-color")}><input type="color" value={o.tint} onChange={e => set("tint")(e.currentTarget.value)} /> Tint</label>
                    <Slider label="Strength" value={o.tintAmount} min={0} max={100} unit="%" onChange={set("tintAmount")} />
                </div>
                <label className={rb("rate-check")}><input type="checkbox" checked={o.invert} onChange={e => set("invert")(e.currentTarget.checked)} /> Invert colours</label>
                <div className={rb("rate-edit-row")}>
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || isUnchanged(o)} onClick={async () => { setBusy(true); try { onUse(await out()); showToast("Recoloured — the 3D preview and downloads use it now", "success"); } finally { setBusy(false); } }}>Use this</button>
                    <button type="button" className="vc-tool-btn" disabled={busy || isUnchanged(o)} onClick={async () => { setBusy(true); try { download(`${name}_recoloured.png`, await out(), "image/png"); } finally { setBusy(false); } }}>Save .png</button>
                    <button type="button" className="vc-tool-btn" onClick={() => { setO(NO_CHANGE); if (p.original) onUse(null); }}>Reset</button>
                </div>
            </div>
        </div>
    );
}

type EditMode = "paint" | "colours";

function PartRow({ p, base, texName, mesh, onReplace }: { p: Part; base: string; texName?: string; mesh?: RobloxMesh; onReplace(bytes: Uint8Array | null): void; }) {
    const [editOpen, setEditOpen] = useState(false);
    const [mode, setMode] = useState<EditMode>("paint");
    const ext = p.kind ? EXT[p.kind] ?? "bin" : "bin";
    const name = partFile(base, p);
    return (
        <div className={rb("asset-file-wrap")}>
            <div className={rb("asset-file")}>
                {p.url && isImage(p.kind) ? <img src={p.url} alt="" /> : <span className={rb("asset-icon")}>{p.what === "mesh" ? "🧊" : p.what === "sound" || isSound(p.kind) ? "🔊" : p.what === "animation" ? "🏃" : "📄"}</span>}
                <div className={rb("asset-file-main")}>
                    <b>{p.label}{p.original && <span className={rb("badge-mini")}>edited</span>}</b>
                    <span>
                        {p.error ? `⚠️ ${p.error}` : p.mesh ? `${(p.mesh.faces.length / 3).toLocaleString()} triangles · mesh version ${p.mesh.version}` : p.bytes ? `${ext.toUpperCase()} · ${size(p.bytes.length)}` : ""}
                        {p.preview && " · Roblox's 420 × 420 picture (the full-size file needs a signed-in account)"}
                    </span>
                    <button type="button" className={rb("link")} onClick={() => copyWithToast(p.ref.id, "ID copied")}>ID {p.ref.id}</button>
                </div>
                <div className={rb("asset-btns")}>
                    {isImage(p.kind) && p.bytes && <button type="button" className={classes("vc-tool-btn", editOpen && "vc-tool-primary")} title="Paint on it or change its colours" onClick={() => setEditOpen(o => !o)}>🎨 Edit</button>}
                    {p.mesh && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => { const o = toObj(p.mesh!, name, texName); download(`${name}.obj`, o.obj, MIME.obj); if (o.mtl) download(`${name}.mtl`, o.mtl, MIME.mtl); }}>Save .obj</button>}
                    {p.bytes && <button type="button" className={classes("vc-tool-btn", !p.mesh && !isImage(p.kind) && "vc-tool-primary")} onClick={() => download(`${name}.${ext}`, p.bytes!, MIME[ext])}>Save .{ext}</button>}
                </div>
            </div>
            {isSound(p.kind) && p.url && <audio className={rb("audio")} controls preload="metadata" src={p.url} />}
            {editOpen && p.bytes && (
                <div className={rb("edit")}>
                    <div className={rb("edit-head")}>
                        <div className="vc-tool-seg">
                            <button type="button" className={classes("vc-tool-seg-btn", mode === "paint" && "vc-tool-seg-on")} onClick={() => setMode("paint")}>🖌 Paint</button>
                            <button type="button" className={classes("vc-tool-seg-btn", mode === "colours" && "vc-tool-seg-on")} onClick={() => setMode("colours")}>🎨 Colours</button>
                        </div>
                        <span className={rb("spacer")} />
                        {p.original && <button type="button" className="vc-tool-btn" title="Undo every edit" onClick={() => onReplace(null)}>↺ Back to the original</button>}
                    </div>
                    {mode === "paint"
                        ? <Painter bytes={p.bytes} mesh={mesh} name={name} onUse={b => onReplace(b)} onSave={b => download(`${name}_edited.png`, b, "image/png")} />
                        : <RecolorPanel p={p} name={name} onUse={onReplace} />}
                </div>
            )}
        </div>
    );
}

export function Assets({ initial }: { initial?: string; }) {
    const [view, setView] = useState<"one" | "two">("one");
    return (
        <>
            <div className="vc-tool-seg">
                <button type="button" className={classes("vc-tool-seg-btn", view === "one" && "vc-tool-seg-on")} onClick={() => setView("one")}>📦 One item</button>
                <button type="button" className={classes("vc-tool-seg-btn", view === "two" && "vc-tool-seg-on")} onClick={() => setView("two")}>⚖️ Compare two items</button>
            </div>
            {view === "one" ? <OneItem initial={initial} /> : <ItemCompare initial={initial} />}
        </>
    );
}

function OneItem({ initial }: { initial?: string; }) {
    const [text, setText] = useState(initial ?? "");
    const [retry, setRetry] = useState(0);
    const [id, setId] = useState<string | null>(() => initial ? parseAssetInput(initial)?.id ?? null : null);
    const [info, setInfo] = useState<RbxAssetInfo | null>(null);
    const [main, setMain] = useState<Main | null>(null);
    const [parts, setParts] = useState<Part[]>([]);
    const [status, setStatus] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    const go = () => {
        const r = parseAssetInput(text);
        if (!r) { setErr("Paste a catalog or Creator Store link (roblox.com/catalog/…, create.roblox.com/store/asset/…) or an item ID."); return; }
        if (r.bundle) { setErr("That's a bundle — a set of items. Open the bundle on Roblox and paste one of its parts here."); return; }
        setErr(null); setId(r.id);
    };

    useEffect(() => {
        if (!id) return;
        let alive = true;
        setInfo(null); setMain(null); setParts([]); setStatus("Looking it up…");
        (async () => {
            const [i, got] = await Promise.all([fetchAssetInfo(id), collectItem(id, s => alive && setStatus(s))]);
            if (!alive) return;
            if (i.ok) setInfo(i.info); else setErr(i.error);
            setMain(got.main); setParts(got.parts); setStatus(null);
        })();
        return () => { alive = false; };
    }, [id, retry]);

    const base = safe(info?.name ?? `Item ${id}`);
    const blocked = !!main?.error?.includes("signed-in") || parts.some(p => p.preview || p.error?.includes("signed-in"));
    const tex = mainTexture(parts);
    const texName = tex?.kind ? `${partFile(base, tex)}.${EXT[tex.kind] ?? "png"}` : undefined;
    const replace = (i: number) => (bytes: Uint8Array | null) => setParts(ps => ps.map((p, j) => {
        if (j !== i || !p.bytes) return p;
        const original = p.original ?? p.bytes;
        if (!bytes && !p.original) return p;
        return bytes ? withUrl({ ...p, bytes, original, kind: "png" }) : withUrl({ ...p, bytes: original, original: undefined, kind: sniff(original) });
    }));

    const zipAll = () => {
        const files = zipEntries(base, main, parts);
        if (!Object.keys(files).length) { showToast("Nothing to save", "failure"); return; }
        download(`${base}.zip`, zipSync(files, { level: 6 }), "application/zip");
    };

    return (
        <>
            <div className={rb("bar")}>
                <input className="vc-tool-input" value={text} placeholder="A catalog or Creator Store link, or an item ID — e.g. roblox.com/catalog/1125510"
                    onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") go(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={go}>Get files</button>
            </div>
            {err && <span className="vc-tool-error">{err}</span>}
            {!id ? (
                <div className="vc-tool-empty">
                    <span className="vc-tool-empty-icon">📦</span>
                    Get an item's files — its 3D model, textures, clothing template, decal image or sound.
                    <span className="vc-tool-hint">Works for most avatar items, clothing, decals, sounds and Creator Store models. Meshes become .obj files you can open in Blender; textures can be recoloured. Some newer items Roblox only hands out to signed-in accounts. A whole avatar can be saved from a profile's Outfit tab.</span>
                </div>
            ) : (
                <div className={rb("asset")}>
                    {info && (
                        <div className={rb("head")}>
                            {info.image ? <img className={rb("icon")} src={info.image} alt="" /> : <span className={classes(rb("icon"), rb("img-none"))}>📦</span>}
                            <div className={rb("who")}>
                                <b>{info.name}</b>
                                <span>{TYPES[info.typeId] ?? `Type ${info.typeId}`} · by {info.creator}{info.price != null && info.forSale ? ` · R$ ${info.price.toLocaleString()}` : ""}</span>
                            </div>
                            {(parts.some(p => p.bytes) || main?.bytes) && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={zipAll}>⬇ Save everything (.zip)</button>}
                        </div>
                    )}
                    {status && <div className={rb("loading")}><span className={rb("spin")} /> {status}</div>}
                    {!status && (blocked || sources.apiKey) && <ApiKeyBox key={String(blocked)} blocked={blocked} onSaved={() => setRetry(n => n + 1)} />}
                    {main?.error && <span className={rb("muted")}>⚠️ The item's own file: {main.error}.{parts.length ? " Here's Roblox's picture of it instead." : ""}</span>}
                    {!status && parts.length > 0 && <Preview parts={parts} />}
                    {main?.bytes && main.kind && !isSound(main.kind) && !isImage(main.kind) && main.kind !== "mesh" && (
                        <div className={rb("asset-file")}>
                            <span className={rb("asset-icon")}>🗂️</span>
                            <div className={rb("asset-file-main")}>
                                <b>The item itself</b>
                                <span>{main.kind === "rbxm" || main.kind === "rbxmx" ? "Roblox model file — drag it into Roblox Studio" : main.kind.toUpperCase()} · {size(main.bytes.length)}</span>
                            </div>
                            <div className={rb("asset-btns")}><button type="button" className="vc-tool-btn" onClick={() => download(`${base}.${EXT[main.kind!] ?? "bin"}`, main.bytes!)}>Save .{EXT[main.kind] ?? "bin"}</button></div>
                        </div>
                    )}
                    {parts.map((p, i) => <PartRow key={`${p.ref.id}-${i}`} p={p} base={base} texName={p.mesh ? texName : undefined}
                        mesh={isImage(p.kind) ? (parts.find(m => m.mesh && m.ref.owner === p.ref.owner && !m.label.startsWith("Cage")) ?? parts.find(m => m.mesh && !m.label.startsWith("Cage")))?.mesh : undefined}
                        onReplace={replace(i)} />)}
                    {!status && main?.bytes && !parts.length && <span className={rb("muted")}>This item doesn't point to any meshes or images — the file above is all there is.</span>}
                    <span className="vc-tool-hint">For your own use — re-uploading someone else's item to the catalog breaks Roblox's rules.</span>
                </div>
            )}
        </>
    );
}
