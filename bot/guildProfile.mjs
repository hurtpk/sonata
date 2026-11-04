/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";
import { fail } from "./discord.mjs";

export const PROFILE_BODY_LIMIT = 3 * 1024 * 1024;
const DEFAULT_BIO = "Moderation, music, and server tools.";
const savedProfile = (store, guild) => JSON.parse(store.get("SELECT data FROM guild_profiles WHERE guild=?", guild)?.data ?? "{}");
const saveProfile = (store, guild, data) => store.run("INSERT INTO guild_profiles VALUES (?,?) ON CONFLICT(guild) DO UPDATE SET data=excluded.data", guild, JSON.stringify(data));

export function profileBio(text = DEFAULT_BIO, prefix = ",") {
    if (typeof text !== "string" || text.length > 100 || /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text)) fail("Use up to 100 characters of bio text without control characters.");
    return `${text.trim()}${text.trim() ? "\n\n" : ""}Commands: \`/help\` • \`${prefix}help\`\nDashboard: https://sonatabot.info`;
}

function imageData(value) {
    if (value === null) return null;
    if (typeof value !== "string" || value.length > 1_400_000) fail("Choose a PNG, JPEG or GIF image no larger than 1 MB.");
    const match = /^data:image\/(png|jpeg|gif);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(value);
    if (!match) fail("Upload a PNG, JPEG or GIF image.");
    const bytes = Buffer.from(match[2], "base64"), kind = match[1];
    if (bytes.length > 1024 * 1024 || bytes.length < 10 || bytes.toString("base64") !== match[2]) fail("Choose a valid image no larger than 1 MB.");
    const valid = kind === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : kind === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
    if (!valid) fail("The file contents do not match the image format.");
    return value;
}

export async function syncProfileBio(store, api, guild, prefix = store.settings(guild).prefix) {
    const data = savedProfile(store, guild), bio = profileBio(data.customBio ?? DEFAULT_BIO, prefix);
    if (data.appliedBio === bio) return;
    await api(`/guilds/${guild}/members/@me`, { method: "PATCH", body: { bio }, reason: "Keep Sonata's dashboard and help commands in the server bio" });
    saveProfile(store, guild, { ...data, appliedBio: bio, error: "" });
}

export async function readGuildProfile(store, api, guild, botId) {
    const [member, user] = await Promise.all([api(`/guilds/${guild}/members/${botId}`), api("/users/@me")]);
    const data = savedProfile(store, guild), hash = value => /^(?:a_)?[a-f0-9]{32}$/i.test(value ?? "");
    const globalAsset = (field, folder) => hash(user[field]) ? `https://cdn.discordapp.com/${folder}/${botId}/${user[field]}.${user[field].startsWith("a_") ? "gif" : "png"}?size=512` : "";
    const asset = (field, folder) => hash(member[field]) ? `https://cdn.discordapp.com/guilds/${guild}/users/${botId}/${folder}/${member[field]}.${member[field].startsWith("a_") ? "gif" : "png"}?size=512` : globalAsset(field, folder);
    const defaultAvatar = globalAsset("avatar", "avatars") || `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(botId) >> 22n) % 6n)}.png`;
    return { guild, nickname: member.nick ?? "", name: member.nick || user.global_name || user.username || "Sonata", defaultName: user.global_name || user.username || "Sonata", customBio: data.customBio ?? DEFAULT_BIO, bio: member.bio ?? data.appliedBio ?? profileBio(data.customBio ?? DEFAULT_BIO, store.settings(guild).prefix), prefix: store.settings(guild).prefix, avatar: asset("avatar", "avatars") || defaultAvatar, banner: asset("banner", "banners"), defaultAvatar, defaultBanner: globalAsset("banner", "banners"), customAvatar: !!member.avatar, customBanner: !!member.banner, updated: data.updated ?? null, updatedBy: data.actor ?? null, error: data.error || "" };
}

export async function writeGuildProfile(store, api, guild, actor, input, reset = false) {
    const data = savedProfile(store, guild);
    if (!reset && data.updated && Date.now() - data.updated < 30_000) throw Object.assign(new Error("Wait 30 seconds between profile changes."), { status: 429 });
    let body, customBio;
    if (reset) {
        customBio = DEFAULT_BIO;
        body = { nick: null, avatar: null, banner: null, bio: profileBio(customBio, store.settings(guild).prefix) };
    } else {
        if (Object.keys(input).some(key => !["guild", "nickname", "bio", "avatar", "banner"].includes(key))) fail("Choose only a nickname, bio, avatar or banner.");
        if (typeof input.nickname !== "string" || input.nickname.length > 32 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(input.nickname)) fail("Use a nickname of up to 32 characters without control characters.");
        customBio = input.bio;
        body = { nick: input.nickname.trim() || null, bio: profileBio(customBio, store.settings(guild).prefix) };
        for (const key of ["avatar", "banner"]) if (Object.hasOwn(input, key)) body[key] = imageData(input[key]);
    }
    const member = await api(`/guilds/${guild}/members/@me`, { method: "PATCH", body, reason: `${reset ? "Sonata administrator reset" : "Server profile updated"} by ${actor}` });
    saveProfile(store, guild, { customBio, appliedBio: body.bio, updated: Date.now(), actor, error: "" });
    return member;
}

export async function maintainProfileBio(store, api, guild) {
    try { await syncProfileBio(store, api, guild); }
    catch (error) { saveProfile(store, guild, { ...savedProfile(store, guild), error: error.message.slice(0, 300) }); }
}
