/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { adminAccess } from "./adminAccess.mjs";
import { Buffer } from "node:buffer";

import { hash, random, validId, validToken } from "./protocol.mjs";

export const failure = (status, message) => Object.assign(new Error(message), { status });
export const cookies = request => Object.fromEntries((request.headers.cookie ?? "").split(";").map(part => part.trim().split("=")).filter(parts => parts.length === 2));

async function discordJson(response) {
    if (!response.body) throw failure(502, "Discord returned an empty sign-in response.");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 131_072) throw failure(502, "Discord's sign-in response was too large."); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (value && typeof value === "object" && !Array.isArray(value)) return value; }
    catch { throw failure(502, "Discord returned an unreadable sign-in response."); }
    throw failure(502, "Discord returned an invalid sign-in response.");
}

export function createAuth(config, store, discordFetch = fetch) {
    const secure = new URL(config.publicUrl).protocol === "https:" ? "; Secure" : "";
    const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
    const session = async request => {
        const token = cookies(request).sonata_admin;
        if (!validToken(token)) return null;
        const found = await store.get("SELECT * FROM sessions WHERE hash=? AND expires>?", hash(token), Date.now());
        if (!found) return null; const access = await adminAccess(config, store, found.user_id); return access ? { ...found, ...access } : null;
    };
    const botSession = async request => { const token = cookies(request).sonata_bot; return validToken(token) ? await store.get("SELECT * FROM bot_sessions WHERE hash=? AND expires>?", hash(token), Date.now()) : null; };
    const login = async (pairingId, response, bot = false) => {
        if (!config.clientId || !config.clientSecret) throw failure(503, "Configure the Discord application before signing in.");
        if (pairingId && !await store.get("SELECT id FROM pairings WHERE id=? AND expires>?", pairingId, Date.now())) throw failure(400, "This activation link has expired. Start again in Sonata.");
        const state = random();
        await store.run("INSERT INTO flows VALUES (?,?,?)", hash(state), pairingId || null, Date.now() + 600_000);
        if (bot && !pairingId) await store.run("INSERT INTO bot_flows VALUES (?,?)", hash(state), Date.now() + 600_000);
        response.setHeader("Set-Cookie", cookie("sonata_oauth", state, 600));
        const url = new URL("https://discord.com/oauth2/authorize");
        url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", scope: "identify", state, redirect_uri: `${config.publicUrl}/auth/callback`, prompt: "consent" }).toString();
        return url.href;
    };
    const finish = async (request, response, url) => {
        const state = url.searchParams.get("state"), code = url.searchParams.get("code");
        if (!validToken(state) || state !== cookies(request).sonata_oauth || !code || code.length > 2048 || (url.searchParams.has("iss") && url.searchParams.get("iss") !== "https://discord.com")) throw failure(400, "Sign-in could not be verified. Start again from Sonata or the dashboard.");
        const flow = await store.get("DELETE FROM flows WHERE hash=? AND expires>? RETURNING *", hash(state), Date.now());
        if (!flow) throw failure(400, "This sign-in has expired or was already used.");
        const botFlow = await store.get("DELETE FROM bot_flows WHERE hash=? AND expires>? RETURNING *", hash(state), Date.now());
        response.setHeader("Set-Cookie", cookie("sonata_oauth", "", 0));
        const tokenResponse = await discordFetch("https://discord.com/api/oauth2/token", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(12_000), body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, redirect_uri: `${config.publicUrl}/auth/callback` }) });
        if (!tokenResponse.ok) throw failure(502, "Discord could not complete sign-in. Please try again.");
        const token = await discordJson(tokenResponse);
        if (typeof token.access_token !== "string" || token.token_type?.toLowerCase() !== "bearer") throw failure(502, "Discord returned an invalid sign-in response.");
        const userResponse = await discordFetch("https://discord.com/api/v10/users/@me", { redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { Authorization: `Bearer ${token.access_token}` } });
        if (!userResponse.ok) throw failure(502, "Discord could not verify your account.");
        const user = await discordJson(userResponse);
        if (!validId(user.id) || typeof user.username !== "string") throw failure(502, "Discord returned an invalid account.");
        if (flow.pairing_id) {
            const pairing = await store.get("SELECT * FROM pairings WHERE id=? AND expires>?", flow.pairing_id, Date.now());
            if (!pairing) throw failure(400, "This activation has expired. Return to Sonata to start again.");
            if (pairing.user_id !== user.id) throw failure(403, "Sign into the same Discord account that is open in Sonata.");
            await store.batch([
                ["INSERT INTO users (id,username,name) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name", user.id, user.username.slice(0, 100), String(user.global_name ?? user.username).slice(0, 100)],
                ["INSERT INTO user_profiles VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET avatar=excluded.avatar,discriminator=excluded.discriminator,updated=excluded.updated", user.id, /^(?:a_)?[a-f0-9]{32}$/i.test(user.avatar ?? "") ? user.avatar : "", /^\d{1,4}$/.test(user.discriminator ?? "") ? user.discriminator : "0", Date.now()],
                ["UPDATE pairings SET approved=1 WHERE id=?", pairing.id],
            ]);
            return "/activate?activated=1";
        }
        if (botFlow) {
            const raw = random();
            await store.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(raw), user.id, user.username.slice(0, 100), random(), Date.now() + 12 * 3600_000);
            response.setHeader("Set-Cookie", [cookie("sonata_oauth", "", 0), cookie("sonata_bot", raw, 43200)]);
            return "/";
        }
        if (!await adminAccess(config, store, user.id)) throw failure(403, "This dashboard is only available to Sonata's configured administrators.");
        const raw = random();
        await store.run("INSERT INTO sessions VALUES (?,?,?,?,?)", hash(raw), user.id, user.username.slice(0, 100), random(), Date.now() + 12 * 3600_000);
        response.setHeader("Set-Cookie", [cookie("sonata_oauth", "", 0), cookie("sonata_admin", raw, 43200)]);
        return "/admin";
    };
    const logout = async (request, response) => {
        const found = cookies(request);
        for (const [name, table] of [["sonata_admin", "sessions"], ["sonata_bot", "bot_sessions"]]) if (validToken(found[name])) await store.run(`DELETE FROM ${table} WHERE hash=?`, hash(found[name]));
        response.setHeader("Set-Cookie", [cookie("sonata_admin", "", 0), cookie("sonata_bot", "", 0)]);
    };
    return { cookie, session, botSession, login, finish, logout };
}
