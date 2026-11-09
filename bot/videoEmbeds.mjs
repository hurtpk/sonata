/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embedColor } from "./discord.mjs";

import { Buffer } from "node:buffer";
import { channelPermissions, isId, PERMS, requirePermission } from "./discord.mjs";
import { actorId, button, genuineControl, rows } from "./interactionUI.mjs";
import iconImages from "./profile/video-icons.json" with { type: "json" };

export { videoSource } from "./music/videoSource.mjs";
import { videoLimit, videoSource } from "./music/videoSource.mjs";

const platformLabels = { tiktok: "TikTok", instagram: "Instagram", x: "X", youtube: "YouTube" };
export const videoCardFlag = 1 << 15;
const iconRequests = new WeakMap();
const text = content => ({ type: 10, content });
const escapeMarkdown = value => String(value).replace(/[\\\x60*_~|<>\[\]()#]/g, "\\$&");

function platformFor(source) {
    const host = new URL(source).hostname;
    return host.endsWith("tiktok.com") ? "tiktok" : host.endsWith("instagram.com") ? "instagram" : host === "x.com" ? "x" : "youtube";
}

function platformIcon(platform, api, applicationId) {
    if (!api || !isId(applicationId)) return;
    let icons = iconRequests.get(api);
    if (!icons) {
        icons = new Map();
        iconRequests.set(api, icons);
    }
    if (!icons.has(platform)) {
        const name = platform === "x" ? "x_logo" : platform, route = "/applications/" + applicationId + "/emojis";
        const request = (async () => {
            const { items } = await api(route);
            const emoji = items.find(item => item.name === name) ?? await api(route, {
                method: "POST", body: { name, image: "data:image/png;base64," + iconImages[platform] }
            });
            if (isId(emoji.id)) return "<:" + name + ":" + emoji.id + ">";
        })().catch(() => undefined);
        icons.set(platform, request);
        void request.then(icon => { if (!icon) icons.delete(platform); });
    }
    return icons.get(platform);
}

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

export async function videoCommand(context, bridge, api, applicationId) {
    const { command, channel, actor, bot, guild, roles } = context;
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.SEND);
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.ATTACH | PERMS.EMBEDS);
    const source = videoSource(command.options.url);
    if (!bridge?.online()) throw new Error("The video service is offline. Try again after it reconnects.");
    const result = await bridge.submit({ id: command.id, kind: "video", guild: guild.id, channel: channel.id, source, limit: videoLimit(guild), mode: command.videoMode || "gif" });
    return renderVideoReply(result, source, actor, api, applicationId);
}

async function renderVideoReply(result, source, actor, api, applicationId) {
    if (result.noMedia && platformFor(source) === "x") return { silent: true, content: "This post has no attached media.", allowed_mentions: { parse: [] } };
    const icon = result.video ? await platformIcon(platformFor(source), api, applicationId) : undefined;
    return videoReply(result, source, actor, icon);
}

export function videoReply(result, source, actor, icon) {
    if (!result.video) throw new Error(result.description || "The video service could not download this video. Try another public link.");
    const platform = platformFor(source), label = platformLabels[platform];
    const author = result.author && escapeMarkdown(result.author.name.replace(/\s+/g, " "));
    const creator = author && result.author.url ? `[**${author}**](${result.author.url})` : author;
    const heading = [icon || (platform === "x" ? "𝕏" : label), creator || (icon ? `**${label}**` : "")].filter(Boolean).join(" ");
    const caption = result.description?.trim() || (!/^(?:Instagram video|Video)$/i.test(result.title || "") ? result.title : "");
    const gif = result.format === "gif";
    const name = gif ? "sonata-animation.gif" : "sonata-video.mp4";
    const components = [{
        type: 9, components: [text(heading)],
        accessory: { type: 2, style: 5, emoji: { name: "🔗" }, url: source }
    }];
    if (caption || result.author?.avatar) {
        const description = text(caption ? escapeMarkdown(caption.slice(0, 1600)) : "Creator profile");
        components.push(result.author?.avatar ? {
            type: 9, components: [description], accessory: { type: 11, media: { url: result.author.avatar }, description: "Creator profile picture" }
        } : description);
    }
    components.push({ type: 12, items: [{ media: { url: "attachment://" + name } }] });
    if (result.isGif) components.push(...rows([button(`snvideo:${actor.user.id}:${gif ? "video" : "gif"}`, gif ? "Video" : "GIF")]));
    const stats = [["views", "👁"], ["likes", "❤️"], ["comments", "💬"], ["shares", "🔁"]].filter(([key]) => result.stats?.[key] !== undefined).map(([key, emoji]) => `${emoji} ${typeof result.stats[key] === "number" ? result.stats[key].toLocaleString("en-US") : result.stats[key]}`);
    const sender = escapeMarkdown(actor.nick || actor.user.global_name || actor.user.username || actor.user.id);
    stats.push(`Sent by ${sender} (<@${actor.user.id}>)`);
    components.push({ type: 14, spacing: 1, divider: true }, text("-# " + stats.join(" • ")));
    return {
        flags: videoCardFlag, components: [{ type: 17, accent_color: embedColor(), components }], allowed_mentions: { parse: [] },
        files: [{ name, type: gif ? "image/gif" : "video/mp4", bytes: typeof result.video === "string" ? Buffer.from(result.video, "base64") : result.video }]
    };
}

export async function videoModeReply(data, api, bridge, botId) {
    const match = /^snvideo:(\d{17,20}):(gif|video)$/.exec(data.data.custom_id);
    if (!match || !genuineControl(data, botId) || actorId(data) !== match[1]) throw new Error("Only the original sender can switch this GIF's playback mode.");
    const header = data.message.components?.find(component => component.type === 17)?.components?.[0];
    const source = videoSource(header?.accessory?.url ?? data.message.embeds?.[0]?.url);
    const channel = await api(`/channels/${data.channel_id}`);
    if (data.guild_id) {
        if (channel.guild_id !== data.guild_id) throw new Error("Use this control in its original channel.");
        const [guild, roles, actor, bot] = await Promise.all([api(`/guilds/${data.guild_id}`), api(`/guilds/${data.guild_id}/roles`), api(`/guilds/${data.guild_id}/members/${match[1]}`), api(`/guilds/${data.guild_id}/members/${botId}`)]);
        return videoCommand({ guild, roles, actor, bot, channel, command: { id: data.id, actor: match[1], videoMode: match[2], options: { url: source } } }, bridge, api, botId);
    }
    if (channel.type !== 1 || !channel.recipients?.some(user => user.id === match[1])) throw new Error("Use this control in your original direct message.");
    if (!bridge?.online()) throw new Error("The video service is offline. Try again shortly.");
    const result = await bridge.submit({ id: data.id, kind: "video", guild: match[1], channel: channel.id, source, limit: videoLimit(), mode: match[2] });
    return renderVideoReply(result, source, { user: await api(`/users/${match[1]}`) }, api, botId);
}
