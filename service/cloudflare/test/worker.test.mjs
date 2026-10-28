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

async function runtime(t, configured = true, provider = "normal") {
    const options = convertV4MiniflareOptions({ workers: [{ name: "test", modules: true, scriptPath: fileURLToPath(new URL("../.check/worker.js", import.meta.url)), compatibilityDate: "2026-10-28", compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"], bindings: configured ? { PUBLIC_URL: "https://sonata.example", DISCORD_CLIENT_ID: "444444444444444444", DISCORD_CLIENT_SECRET: "test-only", ADMIN_USER_IDS: "111111111111111111" } : {},
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
    const schema = await readFile(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8");
    for (const sql of schema.split(";").map(sql => sql.trim()).filter(Boolean)) await db.prepare(sql).run();
    return { worker, db };
}

test("Worker serves dashboard assets with security headers and fails closed before configuration", async t => {
    const { worker } = await runtime(t, false);
    const page = await worker.dispatchFetch("https://sonata.example/admin");
    assert.equal(page.status, 200); assert.match(await page.text(), /Sonata/);
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
