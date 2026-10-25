/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// PDFs: pictures into a PDF (one page each, written here), and PDF pages
// into pictures or text (read by pdf.js, loaded only when a PDF comes along
// and run right here rather than in a separate worker).

import { encodeImage } from "./image";

// ─── Images → PDF ───

/** One page per picture, each page the picture's own shape (at 96 dpi). */
export async function imagesToPdf(canvases: HTMLCanvasElement[]): Promise<Blob> {
    const enc = new TextEncoder();
    const parts: (Uint8Array | string)[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (p: Uint8Array | string) => { parts.push(p); length += typeof p === "string" ? enc.encode(p).byteLength : p.byteLength; };
    const obj = (n: number, body: string | (Uint8Array | string)[]) => {
        offsets[n] = length;
        push(`${n} 0 obj\n`);
        if (typeof body === "string") push(body);
        else body.forEach(push);
        push("\nendobj\n");
    };

    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    const pageIds: number[] = [];
    let next = 3;
    for (const c of canvases) {
        const jpg = new Uint8Array(await (await encodeImage(c, "jpg", 0.92)).arrayBuffer());
        const w = c.width * 0.75, h = c.height * 0.75;
        const [img, content, page] = [next++, next++, next++];
        obj(img, [`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.byteLength} >>\nstream\n`, jpg, "\nendstream"]);
        const draw = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im0 Do Q`;
        obj(content, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
        obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`);
        pageIds.push(page);
    }
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${pageIds.map(p => `${p} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);

    const xref = length;
    const count = next;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n < count; n++) table += `${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`;
    push(`${table}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts.map(p => (typeof p === "string" ? enc.encode(p) : p) as BlobPart), { type: "application/pdf" });
}

// ─── PDF → images / text ───

let pdfjs: any = null;

async function loadPdfjs() {
    if (pdfjs) return pdfjs;
    const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.mjs")]);
    // pdf.js looks here first for a worker to run in the same page (no separate worker needed).
    (globalThis as any).pdfjsWorker = worker;
    pdfjs = lib;
    return lib;
}

/** The document, and a way to let go of it (pdf.js closes documents through the task that opened them). */
async function openPdf(file: Blob) {
    const lib = await loadPdfjs();
    const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
    const doc = await task.promise;
    return { doc, close: () => (task.destroy?.() ?? doc.destroy?.())?.catch?.(() => { }) };
}

const MAX_PAGES = 100;

/** Every page as a picture (2× scale, so text stays sharp). */
export async function pdfToImages(file: Blob, format: "png" | "jpg", onPage: (done: number, total: number) => void): Promise<Blob[]> {
    const { doc, close } = await openPdf(file);
    const total = Math.min(doc.numPages, MAX_PAGES);
    const out: Blob[] = [];
    try {
        for (let n = 1; n <= total; n++) {
            const page = await doc.getPage(n);
            const view = page.getViewport({ scale: 2 });
            const c = document.createElement("canvas");
            c.width = Math.ceil(view.width);
            c.height = Math.ceil(view.height);
            const x = c.getContext("2d")!;
            x.fillStyle = "#fff";
            x.fillRect(0, 0, c.width, c.height);
            // "print" draws it all in one go; "display" waits for screen frames, which stop while Discord is in the background.
            await page.render({ canvasContext: x, canvas: c, viewport: view, intent: "print" }).promise;
            out.push(await encodeImage(c, format, 0.9));
            page.cleanup();
            onPage(n, total);
        }
    } finally {
        await close();
    }
    return out;
}

/** The words in a PDF, page by page. */
export async function pdfToText(file: Blob): Promise<string> {
    const { doc, close } = await openPdf(file);
    const pages: string[] = [];
    try {
        for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES * 5); n++) {
            const page = await doc.getPage(n);
            const content = await page.getTextContent();
            let line = "", text = "";
            for (const item of content.items as any[]) {
                line += item.str;
                if (item.hasEOL) { text += line.trimEnd() + "\n"; line = ""; }
            }
            pages.push((text + line).trim());
            page.cleanup();
        }
    } finally {
        await close();
    }
    return pages.map((p, i) => `— Page ${i + 1} —\n${p}`).join("\n\n") + "\n";
}
