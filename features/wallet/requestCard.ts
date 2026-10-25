/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The picture sent with a money request: "Pay Sam $10", what it's for, a QR
// code for the main way to pay, and every other way listed underneath.

import { makeQr } from "../safety/qrCodes/qr";
import { Entry, kindOf, qrFor, tidy } from "./kinds";
import { money, payLink } from "./payRequests";

const W = 680;
const FONT = "\"gg sans\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif";

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

function fit(c: CanvasRenderingContext2D, text: string, max: number) {
    if (c.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 3 && c.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
}

export interface CardInput { cents: number; currency: string; note: string; name: string; qr: Entry | null; others: Entry[]; accent: string; }

export async function requestCardPng(o: CardInput): Promise<Blob> {
    const rows = o.others.length;
    const qrSize = o.qr ? 330 : 0;
    const H = 300 + (o.qr ? qrSize + 90 : 0) + (rows ? 40 + rows * 56 : 0) + 50;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext("2d")!;

    roundRect(c, 0, 0, W, H, 40);
    c.save();
    c.clip();
    c.fillStyle = "#17181c";
    c.fillRect(0, 0, W, H);

    // A soft wash of colour from the top.
    const glow = c.createRadialGradient(W * 0.2, 0, 20, W * 0.2, 0, W * 0.95);
    glow.addColorStop(0, `${o.accent}cc`);
    glow.addColorStop(1, `${o.accent}00`);
    c.fillStyle = glow;
    c.fillRect(0, 0, W, 360);

    c.textAlign = "center";
    c.fillStyle = "rgba(255,255,255,0.75)";
    c.font = `700 26px ${FONT}`;
    c.fillText(fit(c, o.name ? `Pay ${o.name}` : "Pay me", W - 80), W / 2, 74);
    c.fillStyle = "#ffffff";
    c.font = `800 96px ${FONT}`;
    c.fillText(fit(c, money(o.cents, o.currency), W - 60), W / 2, 178);
    if (o.note) {
        c.font = `600 32px ${FONT}`;
        c.fillStyle = "rgba(255,255,255,0.9)";
        c.fillText(fit(c, `for ${o.note}`, W - 80), W / 2, 236);
    }

    let y = 286;
    if (o.qr) {
        const k = kindOf(o.qr.kind);
        const pad = 22, box = qrSize + pad * 2, x = (W - box) / 2;
        roundRect(c, x, y, box, box, 28);
        c.fillStyle = "#ffffff";
        c.fill();
        const qr = makeQr(payLink(o.qr, o.cents, o.currency, o.note) ?? qrFor(o.qr));
        c.save();
        c.translate(x + pad, y + pad);
        c.scale(qrSize / qr.size, qrSize / qr.size);
        c.fillStyle = "#000000";
        c.fill(new Path2D(qr.path));
        c.restore();
        y += box + 42;
        c.fillStyle = "#ffffff";
        c.font = `700 26px ${FONT}`;
        c.fillText(fit(c, `Scan to pay with ${k.name}`, W - 80), W / 2, y);
        c.fillStyle = "rgba(255,255,255,0.6)";
        c.font = `500 22px ${FONT}`;
        c.fillText(fit(c, tidy(o.qr), W - 80), W / 2, y + 32);
        y += 60;
    }

    if (rows) {
        c.textAlign = "left";
        c.fillStyle = "rgba(255,255,255,0.5)";
        c.font = `700 18px ${FONT}`;
        c.fillText(o.qr ? "OR PAY WITH" : "PAY WITH", 48, y + 10);
        y += 30;
        for (const e of o.others) {
            const k = kindOf(e.kind);
            roundRect(c, 40, y, W - 80, 46, 14);
            c.fillStyle = "rgba(255,255,255,0.06)";
            c.fill();
            c.fillStyle = k.color;
            c.beginPath();
            c.arc(68, y + 23, 15, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = "#ffffff";
            c.font = `800 17px ${FONT}`;
            c.textAlign = "center";
            c.fillText(k.glyph, 68, y + 29);
            c.textAlign = "left";
            c.font = `700 20px ${FONT}`;
            c.fillText(k.name, 96, y + 30);
            c.fillStyle = "rgba(255,255,255,0.7)";
            c.font = `500 19px ${FONT}`;
            c.textAlign = "right";
            c.fillText(fit(c, tidy(e), W - 300), W - 60, y + 30);
            c.textAlign = "left";
            y += 56;
        }
    }
    c.restore();
    return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("render failed")), "image/png"));
}
