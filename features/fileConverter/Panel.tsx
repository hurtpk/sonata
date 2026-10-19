/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, DraftType, Modal, openModal, SelectedChannelStore, showToast, UploadHandler, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { applyPreset, convert, ImageOptions, imagesIntoPdf, Result, zipFiles, zipResults } from "./convert";
import { Kind, kindOf, MB, presetsFor, sizeText, targetsFor } from "./formats";
import { BgOptions, decodeImage, DEFAULT_BG, removeBackground } from "./image";
import { DEFAULT_MEDIA, MediaOptions } from "./media";
import { Renamer } from "./Rename";
import { Trimmer } from "./Trimmer";

const cl = classNameFactory("vc-tool-");
const fc = classNameFactory("vc-fconv-");

const KIND_LABEL: Record<Kind, string> = { image: "Image", animated: "Animated image", audio: "Audio", video: "Video", data: "Data / text", pdf: "PDF", other: "File" };
const KIND_ICON: Record<Kind, string> = { image: "🖼️", animated: "🎞️", audio: "🎵", video: "🎬", data: "📄", pdf: "📕", other: "📦" };

type Choice = { type: "target"; id: string; ext: string; } | { type: "preset"; id: string; } | { type: "pdf-all"; } | { type: "zip"; };

interface Done { result: Result; url: string; from: number; }

const MAX_FILES = 200;

function Preview({ r }: { r: Done; }) {
    const t = r.result.blob.type;
    if (t.startsWith("image/")) return <img className={fc("thumb")} src={r.url} alt="" />;
    if (t.startsWith("video/")) return <video className={fc("thumb")} src={r.url} muted loop autoPlay playsInline />;
    if (t.startsWith("audio/")) return <audio className={fc("audio")} src={r.url} controls />;
    return <span className={fc("thumb-icon")}>{t.includes("zip") ? "🗜️" : t.includes("pdf") ? "📕" : "📄"}</span>;
}

function ResultRow({ r }: { r: Done; }) {
    const file = () => new File([r.result.blob], r.result.name, { type: r.result.blob.type });
    const send = () => {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        if (!channel) { showToast("Open a chat first", "failure"); return; }
        UploadHandler.promptToUpload([file()], channel, DraftType.ChannelMessage);
        showToast("Added to your message", "success");
    };
    const copy = async () => {
        try {
            const png = r.result.blob.type === "image/png" ? r.result.blob : null;
            if (!png) throw 0;
            await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
            showToast("Copied", "success");
        } catch { showToast("Only PNG pictures can be copied", "failure"); }
    };
    const change = r.from ? Math.round((r.result.blob.size / r.from - 1) * 100) : 0;
    return (
        <div className={fc("result")}>
            <Preview r={r} />
            <div className={fc("result-info")}>
                <span className={fc("result-name")} title={r.result.name}>{r.result.name}</span>
                <span className={fc("result-size")}>
                    {sizeText(r.result.blob.size)}
                    {r.from > 0 && change !== 0 && <span className={change < 0 ? fc("smaller") : fc("bigger")}> {change < 0 ? `${-change}% smaller` : `${change}% bigger`}</span>}
                    {r.result.blob.size > 10 * MB && <span className={fc("bigger")}> · over the 10 MB upload limit</span>}
                </span>
            </div>
            <div className={fc("result-actions")}>
                {r.result.blob.type === "image/png" && <button type="button" className={cl("btn")} onClick={copy}>Copy</button>}
                <button type="button" className={cl("btn")} onClick={() => saveFile(file())}>Save</button>
                <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={send}>Add to message</button>
            </div>
        </div>
    );
}

function Options({ kinds, img, setImg, media, setMedia, single }: { kinds: Set<Kind>; img: ImageOptions; setImg(o: ImageOptions): void; media: MediaOptions; setMedia(o: MediaOptions): void; single?: File; }) {
    const pictures = kinds.has("image") || kinds.has("animated");
    const moving = kinds.has("video") || kinds.has("audio") || kinds.has("animated");
    const seg = <T extends string | number>(value: T, options: [T, string][], set: (v: T) => void) => (
        <div className={cl("seg")}>{options.map(([v, label]) => <button key={String(v)} type="button" className={classes(cl("seg-btn"), value === v && cl("seg-on"))} onClick={() => set(v)}>{label}</button>)}</div>
    );
    return (
        <div className={classes(cl("card"), fc("options"))}>
            {pictures && (
                <>
                    <div className={fc("opt")}>
                        <span className={cl("label")}>Picture quality (JPG / WebP)</span>
                        <div className={fc("range")}>
                            <input type="range" min={30} max={100} value={Math.round(img.quality * 100)} onChange={e => setImg({ ...img, quality: Number(e.currentTarget.value) / 100 })} />
                            <b>{Math.round(img.quality * 100)}%</b>
                        </div>
                    </div>
                    <div className={fc("opt")}>
                        <span className={cl("label")}>Picture size</span>
                        {seg(img.maxSide, [[0, "Original"], [4096, "4K"], [2048, "2048"], [1080, "1080"], [512, "512"]], v => setImg({ ...img, maxSide: v }))}
                    </div>
                </>
            )}
            {moving && (
                <>
                    <div className={fc("opt")}>
                        <span className={cl("label")}>Quality</span>
                        {seg(media.quality, [["high", "High"], ["medium", "Medium"], ["small", "Small file"]], v => setMedia({ ...media, quality: v }))}
                    </div>
                    {(kinds.has("video") || kinds.has("animated")) && (
                        <div className={fc("opt")}>
                            <span className={cl("label")}>Video width</span>
                            {seg(media.maxWidth, [[0, "Original"], [1920, "1080p"], [1280, "720p"], [854, "480p"], [480, "Small"]], v => setMedia({ ...media, maxWidth: v }))}
                        </div>
                    )}
                    {single && (kindOf(single) === "video" || kindOf(single) === "audio") ? <Trimmer file={single} media={media} setMedia={setMedia} /> : (
                    <div className={fc("opt")}>
                        <span className={cl("label")}>Trim (seconds)</span>
                        <div className={cl("row")}>
                            <input className={classes(cl("input"), fc("num"))} type="number" min={0} step={0.1} placeholder="Start" value={media.start || ""} onChange={e => setMedia({ ...media, start: Math.max(0, Number(e.currentTarget.value) || 0) })} />
                            <span className={cl("hint")}>to</span>
                            <input className={classes(cl("input"), fc("num"))} type="number" min={0} step={0.1} placeholder="End" value={media.end || ""} onChange={e => setMedia({ ...media, end: Math.max(0, Number(e.currentTarget.value) || 0) })} />
                        </div>
                    </div>
                    )}
                    {(kinds.has("video") || kinds.has("animated")) && (
                        <>
                            <div className={fc("opt")}>
                                <span className={cl("label")}>GIF / WebP smoothness</span>
                                {seg(media.fps, [[8, "8 fps"], [12, "12"], [15, "15"], [24, "24"], [30, "30"]], v => setMedia({ ...media, fps: v }))}
                            </div>
                            <label className={cl("check")}>
                                <input type="checkbox" checked={media.mute} onChange={e => setMedia({ ...media, mute: e.currentTarget.checked })} /> Remove the sound
                            </label>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

/** Background removal: its options, with a live preview of the first picture. */
function BgPanel({ file, bg, setBg }: { file: File; bg: BgOptions; setBg(b: BgOptions): void; }) {
    const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        decodeImage(file).then(c => {
            if (!alive) return;
            // A small copy, so the preview keeps up while you drag the sliders.
            const scale = Math.min(1, 360 / Math.max(c.width, c.height));
            const s = document.createElement("canvas");
            s.width = Math.max(1, Math.round(c.width * scale)); s.height = Math.max(1, Math.round(c.height * scale));
            s.getContext("2d")!.drawImage(c, 0, 0, s.width, s.height);
            setSrc(s);
        }).catch(() => { });
        return () => { alive = false; };
    }, [file]);
    useEffect(() => {
        if (!src) return;
        const t = setTimeout(() => setUrl(removeBackground(src, bg).toDataURL("image/png")), 60);
        return () => clearTimeout(t);
    }, [src, bg]);
    const set = (p: Partial<BgOptions>) => setBg({ ...bg, ...p });
    return (
        <div className={classes(cl("card"), fc("bg"))}>
            <div className={fc("bg-preview")}>{url ? <img src={url} alt="Preview" /> : <span className={cl("hint")}>Making a preview…</span>}</div>
            <div className={fc("bg-opts")}>
                <span className={cl("label")}>Background colour</span>
                <div className={cl("seg")}>
                    {([["auto", "Find it"], ["white", "White"], ["black", "Black"], ["green", "Green screen"], ["blue", "Blue screen"]] as const).map(([v, l]) => <button key={v} type="button" className={classes(cl("seg-btn"), bg.color === v && cl("seg-on"))} onClick={() => set({ color: v })}>{l}</button>)}
                </div>
                <span className={cl("label")}>How much counts as background</span>
                <div className={fc("range")}><input type="range" min={0} max={100} value={bg.tolerance} onChange={e => set({ tolerance: Number(e.currentTarget.value) })} /><b>{bg.tolerance}</b></div>
                <span className={cl("label")}>Softer edges</span>
                <div className={fc("range")}><input type="range" min={0} max={100} value={bg.soften} onChange={e => set({ soften: Number(e.currentTarget.value) })} /><b>{bg.soften}</b></div>
                <label className={cl("check")}><input type="checkbox" checked={bg.edgesOnly} onChange={e => set({ edgesOnly: e.currentTarget.checked })} /> Only the background around the edges (keeps the same colour inside the picture)</label>
                <span className={cl("hint")}>Works best on plain, even backgrounds. It saves as PNG so the see-through part stays.</span>
            </div>
        </div>
    );
}

function ConverterModal({ modalProps, initial }: { modalProps: RenderModalProps; initial: File[]; }) {
    const accent = windowAccent("fileConverter");
    const [files, setFiles] = useState<File[]>(initial);
    const [tab, setTab] = useState<"convert" | "presets" | "rename">("convert");
    const [choice, setChoice] = useState<Choice | null>(null);
    const [img, setImg] = useState<ImageOptions>({ quality: 0.9, maxSide: 0 });
    const [media, setMedia] = useState<MediaOptions>(DEFAULT_MEDIA);
    const [showOptions, setShowOptions] = useState(false);
    const [bg, setBg] = useState<BgOptions>(DEFAULT_BG);
    const [busy, setBusy] = useState<{ text: string; progress?: number; } | null>(null);
    const [done, setDone] = useState<Done[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [over, setOver] = useState(false);
    const picker = useRef<HTMLInputElement>(null);
    const folderPicker = useRef<HTMLInputElement>(null);
    const [skipped, setSkipped] = useState(0);

    // Results stay viewable until the window closes; then their memory is let go.
    const urls = useRef<string[]>([]);
    useEffect(() => { urls.current = done.map(d => d.url); }, [done]);
    useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), []);

    const kinds = useMemo(() => new Set(files.map(kindOf)), [files]);
    const kind: Kind | null = kinds.size === 1 ? [...kinds][0] : null;
    const targets = kind ? targetsFor(kind) : [];
    const presets = kind ? presetsFor(kind) : [];
    const allImages = files.length > 0 && files.every(f => kindOf(f) === "image");

    const addFiles = (list: FileList | File[] | null) => {
        if (!list?.length) return;
        // Hidden system files from folders (Thumbs.db, .DS_Store…) are left out.
        const usable = Array.from(list).filter(f => !/^(\.|thumbs\.db$|desktop\.ini$)/i.test(f.name) && f.size > 0);
        setFiles(f => {
            const all = [...f, ...usable];
            setSkipped(all.length > MAX_FILES ? all.length - MAX_FILES : 0);
            return all.slice(0, MAX_FILES);
        });
        setChoice(null);
        setError(null);
    };

    // A folder dragged in: read everything inside it (and its folders).
    const dropped = async (dt: DataTransfer) => {
        const entries = Array.from(dt.items ?? []).map(i => (i as any).webkitGetAsEntry?.()).filter(Boolean);
        if (!entries.some((e: any) => e.isDirectory)) { addFiles(dt.files); return; }
        const out: File[] = [];
        const walk = async (entry: any): Promise<void> => {
            if (out.length >= MAX_FILES * 2) return;
            if (entry.isFile) { out.push(await new Promise<File>((res, rej) => entry.file(res, rej))); return; }
            const reader = entry.createReader();
            for (; ;) {
                const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
                if (!batch.length) break;
                for (const e of batch) await walk(e);
            }
        };
        for (const e of entries) await walk(e);
        addFiles(out);
    };

    // Mixed folders: keep just one kind so it can be converted in one go.
    const kindCounts = useMemo(() => {
        const m = new Map<Kind, number>();
        for (const f of files) m.set(kindOf(f), (m.get(kindOf(f)) ?? 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }, [files]);

    const saveAllZip = async () => {
        try {
            setBusy({ text: "Zipping…" });
            const z = await zipResults(done.map(d => d.result));
            saveFile(new File([z.blob], z.name, { type: "application/zip" }));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
    };

    const run = async () => {
        if (!choice || !files.length || busy) return;
        setError(null);
        const status = (text: string, progress?: number) => setBusy({ text, progress });
        const out: Done[] = [];
        try {
            if (choice.type === "pdf-all") {
                const r = await imagesIntoPdf(files, img, status);
                out.push({ result: r, url: URL.createObjectURL(r.blob), from: files.reduce((n, f) => n + f.size, 0) });
            } else if (choice.type === "zip") {
                const r = await zipFiles(files);
                out.push({ result: r, url: URL.createObjectURL(r.blob), from: files.reduce((n, f) => n + f.size, 0) });
            } else {
                for (const [i, f] of files.entries()) {
                    const each = (text: string, p?: number) => status(files.length > 1 ? `${f.name} (${i + 1} of ${files.length}) — ${text}` : text, p);
                    const results = choice.type === "preset" ? await applyPreset(f, choice.id, each, { bg }) : await convert(f, choice.id, choice.ext, img, media, each);
                    for (const r of results) out.push({ result: r, url: URL.createObjectURL(r.blob), from: f.size });
                }
            }
            setDone(d => [...out, ...d]);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            out.forEach(d => URL.revokeObjectURL(d.url));
        } finally {
            setBusy(null);
        }
    };

    const pick = (c: Choice) => setChoice(c);
    const isOn = (c: Choice) => !!choice && choice.type === c.type && ("id" in c ? "id" in choice && choice.id === c.id : true);

    return (
        <Modal {...modalProps} size="lg" title="File Converter" subtitle="Everything happens on your computer — nothing is uploaded anywhere.">
            <div className={cl("wrap")} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}
                onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); dropped(e.dataTransfer); }}>
                <input ref={picker} type="file" multiple hidden onChange={e => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
                <input ref={folderPicker} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as any)} onChange={e => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />

                {files.length > 0 && (
                    <ToolHero icon={kind ? KIND_ICON[kind] : "📦"} kicker={busy ? "Working…" : "Ready to convert"}
                        title={files.length === 1 ? files[0].name : `${files.length} ${kind ? `${KIND_LABEL[kind].toLowerCase()}s` : "files"}`}
                        sub={`${sizeText(files.reduce((n, f) => n + f.size, 0))} · everything stays on your computer`}
                        numbers={[{ value: files.length, label: files.length === 1 ? "file" : "files" }, { value: done.length, label: "converted" }]} />
                )}
                {!files.length ? (
                    <button type="button" className={classes(fc("drop"), over && fc("drop-over"))} onClick={() => picker.current?.click()}>
                        <span className={fc("drop-icon")}>⇪</span>
                        <b>Drop files here, or click to choose</b>
                        <span>Pictures (incl. iPhone HEIC), GIFs, videos, music, PDFs, CSV / JSON / YAML / Markdown — or a whole folder</span>
                    </button>
                ) : (
                    <div className={classes(fc("files"), over && fc("drop-over"))}>
                        {files.map((f, i) => (
                            <div key={i} className={fc("file")}>
                                <span aria-hidden>{KIND_ICON[kindOf(f)]}</span>
                                <span className={fc("file-name")} title={f.name}>{f.name}</span>
                                <span className={fc("file-meta")}>{KIND_LABEL[kindOf(f)]} · {sizeText(f.size)}</span>
                                <button type="button" className={fc("x")} aria-label="Remove" onClick={() => { setFiles(fs => fs.filter((_, j) => j !== i)); setChoice(null); }}>✕</button>
                            </div>
                        ))}
                        <div className={fc("more-row")}>
                            <button type="button" className={fc("more")} onClick={() => picker.current?.click()}>＋ Add files</button>
                            <button type="button" className={fc("more")} onClick={() => folderPicker.current?.click()}>📁 Add a folder</button>
                        </div>
                    </div>
                )}
                {!files.length && <button type="button" className={cl("link")} style={{ alignSelf: "center" }} onClick={() => folderPicker.current?.click()}>📁 Or pick a whole folder</button>}
                {files.length > 0 && <span className={cl("hint")}>{files.length} file{files.length === 1 ? "" : "s"} · {sizeText(files.reduce((n, f) => n + f.size, 0))}{skipped ? ` · ${skipped} more left out (up to ${MAX_FILES} at a time)` : ""}</span>}

                {files.length > 0 && (
                    <>
                        {kinds.size > 1 && (
                            <div className={cl("chips")}>
                                <span className={cl("hint")}>Different kinds of file — zip them together, or keep just one kind:</span>
                                {kindCounts.map(([k, n]) => <button key={k} type="button" className={cl("chip")} onClick={() => { setFiles(fs => fs.filter(f => kindOf(f) === k)); setChoice(null); }}>{KIND_ICON[k]} Only {KIND_LABEL[k].toLowerCase()}s ({n})</button>)}
                            </div>
                        )}
                        {kind === "other" && <span className={cl("hint")}>This kind of file can't be converted, but it can be zipped.</span>}

                        <div className={cl("seg")}>
                            <button type="button" className={classes(cl("seg-btn"), tab === "convert" && cl("seg-on"))} onClick={() => setTab("convert")}>Convert to…</button>
                            <button type="button" className={classes(cl("seg-btn"), tab === "presets" && cl("seg-on"))} disabled={!presets.length} onClick={() => setTab("presets")}>Presets &amp; tools</button>
                            <button type="button" className={classes(cl("seg-btn"), tab === "rename" && cl("seg-on"))} onClick={() => setTab("rename")}>✏️ Rename</button>
                        </div>

                        {tab === "rename" ? <Renamer files={files} /> : <>
                        <div className={fc("choices")}>
                            {tab === "convert" ? (
                                <>
                                    {targets.map(t => {
                                        const c: Choice = { type: "target", id: t.id, ext: t.ext };
                                        return (
                                            <button key={t.id} type="button" className={classes(fc("choice"), isOn(c) && fc("choice-on"))} onClick={() => pick(c)}>
                                                <b>{t.label}</b>{t.note && <span>{t.note}</span>}
                                            </button>
                                        );
                                    })}
                                    {allImages && files.length > 1 && (
                                        <button type="button" className={classes(fc("choice"), isOn({ type: "pdf-all" }) && fc("choice-on"))} onClick={() => pick({ type: "pdf-all" })}>
                                            <b>One PDF</b><span>Every picture as a page</span>
                                        </button>
                                    )}
                                    <button type="button" className={classes(fc("choice"), isOn({ type: "zip" }) && fc("choice-on"))} onClick={() => pick({ type: "zip" })}>
                                        <b>ZIP</b><span>{files.length > 1 ? "All of them in one file" : "Zipped up"}</span>
                                    </button>
                                </>
                            ) : presets.map(p => {
                                const c: Choice = { type: "preset", id: p.id };
                                return (
                                    <button key={p.id} type="button" className={classes(fc("choice"), isOn(c) && fc("choice-on"))} onClick={() => pick(c)}>
                                        <b>{p.label}</b><span>{p.blurb}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {choice?.type === "preset" && choice.id === "nobg" && files[0] && <BgPanel file={files[0]} bg={bg} setBg={setBg} />}

                        {tab === "convert" && kind && kind !== "data" && kind !== "pdf" && kind !== "other" && (
                            <button type="button" className={cl("btn")} onClick={() => setShowOptions(s => !s)}>{showOptions ? "Hide options" : files.length === 1 && (kind === "video" || kind === "audio") ? "✂️ Trim & more options" : "More options (quality, size, trim…)"}</button>
                        )}
                        {showOptions && tab === "convert" && <Options kinds={kinds} img={img} setImg={setImg} media={media} setMedia={setMedia} single={files.length === 1 ? files[0] : undefined} />}

                        {(kinds.has("video") || kinds.has("audio") || kinds.has("animated")) && !busy && (
                            <span className={cl("hint")}>Videos and sound use ffmpeg, downloaded once (about 31 MB). Long videos take a while — it all runs on your computer.</span>
                        )}

                        {busy && (
                            <div className={fc("busy")}>
                                <span>{busy.text}</span>
                                <div className={classes(fc("bar"), busy.progress == null && fc("bar-wait"))}><div style={{ width: `${Math.round((busy.progress ?? 0) * 100)}%` }} /></div>
                            </div>
                        )}
                        {error && <div className={cl("error")}>{error}</div>}

                        <div className={cl("footer")}>
                            <button type="button" className={cl("btn")} onClick={() => { setFiles([]); setChoice(null); setError(null); }}>Start over</button>
                            <span className={cl("spacer")} />
                            <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!choice || !!busy} onClick={run}>{busy ? "Working…" : "Convert"}</button>
                        </div>
                        </>}
                    </>
                )}

                {done.length > 0 && (
                    <div className={fc("results")}>
                        <div className={cl("head")}>
                            <span className={cl("label")}>Done · {done.length}</span>
                            {done.length > 1 && <button type="button" className={cl("link")} disabled={!!busy} onClick={saveAllZip}>Save all as ZIP</button>}
                        </div>
                        {done.map((d, i) => <ResultRow key={`${d.url}-${i}`} r={d} />)}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function openFileConverter(files: File[] = []) {
    openModal(props => <ConverterModal modalProps={props} initial={files} />);
}
