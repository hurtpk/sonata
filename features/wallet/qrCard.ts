/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A QR code dressed up for sharing: the coin's (or app's) colour and logo on
// top, "Pay <your name>", the code, and the address written underneath.

import { makeQr } from "../qrCodes/qr";
import { Entry, kindOf, networkName, qrFor, tidy } from "./kinds";

const W = 640, H = 840, R = 36;
const FONT = "\"gg sans\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif";
const MONO = "Consolas, \"Courier New\", monospace";

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

/** Darker or lighter version of a hex colour. */
function shade(hex: string, by: number) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + by * 255)));
    return `rgb(${f(n >> 16 & 255)}, ${f(n >> 8 & 255)}, ${f(n & 255)})`;
}

/** Shortens text to fit a width, keeping both ends (addresses are checked by their start and end). */
function fit(c: CanvasRenderingContext2D, text: string, max: number) {
    if (c.measureText(text).width <= max) return text;
    for (let keep = Math.floor(text.length / 2); keep > 4; keep--) {
        const t = `${text.slice(0, keep)}…${text.slice(-keep)}`;
        if (c.measureText(t).width <= max) return t;
    }
    return text.slice(0, 8) + "…";
}

export async function qrCardPng(e: Entry, name: string): Promise<Blob> {
    const k = kindOf(e.kind);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext("2d")!;

    // The card, with rounded corners.
    roundRect(c, 0, 0, W, H, R);
    c.save();
    c.clip();
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H);

    // A band in the brand's colour.
    const band = c.createLinearGradient(0, 0, W, 170);
    band.addColorStop(0, k.color);
    band.addColorStop(1, shade(k.color, -0.18));
    c.fillStyle = band;
    c.fillRect(0, 0, W, 170);

    // Its logo in a white circle.
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(92, 85, 46, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = k.color;
    c.font = `800 48px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(k.glyph, 92, 88);

    // "Pay Sam" and what it is.
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    c.fillStyle = "#ffffff";
    c.font = `700 38px ${FONT}`;
    c.fillText(fit(c, name ? `Pay ${name}` : `My ${k.name}`, W - 180), 160, 78);
    const net = networkName(e);
    c.font = `500 23px ${FONT}`;
    c.fillStyle = "rgba(255, 255, 255, 0.85)";
    c.fillText(fit(c, `${k.name}${net ? ` · ${net}` : ""}${e.label ? ` — ${e.label}` : ""}`, W - 180), 160, 116);

    // The code itself.
    const qr = makeQr(qrFor(e));
    const size = 470, x0 = (W - size) / 2, y0 = 205;
    c.save();
    c.translate(x0, y0);
    c.scale(size / qr.size, size / qr.size);
    c.fillStyle = "#000000";
    c.fill(new Path2D(qr.path));
    c.restore();

    // The address (or name) written out, and a hint.
    c.textAlign = "center";
    c.fillStyle = "#23272a";
    c.font = `600 25px ${MONO}`;
    c.fillText(fit(c, tidy(e), W - 80), W / 2, 735);
    c.fillStyle = "#80848e";
    c.font = `500 20px ${FONT}`;
    c.fillText(k.crypto ? `Scan with a wallet app to send ${k.name}${net ? ` on ${net}` : ""}` : e.kind === "roblox" ? "Scan to open" : `Scan to pay with ${k.name}`, W / 2, 780);
    c.restore();

    return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("render failed")), "image/png"));
}
