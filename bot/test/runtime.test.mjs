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
const MUSIC_SECRET = "test-music-key-separate-from-the-control-key";
const DASHBOARD_SECRET = "test-dashboard-key-separate-from-bot-and-music";
const VOICE = "888888888888888889";
const CATEGORY = "888888888888888890";

test("User blacklist blocks prefix commands, automatic videos, slash commands and buttons at Gateway ingress", async t => {
    const f = await runtime(t), headers = { Authorization: "Bearer " + DASHBOARD_SECRET, "X-Sonata-User": "779172192461783110" };
    const block = blocked => f.mf.dispatchFetch("https://sonata.example/dashboard/owner/userblocks", { method: "POST", headers, body: JSON.stringify({ id: ACTOR, blocked, reason: "Local runtime test" }) });
    assert.equal((await block(true)).status, 200);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    for (const [id, content] of [["100000000000009101", ",ping"], ["100000000000009102", "https://www.tiktok.com/@test/video/1234567890"]]) f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content });
    f.send("INTERACTION_CREATE", { id: "100000000000009103", type: 2, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: ACTOR } }, token: "blocked-slash", data: { name: "ping", options: [] } });
    f.send("INTERACTION_CREATE", { id: "100000000000009104", type: 3, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: ACTOR } }, token: "blocked-button", message: { author: { id: APP } }, data: { custom_id: "sonata:help", component_type: 2 } });
    await until(() => f.apiCalls.some(call => call.path.includes("blocked-button")));
    for (const token of ["blocked-slash", "blocked-button"]) { const call = f.apiCalls.find(call => call.path.includes(token)); assert.equal(call.body.type, 4); assert.equal(call.body.data.flags, 64); assert.match(call.body.data.content, /^Error code: S/); }
    assert(!f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000009101" || call.path.endsWith("/typing")));
    assert.equal((await block(false)).status, 200);
    f.send("MESSAGE_CREATE", { id: "100000000000009105", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",ping" });
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000009105"));
});

async function until(predicate, attempts = 100) {
    for (let i = 0; i < attempts; i++) { if (await predicate()) return; await sleep(20); }
    assert.fail("Local bot did not reach the expected state");
}

async function runtime(t, configured = true, extraPermissions = 0n) {
    const sockets = [], gatewayPackets = [], apiCalls = [], memberRoles = new Map(), nicknames = new Map(), replyMessages = new Map(), channels = new Map(), bans = new Map(), uploadFailures = new Set(), uploadGates = new Map(), appEmojis = []; let serial = 900000000000000000n, sequence = 0;
    const options = convertV4MiniflareOptions({ workers: [{ name: "sonata-test", modules: true, scriptPath: fileURLToPath(new URL("../.check/worker.js", import.meta.url)), compatibilityDate: "2026-10-28", compatibilityFlags: ["nodejs_compat"], durableObjects: { BOT: { className: "SonataBot", useSQLite: true } },
        bindings: configured ? { DISCORD_APPLICATION_ID: APP, DISCORD_BOT_TOKEN: "fake-test-token", BOT_CONTROL_SECRET: SECRET, MUSIC_BRIDGE_SECRET: MUSIC_SECRET, BOT_DASHBOARD_SECRET: DASHBOARD_SECRET } : {},
        outboundService: async request => {
            const url = new URL(request.url);
            if (/^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/.test(url.hostname)) {
                const pair = new WebSocketPair(), [client, server] = Object.values(pair);
                server.accept(); sockets.push(server);
                server.addEventListener("message", event => {
                    if (server.readyState !== 1) return;
                    const packet = JSON.parse(event.data); gatewayPackets.push(packet);
                    if (packet.op === 2) server.send(JSON.stringify({ op: 0, t: "READY", s: ++sequence, d: { session_id: "fake-session", resume_gateway_url: "wss://gateway.discord.gg", user: { id: APP }, guilds: [{ id: GUILD }] } }));
                    if (packet.op === 8) server.send(JSON.stringify({op:0,t:"GUILD_MEMBERS_CHUNK",s:++sequence,d:{guild_id:GUILD,members:[{user:{id:TARGET},roles:[USERROLE]}],chunk_index:0,chunk_count:1}}));
                    if (packet.op === 6) server.send(JSON.stringify({ op: 0, t: "RESUMED", s: ++sequence, d: {} }));
                    if (packet.op === 1) server.send(JSON.stringify({ op: 11, d: null }));
                });
                server.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
                return new MockResponse(null, { status: 101, webSocket: client });
            }
            if (url.origin === "https://cdn.jsdelivr.net" && url.pathname === "/gh/jdecked/twemoji@17.0.3/assets/72x72/1f62d.png") return new MockResponse(new Uint8Array([137,80,78,71,13,10,26,10]), {headers:{"Content-Type":"image/png"}});
            assert.equal(url.origin, "https://discord.com");
            const form = request.headers.get("content-type")?.startsWith("multipart/form-data") ? await request.formData() : null;
            const raw = form || request.method === "GET" ? "" : await request.text(), body = form ? JSON.parse(form.get("payload_json")) : raw ? JSON.parse(raw) : undefined;
            const call = { path: url.pathname, method: request.method, body, ...(form ? { file: { name: form.get("files[0]").name, text: await form.get("files[0]").text() } } : {}) }; apiCalls.push(call);
            const path = url.pathname.replace("/api/v10", "");
            if (path === "/applications/" + APP + "/emojis") {
                if (request.method === "GET") return MockResponse.json({ items: appEmojis });
                assert.match(body.image, /^data:image\/png;base64,iVBOR/);
                const emoji = { name: body.name, id: String(++serial) };
                appEmojis.push(emoji);
                return MockResponse.json(emoji);
            }
            if (form && uploadGates.has(path)) await uploadGates.get(path);
            if (form && uploadFailures.has(path)) return MockResponse.json({message:"Upload refused"},{status:403});
            if (request.method === "GET" && replyMessages.has(path)) return MockResponse.json(replyMessages.get(path));
            if (path === `/guilds/${GUILD}`) return MockResponse.json({ id: GUILD, owner_id: "111111111111111112", name: "Fake server" });
            if (path === `/channels/${CATEGORY}`) return MockResponse.json({ id: CATEGORY, guild_id: GUILD, type: 4, permission_overwrites: [] });
            if (path === `/guilds/${GUILD}/channels` && request.method === "POST") { const channel = { id: String(++serial), guild_id: GUILD, ...body }; channels.set(channel.id, channel); return MockResponse.json(channel); }
            if (/^\/channels\/\d+$/.test(path) && channels.has(path.split("/")[2])) return MockResponse.json(channels.get(path.split("/")[2]));
            if (path.startsWith(`/guilds/${GUILD}/bans/`)) { const id = path.split("/")[4]; if (request.method === "PUT") bans.set(id, { user: { id }, reason: decodeURIComponent(request.headers.get("x-audit-log-reason") ?? "") }); if (request.method === "DELETE") bans.delete(id); return MockResponse.json(bans.get(id) ?? null); }
            if (path.startsWith(`/guilds/${GUILD}/voice-states/`)) return MockResponse.json(path.endsWith(ACTOR) ? { channel_id: VOICE } : null);
            if (path === `/channels/${VOICE}`) return MockResponse.json({ id: VOICE, guild_id: GUILD, type: 2, permission_overwrites: [{ id: ACTOR, type: 1, allow: "1048576", deny: "0" }, { id: APP, type: 1, allow: "3145728", deny: "0" }] });
            if (path === `/guilds/${GUILD}/roles`) return MockResponse.json([{ id: GUILD, position: 0, permissions: "3072" }, { id: MOD, position: 20, permissions: (extraPermissions | 1099511627776n | 8192n | 65536n | 16384n | 2048n | 1024n).toString() }, { id: BOTROLE, position: 30, permissions: (8n | extraPermissions | 1099511627776n | 8192n | 65536n | 16384n | 2048n | 1024n).toString() }, { id: USERROLE, position: 1, permissions: "0" }]);
            if (path.startsWith(`/guilds/${GUILD}/members/`)) { const id = path.split("/")[4], roles = memberRoles.get(id) ?? [id === ACTOR ? MOD : id === APP ? BOTROLE : USERROLE]; if (path.includes("/roles/") && request.method === "PUT") memberRoles.set(id, [...new Set([...roles, path.split("/")[6]])]); if (request.method === "PATCH" && Object.hasOwn(body, "nick")) nicknames.set(id, body.nick); return MockResponse.json({ user: { id, username: "Test user" }, nick: nicknames.get(id) ?? null, roles: memberRoles.get(id) ?? roles }); }
            if (path === `/channels/${CHANNEL}`) return MockResponse.json({ id: CHANNEL, guild_id: GUILD, type: 0, permission_overwrites: [] });
            if (path === `/channels/${CHANNEL}/messages` && request.method === "GET") return MockResponse.json([1000, 2000].map(age => ({ id: String(BigInt(Date.now() - age - 1420070400000) << 22n), author: { id: TARGET } })));
            call.response = { id: String(++serial) };
            return MockResponse.json(call.response);
        },
    }] });
    const mf = new Miniflare(options);
    t.after(async () => { for (const socket of sockets) if (socket.readyState === 1) socket.close(1000, "Test complete"); await mf.dispose(); });
    const request = (path, method = "GET", auth = true) => mf.dispatchFetch(`https://sonata.example${path}`, { method, redirect: "manual", headers: auth ? { Authorization: `Bearer ${SECRET}` } : {} });
    const status = async () => (await request("/control/status")).json();
    const send = (type, data) => sockets.at(-1).send(JSON.stringify({ op: 0, t: type, s: ++sequence, d: data }));
    return { mf, request, status, send, sockets, gatewayPackets, apiCalls, memberRoles, nicknames, replyMessages, uploadFailures, uploadGates, channels };
}

test("Public routes expose no credentials, and control requires the private control key", async t => {
    const f = await runtime(t);
    const health = await f.request("/health", "GET", false); assert.deepEqual(await health.json(), { service: "Sonata Bot", configured: true });
    assert.equal((await f.request("/control/start", "POST", false)).status, 401);
    assert.equal((await f.request("/control/stop", "POST", false)).status, 401);
    const invite = await f.request("/invite", "GET", false), url = new URL(invite.headers.get("location"));
    assert.equal(url.origin, "https://discord.com"); assert.equal(url.searchParams.get("client_id"), APP);
    assert.equal(BigInt(url.searchParams.get("permissions")), 8n);
    assert.equal(f.sockets.length, 0);
});

test("Gateway replies use the configured server embed color", async t => {
    const f = await runtime(t, true, 32n);
    await f.request("/control/start", "POST");
    await until(async () => (await f.status()).connected);
    for (const [id, content] of [["100000000000019101", ",settings embedcolor #123456"], ["100000000000019102", ",ping"]]) {
        f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content });
        const reply = () => f.apiCalls.find(call => call.body?.message_reference?.message_id === id)?.body;
        await until(reply);
        assert.equal(reply().embeds[0].color, 0x123456);
    }
});

test("Snipe collects deletions in new channels without channel setup", async t => {
    const f = await runtime(t, true, 32n);
    await f.request("/control/start", "POST");
    await until(async () => (await f.status()).connected);
    const channel = "888888888888888891";
    f.channels.set(channel, { id: channel, guild_id: GUILD, type: 0, permission_overwrites: [] });
    f.send("MESSAGE_CREATE", { id: "100000000000019020", guild_id: GUILD, channel_id: channel, author: { id: TARGET }, content: "New channel works by default" });
    f.send("MESSAGE_DELETE", { id: "100000000000019020", guild_id: GUILD, channel_id: channel });
    f.send("MESSAGE_CREATE", { id: "100000000000019021", guild_id: GUILD, channel_id: channel, author: { id: ACTOR }, content: ",s" });
    const reply = () => f.apiCalls.find(call => call.body?.message_reference?.message_id === "100000000000019021")?.body;
    await until(reply);
    assert.match(reply().embeds[0].description, /New channel works by default/);
});

test("Snipe keeps history per channel and honors the dashboard permission toggle", async t => {
    const f = await runtime(t, true, 32n);
    await f.request("/control/start", "POST");
    await until(async () => (await f.status()).connected);
    const ids = Array.from({ length: 12 }, (_, i) => String(100000000000019000n + BigInt(i)));
    const configure = (limit, require_manage_messages) => f.mf.dispatchFetch("https://sonata.example/dashboard/action", {
        method: "POST", headers: { Authorization: "Bearer " + DASHBOARD_SECRET, "X-Sonata-User": ACTOR },
        body: JSON.stringify({ guild: GUILD, channel: CHANNEL, name: "settings", sub: "snipe", options: { limit, require_manage_messages } }),
    });
    const post = (id, content, actor = TARGET, channel = CHANNEL) => f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: channel, author: { id: actor }, content });
    const remove = id => f.send("MESSAGE_DELETE", { id, guild_id: GUILD, channel_id: CHANNEL });
    const prefixReply = async (id, content, actor = ACTOR) => {
        post(id, content, actor);
        const find = () => f.apiCalls.find(call => call.body?.message_reference?.message_id === id)?.body;
        await until(find);
        return find();
    };

    post(ids[0], "Available by default");
    remove(ids[0]);
    assert.match((await prefixReply(ids[7], ",s")).embeds[0].description, /Available by default/);
    const saved = await configure(5);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).settings.snipeLimit, 5);
    assert.equal((await configure(4)).status, 400);
    for (let i = 1; i <= 6; i++) post(ids[i], "Deleted message " + i);
    f.send("MESSAGE_UPDATE", { id: ids[6], guild_id: GUILD, channel_id: CHANNEL, content: "Updated text @everyone" });
    f.send("MESSAGE_DELETE_BULK", { guild_id: GUILD, channel_id: CHANNEL, ids: ids.slice(1, 7).reverse() });
    post(ids[0], "Different channel", TARGET, VOICE);
    remove(ids[0]);
    const newest = await prefixReply(ids[8], ",s");
    assert.match(newest.embeds[0].footer.text, /1\/5 messages/);
    assert.match(newest.embeds[0].description, /Updated text @everyone/);
    assert.deepEqual(newest.allowed_mentions, { parse: [], replied_user: false });
    assert.match((await prefixReply(ids[9], ",snipe 5")).embeds[0].description, /Deleted message 2$/);
    const channel = { id: CHANNEL, guild_id: GUILD, type: 0, permission_overwrites: [{ id: TARGET, type: 1, allow: "65536", deny: "0" }] };
    f.channels.set(CHANNEL, channel);
    assert.match((await prefixReply(ids[10], ",snipe", TARGET)).content, /^Error code: S/);

    assert.equal((await configure(5, false)).status, 200);
    assert.equal((await (await configure(5)).json()).settings.snipeRequireManageMessages, false);
    f.send("INTERACTION_CREATE", { id: ids[11], type: 2, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: TARGET } }, token: "snipe-test", data: { name: "snipe", options: [{ name: "number", value: 2 }] } });
    const slashResult = () => f.apiCalls.find(call => call.path.includes("/snipe-test/messages/@original"))?.body;
    await until(slashResult);
    assert.match(slashResult().embeds[0].description, /Deleted message 5$/);
    assert.equal(f.apiCalls.find(call => call.path.includes("/snipe-test/callback")).body.data.flags, 64);
    assert.match((await prefixReply("100000000000019013", ",s", TARGET)).embeds[0].footer.text, /1\/5 messages/);
    f.channels.set(CHANNEL, { ...channel, permission_overwrites: [] });
    assert.match((await prefixReply("100000000000019014", ",s", TARGET)).content, /^Error code: S/);
    f.channels.set(CHANNEL, channel);
    assert.equal((await prefixReply("100000000000019015", ",settings snipe 5 on")).embeds[0].title, "Snipe settings saved");
    assert.match((await prefixReply("100000000000019016", ",s", TARGET)).content, /^Error code: S/);
    assert.equal((await configure(0)).status, 200);
    assert.equal((await configure(25)).status, 200);
    assert.equal((await prefixReply("100000000000019012", ",snipe")).embeds[0].title, "No deleted message at that position");
});

test("Music bridge authentication is separate from owner controls and cannot send arbitrary Gateway packets", async t => {
    const f = await runtime(t);
    assert.equal((await f.request("/music/poll")).status, 401);
    const headers = { Authorization: `Bearer ${MUSIC_SECRET}` };
    assert.equal((await f.mf.dispatchFetch("https://sonata.example/control/start", { method: "POST", headers })).status, 401);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    const batch = await (await f.mf.dispatchFetch("https://sonata.example/music/poll", { headers })).json();
    assert.equal(batch.ready, true); assert.equal(batch.botId, APP); assert.deepEqual(batch.jobs, []);
    assert(!JSON.stringify(batch).includes("fake-test-token"));
    const before = f.gatewayPackets.length;
    assert.equal((await f.mf.dispatchFetch("https://sonata.example/music/voice", { method: "POST", headers, body: JSON.stringify({ op: 2, d: { token: "anything" } }) })).status, 400);
    assert.equal(f.gatewayPackets.length, before);
    assert.equal((await f.mf.dispatchFetch("https://sonata.example/music/result", { method: "POST", headers, body: "x".repeat(12_000_001) })).status, 413);
});

test("Music waits for the companion's result while moderation continues independently", async t => {
    const f = await runtime(t), headers = { Authorization: `Bearer ${MUSIC_SECRET}` };
    const bridge = async (path, body) => (await f.mf.dispatchFetch(`https://sonata.example/music/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined })).json();
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    await bridge("poll");
    f.send("MESSAGE_CREATE", { id: "100000000000000190", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",play a test track" });
    let job;
    await until(async () => { job = (await bridge("poll")).jobs[0]; return !!job; });
    assert.equal(job.name, "play"); assert.equal(job.channel, VOICE);
    f.send("MESSAGE_CREATE", { id: "100000000000000191", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: `,warn ${TARGET} test` });
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "Case #1 · warn"));
    assert(!f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "Now playing"));
    await bridge("voice", { op: 4, d: { guild_id: GUILD, channel_id: VOICE, self_mute: false, self_deaf: true } });
    await until(() => f.gatewayPackets.some(packet => packet.op === 4));
    f.send("VOICE_SERVER_UPDATE", { guild_id: GUILD, token: "fake-voice-token", endpoint: "fake.discord.media" });
    let event;
    await until(async () => { event = (await bridge("poll")).events[0]; return !!event; }); assert.equal(event.type, "VOICE_SERVER_UPDATE");
    await bridge("result", { id: job.id, title: "Now playing", description: "Confirmed by voice companion" });
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.description === "Confirmed by voice companion"));
});

test("Unconfigured deployment does not offer an unusable invite or start the Gateway", async t => {
    const f = await runtime(t, false);
    assert.equal((await f.request("/invite", "GET", false)).status, 503);
    assert.equal((await f.request("/control/start", "POST")).status, 401);
    assert.equal(f.sockets.length, 0);
});

test("Video bridge replies upload a multipart MP4 with attribution and report failed retrieval without a fake embed", async t => {
    const f = await runtime(t), headers = { Authorization: `Bearer ${MUSIC_SECRET}` };
    const bridge = async (path, body) => (await f.mf.dispatchFetch(`https://sonata.example/music/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined })).json();
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected); await bridge("poll");
    const source = "https://www.tiktok.com/@cantbreakmeoff/video/7689630196105874718", bytes = "0000ftyp0000test";
    f.replyMessages.set(`/channels/${CHANNEL}/messages/100000000000000195`,{id:"100000000000000195",author:{id:ACTOR},content:`sonata ${source}`});
    f.send("MESSAGE_CREATE", { id: "100000000000000195", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: `sonata ${source}` });
    let job; await until(async () => { job = (await bridge("poll")).jobs[0]; return !!job; });
    assert.equal(job.kind,"video"); assert.equal(job.source,source);
    assert(f.apiCalls.some(call=>call.method==="POST"&&call.path.endsWith(`/channels/${CHANNEL}/typing`)));
    assert(!f.apiCalls.some(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000195")));
    const avatar = "https://p16.tiktokcdn.com/avatar.jpg";
    await bridge("result", { id: job.id, title: "K (@cantbreakmeoff)", description: "#mood", author: { name: "K", url: "https://www.tiktok.com/@cantbreakmeoff", avatar }, stats:{views:85355,likes:13313,comments:89,shares:7100},published:"2026-10-10T10:57:00.000Z", video: Buffer.from(bytes).toString("base64") });
    await until(() => f.apiCalls.some(call => call.file?.name === "sonata-video.mp4"));
    const posted = f.apiCalls.find(call => call.file?.name === "sonata-video.mp4");
    const [header, caption, gallery, divider, footer] = posted.body.components[0].components;
    assert.equal(posted.body.flags, 32768);
    assert.match(header.components[0].content, /^<:tiktok:\d+> \[\*\*K\*\*\]\(https:\/\/www\.tiktok\.com\/@cantbreakmeoff\)$/);
    assert.deepEqual(header.accessory, { type: 2, style: 5, emoji: { name: "🔗" }, url: source });
    assert.match(caption.components[0].content, /#mood/);
    assert.equal(caption.accessory.media.url, avatar);
    assert.equal(gallery.items[0].media.url, "attachment://sonata-video.mp4");
    assert.equal(divider.divider, true);
    assert.equal(footer.content, `-# 👁 85,355 • ❤️ 13,313 • 💬 89 • 🔁 7,100 • Sent by Test user (<@${ACTOR}>)`);
    assert.equal(posted.file.text, bytes);
    assert.equal(posted.body.content, undefined);
    assert.equal(posted.body.embeds, undefined);
    assert.equal(posted.body.message_reference, undefined);
    assert.deepEqual(posted.body.allowed_mentions.parse, []);
    await until(()=>f.apiCalls.some(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000195")));assert(f.apiCalls.findIndex(call=>call.file)>0);assert(f.apiCalls.findIndex(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000195"))>f.apiCalls.indexOf(posted));
    f.send("MESSAGE_CREATE", { id: "100000000000000196", guild_id: GUILD, channel_id: CHANNEL, author: { id: TARGET }, content: `,sonata ${source}` });
    await until(async () => { job = (await bridge("poll")).jobs[0]; return !!job; });
    await bridge("result", { id: job.id, title: "Video not completed", description: "TikTok could not provide this video." });
    await until(() => f.apiCalls.some(call => /^Error code: S\d+$/.test(call.body?.content || "")));
    const failed = f.apiCalls.find(call => /^Error code: S\d+$/.test(call.body?.content || "")); assert.equal(failed.file,undefined); assert.match(failed.body.content,/^Error code: S\d+$/); assert.equal(failed.body.embeds,undefined);
    const log=await f.mf.dispatchFetch('https://sonata.example/dashboard/owner/failures',{headers:{Authorization:`Bearer ${DASHBOARD_SECRET}`,'X-Sonata-User':'779172192461783110'}});
    const records=await log.json();assert.equal(records.failures[0].code,failed.body.content.split(': ')[1]);assert.equal(records.failures[0].detail,'TikTok could not provide this video.');assert.equal(records.failures[0].actor,TARGET);assert(records.failures[0].source.startsWith('https://www.tiktok.com/'));assert.equal(records.failures[0].command, `,sonata ${source}`);
    assert(!f.apiCalls.some(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000196")));
});

test("All-channel automatic video uploads include channels created after the setting was saved", async t => {
    const f=await runtime(t,true,32n),headers={Authorization:`Bearer ${MUSIC_SECRET}`};
    const bridge=async(path,body)=>(await f.mf.dispatchFetch(`https://sonata.example/music/${path}`,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined})).json();
    await f.request("/control/start","POST");await until(async()=>(await f.status()).connected);await bridge("poll");
    f.send("MESSAGE_CREATE",{id:"100000000000000197",guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content:",settings videoembeds true all"});
    await until(()=>f.apiCalls.some(call=>call.body?.embeds?.[0]?.title==="Settings saved"));
    const newChannel="888888888888888899";f.replyMessages.set(`/channels/${newChannel}`,{id:newChannel,guild_id:GUILD,type:0,permission_overwrites:[]});
    const source="https://www.tiktok.com/t/ZPLDWC4UG/";f.replyMessages.set(`/channels/${newChannel}/messages/100000000000000198`,{author:{id:TARGET},content:source});
    f.send("MESSAGE_CREATE",{id:"100000000000000198",guild_id:GUILD,channel_id:newChannel,author:{id:TARGET},content:source});
    let job;await until(async()=>{job=(await bridge("poll")).jobs[0];return !!job;});assert.equal(job.channel,newChannel);assert.equal(job.kind,"video");assert.equal(job.source,source);
    await bridge("result",{id:job.id,title:"Automatic clip",description:"#mood",video:Buffer.from("0000ftyp0000test").toString("base64")});
    await until(()=>f.apiCalls.some(call=>call.path.endsWith(`/channels/${newChannel}/messages`)&&call.file?.name==="sonata-video.mp4"));
    await until(()=>f.apiCalls.some(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000198")));
});

test("Automatic video embeds check roles for standalone links and shorthands while manual commands still work", async t => {
    const f = await runtime(t, true, 32n), headers = { Authorization: "Bearer " + MUSIC_SECRET };
    const bridge = async (path, input) => (await f.mf.dispatchFetch("https://sonata.example/music/" + path, { method: input ? "POST" : "GET", headers, body: input ? JSON.stringify(input) : undefined })).json();
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected); await bridge("poll");
    f.send("MESSAGE_CREATE", { id: "100000000000012000", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",settings videoembeds on all roles: " + MOD });
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "Settings saved"));
    const source = "https://www.tiktok.com/@creator/video/123";
    for (const [id, user, roles, content] of [["100000000000012001", TARGET, [USERROLE], source], ["100000000000012004", TARGET, [USERROLE], "sonata " + source], ["100000000000012002", ACTOR, [MOD], source], ["100000000000012003", TARGET, [USERROLE], ",sonata " + source]]) {
        f.replyMessages.set("/channels/" + CHANNEL + "/messages/" + id, { id, author: { id: user }, content });
        f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: CHANNEL, author: { id: user }, member: { roles }, content });
        if (user === TARGET && !content.startsWith(",")) {
            await sleep(60);
            assert.equal((await bridge("poll")).jobs.length, 0);
            assert(!f.apiCalls.some(call => call.path.endsWith("/typing")));
            continue;
        }
        let job; await until(async () => !!(job = (await bridge("poll")).jobs[0]));
        assert.equal(job.id, id);
        await bridge("result", { id, title: "Sample", description: "Sample clip", video: Buffer.from("0000ftyp0000test").toString("base64") });
        await until(() => f.apiCalls.filter(call => call.file?.name === "sonata-video.mp4").length === Number(id.at(-1)) - 1);
        await sleep(25);
    }
});

test("Word filters delete matching messages and edits, ping only the author, and apply repeat timeouts", async t => {
    const f = await runtime(t, true, 8n);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    const source = "/api/v10/channels/" + CHANNEL + "/messages/";
    const send = (id, content, user = ACTOR, roles = [MOD]) => f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: CHANNEL, author: { id: user }, member: { roles }, content });
    for (const [index, command] of [',automod filteradd "test word"', ',automod filterreply "test word" "{user} please stop @everyone"', ',automod filteraction "test word" timeout 2 10m'].entries()) {
        send("10000000000001300" + index, command);
        await until(() => f.apiCalls.filter(call => call.body?.embeds?.[0]?.title === "Message word filters saved").length === index + 1);
    }
    send("100000000000013003", "a test wordish example", TARGET, [USERROLE]);
    send("100000000000013004", "a test word", ACTOR, [MOD]);
    send("100000000000013005", "a TEST WORD!", TARGET, [USERROLE]);
    await until(() => f.apiCalls.some(call => call.method === "DELETE" && call.path === source + "100000000000013005"));
    assert(!f.apiCalls.some(call => call.method === "DELETE" && [source + "100000000000013003", source + "100000000000013004"].includes(call.path)));
    assert(!f.apiCalls.some(call => call.body?.communication_disabled_until));
    const id = "100000000000013006";
    f.replyMessages.set("/channels/" + CHANNEL + "/messages/" + id, { id, author: { id: TARGET }, content: "edited into a test word" });
    const edit = { id, guild_id: GUILD, channel_id: CHANNEL, content: "edited into a test word" };
    f.send("MESSAGE_UPDATE", edit); f.send("MESSAGE_UPDATE", edit);
    await until(() => f.apiCalls.some(call => call.body?.communication_disabled_until));
    const replies = f.apiCalls.filter(call => call.body?.content === "<@" + TARGET + "> please stop @everyone");
    assert.equal(replies.length, 2);
    assert.deepEqual(replies[0].body.allowed_mentions, { parse: [], users: [TARGET] });
    assert.equal(f.apiCalls.filter(call => call.method === "DELETE" && call.path === source + id).length, 1);
    assert.equal(f.apiCalls.filter(call => call.body?.communication_disabled_until).length, 1);
});

test("Gateway embeds only standalone links or Sonata mentions and names, never links inside ordinary text",async t=>{
    const f=await runtime(t,true,32n),headers={Authorization:`Bearer ${MUSIC_SECRET}`},source='https://vt.tiktok.com/ZSpLhJS1S/';
    const bridge=async(path,body)=>(await f.mf.dispatchFetch(`https://sonata.example/music/${path}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined})).json();
    await f.request('/control/start','POST');await until(async()=>(await f.status()).connected);await bridge('poll');
    f.send('MESSAGE_CREATE',{id:'100000000000008000',guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content:',settings videoembeds true all'});await until(()=>f.apiCalls.some(call=>call.body?.embeds?.[0]?.title==='Settings saved'));
    let serial=100000000000008001n;
    for(const content of ['watch this '+source,source+' watch this',`<@${TARGET}> ${source}`,'sonta '+source+' extra',source+' '+source])f.send('MESSAGE_CREATE',{id:String(serial++),guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content});
    await sleep(80);assert.equal((await bridge('poll')).jobs.length,0);assert(!f.apiCalls.some(call=>call.file));
    for(const content of [source,`<@${APP}> vt.tiktok.com/ZSpLhJS1S/`,'sonata '+source,'sonta vt.tiktok.com/ZSpLhJS1S/']){
        const id=String(serial++);f.replyMessages.set(`/channels/${CHANNEL}/messages/${id}`,{id,author:{id:ACTOR},content});
        f.send('MESSAGE_CREATE',{id,guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content});
        let job;await until(async()=>{job=(await bridge('poll')).jobs[0];return!!job});assert.equal(job.source,source);
        await bridge('result',{id:job.id,title:'Clip',description:'Caption',video:Buffer.from('0000ftyp0000video').toString('base64')});
        await until(()=>f.apiCalls.some(call=>call.method==='DELETE'&&call.path.endsWith(id)));await sleep(30);
    }
    assert.equal(f.apiCalls.filter(call=>call.file?.name==='sonata-video.mp4').length,4);
    assert.equal(f.apiCalls.filter(call=>call.method==="POST"&&call.path.endsWith("/applications/"+APP+"/emojis")).length,1);
});

test("Video uploads keep edited source messages and originals when Discord refuses the upload",async t=>{
    const f=await runtime(t),headers={Authorization:`Bearer ${MUSIC_SECRET}`};
    const bridge=async(path,body)=>(await f.mf.dispatchFetch(`https://sonata.example/music/${path}`,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined})).json();
    await f.request("/control/start","POST");await until(async()=>(await f.status()).connected);await bridge("poll");
    const source="https://www.tiktok.com/@cantbreakmeoff/video/7689630196105874718";
    for(const [id,actor,failed]of[["100000000000000193",ACTOR,false],["100000000000000194",TARGET,true]]){
        const uploads=f.apiCalls.filter(call=>call.file).length;
        f.replyMessages.set(`/channels/${CHANNEL}/messages/${id}`,{author:{id:actor},content:failed?`sonata ${source}`:"Edited message with important text"});
        if(failed)f.uploadFailures.add(`/channels/${CHANNEL}/messages`);
        f.send("MESSAGE_CREATE",{id,guild_id:GUILD,channel_id:CHANNEL,author:{id:actor},content:`sonata ${source}`});
        let job;await until(async()=>{job=(await bridge("poll")).jobs[0];return !!job;});
        await bridge("result",{id:job.id,title:"Clip",description:"Caption",video:Buffer.from("0000ftyp0000test").toString("base64")});
        await until(()=>f.apiCalls.filter(call=>call.file).length>uploads&&(failed||f.apiCalls.some(c=>c.method==="GET"&&c.path.endsWith(id))));
        assert(!f.apiCalls.some(call=>call.method==="DELETE"&&call.path.endsWith(id)));
    }
});

test("Videos wake a long poll, upload binary files above 8 MiB, and keep typing through Discord upload",async t=>{
    const f=await runtime(t),headers={Authorization:`Bearer ${MUSIC_SECRET}`};
    await f.request("/control/start","POST");await until(async()=>(await f.status()).connected);
    let release;const gate=new Promise(resolve=>{release=resolve;});f.uploadGates.set(`/channels/${CHANNEL}/messages`,gate);
    const poll=f.mf.dispatchFetch("https://sonata.example/music/poll?wait=1",{headers}).then(r=>r.json());
    await sleep(50);
    f.send("MESSAGE_CREATE",{id:"100000000000000189",guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content:",sonata https://www.tiktok.com/t/ZPLDWC4UG/"});
    try {
        const batch=await poll,job=batch.jobs[0];assert.equal(job.kind,"video");
        const typing=()=>f.apiCalls.filter(call=>call.method==="POST"&&call.path.endsWith("/typing"));
        assert(typing().length>0);assert(f.apiCalls.indexOf(typing()[0])<f.apiCalls.findIndex(call=>call.path.endsWith(`/guilds/${GUILD}/roles`)));
        const metadata={id:job.id,title:"Larger clip",description:"Binary transport",stats:{likes:42}},bytes=Buffer.alloc(9*1024*1024);bytes.write("ftyp",4);
        const result=await f.mf.dispatchFetch("https://sonata.example/music/video",{method:"POST",headers:{...headers,"Content-Type":"video/mp4","X-Sonata-Video":Buffer.from(JSON.stringify(metadata)).toString("base64")},body:bytes});assert.equal(result.status,200);
        await until(()=>f.apiCalls.some(call=>call.file));const posted=f.apiCalls.find(call=>call.file);assert.equal(posted.file.text.length,bytes.length);assert.equal(posted.response,undefined);
        await until(()=>typing().length>=2,450);assert.equal(posted.response,undefined);
    } finally { release(); }
    await until(()=>f.apiCalls.some(call=>call.file&&call.response));
});

test("Gateway GIF buttons edit the same message between GIF and MP4 using fresh media jobs",async t=>{
    const f=await runtime(t),headers={Authorization:`Bearer ${MUSIC_SECRET}`},gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),source='https://x.com/creator/status/123';
    const poll=async()=>{let job;await until(async()=>{job=(await(await f.mf.dispatchFetch('https://sonata.example/music/poll',{headers})).json()).jobs[0];return!!job});return job};
    const complete=async(job,format)=>{const body={id:job.id,title:'Caption',description:'GIF caption',format,isGif:true};const response=await f.mf.dispatchFetch('https://sonata.example/music/video',{method:'POST',headers:{...headers,'X-Sonata-Video':Buffer.from(JSON.stringify(body)).toString('base64')},body:format==='gif'?gif:Buffer.from('0000ftyp0000video')});assert.equal(response.status,200)};
    await f.request('/control/start','POST');await until(async()=>(await f.status()).connected);
    f.replyMessages.set(`/channels/${CHANNEL}/messages/100000000000009001`,{id:'100000000000009001',author:{id:ACTOR},content:',sonata '+source});
    f.send('MESSAGE_CREATE',{id:'100000000000009001',guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content:',sonata '+source});
    let job=await poll();assert.equal(job.limit,20*1048576);await complete(job,'gif');await until(()=>f.apiCalls.some(call=>call.file?.name==='sonata-animation.gif'));
    const initial=f.apiCalls.find(call=>call.file?.name==='sonata-animation.gif');await until(()=>!!initial.response);const messageId=initial.response.id;let message={id:messageId,author:{id:APP},...initial.body};
    const legacy = { id: messageId, author: { id: APP }, embeds: [{ url: source }], components: [message.components[0].components.find(component => component.type === 1)] };
    for(const[mode,n]of[['video',2],['gif',3],['video',4]]){
        if (n === 4) message = legacy;
        const token='fake-gif-toggle-'+mode;
        const controls = (n === 4 ? message.components[0] : message.components[0].components.find(component => component.type === 1)).components;
        f.send('INTERACTION_CREATE',{id:'10000000000000900'+n,type:3,guild_id:GUILD,channel_id:CHANNEL,member:{user:{id:ACTOR}},token:token+n,message,data:{custom_id:controls[0].custom_id,component_type:2}});
        job=await poll();assert.equal(job.mode,mode);await complete(job,mode==='gif'?'gif':'mp4');
        await until(()=>f.apiCalls.some(call=>call.path.includes(token+n)&&call.method==='PATCH'&&call.file));const edit=f.apiCalls.find(call=>call.path.includes(token+n)&&call.method==='PATCH'&&call.file);
        assert.equal(edit.file.name,mode==='gif'?'sonata-animation.gif':'sonata-video.mp4');assert.equal(edit.body.attachments.length,1);
        const card = edit.body.components[0].components;
        assert.equal(card.find(component => component.type === 1).components[0].label,mode==='gif'?'Video':'GIF');
        assert.equal(card.find(component => component.type === 12).items[0].media.url,"attachment://"+edit.file.name);
        assert.deepEqual(edit.body.embeds, n === 4 ? [] : undefined);
        message={id:messageId,author:{id:APP},...edit.body};
        assert(f.apiCalls.some(call=>call.path.includes(token)&&call.body?.type===6));
    }
});

test("Gateway caption upload opens an owner-only editor and updates the original attachment", async t => {
    const f = await runtime(t), headers = { Authorization: `Bearer ${MUSIC_SECRET}` };
    const source = `https://cdn.discordapp.com/attachments/${CHANNEL}/${TARGET}/picture.png`;
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO1sAAAAASUVORK5CYII=", "base64");
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    async function complete(format) {
        let job;
        await until(async () => {
            job = (await (await f.mf.dispatchFetch("https://sonata.example/music/poll", { headers })).json()).jobs[0];
            return !!job;
        });
        assert.equal(job.kind, "caption"); assert.equal(job.source, source);
        assert.equal(job.style.top, "A better caption"); assert.equal(job.style.format, format);
        const metadata = Buffer.from(JSON.stringify({ id: job.id, title: "Image ready", description: "", format })).toString("base64");
        const response = await f.mf.dispatchFetch("https://sonata.example/music/video", { method: "POST", headers: { ...headers, "X-Sonata-Video": metadata }, body: format === "gif" ? gif : png });
        assert.equal(response.status, 200);
    }
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    f.send("MESSAGE_CREATE", { id: "100000000000009500", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",caption A better caption", attachments: [{ id: TARGET, url: source, filename: "picture.png", size: png.length }] });
    await complete("png");
    const posted = () => f.apiCalls.find(call => call.file?.name === "sonata-caption.png" && call.response);
    await until(posted);
    const initial = posted(), message = { id: initial.response.id, author: { id: APP }, ...initial.body };
    const custom_id = message.components[1].components.find(component => component.label === "Make GIF").custom_id;
    const click = (id, actor, token) => f.send("INTERACTION_CREATE", { id, type: 3, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: actor } }, token, message, data: { custom_id, component_type: 2 } });
    click("100000000000009501", TARGET, "caption-other");
    await until(() => f.apiCalls.some(call => call.path.includes("caption-other") && call.body?.flags === 64));
    assert.ok(!f.apiCalls.some(call => call.path.includes("caption-other") && call.method === "PATCH"));
    click("100000000000009502", ACTOR, "caption-owner");
    await complete("gif");
    const edited = () => f.apiCalls.find(call => call.path.includes("caption-owner") && call.method === "PATCH" && call.file);
    await until(edited);
    assert.equal(edited().file.name, "sonata-caption.gif");
    assert.equal(edited().body.attachments.length, 1);
});

test("Cloudflare Gateway identifies, responds to prefix and slash commands, and resumes", async t => {
    const f = await runtime(t);
    assert.equal((await f.request("/control/start", "POST")).status, 200);
    await until(async () => (await f.status()).connected);
    assert.equal(f.gatewayPackets.find(packet => packet.op === 2).d.intents, 34439);
    const activity = { name: "Custom Status", type: 4, state: "♫ harmonizing 1 servers • ,help" }, identify=f.gatewayPackets.find(packet=>packet.op===2).d;
    assert.deepEqual(identify.presence.activities,[{...activity,state:"♫ harmonizing 0 servers • ,help"}]);assert.equal(identify.presence.status,"dnd");assert.equal(identify.properties.browser,"Discord iOS");assert.equal(identify.properties.device,"Discord iOS");
    await until(()=>f.gatewayPackets.some(packet=>packet.op===3&&packet.d.activities[0].state===activity.state));
    for (let i = 0; i < 6; i++) f.send("MESSAGE_CREATE", { id: String(100000000000000000n + BigInt(i)), guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: "normal conversation" });
    f.send("MESSAGE_CREATE", { id: "100000000000000100", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",ping" });
    await until(() => f.apiCalls.some(call => call.method === "POST" && call.body?.embeds?.[0]?.title === "Pong!"));
    f.send("INTERACTION_CREATE", { id: "100000000000000101", type: 2, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: ACTOR } }, token: "fake-interaction-token", data: { name: "warn", options: [{ name: "member", value: TARGET }, { name: "reason", value: "Test warning" }] } });
    await until(() => f.apiCalls.some(call => call.path.includes("/webhooks/") && call.body?.embeds?.[0]?.title === "Case #1 · warn"));
    assert(f.apiCalls.some(call => call.path.endsWith("/callback") && call.body.type === 5 && call.body.data.flags === 64));
    f.send("INTERACTION_CREATE", { id: "100000000000000102", type: 2, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: ACTOR } }, token: "fake-info-token", data: { name: "userinfo", options: [{ name: "member", value: TARGET }] } });
    await until(() => f.apiCalls.some(call => call.path.includes("/webhooks/") && call.body?.embeds?.[0]?.description?.includes(`User: <@${TARGET}>`)));
    f.sockets.at(-1).close(4000, "Test reconnect");
    await until(async () => !(await f.status()).connected);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    assert(f.gatewayPackets.some(packet => packet.op === 6 && packet.d.session_id === "fake-session"));
    await until(() => f.gatewayPackets.filter(packet => packet.op === 3).length >= 2);
    assert.deepEqual(f.gatewayPackets.filter(packet => packet.op === 3).at(-1).d.activities, [activity]);
    await f.request("/control/stop", "POST");
    assert.equal((await f.status()).paused, true);
});

test("The harmonizing status follows real server membership and coalesces joins and departures",async t=>{
    const f=await runtime(t);await f.request("/control/start","POST");await until(async()=>(await f.status()).connected);
    const second="111111111111111113",third="111111111111111114";
    for(const id of [second,third])f.send("GUILD_CREATE",{id,name:"Another server",owner_id:ACTOR,channels:[],roles:[],members:[],voice_states:[]});
    await until(async()=>(await f.status()).activity.state==="♫ harmonizing 3 servers • ,help");
    f.send("GUILD_DELETE",{id:second});f.send("GUILD_DELETE",{id:third,unavailable:true});
    await until(async()=>(await f.status()).activity.state==="♫ harmonizing 2 servers • ,help");
    await until(()=>f.gatewayPackets.some(packet=>packet.op===3&&packet.d.activities[0].state==="♫ harmonizing 2 servers • ,help"),350);
    const updates=f.gatewayPackets.filter(packet=>packet.op===3);assert(updates.length<=2);assert.equal(updates.at(-1).d.status,"dnd");
    await f.request("/control/stop","POST");
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

test("Gateway help controls edit the original message and reject another user privately", async t => {
    const f = await runtime(t); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    f.send("MESSAGE_CREATE", { id: "100000000000000300", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",help" });
    await until(() => f.apiCalls.some(call => call.method === "POST" && call.body?.components?.length));
    const home = f.apiCalls.find(call => call.method === "POST" && call.body?.components?.length).body;
    const data = { custom_id: home.components[0].components[0].custom_id, component_type: 3, values: ["server"] };
    const interaction = { type: 3, guild_id: GUILD, channel_id: CHANNEL, message: { ...home, author: { id: APP } }, data };
    f.send("INTERACTION_CREATE", { ...interaction, id: "100000000000000301", token: "fake-help-token", member: { user: { id: ACTOR } } });
    await until(() => f.apiCalls.some(call => call.path.endsWith("/fake-help-token/callback") && call.body?.type === 7));
    const update = f.apiCalls.find(call => call.path.endsWith("/fake-help-token/callback")).body;
    assert.match(update.data.embeds[0].description, /prefix view/);
    f.send("INTERACTION_CREATE", { ...interaction, id: "100000000000000302", token: "fake-foreign-token", member: { user: { id: TARGET } } });
    await until(() => f.apiCalls.some(call => call.path.endsWith("/fake-foreign-token/callback")));
    const rejected = f.apiCalls.find(call => call.path.endsWith("/fake-foreign-token/callback")).body;
    assert.equal(rejected.type, 4); assert.equal(rejected.data.flags, 64);
    assert.equal(f.apiCalls.filter(call => call.method === "POST" && call.path.endsWith(`/channels/${CHANNEL}/messages`)).length, 1);
});

test("A connected Gateway stays alive after the handshake timeout has passed", async t => {
    const f = await runtime(t); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    await sleep(16_000);
    assert.equal((await f.status()).connected, true);
    assert.equal(f.sockets.length, 1);
    assert(f.gatewayPackets.filter(packet => packet.op === 1).length >= 10);
});

test("Prefix purge posts only its final result after cleanup, with no working message", async t => {
    const f = await runtime(t); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    f.send("MESSAGE_CREATE", { id: "100000000000000500", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",purge 2" });
    await until(() => f.apiCalls.some(call => call.method === "POST" && call.body?.embeds?.[0]?.title === "Case #1 · purge"));
    const posts = f.apiCalls.filter(call => call.method === "POST" && call.path.endsWith(`/channels/${CHANNEL}/messages`));
    assert.equal(posts.length, 1);
    assert.match(posts[0].body.embeds[0].description, /Deleted 2/);
    assert(!JSON.stringify(f.apiCalls).includes("Checking this command"));
    assert(f.apiCalls.findIndex(call => call.path.endsWith("bulk-delete")) < f.apiCalls.indexOf(posts[0]));
    f.send("MESSAGE_CREATE", { id: "100000000000000501", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",purge nope" });
    await until(() => f.apiCalls.some(call => call.method === "POST" && /^Error code: S\d+$/.test(call.body?.content || "")));
    assert.equal(f.apiCalls.filter(call => call.path.endsWith("bulk-delete")).length, 1);
});

test("Gateway ticket buttons open a modal and create one private channel after submission", async t => {
    const f = await runtime(t, true, 32n | 16n | 268435456n | 32768n);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    const message = (id, content) => f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content });
    message("100000000000000600", `,ticket setup ${CATEGORY} ${MOD} ${CHANNEL}`);
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "Tickets saved"));
    message("100000000000000601", `,ticket panel ${CHANNEL}`);
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "Need help?"));
    const record = f.apiCalls.find(call => call.body?.embeds?.[0]?.title === "Need help?"), panel = record.body;
    await until(() => !!record.response);
    const actualPanelId = record.response.id;
    f.send("INTERACTION_CREATE", { id: "100000000000000602", type: 3, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: TARGET } }, token: "fake-ticket-open", message: { id: actualPanelId, author: { id: APP }, ...panel }, data: { custom_id: panel.components[0].components[0].custom_id, component_type: 2 } });
    await until(() => f.apiCalls.some(call => call.path.includes("fake-ticket-open") && call.body?.type === 9));
    const modal = f.apiCalls.find(call => call.path.includes("fake-ticket-open") && call.body?.type === 9).body.data;
    f.send("INTERACTION_CREATE", { id: "100000000000000603", type: 5, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: TARGET } }, token: "fake-ticket-submit", data: { custom_id: modal.custom_id, components: [{ type: 18, component: { custom_id: "value", value: "Please help me" } }] } });
    await until(() => f.apiCalls.some(call => call.path.includes("fake-ticket-submit") && call.body?.embeds?.[0]?.title === "Ticket opened"));
    assert.equal(f.apiCalls.filter(call => call.path === `/api/v10/guilds/${GUILD}/channels` && call.method === "POST").length, 1);
});

test("Gateway accepts ban appeal forms in bot DMs without requiring server membership", async t => {
    const f = await runtime(t, true, 32n | 4n);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    f.send("MESSAGE_CREATE", { id: "100000000000000700", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: `,appeals setup ${CHANNEL}` });
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "Ban appeals saved"));
    f.send("MESSAGE_CREATE", { id: "100000000000000701", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: `,ban ${TARGET} example reason` });
    await until(() => f.apiCalls.some(call => call.method === "PATCH" && call.body?.embeds?.[0]?.title === "Sonata ban notice"));
    const notice = f.apiCalls.find(call => call.method === "PATCH" && call.body?.embeds?.[0]?.title === "Sonata ban notice"), parts = notice.path.split("/"), dm = parts[4], message = { id: parts[6], author: { id: APP }, ...notice.body };
    f.send("INTERACTION_CREATE", { id: "100000000000000702", type: 3, channel_id: dm, user: { id: TARGET }, token: "fake-dm-appeal", message, data: { custom_id: message.components[0].components[0].custom_id, component_type: 2 } });
    await until(() => f.apiCalls.some(call => call.path.includes("fake-dm-appeal") && call.body?.type === 9));
    const modal = f.apiCalls.find(call => call.path.includes("fake-dm-appeal") && call.body?.type === 9).body.data;
    f.send("INTERACTION_CREATE", { id: "100000000000000703", type: 5, channel_id: dm, user: { id: TARGET }, token: "fake-dm-submit", data: { custom_id: modal.custom_id, components: [{ type: 18, component: { custom_id: "value", value: "Please review my case" } }] } });
    await until(() => f.apiCalls.some(call => call.path.includes("fake-dm-submit") && call.body?.embeds?.[0]?.title === "Appeal submitted"));
    assert(f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "Ban appeal · case #1" && call.path === `/api/v10/channels/${CHANNEL}/messages`));
});

test("Music controls update their card and deny members outside the displayed voice channel privately", async t => {
    const f = await runtime(t), headers = { Authorization: `Bearer ${MUSIC_SECRET}` };
    const bridge = async (path, body) => (await f.mf.dispatchFetch(`https://sonata.example/music/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined })).json();
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected); await bridge("poll");
    f.send("MESSAGE_CREATE", { id: "100000000000000800", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",play test" });
    let job; await until(async () => { job = (await bridge("poll")).jobs[0]; return !!job; });
    await bridge("result", { id: job.id, title: "Now playing", description: "A track" });
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "Now playing"));
    const posted = f.apiCalls.find(call => call.body?.embeds?.[0]?.title === "Now playing"); await until(() => !!posted.response);
    const message = { id: posted.response.id, author: { id: APP }, ...posted.body }, id = message.components[0].components[0].custom_id;
    f.send("INTERACTION_CREATE", { id: "100000000000000801", type: 3, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: TARGET } }, token: "fake-player-outsider", message, data: { custom_id: id, component_type: 2 } });
    await until(() => f.apiCalls.some(call => call.path.includes("fake-player-outsider") && /^Error code: S\d+$/.test(call.body?.content || "")));
    const rejected = f.apiCalls.find(call => call.path.includes("fake-player-outsider") && /^Error code: S\d+$/.test(call.body?.content || "")); assert.equal(rejected.body.flags, 64); assert.equal(rejected.method, "POST");
    f.send("INTERACTION_CREATE", { id: "100000000000000802", type: 3, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: ACTOR } }, token: "fake-player-owner", message, data: { custom_id: id, component_type: 2 } });
    await until(async () => { job = (await bridge("poll")).jobs[0]; return !!job; }); assert.equal(job.name, "pause");
    await bridge("result", { id: job.id, title: "Music updated", description: "Paused" });
    await until(() => f.apiCalls.some(call => call.path.includes("fake-player-owner") && call.method === "PATCH" && call.body?.embeds?.[0]?.description === "Paused"));
    assert(f.apiCalls.some(call => call.path.includes("fake-player-owner") && call.body?.type === 6));
});

test("Dashboard bridge rejects other service keys and trusts only its verified actor header", async t => {
    const f = await runtime(t);
    assert.equal((await f.request("/dashboard/owner")).status,401);
    assert.equal((await f.mf.dispatchFetch("https://sonata.example/dashboard/owner",{headers:{Authorization:`Bearer ${MUSIC_SECRET}`}})).status,401);
    const headers={Authorization:`Bearer ${DASHBOARD_SECRET}`};
    assert.equal((await f.mf.dispatchFetch("https://sonata.example/dashboard/owner",{headers})).status,401);
    assert.equal((await f.mf.dispatchFetch("https://sonata.example/dashboard/owner",{headers:{...headers,"X-Sonata-User":ACTOR}})).status,403);
    const response=await f.mf.dispatchFetch("https://sonata.example/dashboard/owner",{headers:{...headers,"X-Sonata-User":"779172192461783110"}});
    assert.equal(response.status,200); const value=await response.json(); assert.deepEqual(value.servers,[]); assert.equal(value.commands,104); assert(!JSON.stringify(value).includes("fake-test-token"));
    assert.equal((await f.mf.dispatchFetch("https://sonata.example/control/start",{method:"POST",headers})).status,401);
});

test("A prefix changed through the dashboard works immediately on the existing Gateway connection", async t=>{
    const f=await runtime(t,true,32n);await f.request('/control/start','POST');await until(async()=>(await f.status()).connected);
    f.send('MESSAGE_CREATE',{id:'100000000000000901',guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content:',ping'});await until(()=>f.apiCalls.some(call=>call.body?.message_reference?.message_id==='100000000000000901'&&call.body?.embeds?.[0]?.title==='Pong!'));
    const response=await f.mf.dispatchFetch('https://sonata.example/dashboard/action',{method:'POST',headers:{Authorization:`Bearer ${DASHBOARD_SECRET}`,'X-Sonata-User':ACTOR},body:JSON.stringify({guild:GUILD,channel:CHANNEL,name:'settings',sub:'prefix',options:{prefix:';'}})});assert.equal(response.status,200);assert((await response.json()).result.embeds?.length);
    f.send('MESSAGE_CREATE',{id:'100000000000000902',guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content:';ping'});await until(()=>f.apiCalls.some(call=>call.body?.message_reference?.message_id==='100000000000000902'&&call.body?.embeds?.[0]?.title==='Pong!'));
    assert.equal(f.sockets.length,1);
});

test("Gateway role snapshots support staff recovery after rejoining and case exports upload an actual file", async t => {
    const f = await runtime(t, true, 32n | 268435456n | 32768n); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    const message = (id, content) => f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content });
    message("100000000000000950", ",role recovery on"); await until(() => f.gatewayPackets.some(packet => packet.op === 8));
    f.send("GUILD_MEMBER_REMOVE", { guild_id: GUILD, user: { id: TARGET } }); f.memberRoles.set(TARGET, []); f.send("GUILD_MEMBER_ADD", { guild_id: GUILD, user: { id: TARGET }, roles: [] });
    message("100000000000000951", `,role restore ${TARGET}`); await until(() => f.apiCalls.some(call => call.method === "PUT" && call.path.endsWith(`/members/${TARGET}/roles/${USERROLE}`)));
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000000951"));
    message("100000000000000952", `,case export ${TARGET} json`); await until(() => f.apiCalls.some(call => call.file?.name?.startsWith("sonata-cases-")));
    const report = JSON.parse(f.apiCalls.find(call => call.file?.name?.startsWith("sonata-cases-")).file.text); assert.equal(report.userId, TARGET); assert.equal(report.cases[0].kind, "roles restored");
});

test("Gateway download replies carry the message reference through to Unicode image uploads", async t => {
    const f = await runtime(t, true, 32768n); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    f.replyMessages.set(`/channels/${CHANNEL}/messages/${TARGET}`, { id: TARGET, content: "😭", attachments: [], sticker_items: [] });
    f.send("MESSAGE_CREATE", { id: "100000000000000970", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",download", message_reference: { type: 0, guild_id: GUILD, channel_id: CHANNEL, message_id: TARGET }, referenced_message: { content: "Untrusted cached content" } });
    await until(() => f.apiCalls.some(call => call.file?.name === "emoji_1f62d.png"));
    const uploaded = f.apiCalls.find(call => call.file?.name === "emoji_1f62d.png"); assert.match(uploaded.body.content, /Twemoji/); assert.deepEqual(uploaded.body.allowed_mentions, { parse: [] });
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.title === "File ready"));
    assert(f.apiCalls.some(call => call.path.endsWith(`/messages/${TARGET}`) && call.method === "GET"));
});

test("Gateway nickname updates enforce configured rules and malformed commands appear in usage insights", async t => {
    const f = await runtime(t, true, 32n | 134217728n); await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected);
    const message = (id, content) => f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content });
    message("100000000000000980", ",nicknamepolicy setup 2 Member");
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000000980"));
    message("100000000000000981", ",nicknamepolicy block admin");
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000000981"));
    f.nicknames.set(TARGET, "Admin impostor"); f.send("GUILD_MEMBER_UPDATE", { guild_id: GUILD, user: { id: TARGET }, roles: [USERROLE], nick: "Admin impostor" });
    await until(() => f.nicknames.get(TARGET) === "Member");
    message("100000000000000982", ",kick");
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000000982" && /^Error code: S\d+$/.test(call.body?.content || "")));
    message("100000000000000983", ",commandstats summary");
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000000983"));
    const result = f.apiCalls.find(call => call.body?.message_reference?.message_id === "100000000000000983"); assert.match(result.body.embeds[0].description, /invalid: 1/);
    message("100000000000000984", ",help");
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000000984"));
    assert.match(f.apiCalls.find(call => call.body?.message_reference?.message_id === "100000000000000984").body.embeds[0].description, /\[Sonata dashboard\]/);
});


test("Owner blacklist survives Gateway startup and automatically leaves repeated invitations", async t => {
    const f = await runtime(t), headers = { Authorization: "Bearer " + DASHBOARD_SECRET, "X-Sonata-User": "779172192461783110" };
    const action = value => f.mf.dispatchFetch("https://sonata.example/dashboard/owner/action", { method: "POST", headers, body: JSON.stringify({ guild: GUILD, action: value }) });
    const owner = async () => (await f.mf.dispatchFetch("https://sonata.example/dashboard/owner", { headers })).json();
    const leaves = () => f.apiCalls.filter(call => call.method === "DELETE" && call.path === "/api/v10/users/@me/guilds/" + GUILD).length;
    assert.equal((await action("blacklist")).status, 200);
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected && leaves() === 1);
    assert.equal((await owner()).servers.length, 0);
    f.send("GUILD_CREATE", { id: GUILD, name: "Fake server", members: [], roles: [], channels: [] }); await until(() => leaves() === 2);
    f.send("MESSAGE_CREATE", { id: "100000000000009001", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",help" });
    f.send("GUILD_CREATE", { id: GUILD, name: "Fake server", members: [], roles: [], channels: [] }); await until(() => leaves() === 3);
    assert(!f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000009001"));
    assert.equal((await owner()).blacklist[0].id, GUILD);
    assert.equal((await action("unblacklist")).status, 200); assert.equal(leaves(), 3); assert.equal((await owner()).servers.length, 0);
    f.send("GUILD_CREATE", { id: GUILD, name: "Fake server", members: [], roles: [], channels: [] }); await until(async () => (await owner()).servers.length === 1);
});


test("Gateway modlogs and modstats shorthands page the original menu and reject another viewer privately", async t => {
    const f = await runtime(t);await f.request("/control/start","POST");await until(async ()=>(await f.status()).connected);
    const send=(id,content,actor=ACTOR)=>f.sockets[0].send(JSON.stringify({op:0,t:"MESSAGE_CREATE",s:100,d:{id,guild_id:GUILD,channel_id:CHANNEL,author:{id:actor},content}}));
    send("100000000000000920",`,warn ${TARGET} Test reason`);await until(()=>f.apiCalls.some(c=>c.body?.message_reference?.message_id==="100000000000000920"));
    send("100000000000000921",`,modlogs ${TARGET}`);await until(()=>f.apiCalls.some(c=>c.body?.message_reference?.message_id==="100000000000000921"));
    const call=f.apiCalls.find(c=>c.body?.message_reference?.message_id==="100000000000000921"),card={...call.body,id:call.response.id,author:{id:APP}},button=card.components[2].components[1];
    const click=(id,actor)=>f.sockets[0].send(JSON.stringify({op:0,t:"INTERACTION_CREATE",s:101,d:{id,token:"modlogs-token",type:3,guild_id:GUILD,channel_id:CHANNEL,member:{user:{id:actor}},message:card,data:{custom_id:button.custom_id,component_type:2}}}));
    click("100000000000000922",ACTOR);await until(()=>f.apiCalls.some(c=>c.path.includes("modlogs-token/messages/@original")&&c.body?.embeds?.[0]?.title==="Moderation history"));
    assert(f.apiCalls.some(c=>c.path.includes("100000000000000922")&&c.body?.type===6));
    click("100000000000000923",TARGET);await until(()=>f.apiCalls.some(c=>c.path.endsWith("modlogs-token")&&c.method==="POST"&&c.body?.flags===64));
    send("100000000000000924",`,modstats ${ACTOR}`);await until(()=>f.apiCalls.some(c=>c.body?.message_reference?.message_id==="100000000000000924"));assert.match(f.apiCalls.find(c=>c.body?.message_reference?.message_id==="100000000000000924").body.embeds[0].fields[0].name,/#1/);
});


test("Text-only X posts are skipped silently without deleting the source or recording a failure", async t => {
    const f = await runtime(t), headers = { Authorization: `Bearer ${MUSIC_SECRET}` };
    const bridge = async (path, body) => (await f.mf.dispatchFetch(`https://sonata.example/music/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined })).json();
    await f.request("/control/start", "POST"); await until(async () => (await f.status()).connected); await bridge("poll");
    const source = "https://x.com/creator/status/2119202610322227327", id = "100000000000029100";
    f.send("MESSAGE_CREATE", { id, guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: `sonata ${source}` });
    let job; await until(async () => { job = (await bridge("poll")).jobs[0]; return !!job; });
    await bridge("result", { id: job.id, title: "No media", description: "This post has no attached media.", noMedia: true });
    f.send("MESSAGE_CREATE", { id: "100000000000029101", guild_id: GUILD, channel_id: CHANNEL, author: { id: ACTOR }, content: ",ping" });
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000029101"));
    assert(!f.apiCalls.some(call => call.file || call.body?.message_reference?.message_id === id || call.method === "DELETE"));
    const result = await f.mf.dispatchFetch("https://sonata.example/dashboard/owner/failures", { headers: { Authorization: `Bearer ${DASHBOARD_SECRET}`, "X-Sonata-User": "779172192461783110" } });
    assert.equal((await result.json()).total, 0);
});
