/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { adminAccess, adminTools } from "./adminAccess.mjs";
import { Buffer } from "node:buffer";

import { createAuth, failure } from "./auth.mjs";
import { hash, random, validId, validToken } from "./protocol.mjs";

const DAY = 86400_000;
const files = { "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"], "/": ["bot.html", "text/html"], "/admin": ["index.html", "text/html"], "/activate": ["index.html", "text/html"], "/bot": ["bot.html", "text/html"], "/bot.js": ["bot.js", "text/javascript"], "/bot.css": ["bot.css", "text/css"], "/owner-bot.js": ["owner-bot.js", "text/javascript"], "/admin-tools.js": ["admin-tools.js", "text/javascript"], "/dashboard-extras.js": ["dashboard-extras.js", "text/javascript"] };
const versionValid = value => typeof value === "string" && /^[\w.+-]{1,40}$/.test(value);

async function body(request) {
    if (!String(request.headers["content-type"]).startsWith("application/json")) throw failure(415, "Send a JSON request.");
    const chunks = [];
    let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 16_384) throw failure(413, "This request is too large."); chunks.push(chunk); }
    const text = Buffer.concat(chunks).toString("utf8");
    try { const value = JSON.parse(text); if (value && typeof value === "object" && !Array.isArray(value)) return value; }
    catch { throw failure(400, "This request contains invalid JSON."); }
    throw failure(400, "Send a JSON object.");
}

export function createApplication(config, store, discordFetch, readAsset, botFetch) {
    const auth = createAuth(config, store, discordFetch);
    const rates = new Map();
    let lastCleanup = 0;
    const json = (response, status, data) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(data)); };
    const redirect = (response, location) => { response.writeHead(302, { Location: location }); response.end(); };
    const requireAdmin = async (request, write = false) => {
        const session = await auth.session(request);
        if (!session) throw failure(401, "Sign in with your administrator Discord account.");
        if (write && (request.headers.origin !== config.publicUrl || request.headers["x-csrf-token"] !== session.csrf)) throw failure(403, "Refresh this page before making changes.");
        return session;
    };
    const device = async request => {
        const bearer = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? "")?.[1];
        const found = bearer && await store.get("SELECT users.*,devices.hash AS device_hash FROM devices JOIN users ON users.id=devices.user_id WHERE devices.hash=? AND devices.expires>?", hash(bearer), Date.now());
        if (!found) throw failure(401, "Activate this Discord account in Sonata again.");
        return found;
    };
    const rate = (request, kind, limit) => {
        const key = `${kind}:${request.socket.remoteAddress}`;
        const now = Date.now(), old = rates.get(key), entry = old && old.until > now ? old : { until: now + 60_000, count: 0 };
        entry.count++;
        rates.set(key, entry);
        if (entry.count > limit) throw failure(429, "Too many requests. Please wait a minute.");
    };
    return async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
        try {
            const url = new URL(request.url, config.publicUrl), path = url.pathname;
            if (request.headers.host !== new URL(config.publicUrl).host) throw failure(403, "Use the configured Sonata service address.");
            if (request.headers.origin && request.headers.origin !== config.publicUrl) throw failure(403, "This request came from another website.");
            if (Date.now() - lastCleanup > 60_000) { if (!config.scheduledCleanup) await store.cleanup(); lastCleanup = Date.now(); for (const [key, entry] of rates) if (entry.until < Date.now()) rates.delete(key); }
            if (request.method === "GET" && path === "/admin" && !await auth.session(request)) {
                const session = await auth.botSession(request);
                redirect(response, session && await adminAccess(config, store, session.user_id) ? "/auth/start" : "/"); return;
            }
            if (request.method === "GET" && path in files) { const [name, type] = files[path]; response.setHeader("Content-Type", `${type}; charset=utf-8`); response.end(await readAsset(name)); return; }
            if (request.method === "GET" && path === "/api/info") { json(response, 200, { demo: !!config.demo, configured: !!(config.clientId && config.clientSecret && config.adminIds.length) }); return; }
            if (request.method === "GET" && path === "/demo" && config.demo) {
                const token = random();
                await store.run("INSERT INTO sessions VALUES (?,?,?,?,?)", hash(token), config.adminIds[0], "Demo owner", random(), Date.now() + DAY);
                response.setHeader("Set-Cookie", auth.cookie("sonata_admin", token, 86400)); redirect(response, "/admin"); return;
            }
            if (request.method === "GET" && path === "/auth/start") { rate(request, "oauth", 20); redirect(response, await auth.login(url.searchParams.get("activation"), response, url.searchParams.get("bot") === "1")); return; }
            if (request.method === "GET" && path === "/auth/callback") { rate(request, "oauth", 20); redirect(response, await auth.finish(request, response, url)); return; }
            if (request.method === "POST" && path === "/api/activation/start") {
                rate(request, "start", 20);
                const input = await body(request);
                if (!validId(input.userId) || !validToken(input.challenge) || !versionValid(input.version)) throw failure(400, "The activation details are invalid.");
                const id = random();
                await store.run("INSERT INTO pairings (id,user_id,challenge,version,expires) VALUES (?,?,?,?,?)", id, input.userId, input.challenge, input.version, Date.now() + 600_000);
                json(response, 200, { id }); return;
            }
            if (request.method === "POST" && path === "/api/activation/finish") {
                rate(request, "finish", 120);
                const input = await body(request);
                if (!validToken(input.id) || !validToken(input.verifier)) throw failure(400, "The activation details are invalid.");
                const pairing = await store.get("SELECT * FROM pairings WHERE id=? AND challenge=? AND expires>?", input.id, hash(input.verifier), Date.now());
                if (!pairing) throw failure(400, "This activation expired. Start again in Sonata.");
                if (!pairing.approved) { json(response, 200, { status: "waiting" }); return; }
                const user = await store.get("SELECT * FROM users WHERE id=?", pairing.user_id);
                if (user.blocked) { json(response, 200, { status: "blocked" }); return; }
                const token = random(), now = Date.now();
                const tokenHash = hash(token);
                const issued = await store.batch([
                    ["INSERT INTO devices (hash,user_id,expires) SELECT ?,pairings.user_id,? FROM pairings JOIN users ON users.id=pairings.user_id WHERE pairings.id=? AND pairings.challenge=? AND pairings.approved=1 AND pairings.expires>? AND users.blocked=0", tokenHash, now + 180 * DAY, pairing.id, hash(input.verifier), now],
                    ["UPDATE users SET first_seen=COALESCE(first_seen,?),last_seen=?,version=? WHERE id=? AND EXISTS (SELECT 1 FROM devices WHERE hash=?)", now, now, pairing.version, user.id, tokenHash],
                    ["DELETE FROM pairings WHERE id=? AND EXISTS (SELECT 1 FROM devices WHERE hash=?)", pairing.id, tokenHash],
                ]);
                if (!issued[0].changes) {
                    const latest = await store.get("SELECT blocked FROM users WHERE id=?", user.id);
                    if (latest?.blocked) { json(response, 200, { status: "blocked" }); return; }
                    throw failure(400, "This activation expired or was already used. Start again in Sonata.");
                }
                json(response, 200, { status: "allowed", token, userId: user.id, admin: config.adminIds.includes(user.id) }); return;
            }
            if (request.method === "POST" && path === "/api/check-in") {
                rate(request, "check", 300);
                const user = await device(request), input = await body(request);
                if (input.userId !== user.id || !versionValid(input.version)) throw failure(403, "This activation belongs to a different Discord account.");
                if (user.blocked) { json(response, 200, { status: "blocked", userId: user.id, admin: false }); return; }
                await store.run("UPDATE users SET last_seen=?,version=? WHERE id=?", Date.now(), input.version, user.id);
                json(response, 200, { status: "allowed", userId: user.id, admin: config.adminIds.includes(user.id) }); return;
            }
            if (request.method === "POST" && path === "/api/disconnect") { const user = await device(request); await store.run("DELETE FROM devices WHERE hash=?", user.device_hash); json(response, 200, { ok: true }); return; }
            if (path.startsWith("/api/bot/")) {
                const session = await auth.botSession(request) || await auth.session(request);
                if (!session) throw failure(401, "Sign in with Discord to manage a server.");
                if (request.method !== "GET" && (request.headers.origin !== config.publicUrl || request.headers["x-csrf-token"] !== session.csrf)) throw failure(403, "Refresh this page before making changes.");
                if (path === "/api/bot/session" && request.method === "GET") { json(response, 200, { id: session.user_id, username: session.username, csrf: session.csrf, owner: !!await adminAccess(config, store, session.user_id), connected: !!botFetch }); return; }
                if (path === "/api/bot/logout" && request.method === "POST") { await auth.logout(request, response); json(response, 200, { ok: true }); return; }
                if (!botFetch) throw failure(503, "The bot dashboard connection is not configured yet.");
                rate(request, "bot", 120);
                const action = path.slice(9);
                if (!((request.method === "GET" && ["servers", "server", "forms", "access"].includes(action)) || (request.method === "POST" && ["action", "access", "designer"].includes(action)))) throw failure(404, "This bot dashboard action was not found.");
                json(response, 200, await botFetch(action + url.search, session.user_id, request.method === "POST" ? await body(request) : undefined)); return;
            }
            if (path.startsWith("/api/admin/")) {
                const session = await requireAdmin(request, request.method !== "GET");
                const required = path === "/api/admin/health" ? "health" : path === "/api/admin/bot/action" ? "serverAccess" : path.startsWith("/api/admin/bot") ? "servers" : path === "/api/admin/block" ? "access" : ["/api/admin/users", "/api/admin/avatars", "/api/admin/audit"].includes(path) ? "users" : null;
                if (required && !session.permissions.includes(required)) throw failure(403, "Your Sonata administrator account does not have access to this tool.");
                if (await adminTools(path, request, response, session, config, store, botFetch, body, json)) return;
                if (path === "/api/admin/bot/action" && request.method === "POST") { if (!botFetch) throw failure(503, "The bot dashboard connection is not configured yet."); rate(request, "bot-owner-action", 20); json(response, 200, await botFetch("owner/action", session.user_id, await body(request), session.permissions)); return; }
                if (request.method === "GET" && ["/api/admin/bot", "/api/admin/bot/server"].includes(path)) { if (!botFetch) throw failure(503, "The bot dashboard connection is not configured yet."); rate(request, "bot-owner", 120); json(response, 200, await botFetch(path === "/api/admin/bot" ? "owner" : "owner/server" + url.search, session.user_id, undefined, session.permissions)); return; }
                if (request.method === "GET" && path === "/api/admin/session") { json(response, 200, { id: session.user_id, username: session.username, csrf: session.csrf, owner: session.owner, permissions: session.permissions }); return; }
                if (request.method === "POST" && path === "/api/admin/logout") { await auth.logout(request, response); json(response, 200, { ok: true }); return; }
                if (request.method === "GET" && path === "/api/admin/avatars") {
                    const ids = [...new Set((url.searchParams.get("ids") || "").split(","))];
                    if (!ids.length || ids.length > 20 || !ids.every(validId)) throw failure(400, "Choose up to 20 valid Discord user IDs.");
                    const users = await store.all(`SELECT users.id,user_profiles.avatar,user_profiles.discriminator,user_profiles.updated FROM users LEFT JOIN user_profiles ON users.id=user_profiles.id WHERE users.id IN (${ids.map(() => "?").join(",")})`, ...ids);
                    const stale = users.filter(user => !user.updated || user.updated < Date.now() - DAY).map(user => user.id);
                    if (stale.length && botFetch) {
                        rate(request, "avatars", 60);
                        let profiles;
                        try { profiles = (await botFetch(`owner/users?ids=${stale.join(",")}`, session.user_id, undefined, session.permissions)).users; } catch { profiles = []; }
                        for (const profile of profiles) {
                            const user = users.find(value => value.id === profile.id);
                            if (!user) continue;
                            const avatar = /^(?:a_)?[a-f0-9]{32}$/i.test(profile.avatar ?? "") ? profile.avatar : "", discriminator = /^\d{1,4}$/.test(profile.discriminator ?? "") ? profile.discriminator : "0", updated = Date.now();
                            await store.run("INSERT INTO user_profiles VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET avatar=excluded.avatar,discriminator=excluded.discriminator,updated=excluded.updated", user.id, avatar, discriminator, updated);
                            Object.assign(user, { avatar, discriminator, updated });
                        }
                    }
                    json(response, 200, { users }); return;
                }
                if (request.method === "GET" && path === "/api/admin/users") {
                    const q = (url.searchParams.get("q") ?? "").slice(0, 100), filter = url.searchParams.get("status") ?? "all", page = Number(url.searchParams.get("page") ?? 0);
                    if (!["all", "allowed", "blocked", "recent"].includes(filter) || !Number.isInteger(page) || page < 0 || page > 1_000_000) throw failure(400, "Choose a valid page and filter.");
                    const condition = filter === "blocked" ? "blocked=1" : filter === "allowed" ? "blocked=0" : filter === "recent" ? `blocked=0 AND last_seen>${Date.now() - 600_000}` : "1=1";
                    const users = await store.all(`SELECT users.*,user_profiles.avatar,user_profiles.discriminator,user_profiles.updated AS avatar_updated FROM users LEFT JOIN user_profiles ON users.id=user_profiles.id WHERE ${condition} AND instr(lower(users.id||' '||COALESCE(username,'')||' '||COALESCE(name,'')),lower(?))>0 ORDER BY last_seen DESC,users.id LIMIT 51 OFFSET ?`, q, page * 50);
                    const stats = await store.get("SELECT COUNT(*) AS total,SUM(blocked) AS blocked,SUM(CASE WHEN blocked=0 AND last_seen>? THEN 1 ELSE 0 END) AS recent FROM users", Date.now() - 600_000);
                    json(response, 200, { users: users.slice(0, 50), next: users.length > 50, stats }); return;
                }
                if (request.method === "POST" && path === "/api/admin/block") {
                    const input = await body(request);
                    if (!validId(input.userId) || typeof input.blocked !== "boolean" || typeof input.reason !== "string" || input.reason.length > 300) throw failure(400, "Enter a Discord user ID and a note of up to 300 characters.");
                    if (input.blocked && config.adminIds.includes(input.userId)) throw failure(400, "Administrator access is managed in the service configuration.");
                    const previous = await store.get("SELECT blocked FROM users WHERE id=?", input.userId);
                    await store.batch([
                        ["INSERT INTO users (id,blocked,blocked_at,reason) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET blocked=excluded.blocked,blocked_at=excluded.blocked_at,reason=excluded.reason", input.userId, Number(input.blocked), input.blocked ? Date.now() : null, input.blocked ? input.reason : ""],
                        ["INSERT INTO audit (actor,target,action,at,reason) VALUES (?,?,?,?,?)", session.user_id, input.userId, input.blocked ? "blocked" : previous?.blocked ? "unblocked" : "allowed", Date.now(), input.reason],
                    ]);
                    json(response, 200, { ok: true }); return;
                }
                if (request.method === "GET" && path === "/api/admin/audit") { json(response, 200, { events: await store.all("SELECT * FROM audit ORDER BY id DESC LIMIT 50") }); return; }
            }
            throw failure(404, "This page or action was not found.");
        } catch (error) {
            if (response.destroyed) return;
            const status = Number.isInteger(error.status) ? error.status : 500, message = error.status ? error.message : "The service could not complete this request. Please try again.";
            if (String(request.url).startsWith("/api/")) json(response, status, { error: message });
            else {
                const escaped = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
                response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
                response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sonata · Sign-in</title><link rel="stylesheet" href="/style.css"><main class="signin"><section class="signin-card"><span class="note large">♫</span><h1>Sign-in failed.</h1><p>${escaped}</p><p class="small">For activation, return to Sonata and start a new sign-in. For the control room, use a configured administrator account.</p><a class="primary link-button" href="/admin">Back to the control room</a></section></main></html>`);
            }
        }
    };
}
