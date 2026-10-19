/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Shared by Sonata's media features (QR Codes, Image to Text, File Previewer).

type Result<T> = { ok: true; data: T; } | { ok: false; error: string; };

/** The main-process functions the media features call (see filePreviewer/native.ts, imageToText/native.ts). */
interface MediaNativeApi {
    fetchDiscordFile(url: string, maxBytes: number): Promise<Result<Uint8Array>>;
    openPdfWindow(url: string, title: string): Promise<Result<null>>;
    recognizeText(url: string): Promise<{ ok: true; text: string; } | { ok: false; error: string; }>;
    openArchive(url: string, filename: string): Promise<{ ok: true; id: string; listing: string; } | { ok: false; error: string; }>;
    extractFromArchive(id: string, entry: string): Promise<Result<Uint8Array>>;
    clearPreviewCache(): Promise<void>;
}

export const MediaNative = VencordNative?.pluginHelpers?.Sonata as unknown as MediaNativeApi | undefined;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

export function looksLikeImage(url: string | undefined | null): url is string {
    if (!url) return false;
    try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) return false;
        return IMAGE_EXT.test(u.pathname) || u.searchParams.get("format") === "webp" || /^images-ext-\d+\.discordapp\.net$/.test(u.hostname);
    } catch {
        return false;
    }
}

/** The image a right-click menu was opened on, if any (message menu or image viewer menu). */
export function imageFromMenu(props: any): string | null {
    const candidates = [props?.src, props?.itemSrc, props?.itemHref, props?.mediaItem?.url, props?.mediaItem?.proxyUrl];
    return candidates.find(looksLikeImage) ?? null;
}

/** A plain link the message menu was opened on (not an image). */
export function linkFromMenu(props: any): string | null {
    const href = props?.itemHref;
    return href && /^https?:\/\//i.test(href) && !looksLikeImage(href) ? href : null;
}

/** File bytes: through Sonata's native helper on desktop, plain fetch otherwise. */
export async function getBytes(url: string, maxBytes: number): Promise<Uint8Array> {
    if (MediaNative) {
        const r = await MediaNative.fetchDiscordFile(url, maxBytes);
        if (!r.ok) throw new Error(r.error);
        return r.data;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't download it (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error("File is too big to preview");
    return buf;
}

export function messageLink(m: { id: string; channel_id: string; }, guildId: string | null | undefined) {
    return `https://discord.com/channels/${guildId ?? "@me"}/${m.channel_id}/${m.id}`;
}
