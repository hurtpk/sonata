/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { failure } from "./auth.mjs";
import { validId } from "./protocol.mjs";

export const ADMIN_SCOPES = ["users", "access", "servers", "serverAccess", "health"];
export async function recordStaffActivity(store, actor, area, action = "", target = "") {
    const now = Date.now(), kind = action ? "action" : "visit";
    try {
        await store.run("INSERT INTO staff_activity (actor,area,kind,action,target,at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM admin_grants WHERE id=?) AND (?='action' OR NOT EXISTS (SELECT 1 FROM staff_activity WHERE actor=? AND kind='visit' AND area=? AND at>?))", actor, area, kind, action, target, now, actor, kind, actor, area, now - 60_000);
    } catch {
        console.error("Could not record Sonata staff activity.");
    }
}
export async function adminAccess(config, store, id) {
    if (config.adminIds.includes(id)) return { owner: true, permissions: ADMIN_SCOPES };
    const grant = await store.get("SELECT permissions FROM admin_grants WHERE id=?", id);
    return grant ? { owner: false, permissions: JSON.parse(grant.permissions) } : null;
}
export async function adminTools(path, request, response, session, config, store, botFetch, input, json) {
    if (path === "/api/admin/staff") {
        if (!session.owner) throw failure(403, "Only the Sonata owner can manage administrators.");
        if (request.method === "GET") {
            const selected = new URL(request.url, config.publicUrl).searchParams.get("activity");
            if (selected !== null) {
                if (!validId(selected) || !await store.get("SELECT id FROM admin_grants WHERE id=?", selected)) throw failure(404, "Choose a current administrator.");
                const [visits, actions] = await Promise.all([
                    store.all("SELECT area,at FROM staff_activity WHERE actor=? AND kind='visit' ORDER BY at DESC,id DESC LIMIT 25", selected),
                    store.all("SELECT area,action,target,at FROM (SELECT area,action,target,at FROM staff_activity WHERE actor=? AND kind='action' UNION ALL SELECT 'admin',action,target,at FROM audit WHERE actor=?) ORDER BY at DESC LIMIT 25", selected, selected),
                ]);
                json(response, 200, { visits, actions }); return true;
            }
            const grants = await store.all("SELECT g.*,u.username,u.name,p.avatar,p.discriminator,(SELECT MAX(at) FROM staff_activity WHERE actor=g.id AND kind='visit' AND area='dashboard') AS lastDashboard,(SELECT MAX(at) FROM staff_activity WHERE actor=g.id AND kind='visit' AND area='admin') AS lastAdmin,((SELECT COUNT(*) FROM staff_activity WHERE actor=g.id AND kind='action')+(SELECT COUNT(*) FROM audit WHERE actor=g.id)) AS totalActions FROM admin_grants g LEFT JOIN users u ON u.id=g.id LEFT JOIN user_profiles p ON p.id=g.id ORDER BY g.at DESC");
            if (botFetch) {
                const byId = new Map(grants.map(grant => [grant.id, grant]));
                for (let index = 0; index < grants.length; index += 20) {
                    try {
                        const { users } = await botFetch("owner/users?profile=1&ids=" + grants.slice(index, index + 20).map(grant => grant.id).join(","), session.user_id, undefined, session.permissions);
                        for (const profile of users ?? []) {
                            const grant = byId.get(profile.id);
                            if (grant) Object.assign(grant, { name: profile.name ?? grant.name, username: profile.username ?? grant.username, avatar: profile.avatar ?? grant.avatar, discriminator: profile.discriminator ?? grant.discriminator });
                        }
                    } catch { break; }
                }
            }
            json(response, 200, { grants, scopes: ADMIN_SCOPES }); return true;
        }
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
