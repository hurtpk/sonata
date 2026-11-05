/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setTimeout as sleep } from "node:timers/promises";
import { downloadVideo } from "./video.mjs";
import { VoiceMusic } from "./player.mjs";
import { renderImage } from "./imageRender.mjs";

const base = new URL(process.env.SONATA_WORKER_URL ?? ""), key = process.env.MUSIC_BRIDGE_SECRET;
if (base.protocol !== "https:" || base.username || base.password || !["/", "/bot-api", "/bot-api/"].includes(base.pathname) || base.search || base.hash || !base.hostname.endsWith(".workers.dev") || typeof key !== "string" || key.length < 32) throw new Error("Configure the Sonata Worker URL and private music bridge key first.");
const maximum = Number(process.env.MAX_MUSIC_SESSIONS ?? 1);
if (!Number.isInteger(maximum) || maximum < 1 || maximum > 3) throw new Error("Choose between one and three simultaneous music sessions.");
let running = true, generation = "", connected = false, epoch = 0;
const tails = new Map();
async function request(path, body, media) {
    const response = await fetch(new URL(`${base.pathname === "/" ? "" : "/bot-api"}/music/${path}`, base), { method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(media ? 120_000 : path.startsWith("poll") ? 25_000 : 10_000), headers: { Authorization: `Bearer ${key}`, "Content-Type": media ? body.format === "png" ? "image/png" : body.format === "gif" ? "image/gif" : "video/mp4" : "application/json", ...(media ? { "X-Sonata-Video": Buffer.from(JSON.stringify(body)).toString("base64") } : {}) }, body: media || (body ? JSON.stringify(body) : undefined) });
    if (!response.ok) throw new Error("The music bridge could not be reached.");
    return response.json();
}
const music = new VoiceMusic(payload => request("voice", payload), maximum);
function reset() { epoch++; music.closeAll(); tails.clear(); }
function shutdown() { running = false; reset(); }
process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
console.info("Sonata voice companion started.");
while (running) {
    try {
        const batch = await request("poll?wait=1");
        if (generation !== batch.generation) { reset(); generation = batch.generation; }
        if (!batch.ready) { if (connected) reset(); connected = false; await sleep(4000); continue; }
        connected = true;
        for (const event of batch.events) music.event(event.type, event.data);
        for (const job of batch.jobs) {
            const accepted = epoch, queueKey = ["video", "caption"].includes(job.kind) ? "media" : job.guild;
            const next = (tails.get(queueKey) ?? Promise.resolve()).then(async () => {
                if (accepted !== epoch || Date.now() >= job.expires) return;
                let result;
                try { result = job.kind === "caption" ? await renderImage(job.source, job.style) : job.kind === "video" ? await downloadVideo(job.source, fetch, undefined, job.limit, job.mode) : await music.command(job); }
                catch (error) { result = { title: job.kind === "caption" ? "Image not completed" : job.kind === "video" ? "Video not completed" : "Music not completed", description: error.message.slice(0, 1500) }; }
                if (accepted !== epoch) return;
                for (let attempt = 0; attempt < 2; attempt++) {
                    try { const { video, image, ...metadata } = result, media = video || image; await request(media ? "video" : "result", { id: job.id, ...metadata, disconnected: !music.rooms.has(job.guild) }, media); break; }
                    catch { if (attempt === 0) await sleep(1000); }
                }
            });
            tails.set(queueKey, next);
            next.finally(() => { if (tails.get(queueKey) === next) tails.delete(queueKey); });
        }
    } catch { if (connected) { reset(); connected = false; } if (running) await sleep(4000); }
}
console.info("Sonata voice companion stopped.");
