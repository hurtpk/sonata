/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { hash, random } from "../../protocol.mjs";

process.env.SONATA_TEST_D1 = "1";
await import("../../test/service.test.mjs");

async function runtime(t, configured = true, provider = "normal", bridge) {
    const options = convertV4MiniflareOptions({ workers: [{ name: "test", modules: true, scriptPath: fileURLToPath(new URL("../.check/worker.js", import.meta.url)), compatibilityDate: "2026-10-28", compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"], bindings: configured ? { PUBLIC_URL: "https://sonata.example", DISCORD_CLIENT_ID: "444444444444444444", DISCORD_CLIENT_SECRET: "test-only", ADMIN_USER_IDS: "111111111111111111", ...(bridge ? { BOT_DASHBOARD_SECRET: "fake-private-dashboard-key-at-least-32-characters" } : {}) } : {},
        serviceBindings: bridge ? { BOT_SERVICE: { node: bridge } } : {},
        outboundService: async request => {
            if ((provider === "tokenRedirect" && request.url.endsWith("/token")) || (provider === "profileRedirect" && request.url.endsWith("/@me"))) return new Response(null, { status: 302, headers: { Location: "https://other.example/" } });
            if (request.url === "https://discord.com/api/oauth2/token") return Response.json({ access_token: "test-token", token_type: "Bearer" });
            assert.equal(request.url, "https://discord.com/api/v10/users/@me");
            return Response.json({ id: "111111111111111111", username: "test-owner", global_name: "Test owner" });
        },
        assets: { directory: fileURLToPath(new URL("../../public/", import.meta.url)), binding: "ASSETS", run_worker_first: true, assetConfig: { html_handling: "none" } },
    }] });
    options.workers[0].config.assets.hasUserWorker = true;
    const worker = new Miniflare(options);
    t.after(() => worker.dispose());
    const db = await worker.getD1Database("DB");
    const schema = await readFile(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8") + await readFile(new URL("../../migrations/0002_bot_dashboard.sql", import.meta.url), "utf8") + await readFile(new URL("../../migrations/0003_user_profiles.sql", import.meta.url), "utf8") + await readFile(new URL("../../migrations/0004_admin_grants.sql", import.meta.url), "utf8");
    for (const sql of schema.split(";").map(sql => sql.trim()).filter(Boolean)) await db.prepare(sql).run();
    return { worker, db };
}

test("Worker serves dashboard assets with security headers and fails closed before configuration", async t => {
    const { worker } = await runtime(t, false);
    const page = await worker.dispatchFetch("https://sonata.example/admin", { redirect: "manual" });
    assert.equal(page.status, 302); assert.equal(page.headers.get("location"), "/");
    assert.doesNotMatch(await page.text(), /Administrator sign-in/);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal((await worker.dispatchFetch("https://sonata.example/style.css")).status, 200);
    const info = await worker.dispatchFetch("https://sonata.example/api/info");
    assert.deepEqual(await info.json(), { configured: false, demo: false });
    assert.equal((await worker.dispatchFetch("https://sonata.example/auth/start")).status, 503);
    assert.equal((await worker.dispatchFetch("https://sonata.example/api/admin/users")).status, 503);
});

test("Worker adapts JSON bodies, D1 credentials, cookies and administrator blocks", async t => {
    const { worker, db } = await runtime(t), user = "222222222222222222", token = random(), csrf = random(), session = random();
    await db.prepare("INSERT INTO users (id,username) VALUES (?,?)").bind(user, "Test user").run();
    await db.prepare("INSERT INTO devices VALUES (?,?,?)").bind(hash(token), user, Date.now() + 3600_000).run();
    await db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?)").bind(hash(session), "111111111111111111", "Owner", csrf, Date.now() + 3600_000).run();
    const request = (path, body, headers = {}) => worker.dispatchFetch("https://sonata.example" + path, { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await request("/api/admin/users")).status, 401);
    assert.equal((await (await request("/api/check-in", { userId: user, version: "test" }, { Authorization: `Bearer ${token}` })).json()).status, "allowed");
    const blocked = await request("/api/admin/block", { userId: user, blocked: true, reason: "Test note" }, { Cookie: `sonata_admin=${session}`, Origin: "https://sonata.example", "X-CSRF-Token": csrf });
    assert.equal(blocked.status, 200);
    assert.equal((await (await request("/api/check-in", { userId: user, version: "test" }, { Authorization: `Bearer ${token}` })).json()).status, "blocked");
    const login = await request("/auth/start");
    assert.equal(login.status, 302); assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
    assert.equal(new URL(login.headers.get("location")).searchParams.get("redirect_uri"), "https://sonata.example/auth/callback");
    assert.equal((await request("/api/admin/users", null, { Origin: "https://other.example" })).status, 403);
});

test("Worker completes the Discord callback and authenticates the resulting administrator cookie", async t => {
    const { worker } = await runtime(t);
    const start = await worker.dispatchFetch("https://sonata.example/auth/start", { redirect: "manual" });
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const flowCookie = start.headers.get("set-cookie").split(";")[0];
    const callback = await worker.dispatchFetch(`https://sonata.example/auth/callback?${new URLSearchParams({ state, code: "test-code" })}`, { redirect: "manual", headers: { Cookie: flowCookie } });
    assert.equal(callback.status, 302, await callback.text());
    assert.equal(callback.headers.get("location"), "/admin");
    const cookies = callback.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const session = await worker.dispatchFetch("https://sonata.example/api/admin/session", { headers: { Cookie: cookies } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).id, "111111111111111111");
});

for (const provider of ["tokenRedirect", "profileRedirect"]) test(`Worker refuses OAuth redirects during ${provider}`, async t => {
    const { worker, db } = await runtime(t, true, provider);
    const start = await worker.dispatchFetch("https://sonata.example/auth/start", { redirect: "manual" });
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const callback = await worker.dispatchFetch(`https://sonata.example/auth/callback?${new URLSearchParams({ state, code: "test-code" })}`, { redirect: "manual", headers: { Cookie: start.headers.get("set-cookie").split(";")[0] } });
    assert.equal(callback.status, 502);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 0);
});

test("Cloudflare dashboard binding forwards only a session-verified actor and keeps its key off the browser", async t => {
    const calls=[], bridge=async(request,response)=>{let raw='';for await(const chunk of request)raw+=chunk;calls.push({url:request.url,headers:request.headers,body:raw?JSON.parse(raw):null});response.setHeader('Content-Type','application/json');response.end(JSON.stringify({servers:[]}));};
    const {worker,db}=await runtime(t,true,'normal',bridge),session=random(),user='222222222222222222';
    await db.prepare('INSERT INTO bot_sessions VALUES (?,?,?,?,?)').bind(hash(session),user,'Server manager','fake-csrf',Date.now()+3600000).run();
    const headers={Cookie:`sonata_bot=${session}`};
    const result=await worker.dispatchFetch('https://sonata.example/api/bot/servers',{headers});assert.equal(result.status,200);assert.deepEqual(await result.json(),{servers:[]});assert.equal(calls[0].headers['x-sonata-user'],user);assert.equal(calls[0].headers.authorization,'Bearer fake-private-dashboard-key-at-least-32-characters');
    assert.equal((await worker.dispatchFetch('https://sonata.example/api/admin/bot',{headers})).status,401);
    const action=await worker.dispatchFetch('https://sonata.example/api/bot/action',{method:'POST',headers:{...headers,Origin:'https://sonata.example','Content-Type':'application/json','X-CSRF-Token':'fake-csrf'},body:JSON.stringify({actor:'111111111111111111',name:'levels'})});assert.equal(action.status,200);assert.equal(calls[1].headers['x-sonata-user'],user);
    assert.equal((await worker.dispatchFetch('https://sonata.example/api/bot/action',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,403);
});

test("Cloudflare bot sign-in creates a D1 bot session without granting owner access", async t=>{
    const {worker,db}=await runtime(t),start=await worker.dispatchFetch('https://sonata.example/auth/start?bot=1',{redirect:'manual'}),url=new URL(start.headers.get('location')),state=url.searchParams.get('state');
    const finish=await worker.dispatchFetch(`https://sonata.example/auth/callback?state=${state}&code=fake-code`,{redirect:'manual',headers:{Cookie:`sonata_oauth=${state}`}});assert.equal(finish.status,302);assert.equal(finish.headers.get('location'),'/');
    const cookie=finish.headers.get('set-cookie').match(/sonata_bot=([a-f0-9]+)/)[1];assert.equal((await worker.dispatchFetch('https://sonata.example/api/admin/session',{headers:{Cookie:`sonata_bot=${cookie}`}})).status,401);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM bot_sessions').first()).n,1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n,0);
});

test("The Sonata hostname forwards only named bot routes and preserves bearer authentication", async t => {
    const calls = [], bridge = async (request, response) => {
        let body = ""; for await (const chunk of request) body += chunk;
        calls.push({ path: new URL(request.url, "https://bot.internal").pathname, method: request.method, auth: request.headers.authorization, body });
        if (calls.at(-1).path === "/invite") { response.writeHead(302, { Location: "https://discord.com/oauth2/authorize?permissions=8" }); response.end(); return; }
        response.writeHead(request.headers.authorization === "Bearer fake-music-key" ? 200 : 401, { "Content-Type": "application/json" }); response.end(JSON.stringify({ forwarded: true }));
    };
    const { worker } = await runtime(t, true, "normal", bridge);
    const invite = await worker.dispatchFetch("https://sonata.example/invite", { redirect: "manual" }); assert.equal(invite.status, 302); assert.match(invite.headers.get("location"), /permissions=8/);
    const poll = "https://sonata.example/bot-api/music/poll";
    assert.equal((await worker.dispatchFetch(poll)).status, 401);
    assert.equal((await worker.dispatchFetch(poll, { headers: { Authorization: "Bearer fake-music-key" } })).status, 200);
    const result = await worker.dispatchFetch("https://sonata.example/bot-api/music/result", { method: "POST", headers: { Authorization: "Bearer fake-music-key", "Content-Type": "application/json" }, body: '{"id":"test"}' });
    assert.equal(result.status, 200); assert.equal(calls.at(-1).path, "/music/result"); assert.equal(calls.at(-1).body, '{"id":"test"}');
    const n = calls.length;
    assert.equal((await worker.dispatchFetch("https://sonata.example/bot-api/dashboard/owner")).status, 404);
    assert.equal((await worker.dispatchFetch("https://sonata.example/bot-api/control/arbitrary", { method: "POST" })).status, 404);
    assert.equal(calls.length, n);
    const root = await worker.dispatchFetch("https://sonata.example/"); assert.match(await root.text(), /id="bot-workspace"/);
});


test("Cloudflare owner departures require the administrator cookie and CSRF before reaching the bot", async t => {
    const calls = [], bridge = async (request, response) => { let body = ""; for await (const part of request) body += part; calls.push({ url: request.url, actor: request.headers["x-sonata-user"], body: JSON.parse(body) }); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ok: true })); };
    const { worker, db } = await runtime(t, true, "normal", bridge), token = random(), csrf = random();
    await db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?)").bind(hash(token), "111111111111111111", "Owner", csrf, Date.now() + 3600000).run();
    const action = headers => worker.dispatchFetch("https://sonata.example/api/admin/bot/action", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ guild: "222222222222222222", action: "leave", actor: "333333333333333333" }) });
    assert.equal((await action({})).status, 401);
    assert.equal((await action({ Cookie: "sonata_admin=" + token })).status, 403);
    assert.equal((await action({ Cookie: "sonata_admin=" + token, Origin: "https://attacker.example", "X-CSRF-Token": csrf })).status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await action({ Cookie: "sonata_admin=" + token, Origin: "https://sonata.example", "X-CSRF-Token": csrf })).status, 200);
    assert.equal(calls[0].url, "/dashboard/owner/action"); assert.equal(calls[0].actor, "111111111111111111");
});
