/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { failure } from "./auth.mjs";
import { validId } from "./protocol.mjs";

export const ADMIN_SCOPES = ["users", "access", "servers", "serverAccess", "health"];
export async function adminAccess(config, store, id) {
    if (config.adminIds.includes(id)) return { owner: true, permissions: ADMIN_SCOPES };
    const grant = await store.get("SELECT permissions FROM admin_grants WHERE id=?", id);
    return grant ? { owner: false, permissions: JSON.parse(grant.permissions) } : null;
}
export async function adminTools(path, request, response, session, config, store, botFetch, input, json) {
    if (path === "/api/admin/staff") {
        if (!session.owner) throw failure(403, "Only the Sonata owner can manage administrators.");
        if (request.method === "GET") { json(response, 200, { grants: await store.all("SELECT * FROM admin_grants ORDER BY at DESC"), scopes: ADMIN_SCOPES }); return true; }
        if (request.method !== "POST") throw failure(405, "Use GET or POST.");
        const value = await input(request);
        if (!validId(value.id) || config.adminIds.includes(value.id) || !Array.isArray(value.permissions) || !value.permissions.every(scope => ADMIN_SCOPES.includes(scope))) throw failure(400, "Choose a Discord ID and available permissions. Owner access stays in the private configuration.");
        const scopes = [...new Set(value.permissions)];
        if (scopes.includes("access") && !scopes.includes("users")) scopes.push("users");
        if (scopes.includes("serverAccess") && !scopes.includes("servers")) scopes.push("servers");
        if (scopes.length) await store.run("INSERT INTO admin_grants VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET permissions=excluded.permissions,actor=excluded.actor,at=excluded.at", value.id, JSON.stringify(scopes), session.user_id, Date.now());
        else { await store.run("DELETE FROM admin_grants WHERE id=?", value.id); await store.run("DELETE FROM sessions WHERE user_id=?", value.id); }
        await store.run("INSERT INTO audit (actor,target,action,at,reason) VALUES (?,?,?,?,?)", session.user_id, value.id, scopes.length ? "admin_granted" : "admin_revoked", Date.now(), scopes.join(", "));
        json(response, 200, { ok: true }); return true;
    }
    if (path === "/api/admin/health" && request.method === "GET") {
        const started = Date.now(), count = await store.get("SELECT COUNT(*) AS n FROM users"), databaseMs = Date.now() - started;
        let bot = null, botError = "";
        try { if (botFetch) bot = await botFetch("owner/health", session.user_id, undefined, session.permissions); else botError = "Bot connection is not configured."; } catch (error) { botError = error.message; }
        json(response, 200, { checkedAt: Date.now(), version: config.version || "local", database: { online: true, responseMs: databaseMs, accounts: count.n }, bot, botError }); return true;
    }
    return false;
}
