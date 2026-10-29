/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { videoSource } from "./videoSource.mjs";

const run = promisify(execFile), maximum = 8 * 1024 * 1024;
export function videoCdn(raw) {
    const url = new URL(raw), suffixes = ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "cdninstagram.com", "fbcdn.net", "twimg.com", "googlevideo.com"];
    if (url.protocol !== "https:" || url.username || url.password || url.port || !suffixes.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("The provider did not supply a supported video stream.");
    return url.href;
}
export async function downloadVideo(raw, transport = fetch, execute = run) {
    const source = videoSource(raw);
    let info;
    try {
        const result = await execute("yt-dlp", ["--ignore-config", "--no-playlist", "--no-warnings", "--skip-download", "--dump-single-json", "--socket-timeout", "8", "--retries", "0", "--js-runtimes", "node", "--format", "b[ext=mp4][height<=720][filesize<8M]/b[ext=mp4][height<=480]", "--", source], { timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true });
        info = JSON.parse(result.stdout);
    } catch { throw new Error("This provider could not supply the video. It may be private, unavailable or restricted on the host."); }
    if (info.is_live || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 180 || info.filesize > maximum || info.ext !== "mp4") throw new Error("Choose a recorded MP4 video up to three minutes and 8 MB.");
    let url = videoCdn(info.url), response;
    for (let i = 0; i < 4; i++) {
        response = await transport(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel(); url = videoCdn(new URL(response.headers.get("location"), url).href);
    }
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maximum) throw new Error("That video is unavailable or exceeds the 8 MB limit.");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > maximum) throw new Error("That video exceeds the 8 MB limit."); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 12 || bytes.subarray(4, 8).toString() !== "ftyp") throw new Error("The provider did not return a playable MP4 video.");
    return { title: String(info.title || "Video").replace(/[\r\n]/g, " ").slice(0, 200), description: "Video ready.", video: bytes.toString("base64") };
}
