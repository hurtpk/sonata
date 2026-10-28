/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare, Response as MockResponse, WebSocketPair } from "miniflare";

const APP = "444444444444444444", GUILD = "111111111111111111", ACTOR = "222222222222222222", TARGET = "333333333333333333", CHANNEL = "888888888888888888", MOD = "555555555555555555", BOTROLE = "666666666666666666", USERROLE = "777777777777777777";
const SECRET = "test-control-key-that-is-never-a-real-secret";

async function until(predicate) {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await sleep(20); }
    assert.fail("Local bot did not reach the expected state");
}

async function runtime(t, configured = true) {
    const sockets = [], gatewayPackets = [], apiCalls = []; let serial = 900000000000000000n, sequence = 0;
    const options = convertV4MiniflareOptions({ workers: [{ name: "sonata-test", modules: true, scriptPath: fileURLToPath(new URL("../.check/worker.js", import.meta.url)), compatibilityDate: "2026-10-28", compatibilityFlags: ["nodejs_compat"], durableObjects: { BOT: { className: "SonataBot", useSQLite: true } },
        bindings: configured ? { DISCORD_APPLICATION_ID: APP, DISCORD_BOT_TOKEN: "fake-test-token", BOT_CONTROL_SECRET: SECRET } : {},
        outboundService: async request => {
            const url = new URL(request.url);
            if (/^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/.test(url.hostname)) {
                const pair = new WebSocketPair(), [client, server] = Object.values(pair);
                server.accept(); sockets.push(server);
                server.addEventListener("message", event => {
                    if (server.readyState !== 1) return;
                    const packet = JSON.parse(event.data); gatewayPackets.push(packet);
                    if (packet.op === 2) server.send(JSON.stringify({ op: 0, t: "READY", s: ++sequence, d: { session_id: "fake-session", resume_gateway_url: "wss://gateway.discord.gg", user: { id: APP } } }));
                    if (packet.op === 6) server.send(JSON.stringify({ op: 0, t: "RESUMED", s: ++sequence, d: {} }));
                    if (packet.op === 1) server.send(JSON.stringify({ op: 11, d: null }));
                });
                server.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
                return new MockResponse(null, { status: 101, webSocket: client });
            }
            assert.equal(url.origin, "https://discord.com");
            const body = request.method === "GET" ? undefined : await request.json();
            apiCalls.push({ path: url.pathname, method: request.method, body });
            const path = url.pathname.replace("/api/v10", "");
            if (path === `/guilds/${GUILD}`) return MockResponse.json({ id: GUILD, owner_id: "111111111111111112", name: "Fake server" });
            if (path === `/guilds/${GUILD}/roles`) return MockResponse.json([{ id: GUILD, position: 0, permissions: "3072" }, { id: MOD, position: 20, permissions: "1099511627776" }, { id: BOTROLE, position: 30, permissions: "1099511627776" }, { id: USERROLE, position: 1, permissions: "0" }]);
            if (path.startsWith(`/guilds/${GUILD}/members/`)) { const id = path.split("/")[4]; return MockResponse.json({ user: { id }, roles: [id === ACTOR ? MOD : id === APP ? BOTROLE : USERROLE] }); }
            if (path === `/channels/${CHANNEL}`) return MockResponse.json({ id: CHANNEL, guild_id: GUILD, type: 0, permission_overwrites: [] });
            return MockResponse.json({ id: String(++serial) });
        },
    }] });
    const mf = new Miniflare(options);
    t.after(async () => { for (const socket of sockets) if (socket.readyState === 1) socket.close(1000, "Test complete"); await mf.dispose(); });
    const request = (path, method = "GET", auth = true) => mf.dispatchFetch(`https://sonata.example${path}`, { method, redirect: "manual", headers: auth ? { Authorization: `Bearer ${SECRET}` } : {} });
    const status = async () => (await request("/control/status")).json();
    const send = (type, data) => sockets.at(-1).send(JSON.stringify({ op: 0, t: type, s: ++sequence, d: data }));
    return { mf, request, status, send, sockets, gatewayPackets, apiCalls };
}

test("Public routes expose no credentials, and control requires the private control key", async t => {
    const f = await runtime(t);
    const health = await f.request("/health", "GET", false); assert.deepEqual(await health.json(), { service: "Sonata Bot", configured: true });
    assert.equal((await f.request("/control/start", "POST", false)).status, 401);
    assert.equal((await f.request("/control/stop", "POST", false)).status, 401);
    const invite = await f.request("/invite", "GET", false), url = new URL(invite.headers.get("location"));
    assert.equal(url.origin, "https://discord.com"); assert.equal(url.searchParams.get("client_id"), APP);
    assert.equal(BigInt(url.searchParams.get("permissions")) & 8n, 0n);
    assert.equal(f.sockets.length, 0);
});

test("Unconfigured deployment does not offer an unusable invite or start the Gateway", async t => {
    const f = await runtime(t, false);
    assert.equal((await f.request("/invite", "GET", false)).status, 503);
    assert.equal((await f.request("/control/start", "POST")).status, 401);
    assert.equal(f.sockets.length, 0);
});

test("Cloudflare Gateway identifies, responds to prefix and slash commands, and resumes", async t => {
    const f = await runtime(t);
    assert.equal((await f.request("/control/start", "POST")).status, 200);
    await until(async () => (await f.status()).connected);
    assert.equal(f.gatewayPackets.find(packet => packet.op === 2).d.intents, 33283);
    for (let i = 0; i < 6; i++) f.send("MESSAGE_CREATE", { id: String(100000000000000000n + BigInt(i)), guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: "normal conversation" });
    f.send("MESSAGE_CREATE", { id: "100000000000000100", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",ping" });
    await until(() => f.apiCalls.some(call => call.method === "PATCH" && call.body?.embeds?.[0]?.title === "Sonata is here"));
    f.send("INTERACTION_CREATE", { id: "100000000000000101", type: 2, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: ACTOR } }, token: "fake-interaction-token", data: { name: "warn", options: [{ name: "member", value: TARGET }, { name: "reason", value: "Test warning" }] } });
    await until(() => f.apiCalls.some(call => call.path.includes("/webhooks/") && call.body?.embeds?.[0]?.title === "Case #1 · warn"));
    assert(f.apiCalls.some(call => call.path.endsWith("/callback") && call.body.type === 5 && call.body.data.flags === 64));
    f.send("INTERACTION_CREATE", { id: "100000000000000102", type: 2, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: ACTOR } }, token: "fake-info-token", data: { name: "userinfo", options: [{ name: "member", value: TARGET }] } });
    await until(() => f.apiCalls.some(call => call.path.includes("/webhooks/") && call.body?.embeds?.[0]?.description?.includes(`User: <@${TARGET}>`)));
    f.sockets.at(-1).close(4000, "Test reconnect");
    await until(async () => !(await f.status()).connected);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    assert(f.gatewayPackets.some(packet => packet.op === 6 && packet.d.session_id === "fake-session"));
    await f.request("/control/stop", "POST");
    assert.equal((await f.status()).paused, true);
});

test("Missing intents pause the bot with an actionable message instead of reconnecting repeatedly", async t => {
    const f = await runtime(t); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    f.sockets.at(-1).close(4014, "Intents not enabled");
    await until(async () => (await f.status()).paused);
    assert.match((await f.status()).error, /Message Content Intent and Server Members Intent/);
    const namespace = await f.mf.getDurableObjectNamespace("BOT");
    await namespace.get(namespace.idFromName("sonata")).fetch("https://bot.internal/tick", { method: "POST" });
    assert.equal(f.sockets.length, 1);
});

test("Expired Gateway sessions identify again instead of resuming stale credentials", async t => {
    const f = await runtime(t); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    f.sockets.at(-1).close(4009, "Session expired");
    await until(async () => !(await f.status()).connected);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    assert.equal(f.gatewayPackets.filter(packet => packet.op === 2).length, 2);
    assert.equal(f.gatewayPackets.filter(packet => packet.op === 6).length, 0);
});

test("A connected Gateway stays alive after the handshake timeout has passed", async t => {
    const f = await runtime(t); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    await sleep(16_000);
    assert.equal((await f.status()).connected, true);
    assert.equal(f.sockets.length, 1);
    assert(f.gatewayPackets.filter(packet => packet.op === 1).length >= 10);
});
