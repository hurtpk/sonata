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
async function fixture(t) {
    const store = openStore(":memory:"), ownerToken = random(), token = random(), csrf = random(), calls = [];
    store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(ownerToken), OWNER, "owner", csrf, Date.now() + 3600_000);
    store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(token), USER, "user", random(), Date.now() + 3600_000);
    store.run("INSERT INTO admin_grants VALUES (?,?,?,?)", USER, JSON.stringify(["users", "servers", "health"]), OWNER, Date.now());
    let application; const server = createServer((req, res) => application(req, res)); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    application = createApplication({ publicUrl: origin, adminIds: [OWNER] }, store, undefined, async () => "test", async (path, actor, input) => { calls.push({ path, actor, input }); return { status: { connected: true, musicOnline: false }, access: [] }; });
    const request = (path, input, as = ownerToken, headers = {}) => fetch(origin + path, { method: input ? "POST" : "GET", headers: { ...(as ? { Cookie: "sonata_bot=" + as } : {}), ...(input ? { "Content-Type": "application/json", Origin: origin, "X-CSRF-Token": csrf } : {}), ...headers }, body: input ? JSON.stringify(input) : undefined });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.db.close(); });
    return { store, request, ownerToken, token, calls };
}

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
