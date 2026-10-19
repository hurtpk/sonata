/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useEffect, useMemo, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { getBytes, MediaNative } from "../_shared/media";
import { decodeText, extensionOf, formatSize, LIMITS, PreviewKind, previewKind } from "./formats";
import { highlight, isCode, languageName, MAX_COLOURED } from "./highlight";
import { ArchiveView, FontView, VideoView } from "./MediaViews";
import { TableView, TextView } from "./TextViews";

const cl = classNameFactory("vc-fprev-");

export interface FileRef { url: string; filename: string; size: number; contentType?: string | null; }

function ViewerModal({ modalProps, file, kind }: { modalProps: RenderModalProps; file: FileRef; kind: Exclude<PreviewKind, "pdf">; }) {
    const [text, setText] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const ext = extensionOf(file.filename);
    // Code keeps its lines (and line numbers); plain text wraps.
    const [wrap, setWrap] = useState(() => !isCode(ext));
    const [colours, setColours] = useState(true);
    const [raw, setRaw] = useState(false);
    const [pretty, setPretty] = useState(true);
    const accent = windowAccent("filePreviewer");

    useEffect(() => {
        let cancelled = false;
        getBytes(file.url, LIMITS[kind]).then(bytes => {
            if (cancelled) return;
            const decoded = decodeText(bytes);
            if (decoded == null) setError("This looks like a binary file, not text.");
            else setText(decoded);
        }).catch(e => { if (!cancelled) setError(String(e?.message ?? e)); });
        return () => { cancelled = true; };
    }, [file.url]);

    const shown = useMemo(() => {
        if (text == null || ext !== "json" || !pretty) return text;
        try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
    }, [text, pretty, ext]);

    const copyAll = async () => {
        try { await navigator.clipboard.writeText(shown ?? ""); showToast("Copied", "success"); } catch { showToast("Couldn't copy", "failure"); }
    };

    return (
        <Modal {...modalProps} size="lg" title={file.filename} subtitle={`${formatSize(file.size)} · previewed without saving it`}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("toolbar")}>
                    {kind === "table" && (
                        <button type="button" className={classes(cl("chip"), !raw && cl("chip-on"))} onClick={() => setRaw(!raw)}>{raw ? "Show as table" : "Table"}</button>
                    )}
                    {(kind === "text" || raw) && (
                        <button type="button" className={classes(cl("chip"), wrap && cl("chip-on"))} onClick={() => setWrap(!wrap)}>Wrap lines</button>
                    )}
                    {kind === "text" && languageName(ext) && (
                        <button type="button" className={classes(cl("chip"), colours && cl("chip-on"))} onClick={() => setColours(!colours)} title={`Colour the code as ${languageName(ext)}`}>Colours</button>
                    )}
                    {ext === "json" && (
                        <button type="button" className={classes(cl("chip"), pretty && cl("chip-on"))} onClick={() => setPretty(!pretty)}>Pretty-print</button>
                    )}
                    <span className={cl("spacer")} />
                    {kind === "text" && languageName(ext) && shown != null && (
                        <span className={cl("lang")}>{languageName(ext)}{colours && shown.length > MAX_COLOURED ? " · too big to colour" : colours && highlight("", ext) == null ? " · colours load after Discord shows a code block" : ""}</span>
                    )}
                    <button type="button" className={cl("chip")} disabled={shown == null} onClick={copyAll}>Copy all</button>
                </div>
                {error ? <div className={cl("error")}>{error}</div>
                    : shown == null ? <div className={cl("note")}>Loading…</div>
                        : kind === "table" && !raw ? <TableView text={shown} filename={file.filename} />
                            : <TextView text={shown} wrap={wrap} ext={kind === "text" ? ext : undefined} colours={colours} />}
            </div>
        </Modal>
    );
}

export async function preview(file: FileRef) {
    const kind = previewKind(file.filename, file.contentType);
    if (!kind) return;
    if (file.size > LIMITS[kind]) {
        showToast(`${file.filename} is too big to preview (${formatSize(file.size)})`, "failure");
        return;
    }
    if (kind === "pdf") {
        if (!MediaNative) { window.open(file.url, "_blank", "noopener"); return; }
        showToast("Opening PDF…", "message");
        const r = await MediaNative.openPdfWindow(file.url, file.filename);
        if (!r.ok) showToast(`Couldn't open the PDF: ${r.error}`, "failure");
        return;
    }
    if (kind === "archive" || kind === "font" || kind === "video") {
        openModal(props => <MediaModal modalProps={props} file={file} kind={kind} />);
        return;
    }
    openModal(props => <ViewerModal modalProps={props} file={file} kind={kind as "table" | "text"} />);
}

function FontLoader({ file }: { file: FileRef; }) {
    const [bytes, setBytes] = useState<Uint8Array | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { getBytes(file.url, LIMITS.font).then(setBytes, e => setError(String(e?.message ?? e))); }, [file.url]);
    if (error) return <div className={cl("error")}>{error}</div>;
    return bytes ? <FontView bytes={bytes} filename={file.filename} /> : <div className={cl("note")}>Loading…</div>;
}

function MediaModal({ modalProps, file, kind }: { modalProps: RenderModalProps; file: FileRef; kind: "archive" | "font" | "video"; }) {
    const accent = windowAccent("filePreviewer");
    const subtitle = kind === "video" ? `${formatSize(file.size)} · streamed, not downloaded`
        : kind === "archive" ? `${formatSize(file.size)} · cached until you switch channels`
            : `${formatSize(file.size)} · font preview`;
    return (
        <Modal {...modalProps} size="lg" title={file.filename} subtitle={subtitle}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {kind === "video" ? <VideoView url={file.url} /> : kind === "font" ? <FontLoader file={file} /> : <ArchiveView url={file.url} filename={file.filename} />}
            </div>
        </Modal>
    );
}
