/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const API = "https://discord.com/api/v10";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const hex = h => new Uint8Array((h.match(/.{1,2}/g) ?? []).map(b => parseInt(b, 16)));

/** Discord signs every request it sends; anything not signed by Discord is turned away. */
async function fromDiscord(req, body, env) {
    const sig = req.headers.get("X-Signature-Ed25519");
    const time = req.headers.get("X-Signature-Timestamp");
    if (!sig || !time || !env.DISCORD_PUBLIC_KEY) return false;
    try {
        const key = await crypto.subtle.importKey("raw", hex(env.DISCORD_PUBLIC_KEY.trim()), { name: "Ed25519" }, false, ["verify"]);
        return await crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(time + body));
    } catch { return false; }
}

/** Only your Sonata knows the secret. Compared in constant time. */
function fromYou(req, env) {
    const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const want = env.SONATA_SECRET ?? "";
    if (!want || got.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
}

const newId = () => {
    const a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return [...a].map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
};

/** {user} → a mention of whoever pressed it, {name} → their name, {server} → the server's ID. */
function fillIn(text, interaction) {
    const user = interaction.member?.user ?? interaction.user ?? {};
    return String(text)
        .replaceAll("{user}", user.id ? `<@${user.id}>` : "you")
        .replaceAll("{name}", user.global_name || user.username || "you")
        .replaceAll("{server}", interaction.guild_id ?? "");
}

async function discordRequest(interaction, env) {
    // 1 = Discord checking the address works.
    if (interaction.type === 1) return json({ type: 1 });
    // 3 = someone pressed a button.
    if (interaction.type === 3) {
        const cid = String(interaction.data?.custom_id ?? "");
        if (cid.startsWith("sonata:r:")) {
            const saved = await env.REPLIES.get(cid.slice(9), "json");
            const text = saved?.text ? fillIn(saved.text, interaction) : "This button's message has been removed.";
            return json({ type: 4, data: { content: text.slice(0, 2000), flags: 64, allowed_mentions: { parse: [] } } });
        }
    }
    return json({ type: 4, data: { content: "This button doesn't do anything any more.", flags: 64 } });
}

async function yourRequest(req, env, url) {
    if (!fromYou(req, env)) return json({ error: "Wrong secret" }, 401);
    const path = url.pathname.replace(/\/+$/, "");
    const body = req.method === "GET" || req.method === "DELETE" ? null : await req.json().catch(() => ({}));

    // Is everything set up?
    if (path === "/api/ping") {
        const missing = ["DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "SONATA_SECRET"].filter(k => !env[k]);
        if (!env.REPLIES) missing.push("REPLIES (KV namespace)");
        let app = null;
        if (env.DISCORD_BOT_TOKEN) {
            const r = await fetch(`${API}/applications/@me`, { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
            if (r.ok) { const a = await r.json(); app = { id: a.id, name: a.name, interactionsUrl: a.interactions_endpoint_url ?? null }; }
            else missing.push("a working DISCORD_BOT_TOKEN");
        }
        return json({ ok: missing.length === 0, missing, app });
    }

    // Save a reply → its ID (for the button).
    if (path === "/api/replies" && req.method === "POST") {
        const text = String(body?.text ?? "").slice(0, 2000);
        if (!text.trim()) return json({ error: "Empty reply" }, 400);
        const id = newId();
        await env.REPLIES.put(id, JSON.stringify({ text, at: Date.now() }));
        return json({ id });
    }

    // Change or remove a reply.
    const m = path.match(/^\/api\/replies\/([a-z0-9]{6,32})$/);
    if (m && req.method === "GET") {
        const saved = await env.REPLIES.get(m[1], "json");
        return saved ? json({ text: saved.text }) : json({ error: "Not found" }, 404);
    }
    if (m && req.method === "PUT") {
        const text = String(body?.text ?? "").slice(0, 2000);
        await env.REPLIES.put(m[1], JSON.stringify({ text, at: Date.now() }));
        return json({ ok: true });
    }
    if (m && req.method === "DELETE") { await env.REPLIES.delete(m[1]); return json({ ok: true }); }

    // A webhook owned by your bot, in a channel — the only kind Discord lets send clickable buttons.
    if (path === "/api/webhooks" && req.method === "POST") {
        const channel = String(body?.channel_id ?? "");
        if (!/^\d{5,25}$/.test(channel)) return json({ error: "Missing channel" }, 400);
        const r = await fetch(`${API}/channels/${channel}/webhooks`, {
            method: "POST",
            headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
            body: JSON.stringify({ name: String(body?.name || "Sonata").slice(0, 80) }),
        });
        const w = await r.json().catch(() => ({}));
        if (!r.ok) return json({ error: w?.message ?? `Discord answered ${r.status}` }, r.status === 403 ? 403 : 400);
        return json({ url: `https://discord.com/api/webhooks/${w.id}/${w.token}`, id: w.id, name: w.name });
    }

    return json({ error: "Not found" }, 404);
}

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api/")) return yourRequest(req, env, url);
        if (req.method !== "POST") return new Response("Sonata private replies are running. ✓", { headers: { "content-type": "text/plain; charset=utf-8" } });
        const body = await req.text();
        if (!(await fromDiscord(req, body, env))) return new Response("Bad signature", { status: 401 });
        return discordRequest(JSON.parse(body), env);
    },
};
