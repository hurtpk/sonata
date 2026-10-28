/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createApplication as application } from "./application.mjs";
import { openStore, validId } from "./store.mjs";

const DAY = 86400_000;
const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
export const createApplication = (config, store, discordFetch) => application(config, store, discordFetch, name => readFile(resolve(publicPath, name)));

export function readConfig(demo = false) {
    if (demo) { if (process.env.NODE_ENV === "production") throw new Error("Demo mode is only available locally."); return { publicUrl: "http://127.0.0.1:4173", clientId: "", clientSecret: "", adminIds: ["111111111111111111"], host: "127.0.0.1", port: 4173, database: ":memory:", demo: true }; }
    const publicUrl = String(process.env.PUBLIC_URL ?? "").replace(/\/$/, ""), url = new URL(publicUrl);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) || url.origin !== publicUrl) throw new Error("PUBLIC_URL must be an HTTPS origin, or localhost for development.");
    const adminIds = (process.env.ADMIN_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
    if (!adminIds.length || adminIds.some(id => !validId(id)) || !validId(process.env.DISCORD_CLIENT_ID) || !process.env.DISCORD_CLIENT_SECRET) throw new Error("Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and ADMIN_USER_IDS in .env.");
    return { publicUrl, clientId: process.env.DISCORD_CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET, adminIds, host: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 4173), database: process.env.DATABASE_PATH ?? "./data/sonata.sqlite" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const config = readConfig(process.argv.includes("--demo")), store = openStore(config.database);
    if (config.demo) for (let i = 1; i <= 12; i++) store.run("INSERT INTO users (id,username,name,first_seen,last_seen,version,blocked,blocked_at,reason) VALUES (?,?,?,?,?,?,?,?,?)", String(222222222222222220n + BigInt(i)), `demo_user_${i}`, ["Mira", "Rowan", "Jules", "Avery"][i % 4], Date.now() - i * DAY, Date.now() - i * 70_000, "2026.10.27c", i === 4 ? 1 : 0, i === 4 ? Date.now() : null, i === 4 ? "Demo access restriction" : "");
    const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, createApplication(config, store));
    server.listen(config.port, config.host, () => process.stdout.write(`Sonata Control Room: ${config.publicUrl}${config.demo ? "/demo (sample data only)" : "/admin"}\n`));
    const close = () => server.close(() => { store.db.close(); process.exit(0); });
    process.once("SIGINT", close); process.once("SIGTERM", close);
}
