/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channelPermissions, embed, fail, isId, PERMS, requirePermission } from "./discord.mjs";
import { messageChannel } from "./community.mjs";

export const UTILITY_COMMANDS = ["poll", "choose", "roll", "coinflip", "8ball", "timestamp", "snowflake", "firstmessage", "servericon", "serverbanner", "boosts"];
const choose = values => values[Math.floor(Math.random() * values.length)];

export async function utilityCommand(context) {
    const { command, guild, api, channel, roles, actor, bot } = context, o = command.options;
    if (command.name === "choose") { const values = o.options.split("|").map(value => value.trim()).filter(Boolean); if (values.length < 2 || values.length > 20) fail("Separate two to twenty choices with |."); return embed("I chose", choose(values)); }
    if (command.name === "coinflip") return embed("Coin flip", choose(["Heads", "Tails"]));
    if (command.name === "8ball") return embed("Magic eight ball", choose(["Yes.", "No.", "Probably.", "Ask again later.", "The outlook is good.", "It is uncertain."]));
    if (command.name === "roll") {
        const match = /^(\d{1,2})d(\d{1,4})$/i.exec(o.dice), count = Number(match?.[1]), sides = Number(match?.[2]);
        if (!match || count < 1 || count > 20 || sides < 2 || sides > 1000) fail("Use one to twenty dice with two to one thousand sides, such as 2d6.");
        const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
        return embed(`${count}d${sides}`, `${rolls.join(" + ")} = **${rolls.reduce((a, b) => a + b, 0)}**`);
    }
    if (command.name === "timestamp") return embed("Discord timestamp", `<t:${o.seconds}:F>\n<t:${o.seconds}:R>\nCopy: \`<t:${o.seconds}:F>\``);
    if (command.name === "snowflake") { if (!isId(o.id)) fail("Use a valid Discord ID."); const ms = Number((BigInt(o.id) >> 22n) + 1420070400000n); return embed("Discord ID", `${o.id}\nCreated <t:${Math.floor(ms / 1000)}:F>\n${new Date(ms).toISOString()}`); }
    if (["servericon", "serverbanner", "boosts"].includes(command.name)) {
        if (command.name === "boosts") return embed("Server boosts", `Level: ${guild.premium_tier ?? 0}\nBoosts: ${guild.premium_subscription_count ?? 0}`);
        const hash = command.name === "servericon" ? guild.icon : guild.banner;
        if (!hash) return embed("No image", `This server has no ${command.name === "servericon" ? "icon" : "banner"}.`);
        if (!/^(?:a_)?[a-f0-9]{32}$/i.test(hash)) fail("Discord returned an unsupported server image.");
        const url = `https://cdn.discordapp.com/${command.name === "servericon" ? "icons" : "banners"}/${guild.id}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=1024`, response = embed(guild.name, `[Open image](${url})`);
        response.embeds[0].image = { url }; return response;
    }
    if (![0, 5].includes(channel.type)) fail("Use a regular text or announcement channel.");
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.HISTORY);
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.HISTORY);
    if (command.name === "firstmessage") {
        const messages = await api(`/channels/${channel.id}/messages?after=0&limit=1`);
        return embed("First available message", messages.length ? `https://discord.com/channels/${guild.id}/${channel.id}/${messages[0].id}` : "No readable messages found.");
    }
    if (command.sub === "results") {
        if (!isId(o.message)) fail("Use a poll message ID from this channel.");
        const message = await api(`/channels/${channel.id}/messages/${o.message}`), poll = message.poll;
        if (!poll) fail("That message is not a poll.");
        return embed(poll.question.text, poll.results ? poll.answers.map(answer => `${answer.poll_media.text}: ${poll.results.answer_counts.find(value => value.id === answer.answer_id)?.count ?? 0}`).join("\n") + `\n\n${poll.results.is_finalized ? "Final results." : "Results may change while votes are counted."}` : "Discord has not provided vote counts yet.");
    }
    await messageChannel(context, channel.id);
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.POLLS);
    context.botPermission(PERMS.POLLS, true);
    const answers = o.answers.split("|").map(value => value.trim());
    if (o.question.length > 300 || answers.length < 2 || answers.length > 10 || answers.some(value => !value || value.length > 55)) fail("Use a question up to 300 characters and two to ten answers up to 55 characters, separated by |.");
    const posted = await api(`/channels/${channel.id}/messages`, { method: "POST", body: { poll: { question: { text: o.question }, answers: answers.map(text => ({ poll_media: { text } })), duration: 24, allow_multiselect: false, layout_type: 1 }, allowed_mentions: { parse: [] } } });
    return embed("Poll created", `https://discord.com/channels/${guild.id}/${channel.id}/${posted.id}`);
}
