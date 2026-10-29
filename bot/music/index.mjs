/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setTimeout as sleep } from "node:timers/promises";
import { downloadVideo } from "./video.mjs";
import { VoiceMusic } from "./player.mjs";

const base = new URL(process.env.SONATA_WORKER_URL ?? ""), key = process.env.MUSIC_BRIDGE_SECRET;
if (base.protocol !== "https:" || base.username || base.password || !["/", "/bot-api", "/bot-api/"].includes(base.pathname) || base.search || base.hash || !base.hostname.endsWith(".workers.dev") || typeof key !== "string" || key.length < 32) throw new Error("Configure the Sonata Worker URL and private music bridge key first.");
const maximum = Number(process.env.MAX_MUSIC_SESSIONS ?? 1);
if (!Number.isInteger(maximum) || maximum < 1 || maximum > 3) throw new Error("Choose between one and three simultaneous music sessions.");
let running = true, generation = "", connected = false, epoch = 0;
const tails = new Map();
async function request(path, body) {
    const response = await fetch(new URL(`${base.pathname === "/" ? "" : "/bot-api"}/music/${path}`, base), { method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
        const batch = await request("poll");
        if (generation !== batch.generation) { reset(); generation = batch.generation; }
        if (!batch.ready) { if (connected) reset(); connected = false; await sleep(4000); continue; }
        connected = true;
        for (const event of batch.events) music.event(event.type, event.data);
        for (const job of batch.jobs) {
            const accepted = epoch, queueKey = job.kind === "video" ? "video" : job.guild;
            const next = (tails.get(queueKey) ?? Promise.resolve()).then(async () => {
                if (accepted !== epoch || Date.now() >= job.expires) return;
                let result;
                try { result = job.kind === "video" ? await downloadVideo(job.source) : await music.command(job); }
                catch (error) { result = { title: job.kind === "video" ? "Video not completed" : "Music not completed", description: error.message.slice(0, 1500) }; }
                if (accepted !== epoch) return;
                for (let attempt = 0; attempt < 2; attempt++) {
                    try { await request("result", { id: job.id, ...result, disconnected: !music.rooms.has(job.guild) }); break; }
                    catch { if (attempt === 0) await sleep(1000); }
                }
            });
            tails.set(queueKey, next);
            next.finally(() => { if (tails.get(queueKey) === next) tails.delete(queueKey); });
        }
    } catch { if (connected) { reset(); connected = false; } }
    if (running) await sleep(4000);
}
console.info("Sonata voice companion stopped.");
