/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useRef, useState } from "@webpack/common";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import { loadPdfjs } from "../../mediaTools/fileConverter/pdf";
import { getBytes, MediaNative } from "../../_shared/media";
import { Window } from "../../_shared/Window";
import { formatSize } from "./formats";
import type { FileRef } from "./Viewer";

const READER_LIMIT = 32 * 1024 * 1024;
const POSITIONS = "sonata-file-preview-pdf-pages";
const BATCH = 8;
type Position = { id: string; page: number; };
type Match = { page: number; excerpt: string; };
const Ocr = IS_WEB ? undefined : MediaNative;
const normalize = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

function attachmentKey(url: string) {
    const { origin, pathname } = new URL(url);
    if (origin !== "https://cdn.discordapp.com" && origin !== "https://media.discordapp.net") return;
    const match = /^\/attachments\/(\d{17,20})\/(\d{17,20})\//.exec(pathname);
    if (match) return `${match[1]}/${match[2]}`;
}

async function openStandardPdf(file: FileRef) {
    if (!MediaNative) { window.open(file.url, "_blank", "noopener"); return; }
    showToast("Opening PDF…", "message");
    try {
        const result = await MediaNative.openPdfWindow(file.url, file.filename);
        if (!result.ok) showToast(`Couldn't open the PDF: ${result.error}`, "failure");
    } catch {
        showToast("Couldn't open the PDF.", "failure");
    }
}

function PageCanvas({ doc, page, thumbnail = false, zoom = 1, query = "" }: { doc: PDFDocumentProxy; page: number; thumbnail?: boolean; zoom?: number; query?: string; }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [marks, setMarks] = useState<React.CSSProperties[]>([]);
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        let cancelled = false, render: RenderTask | undefined;
        void (async () => {
            const source = await doc.getPage(page);
            if (cancelled) return;
            const original = source.getViewport({ scale: 1 });
            const edge = thumbnail ? 128 : 1800;
            const scale = Math.min(edge / original.width, edge / original.height, thumbnail ? 1 : 2);
            const viewport = source.getViewport({ scale });
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            render = source.render({ canvas, viewport, background: "white", annotationMode: 0 });
            await render.promise;
            if (!cancelled) setState("ready");
        })().catch(() => { if (!cancelled) setState("error"); });
        return () => {
            cancelled = true;
            render?.cancel();
        };
    }, [doc, page, thumbnail]);
    useEffect(() => {
        setMarks([]);
        if (thumbnail || !query || state !== "ready") return;
        let cancelled = false;
        void (async () => {
            const [source, lib] = await Promise.all([doc.getPage(page), loadPdfjs()]);
            const { items } = await source.getTextContent();
            const spans = items.flatMap(item => "str" in item ? [item] : []);
            let text = "";
            const ranges = spans.map(item => {
                const start = text.length;
                const chunk = normalize(item.str);
                text += text.endsWith(" ") ? chunk.replace(/^ /, "") : chunk;
                const end = text.length;
                if (item.hasEOL && !text.endsWith(" ")) text += " ";
                return { start, end };
            });
            const found: [number, number][] = [];
            for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) found.push([at, at + query.length]);
            const viewport = source.getViewport({ scale: 1 });
            const highlights: React.CSSProperties[] = [];
            let next = 0;
            for (const [index, span] of spans.entries()) {
                const { start, end } = ranges[index];
                while (next < found.length && found[next][1] <= start) next++;
                if (next >= found.length) break;
                const transform = lib.Util.transform(viewport.transform, span.transform);
                const height = Math.hypot(transform[2], transform[3]) || span.height;
                const angle = Math.atan2(transform[1], transform[0]);
                for (let i = next; i < found.length && found[i][0] < end; i++) {
                    if (end <= start) continue;
                    const a = (Math.max(start, found[i][0]) - start) / (end - start);
                    const b = (Math.min(end, found[i][1]) - start) / (end - start);
                    const x = transform[4] + span.width * a * Math.cos(angle) + height * Math.sin(angle);
                    const y = transform[5] + span.width * a * Math.sin(angle) - height * Math.cos(angle);
                    highlights.push({
                        left: 100 * x / viewport.width + "%",
                        top: 100 * y / viewport.height + "%",
                        width: 100 * span.width * (b - a) / viewport.width + "%",
                        height: 100 * height / viewport.height + "%",
                        transform: "rotate(" + angle + "rad)",
                    });
                }
            }
            if (!cancelled) setMarks(highlights);
        })().catch(() => { });
        return () => { cancelled = true; };
    }, [doc, page, query, state, thumbnail]);
    return <>
        {state === "loading" && <span className="vc-fprev-note">{thumbnail ? "…" : "Rendering page…"}</span>}
        {state === "error" && <span className="vc-fprev-note">{thumbnail ? "No preview" : "This page could not be rendered."}</span>}
        <div className={thumbnail ? undefined : "vc-fprev-pdf-sheet"} hidden={state !== "ready"} style={thumbnail ? undefined : { width: 100 * zoom + "%" }}>
            <canvas ref={canvasRef} role={thumbnail ? undefined : "img"} aria-label={thumbnail ? undefined : `PDF page ${page}`} aria-hidden={thumbnail || undefined} />
            {marks.map((style, i) => <span key={i} className="vc-fprev-pdf-mark" style={style} aria-hidden />)}
        </div>
    </>;
}

function PdfReader({ modalProps, file }: { modalProps: RenderModalProps; file: FileRef; }) {
    const [doc, setDoc] = useState<PDFDocumentProxy>();
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const [pageField, setPageField] = useState("1");
    const [query, setQuery] = useState("");
    const [matches, setMatches] = useState<Match[]>();
    const [zoom, setZoom] = useState(1);
    const [scan, setScan] = useState<{ page: number; text: string; error?: boolean; }>();
    const [scanning, setScanning] = useState(false);
    const recognized = useRef(new Map<number, string>());
    const [searchStatus, setSearchStatus] = useState("");
    const searchRevision = useRef(0);
    const stage = useRef<HTMLDivElement>(null);
    const id = attachmentKey(file.url);

    useEffect(() => {
        let closed = false;
        let task: PDFDocumentLoadingTask | undefined;
        void (async () => {
            const [lib, data, saved] = await Promise.all([
                loadPdfjs(),
                getBytes(file.url, READER_LIMIT),
                id ? DataStore.get<Position[]>(POSITIONS).catch(() => undefined) : undefined,
            ]);
            if (closed) return;
            const options = { data, isEvalSupported: false, enableXfa: false, useWasm: false, useWorkerFetch: false, maxImageSize: 16_000_000 };
            task = lib.getDocument(options);
            const loaded = await task.promise;
            if (closed) return;
            const last = Array.isArray(saved) ? saved.find(item => item.id === id)?.page : undefined;
            const restored = last && Number.isInteger(last) ? Math.max(1, Math.min(last, loaded.numPages)) : 1;
            setPage(restored);
            setPageField(String(restored));
            setDoc(loaded);
        })().catch(reason => {
            if (closed) return;
            setError(reason instanceof Error && reason.name === "PasswordException"
                ? "This PDF needs a password. Open it in the separate viewer to unlock it."
                : "This PDF could not be loaded in the reader. Try the separate viewer.");
        });
        return () => {
            closed = true;
            searchRevision.current++;
            void task?.destroy().catch(() => { });
        };
    }, [file.url, id]);

    function jump(target: number) {
        if (!doc || !Number.isSafeInteger(target)) { setPageField(String(page)); return; }
        const next = Math.max(1, Math.min(target, doc.numPages));
        setPage(next);
        setPageField(String(next));
        stage.current?.scrollTo(0, 0);
        if (id) void DataStore.update<Position[]>(POSITIONS, previous => [
            { id, page: next }, ...(Array.isArray(previous) ? previous.filter(item => item.id !== id).slice(0, 99) : []),
        ]).catch(() => { });
    }

    async function scanPage() {
        const canvas = stage.current?.querySelector<HTMLCanvasElement>(".vc-fprev-pdf-sheet:not([hidden]) canvas");
        if (!canvas || !Ocr?.recognizePdfPage || scanning) return;
        setScanning(true);
        try {
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
            if (!blob) throw new Error("Couldn't capture this page.");
            const result = await Ocr.recognizePdfPage(new Uint8Array(await blob.arrayBuffer()));
            if (!result.ok) throw new Error(result.error);
            if (result.text) recognized.current.set(page, result.text);
            setScan({ page, text: result.text || "No text recognized on this page." });
        } catch (reason) {
            setScan({ page, text: reason instanceof Error ? reason.message : "Couldn't scan this page.", error: true });
        } finally { setScanning(false); }
    }

    async function findText() {
        const term = query.trim().replace(/\s+/g, " ").toLowerCase();
        if (!doc || !term) return;
        const revision = ++searchRevision.current, found: Match[] = [];
        setMatches(undefined);
        setSearchStatus("Searching…");
        try {
            for (let n = 1; n <= doc.numPages; n++) {
                if (revision !== searchRevision.current) return;
                const source = await doc.getPage(n);
                const content = await source.getTextContent();
                const text = (recognized.current.get(n) || content.items.map(item => "str" in item ? item.str + (item.hasEOL ? " " : "") : "").join("")).replace(/\s+/g, " ");
                const at = text.toLowerCase().indexOf(term);
                if (at !== -1) found.push({ page: n, excerpt: text.slice(Math.max(0, at - 32), at + term.length + 62).trim() });
                if (n % BATCH === 0 && revision === searchRevision.current) {
                    setSearchStatus(`Searching page ${n} of ${doc.numPages}…`);
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            if (revision !== searchRevision.current) return;
            setMatches(found);
            setSearchStatus(found.length ? `${found.length} matching ${found.length === 1 ? "page" : "pages"}` : "No matching text. Scanned pages may only contain images.");
            if (found.length) jump(found[0].page);
        } catch {
            if (revision === searchRevision.current) setSearchStatus("Some PDF text could not be searched.");
        }
    }

    const first = Math.floor((page - 1) / BATCH) * BATCH + 1;
    return (
        <Window {...modalProps} size="lg" title={file.filename} subtitle={`PDF · ${formatSize(file.size)}`}>
            <div className="vc-fprev-pdf">
                <div className="vc-fprev-pdf-toolbar">
                    <form className="vc-fprev-pdf-search" role="search" onSubmit={event => { event.preventDefault(); void findText(); }}>
                        <input type="search" aria-label="Search PDF text" placeholder="Find in PDF" value={query} maxLength={160} disabled={!doc} onChange={event => {
                            searchRevision.current++;
                            setQuery(event.currentTarget.value);
                            setMatches(undefined);
                            setSearchStatus("");
                        }} />
                        <button type="submit" className="vc-fprev-chip" disabled={!doc || !query.trim()}>Find</button>
                    </form>
                    <label>Zoom <select aria-label="PDF zoom" className="vc-fprev-chip" value={zoom} disabled={!doc} onChange={event => setZoom(Number(event.currentTarget.value))}>
                        <option value={1}>Fit width</option><option value={1.25}>125%</option><option value={1.5}>150%</option><option value={2}>200%</option><option value={3}>300%</option>
                    </select></label>
                    {Ocr?.recognizePdfPage && <button type="button" className="vc-fprev-chip" disabled={!doc || scanning} onClick={() => void scanPage()}>{scanning ? "Scanning…" : "Scan page text"}</button>}
                    <button type="button" className="vc-fprev-chip" onClick={() => void openStandardPdf(file)}>Separate viewer</button>
                </div>
                {error && <p className="vc-fprev-error" role="alert">{error}</p>}
                {!doc && !error && <p className="vc-fprev-note" role="status">Opening PDF…</p>}
                {doc && <>
                    {scan?.page === page && <details open className="vc-fprev-pdf-ocr"><summary>{scan.error ? "Scan failed" : "Recognized page text"}</summary><pre>{scan.text}</pre></details>}
                    {searchStatus && <p className="vc-fprev-pdf-status" role="status">{searchStatus}</p>}
                    <div className="vc-fprev-pdf-layout">
                        <aside className="vc-fprev-pdf-rail" aria-label={matches ? "Search results" : "Page thumbnails"}>
                            {matches?.length ? matches.map(match => <button type="button" className="vc-fprev-chip" key={match.page} aria-current={match.page === page ? "page" : undefined} onClick={() => jump(match.page)}>
                                <strong>Page {match.page}</strong><small>{match.excerpt}</small>
                            </button>) : Array.from({ length: Math.min(BATCH, doc.numPages - first + 1) }, (_, index) => first + index).map(n => (
                                <button type="button" className="vc-fprev-chip" key={n} aria-current={n === page ? "page" : undefined} onClick={() => jump(n)}>
                                    <PageCanvas doc={doc} page={n} thumbnail /><span>Page {n}</span>
                                </button>
                            ))}
                        </aside>
                        <div className="vc-fprev-pdf-stage" ref={stage} tabIndex={0} aria-label={`Page ${page} of ${doc.numPages}`}>
                            <PageCanvas key={page} doc={doc} page={page} zoom={zoom} query={matches?.some(match => match.page === page) ? normalize(query.trim()) : ""} />
                        </div>
                    </div>
                    <form className="vc-fprev-pdf-navigation" onSubmit={event => { event.preventDefault(); jump(Number(pageField)); }}>
                        <button type="button" className="vc-fprev-chip" onClick={() => jump(page - 1)} disabled={page === 1}>Previous</button>
                        <input type="number" min={1} max={doc.numPages} value={pageField} aria-label="Page number" required onChange={event => setPageField(event.currentTarget.value)} />
                        <span>of {doc.numPages}</span>
                        <button type="submit" className="vc-fprev-chip">Go</button>
                        <button type="button" className="vc-fprev-chip" onClick={() => jump(page + 1)} disabled={page === doc.numPages}>Next</button>
                    </form>
                </>}
            </div>
        </Window>
    );
}

export function openPdfReader(file: FileRef) {
    if (file.size > READER_LIMIT) { void openStandardPdf(file); return; }
    openModal(props => <PdfReader modalProps={props} file={file} />);
}
