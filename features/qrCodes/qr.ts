/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import jsQR from "./vendor/jsQR";
import qrcode from "./vendor/qrcode";

// UTF-8 so emoji and non-English text encode correctly (the library's
// default only handles plain ASCII). The browser's encoder is exact.
const utf8 = new TextEncoder();
qrcode.stringToBytes = (s: string) => Array.from(utf8.encode(s));

export interface QrMatrix { size: number; path: string; }

/** A QR code as an SVG path (1 unit per module, 4-module quiet zone included in size). */
export function makeQr(text: string): QrMatrix {
    const qr = qrcode(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let path = "";
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
        }
    }
    return { size: n + quiet * 2, path };
}

/** Decode a QR code from raw RGBA pixels. */
export function readQrPixels(data: Uint8ClampedArray, width: number, height: number): string | null {
    return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** Decode a QR code in an image file (scaled down first if it's huge). */
export async function readQrImage(bytes: Uint8Array): Promise<string | null> {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return readQrPixels(ctx.getImageData(0, 0, w, h).data, w, h);
}

export interface LinkCheck { url: URL; host: string; warnings: string[]; }

/** If the text is a web link, describe where it really goes and anything suspicious. */
export function checkLink(text: string): LinkCheck | null {
    if (!/^https?:\/\//i.test(text.trim())) return null;
    let url: URL;
    try { url = new URL(text.trim()); } catch { return null; }
    const warnings: string[] = [];
    if (url.protocol === "http:") warnings.push("Not secure (http, not https).");
    if (url.username || url.password) warnings.push(`Disguised link: everything before "@" is ignored — it really goes to ${url.hostname}.`);
    if (url.hostname.split(".").some(part => part.startsWith("xn--"))) warnings.push("The address uses look-alike international characters.");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith("[")) warnings.push("Goes to a bare IP address instead of a named website.");
    return { url, host: url.hostname, warnings };
}

/** Render the QR to a PNG blob (for copying / saving). */
export async function qrPng(text: string, px = 768): Promise<Blob> {
    const { size, path } = makeQr(text);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, px, px);
    ctx.scale(px / size, px / size);
    ctx.fillStyle = "#000";
    ctx.fill(new Path2D(path));
    return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("render failed")), "image/png"));
}
