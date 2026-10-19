/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Viewers for fonts, MKV video and .rar/.7z archives.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useRef, useState } from "@webpack/common";

import { MediaNative } from "../_shared/media";
import { Archive, ArchiveEntry, childrenOf } from "./archive";
import { readFontInfo } from "./fontInfo";
import { decodeText, formatSize, previewKind } from "./formats";
import { TableView, TextView } from "./TextViews";

const cl = classNameFactory("vc-fprev-");
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;
const MIME: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };

let fontSeq = 0;

export function FontView({ bytes, filename }: { bytes: Uint8Array; filename: string; }) {
    const info = useMemo(() => readFontInfo(bytes), [bytes]);
    const [family, setFamily] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [size, setSize] = useState(44);
    const [sample, setSample] = useState("The quick brown fox jumps over the lazy dog");

    useEffect(() => {
        const name = `opticord-font-preview-${fontSeq++}`;
        const face = new FontFace(name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        let added = false;
        face.load().then(f => { document.fonts.add(f); added = true; setFamily(name); }).catch(() => setError(true));
        return () => { if (added) document.fonts.delete(face); };
    }, [bytes]);

    if (error) return <div className={cl("error")}>This font file couldn't be read.</div>;
    if (!family) return <div className={cl("note")}>Loading font…</div>;
    const style = { fontFamily: `"${family}"` };

    return (
        <div className={cl("font")}>
            <div className={cl("font-meta")}>
                <span className={cl("font-name")}>{info.family ?? filename}</span>
                {info.style && <span className={cl("font-tag")}>{info.style}</span>}
                {info.version && <span className={cl("font-tag")}>v{info.version}</span>}
            </div>
            <div className={cl("font-controls")}>
                <input className={cl("font-input")} value={sample} onChange={e => setSample(e.currentTarget.value)} placeholder="Type to preview…" aria-label="Sample text" />
                <input type="range" min={12} max={120} value={size} onChange={e => setSize(Number(e.currentTarget.value))} aria-label="Size" className={cl("font-range")} />
                <span className={cl("font-size")}>{size}px</span>
            </div>
            <div className={cl("font-sample")} style={{ ...style, fontSize: size }}>{sample || " "}</div>
            <div className={cl("font-sheet")} style={style}>
                <div>ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>
                <div>abcdefghijklmnopqrstuvwxyz</div>
                <div>0123456789 !?&amp;@#%$€£ ()[]{"{}"} .,:;'"–—…</div>
            </div>
            <div className={cl("font-waterfall")} style={style}>
                {[14, 20, 28, 40].map(px => <div key={px} style={{ fontSize: px }}><span className={cl("font-px")}>{px}</span>{sample || "Sample"}</div>)}
            </div>
        </div>
    );
}

export function VideoView({ url }: { url: string; }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState(false);
    const [noSound, setNoSound] = useState(false);

    useEffect(() => {
        const v = ref.current;
        if (!v) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onPlaying = () => {
            clearTimeout(timer);
            // If the picture is decoding but no audio is, the audio codec isn't supported.
            timer = setTimeout(() => {
                const anyV = v as any;
                if (!v.paused && !v.muted && anyV.webkitVideoDecodedByteCount > 0 && anyV.webkitAudioDecodedByteCount === 0) setNoSound(true);
            }, 2500);
        };
        v.addEventListener("playing", onPlaying);
        return () => { clearTimeout(timer); v.removeEventListener("playing", onPlaying); };
    }, [url]);

    if (error) {
        return (
            <div className={cl("error")}>
                Discord's player can't play this MKV. It most likely uses HEVC (H.265) video, which Discord's player doesn't support.
                Most MKVs with H.264, VP9 or AV1 video play fine.
            </div>
        );
    }
    return (
        <>
            <video ref={ref} className={cl("video")} src={url} controls preload="metadata" onError={() => setError(true)} />
            {noSound && <div className={cl("hint")}>No sound? This video's audio track probably uses AC-3 or DTS, which Discord's player can't decode. The picture still works.</div>}
        </>
    );
}

function EntryPreview({ archive, entry }: { archive: Archive; entry: ArchiveEntry; }) {
    const [state, setState] = useState<{ bytes?: Uint8Array; error?: string; }>({});

    useEffect(() => {
        setState({});
        if (entry.encrypted) return setState({ error: "This file is password-protected." });
        if (entry.size > 20 * 1048576) return setState({ error: `Too big to preview here (${formatSize(entry.size)}) — download it instead.` });
        let cancelled = false;
        archive.extract(entry.path).then(
            bytes => { if (!cancelled) setState({ bytes }); },
            e => { if (!cancelled) setState({ error: String(e?.message ?? e) }); },
        );
        return () => { cancelled = true; };
    }, [entry.path]);

    const blobUrl = useMemo(() => {
        if (!state.bytes || !IMAGE_EXT.test(entry.name)) return null;
        const ext = entry.name.split(".").pop()!.toLowerCase();
        return URL.createObjectURL(new Blob([state.bytes as BlobPart], { type: MIME[ext] ?? "application/octet-stream" }));
    }, [state.bytes]);
    useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

    const download = () => {
        if (!state.bytes) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([state.bytes as BlobPart]));
        a.download = entry.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };

    const kind = previewKind(entry.name);
    let body: React.ReactNode;
    if (state.error) body = <div className={cl("error")}>{state.error}</div>;
    else if (!state.bytes) body = <div className={cl("note")}>Loading…</div>;
    else if (blobUrl) body = <div className={cl("img-wrap")}><img className={cl("img")} src={blobUrl} alt={entry.name} /></div>;
    else if (kind === "font") body = <FontView bytes={state.bytes} filename={entry.name} />;
    else if (kind === "text" || kind === "table") {
        const text = decodeText(state.bytes);
        body = text == null ? <div className={cl("note")}>This looks like a binary file.</div>
            : kind === "table" ? <TableView text={text} filename={entry.name} /> : <TextView text={text} wrap />;
    } else body = <div className={cl("note")}>No preview for this kind of file — you can download it.</div>;

    return (
        <div className={cl("entry-preview")}>
            <div className={cl("entry-head")}>
                <span className={cl("entry-name")} title={entry.path}>{entry.name}</span>
                <span className={cl("entry-size")}>{formatSize(entry.size)}</span>
                <button type="button" className={cl("chip")} disabled={!state.bytes} onClick={download}>Download</button>
            </div>
            {body}
        </div>
    );
}

export function ArchiveView({ url, filename }: { url: string; filename: string; }) {
    const [archive, setArchive] = useState<Archive | null>(null);
    const [stage, setStage] = useState("Downloading…");
    const [error, setError] = useState<string | null>(null);
    const [folder, setFolder] = useState("");
    const [selected, setSelected] = useState<ArchiveEntry | null>(null);

    useEffect(() => {
        let cancelled = false;
        let opened: Archive | null = null;
        (async () => {
            if (!MediaNative) throw new Error("Previewing archives needs the Discord desktop app.");
            setStage("Downloading and opening… (big archives can take a moment)");
            opened = await Archive.open(url, filename);
            if (cancelled) { opened.close(); return; }
            setArchive(opened);
        })().catch(e => { if (!cancelled) setError(String(e?.message ?? e)); });
        return () => { cancelled = true; opened?.close(); };
    }, [url]);

    if (error) return <div className={cl("error")}>{error}</div>;
    if (!archive) return <div className={cl("note")}>{stage}</div>;

    const files = archive.entries.filter(e => !e.dir);
    const total = files.reduce((n, e) => n + e.size, 0);
    const items = childrenOf(archive.entries, folder);
    const crumbs = folder ? folder.split("/") : [];

    return (
        <div className={cl("archive")}>
            <div className={cl("meta")}>{files.length} file{files.length === 1 ? "" : "s"} · {formatSize(total)} uncompressed{files.some(f => f.encrypted) ? " · some files are password-protected 🔒" : ""}</div>
            <div className={cl("archive-body")}>
                <div className={cl("browser")}>
                    <div className={cl("crumbs")}>
                        <button type="button" className={cl("crumb")} onClick={() => { setFolder(""); setSelected(null); }}>{filename}</button>
                        {crumbs.map((c, i) => (
                            <span key={i}> / <button type="button" className={cl("crumb")} onClick={() => { setFolder(crumbs.slice(0, i + 1).join("/")); setSelected(null); }}>{c}</button></span>
                        ))}
                    </div>
                    <div className={cl("rows")}>
                        {folder && <button type="button" className={cl("row")} onClick={() => { setFolder(crumbs.slice(0, -1).join("/")); setSelected(null); }}><span className={cl("row-icon")}>↩</span><span className={cl("row-name")}>..</span></button>}
                        {items.map(e => (
                            <button
                                key={e.path}
                                type="button"
                                className={classes(cl("row"), selected?.path === e.path && cl("row-on"))}
                                onClick={() => e.dir ? (setFolder(e.path), setSelected(null)) : setSelected(e)}
                            >
                                <span className={cl("row-icon")}>{e.dir ? "📁" : e.encrypted ? "🔒" : "📄"}</span>
                                <span className={cl("row-name")}>{e.name}</span>
                                {!e.dir && <span className={cl("row-size")}>{formatSize(e.size)}</span>}
                            </button>
                        ))}
                        {items.length === 0 && <div className={cl("note")}>This folder is empty.</div>}
                    </div>
                </div>
                <div className={cl("side")}>
                    {selected ? <EntryPreview key={selected.path} archive={archive} entry={selected} /> : <div className={cl("note")}>Pick a file to preview it.</div>}
                </div>
            </div>
        </div>
    );
}
