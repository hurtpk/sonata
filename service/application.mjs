/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";

import { createAuth, failure } from "./auth.mjs";
import { hash, random, validId, validToken } from "./protocol.mjs";

const DAY = 86400_000;
const files = { "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"], "/": ["index.html", "text/html"], "/admin": ["index.html", "text/html"], "/activate": ["index.html", "text/html"] };
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

export function createApplication(config, store, discordFetch, readAsset) {
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
        response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
        try {
            const url = new URL(request.url, config.publicUrl), path = url.pathname;
            if (request.headers.host !== new URL(config.publicUrl).host) throw failure(403, "Use the configured Sonata service address.");
            if (request.headers.origin && request.headers.origin !== config.publicUrl) throw failure(403, "This request came from another website.");
            if (Date.now() - lastCleanup > 60_000) { if (!config.scheduledCleanup) await store.cleanup(); lastCleanup = Date.now(); for (const [key, entry] of rates) if (entry.until < Date.now()) rates.delete(key); }
            if (request.method === "GET" && path in files) { const [name, type] = files[path]; response.setHeader("Content-Type", `${type}; charset=utf-8`); response.end(await readAsset(name)); return; }
            if (request.method === "GET" && path === "/api/info") { json(response, 200, { demo: !!config.demo, configured: !!(config.clientId && config.clientSecret && config.adminIds.length) }); return; }
            if (request.method === "GET" && path === "/demo" && config.demo) {
                const token = random();
                await store.run("INSERT INTO sessions VALUES (?,?,?,?,?)", hash(token), config.adminIds[0], "Demo owner", random(), Date.now() + DAY);
                response.setHeader("Set-Cookie", auth.cookie("sonata_admin", token, 86400)); redirect(response, "/admin"); return;
            }
            if (request.method === "GET" && path === "/auth/start") { rate(request, "oauth", 20); redirect(response, await auth.login(url.searchParams.get("activation"), response)); return; }
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
            if (path.startsWith("/api/admin/")) {
                const session = await requireAdmin(request, request.method !== "GET");
                if (request.method === "GET" && path === "/api/admin/session") { json(response, 200, { id: session.user_id, username: session.username, csrf: session.csrf }); return; }
                if (request.method === "POST" && path === "/api/admin/logout") { await store.run("DELETE FROM sessions WHERE hash=?", session.hash); response.setHeader("Set-Cookie", auth.cookie("sonata_admin", "", 0)); json(response, 200, { ok: true }); return; }
                if (request.method === "GET" && path === "/api/admin/users") {
                    const q = (url.searchParams.get("q") ?? "").slice(0, 100), filter = url.searchParams.get("status") ?? "all", page = Number(url.searchParams.get("page") ?? 0);
                    if (!["all", "allowed", "blocked", "recent"].includes(filter) || !Number.isInteger(page) || page < 0 || page > 1_000_000) throw failure(400, "Choose a valid page and filter.");
                    const condition = filter === "blocked" ? "blocked=1" : filter === "allowed" ? "blocked=0" : filter === "recent" ? `blocked=0 AND last_seen>${Date.now() - 600_000}` : "1=1";
                    const users = await store.all(`SELECT * FROM users WHERE ${condition} AND instr(lower(id||' '||COALESCE(username,'')||' '||COALESCE(name,'')),lower(?))>0 ORDER BY last_seen DESC,id LIMIT 51 OFFSET ?`, q, page * 50);
                    const stats = await store.get("SELECT COUNT(*) AS total,SUM(blocked) AS blocked,SUM(CASE WHEN blocked=0 AND last_seen>? THEN 1 ELSE 0 END) AS recent FROM users", Date.now() - 600_000);
                    json(response, 200, { users: users.slice(0, 50), next: users.length > 50, stats }); return;
                }
                if (request.method === "POST" && path === "/api/admin/block") {
                    const input = await body(request);
                    if (!validId(input.userId) || typeof input.blocked !== "boolean" || typeof input.reason !== "string" || input.reason.length > 300) throw failure(400, "Enter a Discord user ID and a note of up to 300 characters.");
                    if (input.blocked && config.adminIds.includes(input.userId)) throw failure(400, "Administrator access is managed in the service configuration.");
                    await store.batch([
                        ["INSERT INTO users (id,blocked,blocked_at,reason) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET blocked=excluded.blocked,blocked_at=excluded.blocked_at,reason=excluded.reason", input.userId, Number(input.blocked), input.blocked ? Date.now() : null, input.blocked ? input.reason : ""],
                        ["INSERT INTO audit (actor,target,action,at,reason) VALUES (?,?,?,?,?)", session.user_id, input.userId, input.blocked ? "blocked" : "unblocked", Date.now(), input.reason],
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
                response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sonata · Sign-in</title><link rel="stylesheet" href="/style.css"><main class="signin"><section class="signin-card"><span class="note large">♫</span><h1>Let's try that again.</h1><p>${escaped}</p><p class="small">For activation, return to Sonata and start a new sign-in. For the control room, use a configured administrator account.</p><a class="primary link-button" href="/admin">Back to the control room</a></section></main></html>`);
            }
        }
    };
}
