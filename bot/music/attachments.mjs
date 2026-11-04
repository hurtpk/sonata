/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const MUSIC_FILE_LIMIT = 20 * 1024 * 1024;
export function musicAttachment(file) {
    if (!file || typeof file.filename !== "string" || file.filename.length > 255 || /[\x00-\x1f]/.test(file.filename) || !/\.(mp3|wav|mov|mp4|ogg)$/i.test(file.filename)) throw new Error("Attach one MP3, WAV, MOV, MP4 or OGG file.");
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MUSIC_FILE_LIMIT) throw new Error("Music files must be no larger than 20 MiB.");
    let url;
    try { url = new URL(file.url); } catch { throw new Error("Use a file uploaded to this Discord command."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) || !/^\/attachments\/\d{17,20}\/\d{17,20}\/[^/]+$/.test(url.pathname)) throw new Error("Use a file uploaded to this Discord command.");
    return { filename: file.filename, size: file.size, url: url.href };
}

export function mediaInput(url, offset = 0, segmented = false) {
    const seek = offset > 0 ? ["-ss", String(offset)] : [];
    return ["-protocol_whitelist", "https,tls,tcp,crypto", "-rw_timeout", "15000000", ...(!segmented ? seek : []), "-i", url, ...(segmented ? seek : [])];
}
