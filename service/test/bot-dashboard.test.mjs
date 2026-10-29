/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApplication } from "../server.mjs";
import { hash, openStore, random } from "../store.mjs";

const OWNER = "111111111111111111", USER = "222222222222222222";
async function fixture(t) {
    const store = openStore(":memory:"), calls = []; let application;
    const server = createServer((request, response) => application(request, response)); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    application = createApplication({ publicUrl: origin, clientId: "444444444444444444", clientSecret: "fake-secret", adminIds: [OWNER] }, store, async url => url.endsWith("/token") ? Response.json({ access_token: "fake-token", token_type: "Bearer" }) : Response.json({ id: USER, username: "server-manager" }), async (path, actor, body) => { calls.push({ path, actor, body }); return path.startsWith("owner/users?") ? { users: new URL("https://bot.internal/" + path).searchParams.get("ids").split(",").map(id => ({ id, avatar: "0123456789abcdef0123456789abcdef", discriminator: "0" })) } : { servers: [], ok: true }; });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.db.close(); });
    const request = (path, body, headers = {}) => fetch(origin + path, { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { store, origin, request, calls };
}

test("Server dashboard login creates a distinct session without activation records or owner access", async t => {
    const f = await fixture(t), start = await f.request("/auth/start?bot=1"), url = new URL(start.headers.get("location")), cookie = start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert.equal(url.searchParams.get("scope"), "identify"); assert.equal(url.searchParams.get("redirect_uri"), f.origin + "/auth/callback");
    const finish = await f.request(`/auth/callback?${new URLSearchParams({ state: url.searchParams.get("state"), code: "fake-code" })}`, null, { Cookie: cookie });
    assert.equal(finish.status, 302); assert.equal(finish.headers.get("location"), "/");
    const auth = finish.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert.equal((await f.request("/api/admin/users", null, { Cookie: auth })).status, 401);
    const session = await (await f.request("/api/bot/session", null, { Cookie: auth })).json(); assert.equal(session.id, USER); assert.equal(session.owner, false);
    await f.request("/api/bot/servers", null, { Cookie: auth }); assert.equal(f.calls[0].actor, USER);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM users").n, 0); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM sessions").n, 0);
});

test("Dashboard mutations require the same-origin session CSRF token and ignore a forged actor in JSON", async t => {
    const f = await fixture(t), token = random(), csrf = random(); f.store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(token), USER, "manager", csrf, Date.now() + 3600_000);
    const input = { guild: "333333333333333333", actor: OWNER, name: "settings", sub: "prefix", options: { prefix: "!" } }, cookie = `sonata_bot=${token}`;
    assert.equal((await f.request("/api/bot/action", input, { Cookie: cookie })).status, 403);
    assert.equal((await f.request("/api/bot/action", input, { Cookie: cookie, Origin: "https://attacker.example", "X-CSRF-Token": csrf })).status, 403);
    assert.equal((await f.request("/api/bot/action", input, { Cookie: cookie, Origin: f.origin, "X-CSRF-Token": csrf })).status, 200);
    assert.equal(f.calls.at(-1).actor, USER);
    assert.equal((await f.request("/api/bot/owner", null, { Cookie: cookie })).status, 404);
});

test("Owner bot routes require the owner session and never expose service credentials", async t => {
    const f = await fixture(t), ownerToken = random(), botToken = random();
    f.store.run("INSERT INTO sessions VALUES (?,?,?,?,?)", hash(ownerToken), OWNER, "owner", random(), Date.now() + 3600_000);
    f.store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(botToken), USER, "member", random(), Date.now() + 3600_000);
    assert.equal((await f.request("/api/admin/bot", null, { Cookie: `sonata_bot=${botToken}` })).status, 401);
    const response = await f.request("/api/admin/bot", null, { Cookie: `sonata_admin=${ownerToken}` }); assert.equal(response.status, 200); assert.equal(f.calls.at(-1).path, "owner"); assert.equal(f.calls.at(-1).actor, OWNER);
    assert(!JSON.stringify(await response.json()).includes("fake-secret"));
});

test("Signing out invalidates both currently supplied dashboard cookies", async t => {
    const f = await fixture(t), ownerToken = random(), botToken = random(), csrf = random();
    f.store.run("INSERT INTO sessions VALUES (?,?,?,?,?)", hash(ownerToken), OWNER, "owner", random(), Date.now() + 3600_000);
    f.store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(botToken), OWNER, "owner", csrf, Date.now() + 3600_000);
    const response = await f.request("/api/bot/logout", {}, { Cookie: `sonata_admin=${ownerToken}; sonata_bot=${botToken}`, Origin: f.origin, "X-CSRF-Token": csrf });
    assert.equal(response.status, 200); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM sessions").n, 0); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM bot_sessions").n, 0);
});


test("Server departure controls require an owner session, same origin and CSRF", async t => {
    const f = await fixture(t), token = random(), manager = random(), csrf = random();
    f.store.run("INSERT INTO sessions VALUES (?,?,?,?,?)", hash(token), OWNER, "owner", csrf, Date.now() + 3600000);
    f.store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(manager), USER, "manager", csrf, Date.now() + 3600000);
    const input = { guild: "333333333333333333", action: "blacklist", actor: USER };
    assert.equal((await f.request("/api/admin/bot/action", input)).status, 401);
    assert.equal((await f.request("/api/admin/bot/action", input, { Cookie: "sonata_bot=" + manager, Origin: f.origin, "X-CSRF-Token": csrf })).status, 401);
    assert.equal((await f.request("/api/admin/bot/action", input, { Cookie: "sonata_admin=" + token })).status, 403);
    assert.equal((await f.request("/api/admin/bot/action", input, { Cookie: "sonata_admin=" + token, Origin: "https://attacker.example", "X-CSRF-Token": csrf })).status, 403);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.request("/api/admin/bot/action", input, { Cookie: "sonata_admin=" + token, Origin: f.origin, "X-CSRF-Token": csrf })).status, 200);
    assert.equal(f.calls[0].path, "owner/action"); assert.equal(f.calls[0].actor, OWNER);
});


test("Registered user avatars are fetched privately, cached and removed with their account", async t => {
    const f = await fixture(t), token = random(), headers = { Cookie: "sonata_admin=" + token };
    f.store.run("INSERT INTO sessions VALUES (?,?,?,?,?)", hash(token), OWNER, "owner", random(), Date.now() + 3600000);
    f.store.run("INSERT INTO users (id) VALUES (?)", USER);
    const path = "/api/admin/avatars?ids=" + USER;
    const first = await (await f.request(path, null, headers)).json();
    assert.equal(first.users[0].avatar, "0123456789abcdef0123456789abcdef"); assert.equal(f.calls[0].actor, OWNER); assert.equal(f.calls.length, 1);
    await f.request(path, null, headers); assert.equal(f.calls.length, 1);
    const unknown = await (await f.request("/api/admin/avatars?ids=333333333333333333", null, headers)).json(); assert.equal(unknown.users.length, 0); assert.equal(f.calls.length, 1);
    f.store.run("DELETE FROM users WHERE id=?", USER); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM user_profiles").n, 0);
});
