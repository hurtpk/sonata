/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApplication } from "../application.mjs";
import { openStore, hash, random } from "../store.mjs";

const OWNER = "111111111111111111", USER = "222222222222222222";
async function fixture(t, respondToBot = () => ({ status: { connected: true, musicOnline: false }, access: [] })) {
    const store = openStore(":memory:"), ownerToken = random(), token = random(), csrf = random(), calls = [];
    store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(ownerToken), OWNER, "owner", csrf, Date.now() + 3600_000);
    store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(token), USER, "user", random(), Date.now() + 3600_000);
    store.run("INSERT INTO admin_grants VALUES (?,?,?,?)", USER, JSON.stringify(["users", "servers", "health"]), OWNER, Date.now());
    let application; const server = createServer((req, res) => application(req, res)); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    application = createApplication({ publicUrl: origin, adminIds: [OWNER] }, store, undefined, async () => "test", async (path, actor, input) => { calls.push({ path, actor, input }); return respondToBot(path); });
    const request = (path, input, as = ownerToken, headers = {}) => fetch(origin + path, { method: input ? "POST" : "GET", headers: { ...(as ? { Cookie: "sonata_bot=" + as } : {}), ...(input ? { "Content-Type": "application/json", Origin: origin, "X-CSRF-Token": csrf } : {}), ...headers }, body: input ? JSON.stringify(input) : undefined });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.db.close(); });
    return { store, request, ownerToken, token, calls };
}

test("Role icon requests cross the signed-in dashboard bridge with a bounded body and CSRF protection", async t => {
    const f = await fixture(t), icon = "data:image/png;base64," + Buffer.alloc(100_000).toString("base64"), input = { guild: OWNER, action: "role-update", id: USER, options: { icon } };
    const response = await f.request("/api/bot/server-manager", input);
    assert.equal(response.status, 200); assert.equal(f.calls.at(-1).input.options.icon, icon); assert.equal(f.calls.at(-1).actor, OWNER);
    assert.equal((await f.request("/api/bot/server-manager", input, f.ownerToken, { "X-CSRF-Token": "wrong" })).status, 403);
    assert.equal((await f.request("/api/bot/server-manager", { ...input, options: { icon: "x".repeat(384 * 1024) } })).status, 413);
    assert.equal((await f.request("/api/bot/action", input)).status, 413);
});

test("Owner console requires owner identity and CSRF even for delegated administrators", async t => {
    const f = await fixture(t);
    const owner = await (await f.request("/api/bot/session")).json(), admin = await (await f.request("/api/bot/session", null, f.token)).json();
    assert.equal(owner.sonataOwner, true); assert.equal(admin.owner, true); assert.equal(admin.sonataOwner, false);
    assert.equal((await f.request("/api/admin/console/sessions", null, "")).status, 401);
    assert.equal((await f.request("/api/admin/console/sessions", null, f.token)).status, 403);
    assert.equal((await f.request("/api/admin/console/operations", { maintenance: [], rollouts: [] }, f.ownerToken, { "X-CSRF-Token": "forged" })).status, 403);
    assert.equal((await f.request("/api/admin/console/operations", { maintenance: [], rollouts: [], actor: USER })).status, 200);
    assert.equal(f.calls.at(-1).actor, OWNER);
    f.store.run("DELETE FROM admin_grants WHERE id=?", USER);
    const ordinary = await (await f.request("/api/bot/session", null, f.token)).json(); assert.equal(ordinary.owner, false); assert.equal(ordinary.sonataOwner, false);
});

test("Session listing never returns credentials and revocation immediately invalidates the selected browser", async t => {
    const f = await fixture(t);
    await f.request("/api/bot/session", null, f.token);
    const data = await (await f.request("/api/admin/console/sessions")).json(), user = data.sessions.find(session => session.user_id === USER);
    assert.ok(user); for (const session of data.sessions) { assert.equal(session.hash, undefined); assert.equal(session.csrf, undefined); assert.ok(!JSON.stringify(session).includes(f.token)); }
    assert.equal((await f.request("/api/admin/console/sessions", { id: user.id })).status, 200);
    assert.equal((await f.request("/api/bot/session", null, f.token)).status, 401);
    assert.equal((await f.request("/api/bot/session")).status, 200);
});

test("Owner overview counts current access and keeps local data available during a bot outage", async t => {
    const f = await fixture(t, path => {
        if (path === "owner/health") throw Error("Temporarily unavailable");
        if (path === "owner/resources") return { days: [{ day: "2026-11-05", commands: 4 }], alerts: [], databaseBytes: 800, activeMusicServers: 0 };
        return { maintenance: [{ target: "music", message: "Private note" }], rollouts: [] };
    });
    const now = Date.now(), path = "/api/admin/console/overview";
    f.store.run("INSERT INTO users (id,first_seen,last_seen,blocked) VALUES (?,?,?,?)", OWNER, now, now, 0);
    f.store.run("INSERT INTO users (id,blocked) VALUES (?,1)", USER);
    f.store.run("INSERT INTO audit (actor,target,action,at,reason) VALUES (?,?,?,?,?)", OWNER, USER, "blocked", now, "Private reason");
    assert.equal((await f.request(path, null, "")).status, 401);
    assert.equal((await f.request(path, null, f.token)).status, 403);
    assert.equal((await f.request(path, {})).status, 405);
    const response = await f.request(path), data = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(data.accounts, { activated: 1, recent: 1, blocked: 1 });
    assert.equal(data.sessions, 2);
    assert.equal(data.bot, null);
    assert.equal(data.resources.days[0].commands, 4);
    assert.deepEqual(data.operations.maintenance, ["music"]);
    assert.deepEqual(data.activity, [{ actor: OWNER, target: USER, action: "blocked", at: now }]);
    assert.equal(f.calls.length, 3);
});

test("Public status returns only service checks; account lookup stays private", async t => {
    const f = await fixture(t), response = await f.request("/api/status", null, ""), data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.services.length, 4); assert.equal(data.services.find(service => service.name === "Discord bot").online, true);
    assert.ok(!JSON.stringify(data).includes(OWNER)); assert.equal(data.status, undefined);
    const lookup = await (await f.request("/api/admin/console/lookup?id=" + USER)).json(); assert.equal(lookup.id, USER); assert.deepEqual(lookup.admin.permissions, ["users", "servers", "health"]);
    assert.equal((await f.request("/api/admin/console/lookup?id=" + USER, null, f.token)).status, 403);
});


test("Owner message and bot user-block endpoints enforce owner identity and CSRF", async t => {
    const f = await fixture(t);
    for (const tool of ["messages", "userblocks"]) {
        assert.equal((await f.request("/api/admin/console/" + tool, null, "")).status, 401);
        assert.equal((await f.request("/api/admin/console/" + tool, {}, f.token)).status, 403);
        assert.equal((await f.request("/api/admin/console/" + tool, {}, f.ownerToken, { "X-CSRF-Token": "forged" })).status, 403);
        assert.equal((await f.request("/api/admin/console/" + tool, { guild: USER, content: "Local test", actor: USER })).status, 200);
        assert.equal(f.calls.at(-1).actor, OWNER);
    }
});

test("All-server dashboard permission is explicit and revocation applies without signing in again", async t => {
    const f = await fixture(t);
    assert.equal((await f.request("/api/admin/bot", null, f.token)).status, 200);
    const session = await (await f.request("/api/bot/session", null, f.token)).json();
    assert.ok(session.permissions.includes("servers")); assert.equal(session.sonataOwner, false);
    f.store.run("UPDATE admin_grants SET permissions=? WHERE id=?", JSON.stringify(["health"]), USER);
    assert.equal((await f.request("/api/admin/bot", null, f.token)).status, 403);
    assert.deepEqual((await (await f.request("/api/bot/session", null, f.token)).json()).permissions, ["health"]);
    assert.equal((await f.request("/api/bot/servers", null, f.token)).status, 200);
});

test("Only the owner sees staff profiles, separate SSO visits and authenticated action history", async t => {
    const f = await fixture(t, path => path.startsWith("owner/users?") ? { users: [{ id: USER, username: "mod", name: "Moderator", avatar: "a".repeat(32), discriminator: "0" }] } : { ok: true });
    const target = "333333333333333333";
    f.store.run("UPDATE admin_grants SET permissions=? WHERE id=?", JSON.stringify(["users", "access", "servers", "serverAccess"]), USER);
    await f.request("/api/bot/session", null, f.token);
    await f.request("/api/bot/session", null, f.token);
    const staff = await (await f.request("/api/admin/session", null, f.token)).json();
    const headers = { "X-CSRF-Token": staff.csrf };
    assert.equal((await f.request("/api/bot/action", { guild: target, name: "alias", sub: "set", options: { name: "private-alias" }, actor: OWNER }, f.token, headers)).status, 200);
    assert.equal((await f.request("/api/admin/block", { userId: target, blocked: true, reason: "Private note" }, f.token, headers)).status, 200);
    assert.equal((await f.request("/api/admin/bot/action", { guild: target, action: "blacklist" }, f.token, headers)).status, 200);
    assert.equal((await f.request("/api/admin/bot/action", { guild: target, action: "leave" }, f.token)).status, 403);
    assert.equal((await f.request("/api/admin/staff?activity=" + USER, null, f.token)).status, 403);
    assert.equal((await f.request("/api/admin/staff", null, f.token)).status, 403);
    const { grants: [grant] } = await (await f.request("/api/admin/staff")).json();
    assert.equal(grant.name, "Moderator");
    assert.equal(grant.avatar, "a".repeat(32));
    assert.ok(grant.lastDashboard && grant.lastAdmin);
    assert.equal(grant.totalActions, 3);
    const history = await (await f.request("/api/admin/staff?activity=" + USER)).json();
    assert.deepEqual(history.visits.map(visit => visit.area).sort(), ["admin", "dashboard"]);
    assert.deepEqual(history.actions.map(entry => entry.action).sort(), ["Server blacklisted", "alias set", "blocked"]);
    assert.ok(!JSON.stringify(history).includes("private-alias") && !JSON.stringify(history).includes("Private note"));
});
