/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";
import { channelPermissions, embed, PERMS, requirePermission } from "./discord.mjs";
import { actorId, button, genuineControl, rows } from "./interactionUI.mjs";

export { videoSource } from "./music/videoSource.mjs";
import { videoLimit, videoSource } from "./music/videoSource.mjs";

export function videoInvocation(content, botId) {
    if (typeof content !== "string" || content.length > 600) return null;
    let link = content.trim(), explicit = false;
    const prefix = /^(?:sonata|sonta)\s+/i.exec(link) || new RegExp(`^<@!?${botId}>\\s+`).exec(link);
    if (prefix) { explicit = true; link = link.slice(prefix[0].length); }
    if (link.startsWith("<") && link.endsWith(">")) link = link.slice(1, -1);
    if (!link || /[\s<>]/.test(link)) return null;
    try { return { source: videoSource(link.startsWith("https://") ? link : `https://${link}`), explicit }; }
    catch { return null; }
}

export async function videoCommand(context, bridge) {
    const { command, channel, actor, bot, guild, roles } = context;
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.SEND);
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.ATTACH | PERMS.EMBEDS);
    const source = videoSource(command.options.url);
    if (!bridge?.online()) throw new Error("The video service is offline. Try again after it reconnects.");
    const result = await bridge.submit({ id: command.id, kind: "video", guild: guild.id, channel: channel.id, source, limit: videoLimit(guild), mode: command.videoMode || "gif" });
    return videoReply(result, source, actor);
}

export function videoReply(result, source, actor) {
    const response = embed("Video", `[Original video](${source})`);
    if (!result.video) throw new Error(result.description || "The video service could not download this video. Try another public link.");
    const host = new URL(source).hostname, platform = host.endsWith("tiktok.com") ? "TikTok" : host.endsWith("instagram.com") ? "Instagram" : host === "x.com" ? "X" : "YouTube";
    const stats = [["views", "👁"], ["likes", "❤️"], ["comments", "💬"], ["shares", "🔁"]].filter(([key]) => result.stats?.[key] !== undefined).map(([key, emoji]) => `${emoji} ${typeof result.stats[key] === "number" ? result.stats[key].toLocaleString("en-US") : result.stats[key]}`);
    const icons = { TikTok: "https://www.tiktok.com/favicon.ico", Instagram: "https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png", X: "https://abs.twimg.com/favicons/twitter.3.ico", YouTube: "https://www.youtube.com/favicon.ico" };
    response.embeds[0].footer = { text: [platform, ...stats, `Sent by ${actor.nick || actor.user.global_name || actor.user.username || actor.user.id}`].join(" • "), icon_url: icons[platform] };
    if (result.author) response.embeds[0].author = { name: result.author.name, url: result.author.url, ...(result.author.avatar ? { icon_url: result.author.avatar } : {}) };
    if (result.published) response.embeds[0].timestamp = result.published;
    const caption = result.description?.trim() || (!/^(?:Instagram video|Video)$/i.test(result.title || "") ? result.title : "");
    response.embeds[0].title = caption ? caption.replace(/[\r\n]+/g, " ").slice(0, 200) : "View original post";
    response.embeds[0].url = source;
    response.embeds[0].description = caption.length > 200 ? caption.slice(200, 1600) : "";
    const gif = result.format === "gif";
    response.files = [{ name: gif ? "sonata-animation.gif" : "sonata-video.mp4", type: gif ? "image/gif" : "video/mp4", bytes: typeof result.video === "string" ? Buffer.from(result.video, "base64") : result.video }];
    if (gif) response.embeds[0].image = { url: "attachment://sonata-animation.gif" };
    if (result.isGif) response.components = rows([button(`snvideo:${actor.user.id}:${gif ? "video" : "gif"}`, gif ? "Video" : "GIF")]);
    return response;
}

export async function videoModeReply(data, api, bridge, botId) {
    const match = /^snvideo:(\d{17,20}):(gif|video)$/.exec(data.data.custom_id);
    if (!match || !genuineControl(data, botId) || actorId(data) !== match[1]) throw new Error("Only the original sender can switch this GIF's playback mode.");
    const source = videoSource(data.message.embeds?.[0]?.url);
    const channel = await api(`/channels/${data.channel_id}`);
    if (data.guild_id) {
        if (channel.guild_id !== data.guild_id) throw new Error("Use this control in its original channel.");
        const [guild, roles, actor, bot] = await Promise.all([api(`/guilds/${data.guild_id}`), api(`/guilds/${data.guild_id}/roles`), api(`/guilds/${data.guild_id}/members/${match[1]}`), api(`/guilds/${data.guild_id}/members/${botId}`)]);
        return videoCommand({ guild, roles, actor, bot, channel, command: { id: data.id, actor: match[1], videoMode: match[2], options: { url: source } } }, bridge);
    }
    if (channel.type !== 1 || !channel.recipients?.some(user => user.id === match[1])) throw new Error("Use this control in your original direct message.");
    if (!bridge?.online()) throw new Error("The video service is offline. Try again shortly.");
    const result = await bridge.submit({ id: data.id, kind: "video", guild: match[1], channel: channel.id, source, limit: videoLimit(), mode: match[2] });
    return videoReply(result, source, { user: await api(`/users/${match[1]}`) });
}
