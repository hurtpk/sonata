/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Main-process helpers shared by File Previewer, Image to Text and QR Codes:
// download files from Discord's own file servers (nothing else). Big previews
// (archives, PDFs) go through the on-disk preview cache in previewCache.ts.

import { IpcMainInvokeEvent } from "electron";
import { createWriteStream } from "fs";

const DISCORD_HOSTS = /^(cdn\.discordapp\.com|media\.discordapp\.net|cdn\.discord\.com|images-ext-\d+\.discordapp\.net)$/;

export function isDiscordFileUrl(url: string) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && DISCORD_HOSTS.test(u.hostname);
    } catch {
        return false;
    }
}

/** Download a Discord-hosted file, refusing anything bigger than maxBytes (checked while streaming). */
export async function downloadDiscordFile(url: string, maxBytes: number): Promise<Uint8Array> {
    if (!isDiscordFileUrl(url)) throw new Error("Only files hosted by Discord can be opened");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Discord returned ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (declared > maxBytes) throw new Error(`File is too big to preview (${Math.round(declared / 1048576)} MB)`);

    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            reader.cancel().catch(() => { });
            throw new Error("File is too big to preview");
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
    return out;
}

type Result<T> = { ok: true; data: T; } | { ok: false; error: string; };

/** Stream a Discord-hosted file straight to disk (big files are never held in memory). */
export async function downloadDiscordFileToDisk(url: string, path: string, maxBytes: number): Promise<number> {
    if (!isDiscordFileUrl(url)) throw new Error("Only files hosted by Discord can be opened");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Discord returned ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (declared > maxBytes) throw new Error(`Too big to preview (${Math.round(declared / 1048576)} MB)`);

    const out = createWriteStream(path);
    const reader = res.body!.getReader();
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                reader.cancel().catch(() => { });
                throw new Error("Too big to preview");
            }
            if (!out.write(value)) await new Promise(r => out.once("drain", r));
        }
    } finally {
        await new Promise<void>(r => out.end(r));
    }
    return total;
}

export async function fetchDiscordFile(_: IpcMainInvokeEvent, url: string, maxBytes: number): Promise<Result<Uint8Array>> {
    try {
        return { ok: true, data: await downloadDiscordFile(url, Math.min(maxBytes, 50 * 1048576)) };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}
