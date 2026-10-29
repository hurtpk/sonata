/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";

import { channelPermissions, embed, fail, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

export const MEDIA_COMMANDS = ["download", "emoji", "sticker"];
const TWEMOJI = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/72x72/";
const CREDIT = "Emoji artwork by Twemoji contributors, licensed CC BY 4.0. [Source](https://github.com/jdecked/twemoji) · [License](https://creativecommons.org/licenses/by/4.0/)";
const firstEmoji = text => /<a?:[a-zA-Z0-9_]{2,32}:\d{17,20}>|\p{RGI_Emoji}|\p{Extended_Pictographic}\uFE0F?/v.exec(text ?? "")?.[0];

export async function readDiscordFile(raw, maximum = 8 * 1024 * 1024, transport = fetch) {
    let url;
    try { url = new URL(raw); } catch { fail("Use a valid Discord CDN file URL."); }
    const discord = ["https://cdn.discordapp.com", "https://media.discordapp.net"].includes(url.origin) && /^\/(?:attachments|emojis|stickers|avatars|icons|banners)\//.test(url.pathname);
    const unicode = url.origin === "https://cdn.jsdelivr.net" && /^\/gh\/jdecked\/twemoji@17\.0\.3\/assets\/72x72\/[a-f0-9]+(?:-[a-f0-9]+)*\.png$/.test(url.pathname) && !url.search;
    if ((!discord && !unicode) || url.username || url.password) fail("Use a direct Discord CDN file link or a supported emoji image. Message downloads refresh expired attachment links.");
    const response = await transport(url.href, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.body) fail("Discord or the emoji provider could not provide that file. Try another emoji or a fresh message link.");
    if (Number(response.headers.get("Content-Length")) > maximum) fail("That file exceeds the size limit.");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > maximum) fail("That file exceeds the size limit."); chunks.push(chunk); }
    if (!size) fail("That file is empty.");
    const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : bytes.subarray(0, 3).toString() === "GIF" ? "image/gif" : bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg" : "application/octet-stream";
    return { bytes, mime };
}

const emojiInfo = value => {
    const match = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/.exec(value);
    if (match) return { id: match[3], name: match[2], animated: !!match[1], url: `https://cdn.discordapp.com/emojis/${match[3]}.${match[1] ? "gif" : "png"}` };
    if (isId(value)) return { id: value, name: `emoji_${value}`, animated: false, url: `https://cdn.discordapp.com/emojis/${value}.png` };
    if (!/^(?:\p{RGI_Emoji}|\p{Extended_Pictographic}\uFE0F?)$/v.test(value)) fail("Use an emoji or a custom emoji's Discord ID.");
    const code = [...(value.includes("\u200d") ? value : value.replaceAll("\ufe0f", ""))].map(char => char.codePointAt(0).toString(16)).join("-");
    return { name: `emoji_${code.replaceAll("-", "_")}`.slice(0, 32), animated: false, url: `${TWEMOJI}${code}.png`, credit: CREDIT };
};
const stickerUrl = sticker => `https://cdn.discordapp.com/stickers/${sticker.id}.${sticker.format_type === 3 ? "json" : sticker.format_type === 4 ? "gif" : "png"}`;

export async function mediaCommand(context) {
    const { command, api, guild, actor, bot, roles, channel } = context, kind = command.name;
    let o = command.options, sub = command.sub;
    const replyField = kind === "download" ? { message: "message", emoji: "emoji", sticker: "id" }[sub] : sub === "steal" ? kind === "emoji" ? "emoji" : "id" : null;
    if (replyField && o[replyField] === "reply") {
        const reference = command.reply;
        if (!reference || !isId(reference.message_id)) fail("Reply to a message containing an emoji, sticker or attachment, then send the command again.");
        if ((reference.type !== undefined && reference.type !== 0) || (reference.guild_id && reference.guild_id !== guild.id) || (reference.channel_id && reference.channel_id !== channel.id) || ![0, 5].includes(channel.type)) fail("Reply to an ordinary message in this server's current text channel.");
        for (const member of [actor, bot]) requirePermission(channelPermissions(member, roles, guild, channel), PERMS.VIEW | PERMS.HISTORY);
        const message = await api(`/channels/${channel.id}/messages/${reference.message_id}`, { optional: true });
        if (!message) fail("The replied-to message was deleted or is no longer available.");
        const sticker = message.sticker_items?.[0], emoji = firstEmoji(message.content);
        if (kind === "download" && sub === "message") {
            if (sticker) { sub = "sticker"; o = { id: sticker.id }; }
            else if (emoji) { sub = "emoji"; o = { emoji }; }
            else if (message.attachments?.[0]) { sub = "attachment"; o = { file: message.attachments[0] }; }
            else fail("That message has no downloadable emoji, sticker or attachment.");
        } else if (replyField === "emoji") { if (!emoji) fail("No emoji was found in the replied-to message."); o = { ...o, emoji }; }
        else { if (!sticker) fail("No sticker was found in the replied-to message."); o = { ...o, id: sticker.id }; }
    }
    const postFile = async (url, filename, credit) => {
        if (![0, 5].includes(channel.type)) fail("Download files in a regular text or announcement channel.");
        requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.SEND);
        requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.ATTACH);
        const file = await readDiscordFile(url), name = String(filename || "download").replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 100);
        const form = new FormData(); form.set("payload_json", JSON.stringify({ ...(credit ? { content: credit } : {}), allowed_mentions: { parse: [] }, attachments: [{ id: "0", filename: name }] }));
        form.set("files[0]", new Blob([file.bytes], { type: file.mime }), name);
        const posted = await api(`/channels/${channel.id}/messages`, { method: "POST", form });
        return embed("File ready", `https://discord.com/channels/${guild.id}/${channel.id}/${posted.id}`);
    };
    if (kind === "download") {
        if (sub === "url") { let name = "download"; try { name = new URL(o.url).pathname.split("/").at(-1) || name; } catch { fail("Use a Discord CDN file URL."); } return postFile(o.url, name); }
        if (sub === "attachment") { if (!o.file?.url) fail("Attach a file to this command."); return postFile(o.file.url, o.file.filename); }
        if (sub === "emoji") { const emoji = emojiInfo(o.emoji); return postFile(emoji.url, `${emoji.name}.${emoji.animated ? "gif" : "png"}`, emoji.credit); }
        if (sub === "sticker") { if (!isId(o.id)) fail("Use a sticker ID."); const sticker = await api(`/stickers/${o.id}`); return postFile(stickerUrl(sticker), `${sticker.name}.${sticker.format_type === 3 ? "json" : sticker.format_type === 4 ? "gif" : "png"}`); }
        const match = /^(?:https:\/\/(?:canary\.|ptb\.)?(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/)?(\d{17,20})$/.exec(o.message);
        if (!match || (match[1] && match[1] !== guild.id)) fail("Use a message ID or link from this server.");
        const source = match[2] ? await api(`/channels/${match[2]}`) : channel;
        if (source.guild_id !== guild.id || ![0, 5].includes(source.type)) fail("Choose a message in a regular text or announcement channel in this server.");
        requirePermission(channelPermissions(actor, roles, guild, source), PERMS.VIEW | PERMS.HISTORY);
        requirePermission(channelPermissions(bot, roles, guild, source), PERMS.VIEW | PERMS.HISTORY);
        const message = await api(`/channels/${source.id}/messages/${match[3]}`), file = message.attachments?.[(o.index ?? 1) - 1];
        if (!file) fail("That attachment number does not exist on this message.");
        return postFile(file.url, file.filename);
    }
    const plural = kind === "emoji" ? "emojis" : "stickers";
    if (sub === "list") {
        const values = await api(`/guilds/${guild.id}/${plural}`), pages = Math.max(1, Math.ceil(values.length / 12)), page = o.page ?? 1;
        if (page > pages) fail(`Choose a page from 1 to ${pages}.`);
        return embed(`Server ${plural} · ${page}/${pages}`, values.slice((page - 1) * 12, page * 12).map(value => `${value.name} · ${value.id}`).join("\n") || "None found.");
    }
    if (sub === "info") {
        if (kind === "emoji") { const emoji = emojiInfo(o.emoji), response = embed(emoji.name, `${emoji.id ? `ID: ${emoji.id}` : "Unicode emoji"}\n[Download image](${emoji.url})${emoji.credit ? `\n${emoji.credit}` : ""}`); response.embeds[0].image = { url: emoji.url }; return response; }
        if (!isId(o.id)) fail("Use a sticker ID.");
        const sticker = await api(`/stickers/${o.id}`); return embed(sticker.name, `ID: ${sticker.id}\nFormat: ${sticker.format_type}\n[Download file](${stickerUrl(sticker)})`);
    }
    const creating = ["add", "steal"].includes(sub), bits = creating ? PERMS.CREATE_EXPRESSIONS | PERMS.EXPRESSIONS : PERMS.EXPRESSIONS;
    for (const member of [actor, bot]) { const actual = memberPermissions(member, roles, guild); if (!(actual & (PERMS.ADMIN | bits))) fail("You and Sonata Bot need Create Expressions for imports, or Manage Expressions for edits and removal."); }
    if (!creating) {
        if (!isId(o.id)) fail("Use an expression ID from this server.");
        const existing = await api(`/guilds/${guild.id}/${plural}/${o.id}`);
        if (!existing || existing.managed) fail("Choose an ordinary expression in this server.");
        if (sub === "rename" && (kind === "emoji" ? !/^[a-zA-Z0-9_]{2,32}$/.test(o.name) : o.name.trim().length < 2)) fail("Choose a valid expression name with at least two characters.");
        await api(`/guilds/${guild.id}/${plural}/${o.id}`, { method: sub === "remove" ? "DELETE" : "PATCH", ...(sub === "rename" ? { body: { name: o.name.trim() } } : {}), reason: `Sonata ${kind} ${sub} by ${actor.user.id}` });
        return embed("Expression updated", sub === "remove" ? "The expression was removed from this server." : "The expression was renamed.");
    }
    let url, credit, name = o.name;
    if (sub === "add") { if (!o.file?.url) fail("Attach an image."); url = o.file.url; }
    else if (kind === "emoji") { const emoji = emojiInfo(o.emoji); url = emoji.url; credit = emoji.credit; name ||= emoji.name; }
    else { if (!isId(o.id)) fail("Use a sticker ID."); const sticker = await api(`/stickers/${o.id}`); if (sticker.format_type === 3) fail("Lottie stickers can be downloaded, but cannot be imported by Sonata."); url = stickerUrl(sticker); name ||= sticker.name; }
    name = name?.trim();
    if (!name || (kind === "emoji" ? !/^[a-zA-Z0-9_]{2,32}$/.test(name) : name.length < 2 || name.length > 30)) fail("Use a valid name: two to 32 letters, digits or underscores for emojis; two to 30 characters for stickers.");
    const file = await readDiscordFile(url, kind === "emoji" ? 256 * 1024 : 512 * 1024);
    if (!["image/png", "image/gif", "image/jpeg"].includes(file.mime) || (kind === "sticker" && file.mime === "image/jpeg")) fail("Use PNG or GIF for stickers, or PNG, GIF or JPEG for emojis.");
    let saved;
    if (kind === "emoji") saved = await api(`/guilds/${guild.id}/emojis`, { method: "POST", body: { name, image: `data:${file.mime};base64,${file.bytes.toString("base64")}` }, reason: `Imported by ${actor.user.id} using Sonata` });
    else {
        const form = new FormData(); form.set("name", name); form.set("description", "Imported with Sonata"); form.set("tags", "🙂"); form.set("file", new Blob([file.bytes], { type: file.mime }), file.mime === "image/gif" ? "sticker.gif" : "sticker.png");
        saved = await api(`/guilds/${guild.id}/stickers`, { method: "POST", form, reason: `Imported by ${actor.user.id} using Sonata` });
    }
    return embed(`${kind === "emoji" ? "Emoji" : "Sticker"} added`, `${saved.name} · ${saved.id}${credit ? `\n${credit}` : ""}`);
}
