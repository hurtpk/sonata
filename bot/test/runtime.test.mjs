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

async function until(predicate, attempts = 100) {
    for (let i = 0; i < attempts; i++) { if (await predicate()) return; await sleep(20); }
    assert.fail("Local bot did not reach the expected state");
}

async function runtime(t, configured = true, extraPermissions = 0n) {
    const sockets = [], gatewayPackets = [], apiCalls = [], memberRoles = new Map(), nicknames = new Map(), replyMessages = new Map(), channels = new Map(), bans = new Map(), uploadFailures = new Set(); let serial = 900000000000000000n, sequence = 0;
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
    return { mf, request, status, send, sockets, gatewayPackets, apiCalls, memberRoles, nicknames, replyMessages, uploadFailures };
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
    await bridge("result", { id: job.id, title: "K (@cantbreakmeoff)", description: "#mood", stats:{views:85355,likes:13313,comments:89,shares:7100},published:"2026-10-10T10:57:00.000Z", video: Buffer.from(bytes).toString("base64") });
    await until(() => f.apiCalls.some(call => call.file?.name === "sonata-video.mp4"));
    const posted = f.apiCalls.find(call => call.file?.name === "sonata-video.mp4");
    assert.equal(posted.file.text,bytes); assert.match(posted.body.embeds[0].description,/#mood/); assert.match(posted.body.embeds[0].footer.text,/Sent by/); assert.equal(posted.body.content,undefined); assert.deepEqual(posted.body.allowed_mentions.parse,[]);
    assert.match(posted.body.embeds[0].footer.text,/TikTok • 👁 85,355 • ❤️ 13,313 • 💬 89 • 🔁 7,100/);assert.equal(posted.body.embeds[0].timestamp,"2026-10-10T10:57:00.000Z");assert.equal(posted.body.message_reference,undefined);
    await until(()=>f.apiCalls.some(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000195")));assert(f.apiCalls.findIndex(call=>call.file)>0);assert(f.apiCalls.findIndex(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000195"))>f.apiCalls.indexOf(posted));
    f.send("MESSAGE_CREATE", { id: "100000000000000196", guild_id: GUILD, channel_id: CHANNEL, author: { id: TARGET }, content: `,sonata ${source}` });
    await until(async () => { job = (await bridge("poll")).jobs[0]; return !!job; });
    await bridge("result", { id: job.id, title: "Video not completed", description: "TikTok could not provide this video." });
    await until(() => f.apiCalls.some(call => call.body?.embeds?.[0]?.description === "TikTok could not provide this video."));
    const failed = f.apiCalls.find(call => call.body?.embeds?.[0]?.description === "TikTok could not provide this video."); assert.equal(failed.file,undefined); assert.equal(failed.body.content,undefined);
    assert(!f.apiCalls.some(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000196")));
});

test("All-channel automatic video uploads include channels created after the setting was saved", async t => {
    const f=await runtime(t,true,32n),headers={Authorization:`Bearer ${MUSIC_SECRET}`};
    const bridge=async(path,body)=>(await f.mf.dispatchFetch(`https://sonata.example/music/${path}`,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined})).json();
    await f.request("/control/start","POST");await until(async()=>(await f.status()).connected);await bridge("poll");
    f.send("MESSAGE_CREATE",{id:"100000000000000197",guild_id:GUILD,channel_id:CHANNEL,author:{id:ACTOR},content:",settings videoembeds true all"});
    await until(()=>f.apiCalls.some(call=>call.body?.embeds?.[0]?.title==="Settings saved"));
    const newChannel="888888888888888899";f.replyMessages.set(`/channels/${newChannel}`,{id:newChannel,guild_id:GUILD,type:0,permission_overwrites:[]});
    const source="https://www.tiktok.com/@cantbreakmeoff/video/7689630196105874718";f.replyMessages.set(`/channels/${newChannel}/messages/100000000000000198`,{author:{id:TARGET},content:source});
    f.send("MESSAGE_CREATE",{id:"100000000000000198",guild_id:GUILD,channel_id:newChannel,author:{id:TARGET},content:source});
    let job;await until(async()=>{job=(await bridge("poll")).jobs[0];return !!job;});assert.equal(job.channel,newChannel);assert.equal(job.kind,"video");
    await bridge("result",{id:job.id,title:"Automatic clip",description:"#mood",video:Buffer.from("0000ftyp0000test").toString("base64")});
    await until(()=>f.apiCalls.some(call=>call.path.endsWith(`/channels/${newChannel}/messages`)&&call.file?.name==="sonata-video.mp4"));
    await until(()=>f.apiCalls.some(call=>call.method==="DELETE"&&call.path.endsWith("100000000000000198")));
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

test("Cloudflare Gateway identifies, responds to prefix and slash commands, and resumes", async t => {
    const f = await runtime(t);
    assert.equal((await f.request("/control/start", "POST")).status, 200);
    await until(async () => (await f.status()).connected);
    assert.equal(f.gatewayPackets.find(packet => packet.op === 2).d.intents, 33415);
    const activity = { name: "Custom Status", type: 4, state: "harmonizing 1 server" }, identify=f.gatewayPackets.find(packet=>packet.op===2).d;
    assert.deepEqual(identify.presence.activities,[{...activity,state:"harmonizing 0 servers"}]);assert.equal(identify.presence.status,"dnd");assert.equal(identify.properties.browser,"Discord iOS");assert.equal(identify.properties.device,"Discord iOS");
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
    await until(async()=>(await f.status()).activity.state==="harmonizing 3 servers");
    f.send("GUILD_DELETE",{id:second});f.send("GUILD_DELETE",{id:third,unavailable:true});
    await until(async()=>(await f.status()).activity.state==="harmonizing 2 servers");
    await until(()=>f.gatewayPackets.some(packet=>packet.op===3&&packet.d.activities[0].state==="harmonizing 2 servers"),350);
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
    await until(() => f.apiCalls.some(call => call.method === "POST" && call.body?.embeds?.[0]?.title === "Command not completed"));
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
    await until(() => f.apiCalls.some(call => call.path.includes("fake-player-outsider") && call.body?.embeds?.[0]?.title === "Control not completed"));
    const rejected = f.apiCalls.find(call => call.path.includes("fake-player-outsider") && call.body?.embeds?.[0]?.title === "Control not completed"); assert.equal(rejected.body.flags, 64); assert.equal(rejected.method, "POST");
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
    assert.equal(response.status,200); const value=await response.json(); assert.deepEqual(value.servers,[]); assert.equal(value.commands,100); assert(!JSON.stringify(value).includes("fake-test-token"));
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
    await until(() => f.apiCalls.some(call => call.body?.message_reference?.message_id === "100000000000000982" && call.body?.embeds?.[0]?.title === "Command not completed"));
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
