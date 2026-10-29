/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile } from "node:fs/promises";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { d1Store } from "../store.mjs";

export async function testStore() {
    const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "test", modules: true, script: "export default {fetch() {return new Response('Test');}}", compatibilityDate: "2026-10-28", d1Databases: ["DB"] }] }));
    try {
        const database = await runtime.getD1Database("DB");
        const schema = await readFile(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8") + await readFile(new URL("../../migrations/0002_bot_dashboard.sql", import.meta.url), "utf8") + await readFile(new URL("../../migrations/0003_user_profiles.sql", import.meta.url), "utf8") + await readFile(new URL("../../migrations/0004_admin_grants.sql", import.meta.url), "utf8");
        for (const sql of schema.split(";").map(sql => sql.trim()).filter(Boolean)) await database.prepare(sql).run();
        return { ...d1Store(database), db: { close: () => runtime.dispose() } };
    } catch (error) { await runtime.dispose(); throw error; }
}
