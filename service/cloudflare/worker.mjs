/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";

import { createApplication } from "../application.mjs";
import { validId } from "../protocol.mjs";
import { d1Store } from "./store.mjs";

const applications = new WeakMap();

function configuration(env, requestUrl) {
    const publicUrl = env.PUBLIC_URL ?? new URL(requestUrl).origin;
    let validOrigin = false;
    try { const url = new URL(publicUrl); validOrigin = url.origin === publicUrl && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))); }
    catch { validOrigin = false; }
    const adminIds = String(env.ADMIN_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
    return { publicUrl, clientId: env.DISCORD_CLIENT_ID ?? "", clientSecret: env.DISCORD_CLIENT_SECRET ?? "", adminIds, scheduledCleanup: true,
        configured: !!(validOrigin && env.PUBLIC_URL && validId(env.DISCORD_CLIENT_ID) && env.DISCORD_CLIENT_SECRET && adminIds.length && adminIds.every(validId) && env.DB) };
}

export default {
    async fetch(request, env) {
        const config = configuration(env, request.url), url = new URL(request.url);
        if (!config.configured && (url.pathname.startsWith("/auth/") || (url.pathname.startsWith("/api/") && url.pathname !== "/api/info"))) return Response.json({ error: "Finish configuring the Discord application and service URL before signing in." }, { status: 503, headers: { "Cache-Control": "no-store" } });
        if (!config.configured && url.pathname === "/api/info") return Response.json({ configured: false, demo: false }, { headers: { "Cache-Control": "no-store" } });
        let application = applications.get(env);
        if (!application) {
            if (!config.configured) config.publicUrl = url.origin;
            application = createApplication(config, d1Store(env.DB), undefined, async name => {
                const asset = await env.ASSETS.fetch(new URL(`/${name}`, "https://assets.local"));
                if (!asset.ok) throw new Error("Dashboard asset unavailable.");
                return Buffer.from(await asset.arrayBuffer());
            });
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
