/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApplication, readConfig } from "../server.mjs";
import { hash, openStore, random } from "../store.mjs";

const OWNER = "111111111111111111", USER = "222222222222222222", OTHER = "333333333333333333";
async function fixture(t) {
    const store = process.env.SONATA_TEST_D1 === "1" ? await (await import("../cloudflare/test/store.mjs")).testStore() : openStore(":memory:");
    let application, identity = USER, providerMode = "normal";
    const server = createServer((request, response) => application(request, response));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const config = { publicUrl: base, clientId: "444444444444444444", clientSecret: "test-secret", adminIds: [OWNER] };
    const oauthRequests = [];
    application = createApplication(config, store, async (url, options) => {
        oauthRequests.push({ url, options });
        if (providerMode === "large") return new Response("x".repeat(140_000));
        if (providerMode === "invalid") return new Response("not JSON");
        if (url === "https://discord.com/api/oauth2/token") return Response.json({ access_token: "test-oauth-token", token_type: "Bearer" });
        assert.equal(url, "https://discord.com/api/v10/users/@me");
        return Response.json({ id: identity, username: `name_${identity}`, global_name: "Verified member", avatar: "0123456789abcdef0123456789abcdef", discriminator: "0" });
    });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.db.close(); });
    const request = (path, body, headers = {}) => fetch(base + path, { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const login = async (id, pairing = "") => {
        identity = id;
        const start = await request(`/auth/start${pairing ? `?activation=${pairing}` : ""}`);
        assert.equal(start.status, 302);
        const url = new URL(start.headers.get("location"));
        assert.equal(url.origin, "https://discord.com"); assert.equal(url.searchParams.get("scope"), "identify");
        const state = url.searchParams.get("state"), cookie = start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
        const response = await request(`/auth/callback?${new URLSearchParams({ state, code: "test-code", iss: "https://discord.com" })}`, null, { Cookie: cookie });
        const cookies = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
        return { response, cookies, state, flowCookie: cookie };
    };
    const admin = async () => { const loginResult = await login(OWNER); assert.equal(loginResult.response.status, 302); const session = await (await request("/api/admin/session", null, { Cookie: loginResult.cookies })).json(); return { Cookie: loginResult.cookies, Origin: base, "X-CSRF-Token": session.csrf }; };
    const begin = async (id = USER) => { const verifier = random(), result = await (await request("/api/activation/start", { userId: id, challenge: hash(verifier), version: "2026.10.28" })).json(); return { id: result.id, verifier }; };
    const activate = async (id = USER) => { const pair = await begin(id); const auth = await login(id, pair.id); assert.equal(auth.response.status, 302); return (await request("/api/activation/finish", pair)).json(); };
    return { store, base, config, request, login, admin, begin, activate, oauthRequests, providerMode: value => { providerMode = value; } };
}

test("Only verified owner sessions can access the dashboard and mutations require CSRF", async t => {
    const f = await fixture(t);
    assert.equal((await f.request("/api/admin/users")).status, 401);
    assert.equal((await f.login(USER)).response.status, 403);
    assert.equal((await f.store.get("SELECT COUNT(*) AS n FROM users")).n, 0);
    const headers = await f.admin();
    assert.equal((await f.request("/api/admin/users", null, headers)).status, 200);
    assert.equal((await f.request("/api/admin/block", { userId: USER, blocked: true, reason: "Test" }, { Cookie: headers.Cookie })).status, 403);
    assert.equal((await f.request("/api/admin/block", { userId: USER, blocked: true, reason: "Test" }, { ...headers, Origin: "https://other.example" })).status, 403);
    assert.equal((await f.request("/api/admin/block", { userId: OWNER, blocked: true, reason: "Test" }, headers)).status, 400);
});

test("The Accounts page stays hidden from visitors and server managers", async t => {
    const f = await fixture(t);
    const visitor = await f.request("/admin");
    assert.equal(visitor.status, 302); assert.equal(visitor.headers.get("location"), "/");
    assert.doesNotMatch(await visitor.text(), /Administrator sign-in|Registered accounts/);
    const token = random(), headers = { Cookie: `sonata_bot=${token}` };
    await f.store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(token), USER, "Server manager", random(), Date.now() + 3600_000);
    const manager = await f.request("/admin", null, headers);
    assert.equal(manager.status, 302); assert.equal(manager.headers.get("location"), "/");
    assert.equal((await f.request("/api/admin/users", null, headers)).status, 401);
    await f.store.run("UPDATE bot_sessions SET user_id=? WHERE hash=?", OWNER, hash(token));
    const owner = await f.request("/admin", null, headers);
    assert.equal(owner.status, 302); assert.equal(owner.headers.get("location"), "/auth/start");
    const page = await f.request("/admin", null, await f.admin());
    assert.equal(page.status, 200); assert.match(await page.text(), /Registered accounts/);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal((await f.request("/")).status, 200);
    assert.equal((await f.request("/activate")).status, 200);
});

test("Activation binds a Discord identity to the device verifier and stores only hashed device credentials", async t => {
    const f = await fixture(t), pair = await f.begin();
    assert.equal((await f.store.get("SELECT COUNT(*) AS n FROM users")).n, 0);
    assert.equal((await (await f.request("/api/activation/finish", pair)).json()).status, "waiting");
    assert.equal((await f.request("/api/activation/finish", { ...pair, verifier: random() })).status, 400);
    assert.equal((await f.login(OTHER, pair.id)).response.status, 403);
    const login = await f.login(USER, pair.id); assert.equal(login.response.status, 302);
    assert.equal((await f.request(`/auth/callback?${new URLSearchParams({ state: login.state, code: "test-code" })}`, null, { Cookie: login.flowCookie })).status, 400);
    const activated = await (await f.request("/api/activation/finish", pair)).json();
    assert.equal(activated.status, "allowed"); assert.equal(activated.userId, USER); assert.equal(activated.admin, false);
    assert.equal((await f.store.get("SELECT hash FROM devices")).hash, hash(activated.token));
    assert.equal((await f.request("/api/activation/finish", pair)).status, 400);
    assert.equal((await f.request("/api/check-in", { userId: OTHER, version: "2026.10.28" }, { Authorization: `Bearer ${activated.token}` })).status, 403);
    const record = await f.store.get("SELECT * FROM users WHERE id=?", USER); assert(record.first_seen > 0); assert.equal(record.version, "2026.10.28");
});

test("Preemptive blocks deny activation, and block/unblock controls affect existing devices", async t => {
    const f = await fixture(t), headers = await f.admin();
    assert.equal((await f.request("/api/admin/block", { userId: OTHER, blocked: true, reason: "Private note" }, headers)).status, 200);
    const blocked = await f.activate(OTHER); assert.equal(blocked.status, "blocked"); assert.equal(blocked.token, undefined);
    const allowed = await f.activate(USER), auth = { Authorization: `Bearer ${allowed.token}` };
    await f.request("/api/admin/block", { userId: USER, blocked: true, reason: "Private moderation note" }, headers);
    const check = await (await f.request("/api/check-in", { userId: USER, version: "2026.10.28" }, auth)).json();
    assert.equal(check.status, "blocked"); assert.equal(check.reason, undefined);
    await f.request("/api/admin/block", { userId: USER, blocked: false, reason: "" }, headers);
    assert.equal((await (await f.request("/api/check-in", { userId: USER, version: "2026.10.28" }, auth)).json()).status, "allowed");
    const audit = await (await f.request("/api/admin/audit", null, headers)).json(); assert.equal(audit.events.length, 3); assert.equal(audit.events[0].actor, OWNER);
    await f.request("/api/disconnect", {}, auth);
    assert.equal((await f.request("/api/check-in", { userId: USER, version: "2026.10.28" }, auth)).status, 401);
});

test("Filters, validation and retention keep the access registry bounded", async t => {
    const f = await fixture(t), headers = await f.admin();
    await f.activate(USER);
    await f.request("/api/admin/block", { userId: OTHER, blocked: true, reason: "Retain restriction" }, headers);
    const blocked = await (await f.request("/api/admin/users?status=blocked", null, headers)).json(); assert.equal(blocked.users.length, 1); assert.equal(blocked.users[0].id, OTHER);
    const search = await (await f.request(`/api/admin/users?q=${USER}`, null, headers)).json(); assert.equal(search.users.length, 1);
    assert.equal((await f.request("/api/admin/users?status=invalid", null, headers)).status, 400);
    assert.equal((await f.request("/api/activation/start", { userId: "bad", challenge: random(), version: "2026.10.28" })).status, 400);
    assert.equal((await f.request("/api/admin/block", { userId: USER, blocked: "yes", reason: "" }, headers)).status, 400);
    await f.store.run("UPDATE users SET last_seen=? WHERE id=?", Date.now() - 91 * 86400_000, USER); await f.store.cleanup();
    assert.equal(await f.store.get("SELECT id FROM users WHERE id=?", USER), undefined); assert(await f.store.get("SELECT id FROM users WHERE id=?", OTHER)); assert.equal((await f.store.get("SELECT COUNT(*) AS n FROM devices")).n, 0);
    await f.store.run("UPDATE users SET blocked=0,registered_at=? WHERE id=?", Date.now() - 91 * 86400_000, OTHER); await f.store.cleanup();
    assert.equal(await f.store.get("SELECT id FROM users WHERE id=?", OTHER), undefined);
});

test("Oversized or malformed OAuth responses cannot create an administrator session", async t => {
    const f = await fixture(t);
    for (const mode of ["large", "invalid"]) { f.providerMode(mode); assert.equal((await f.login(OWNER)).response.status, 502); }
    assert.equal((await f.store.get("SELECT COUNT(*) AS n FROM sessions")).n, 0);
});

test("OAuth rejects forged state and production cannot enable demo mode", async t => {
    const f = await fixture(t);
    assert.equal((await f.request(`/auth/callback?state=${random()}&code=fake`)).status, 400);
    assert.equal(f.oauthRequests.length, 0);
    assert.equal((await f.request("/demo")).status, 404);
    const old = process.env.NODE_ENV; process.env.NODE_ENV = "production";
    try { assert.throws(() => readConfig(true), /only available locally/); }
    finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});

test("Concurrent activation requests can issue only one device credential", async t => {
    const f = await fixture(t), pair = await f.begin();
    assert.equal((await f.login(USER, pair.id)).response.status, 302);
    const results = await Promise.all([f.request("/api/activation/finish", pair), f.request("/api/activation/finish", pair)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    assert.equal((await f.store.get("SELECT COUNT(*) AS n FROM devices")).n, 1);
});


test("Allow ID can register a new account or restore a block without bypassing Discord activation", async t => {
    const f = await fixture(t), headers = await f.admin();
    assert.equal((await f.request("/api/admin/block", { userId: USER, blocked: false, reason: "" }, headers)).status, 200);
    const pending = await f.store.get("SELECT * FROM users WHERE id=?", USER);
    assert.equal(pending.blocked, 0); assert.equal(pending.first_seen, null);
    const audit = await f.store.get("SELECT * FROM audit WHERE target=?", USER); assert.equal(audit.action, "allowed");
    await f.request("/api/admin/block", { userId: USER, blocked: true, reason: "Review" }, headers);
    await f.request("/api/admin/block", { userId: USER, blocked: false, reason: "" }, headers);
    const activated = await f.activate(USER); assert.equal(activated.status, "allowed");
    const profile = await f.store.get("SELECT * FROM user_profiles WHERE id=?", USER);
    assert.equal(profile.avatar, "0123456789abcdef0123456789abcdef"); assert.equal(profile.discriminator, "0");
    const users = await (await f.request("/api/admin/users", null, headers)).json(); assert.equal(users.users[0].avatar, profile.avatar);
    assert.equal((await f.request("/api/admin/avatars?ids=" + USER)).status, 401);
    assert.equal((await f.request("/api/admin/avatars?ids=invalid", null, headers)).status, 400);
    await f.store.run("DELETE FROM users WHERE id=?", USER); assert.equal(await f.store.get("SELECT id FROM user_profiles WHERE id=?", USER), undefined);
});


test("Owner grants limit administrator tools, reject escalation and revoke existing sessions immediately", async t => {
    const f = await fixture(t), owner = await f.admin();
    assert.equal((await f.request("/api/admin/staff", { id: USER, permissions: ["health"] }, owner)).status, 200);
    const signed = await f.login(USER); assert.equal(signed.response.status, 302);
    const info = await (await f.request("/api/admin/session", null, { Cookie: signed.cookies })).json();
    assert.deepEqual(info.permissions, ["health"]); assert.equal(info.owner, false);
    const headers = { Cookie: signed.cookies, Origin: f.base, "X-CSRF-Token": info.csrf };
    assert.equal((await f.request("/api/admin/health", null, headers)).status, 200);
    assert.equal((await f.request("/api/admin/users", null, headers)).status, 403);
    assert.equal((await f.request("/api/admin/bot/action", { guild: OTHER, action: "leave" }, headers)).status, 403);
    assert.equal((await f.request("/api/admin/staff", { id: OTHER, permissions: ["access"] }, headers)).status, 403);
    assert.equal((await f.request("/api/admin/staff", { id: OTHER, permissions: ["health"] }, { Cookie: owner.Cookie })).status, 403);
    assert.equal((await f.request("/api/admin/staff", { id: USER, permissions: [] }, owner)).status, 200);
    assert.equal((await f.request("/api/admin/session", null, headers)).status, 401);
    assert.equal((await f.login(USER)).response.status, 403);
    assert.equal((await f.request("/api/admin/staff", { id: OWNER, permissions: [] }, owner)).status, 400);
});
