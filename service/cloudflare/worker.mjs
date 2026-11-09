/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";

import { createApplication } from "../application.mjs";
import { validId } from "../protocol.mjs";
import { d1Store } from "./store.mjs";
import { failure } from "../auth.mjs";

const applications = new WeakMap();

function configuration(env, requestUrl) {
    const publicUrl = env.PUBLIC_URL ?? new URL(requestUrl).origin;
    let validOrigin = false;
    try { const url = new URL(publicUrl); validOrigin = url.origin === publicUrl && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))); }
    catch { validOrigin = false; }
    const adminIds = String(env.ADMIN_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
    return { publicUrl, clientId: env.DISCORD_CLIENT_ID ?? "", clientSecret: env.DISCORD_CLIENT_SECRET ?? "", adminIds, scheduledCleanup: true, version: env.VERSION?.id || "local",
        configured: !!(validOrigin && env.PUBLIC_URL && validId(env.DISCORD_CLIENT_ID) && env.DISCORD_CLIENT_SECRET && adminIds.length && adminIds.every(validId) && env.DB) };
}

const website = {
    async fetch(request, env) {
        const config = configuration(env, request.url), url = new URL(request.url);
        const publicBotRoute = request.method === "GET" && url.pathname === "/invite";
        const bridgePath = url.pathname.slice("/bot-api".length);
        const botBridge = url.pathname.startsWith("/bot-api/") && ((request.method === "GET" && ["/health", "/control/status", "/music/poll"].includes(bridgePath)) || (request.method === "POST" && ["/control/start", "/control/stop", "/music/voice", "/music/result", "/music/video"].includes(bridgePath)));
        if (publicBotRoute || botBridge) {
            if (!env.BOT_SERVICE) return Response.json({ error: "The bot connection is not configured." }, { status: 503 });
            return env.BOT_SERVICE.fetch(new Request(`https://bot.internal${publicBotRoute ? url.pathname : bridgePath}${url.search}`, request));
        }
        const legacy = config.publicUrl === "https://sonatabot.info" && url.origin === "https://sonata.hurts.workers.dev";
        if (legacy && ["GET", "HEAD"].includes(request.method)) return Response.redirect(`${config.publicUrl}${url.pathname}${url.search}`, 308);
        if (legacy && request.method === "POST" && !request.headers.has("origin") && !request.headers.has("cookie") && ["/api/activation/direct", "/api/activation/start", "/api/activation/finish", "/api/check-in", "/api/disconnect"].includes(url.pathname)) {
            request = new Request(`${config.publicUrl}${url.pathname}${url.search}`, request);
            url.host = new URL(config.publicUrl).host;
        }
        if (!config.configured && (url.pathname.startsWith("/auth/") || (url.pathname.startsWith("/api/") && url.pathname !== "/api/info"))) return Response.json({ error: "Finish configuring the Discord application and service URL before signing in." }, { status: 503, headers: { "Cache-Control": "no-store" } });
        if (!config.configured && url.pathname === "/api/info") return Response.json({ configured: false, demo: false }, { headers: { "Cache-Control": "no-store" } });
        let application = applications.get(env);
        if (!application) {
            if (!config.configured) config.publicUrl = url.origin;
            application = createApplication(config, d1Store(env.DB), undefined, async name => {
                const asset = await env.ASSETS.fetch(new URL(`/${name}`, "https://assets.local"));
                if (!asset.ok) throw new Error("Dashboard asset unavailable.");
                return Buffer.from(await asset.arrayBuffer());
            }, env.BOT_SERVICE && env.BOT_DASHBOARD_SECRET ? async (path, actor, input, permissions = []) => {
                const result = await env.BOT_SERVICE.fetch(`https://bot.internal/dashboard/${path}`, { method: input ? "POST" : "GET", redirect: "manual", headers: { Authorization: `Bearer ${env.BOT_DASHBOARD_SECRET}`, "X-Sonata-User": actor, "X-Sonata-Permissions": permissions.join(","), "Content-Type": "application/json" }, body: input ? JSON.stringify(input) : undefined });
                const value = await result.json();
                if (!result.ok) throw failure(result.status, value.error || "The bot dashboard could not complete this request.");
                return value;
            } : undefined);
            applications.set(env, application);
        }
        const headers = Object.fromEntries(request.headers);
        headers.host = url.host;
        const incoming = { url: url.pathname + url.search, method: request.method, headers, socket: { remoteAddress: headers["cf-connecting-ip"] ?? "local" },
            async *[Symbol.asyncIterator]() { if (request.body) yield* request.body; } };
        const outgoingHeaders = new Headers();
        let status = 200, body = "";
        const outgoing = { destroyed: false,
            setHeader(name, value) { outgoingHeaders.delete(name); for (const part of Array.isArray(value) ? value : [value]) outgoingHeaders.append(name, String(part)); },
            writeHead(code, values) { status = code; for (const [name, value] of Object.entries(values ?? {})) this.setHeader(name, value); },
            end(value) { body = value ?? ""; },
        };
        await application(incoming, outgoing);
        return new Response(body, { status, headers: outgoingHeaders });
    },
    async scheduled(_event, env, context) { context.waitUntil(d1Store(env.DB).cleanup()); },
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        let response;
        if (url.protocol === "http:") response = Response.redirect(request.url.replace(/^http:/, "https:"), 308);
        else {
            const authentication = url.pathname.startsWith("/auth/") || ["/api/activation/start", "/api/activation/direct"].includes(url.pathname);
            const limited = authentication || url.pathname.startsWith("/api/");
            if (limited) {
                const limiter = authentication ? env.AUTH_RATE_LIMIT : env.API_RATE_LIMIT;
                try {
                    if (!limiter) response = Response.json({ error: "This service is temporarily unavailable." }, { status: 503 });
                    else if (!(await limiter.limit({ key: `${authentication ? "auth" : "api"}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}` })).success) {
                        response = Response.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers: { "Retry-After": "60" } });
                    }
                } catch { response = Response.json({ error: "This service is temporarily unavailable." }, { status: 503 }); }
            }
            response ??= await website.fetch(request, env);
        }
        const headers = new Headers(response.headers);
        headers.set("Strict-Transport-Security", "max-age=15552000");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("X-Frame-Options", "SAMEORIGIN");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
        headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'; upgrade-insecure-requests");
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/bot-api/") || url.pathname === "/admin") headers.set("Cache-Control", "no-store");
        if (url.pathname === "/admin" || url.pathname.startsWith("/auth/")) headers.set("X-Robots-Tag", "noindex, nofollow");
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },
    scheduled: website.scheduled,
};
