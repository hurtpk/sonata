/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { adminAccess } from "./adminAccess.mjs";
import { failure } from "./auth.mjs";
import { validId } from "./protocol.mjs";

export async function ownerConsole(path, request, response, session, config, store, botFetch, body, json) {
    const action = path.slice("/api/admin/console/".length);
    if (!session.owner) throw failure(403, "Only the Sonata owner can use these tools.");
    if (!["GET", "POST"].includes(request.method)) throw failure(405, "Use GET or POST.");
    const input = request.method === "POST" ? await body(request) : Object.fromEntries(new URL(request.url, config.publicUrl).searchParams);
    if (action === "sessions") {
        await store.batch([
            ["INSERT OR IGNORE INTO session_details SELECT lower(hex(randomblob(16))),'admin',hash,user_id,expires-43200000,expires-43200000,'' FROM sessions WHERE expires>?", Date.now()],
            ["INSERT OR IGNORE INTO session_details SELECT lower(hex(randomblob(16))),'dashboard',hash,user_id,expires-43200000,expires-43200000,'' FROM bot_sessions WHERE expires>?", Date.now()],
        ]);
        if (request.method === "POST") {
            if (input.userId && !validId(input.userId)) throw failure(400, "Enter a Discord user ID.");
            if (!input.userId && (typeof input.id !== "string" || !/^[a-f0-9]{32,64}$/.test(input.id))) throw failure(400, "Choose a session or account.");
            if (input.userId) await store.batch([["DELETE FROM sessions WHERE user_id=?", input.userId], ["DELETE FROM bot_sessions WHERE user_id=?", input.userId], ["DELETE FROM session_details WHERE user_id=?", input.userId]]);
            else {
                const row = await store.get("SELECT * FROM session_details WHERE id=?", input.id);
                if (!row) throw failure(404, "This session has expired or was already revoked.");
                const table = row.kind === "admin" ? "sessions" : "bot_sessions";
                await store.batch([[`DELETE FROM ${table} WHERE hash=?`, row.hash], ["DELETE FROM session_details WHERE id=?", input.id]]);
            }
            await store.run("INSERT INTO audit (actor,target,action,at,reason) VALUES (?,?,?,?,?)", session.user_id, input.userId || input.id, "sessions_revoked", Date.now(), input.userId ? "All dashboard sessions for this account." : "One dashboard session.");
        }
        const sessions = await store.all("SELECT d.id,d.kind,d.user_id,d.created,d.last_seen,d.agent,s.username,s.expires FROM session_details d JOIN sessions s ON d.hash=s.hash AND d.kind='admin' WHERE s.expires>? UNION ALL SELECT d.id,d.kind,d.user_id,d.created,d.last_seen,d.agent,s.username,s.expires FROM session_details d JOIN bot_sessions s ON d.hash=s.hash AND d.kind='dashboard' WHERE s.expires>? ORDER BY last_seen DESC LIMIT 200", Date.now(), Date.now());
        json(response, 200, { sessions }); return;
    }
    if (action === "lookup") {
        if (request.method !== "GET" || !validId(input.id)) throw failure(400, "Enter a Discord user ID.");
        const user = await store.get("SELECT id,username,name,first_seen,last_seen,version,blocked,reason FROM users WHERE id=?", input.id), access = await adminAccess(config, store, input.id), devices = await store.get("SELECT COUNT(*) AS n FROM devices WHERE user_id=? AND expires>?", input.id, Date.now());
        const bot = botFetch ? await botFetch("owner/lookup?" + new URLSearchParams(input), session.user_id) : { access: [], more: false };
        json(response, 200, { id: input.id, activation: user ?? null, admin: access, devices: devices.n, ...bot }); return;
    }
    if (!["messages", "userblocks", "operations", "resources", "history", "check", "notes"].includes(action)) throw failure(404, "Owner tool not found.");
    if (!botFetch) throw failure(503, "The bot dashboard connection is not configured.");
    json(response, 200, await botFetch(`owner/${action}${request.method === "GET" ? "?" + new URLSearchParams(input) : ""}`, session.user_id, request.method === "POST" ? input : undefined));
}
