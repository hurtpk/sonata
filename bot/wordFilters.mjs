/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { option, role, sub } from "./commandOptions.mjs";
import { recordCommandFailure } from "./commandFailures.mjs";
import { parseDuration } from "./commands.mjs";
import { canManage, embed, fail, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { featureEnabled } from "./featureGroups.mjs";

const word = () => option("word", 3, "Word or phrase. Quote phrases in prefix commands", true, { max_length: 80 });
const actions = { mute: PERMS.VOICE_MUTE, timeout: PERMS.TIMEOUT, kick: PERMS.KICK, ban: PERMS.BAN };
export const WORD_FILTER_OPTIONS = [
    sub("filteradd", "Delete messages containing a word or phrase", [word()]),
    sub("filterremove", "Remove a message word filter", [word()]),
    sub("filterlist", "List message word filters and consequences", [option("page", 4, "Filter page", false, { min_value: 1, max_value: 3 })]),
    sub("filterreply", "Set a public reply, or enter off to clear it", [word(), option("text", 3, "Reply text. Use {user} to position the ping", true, { max_length: 300 })]),
    sub("filteraction", "Set a repeat violation action for a filter", [word(), option("action", 3, "Action to take at the strike threshold", true, { choices: ["none", ...Object.keys(actions)].map(value => ({ name: value, value })) }), option("strikes", 4, "Violations in 24 hours, default 3", false, { min_value: 1, max_value: 20 }), option("duration", 3, "Timeout duration, default 10m", false, { max_length: 40 })]),
    sub("filterexempt", "Exempt or unexempt a role from message filters", [role(), option("enabled", 5, "Exempt this role")]),
];
const normalize = value => value.normalize("NFKC").toLowerCase();
const wordKey = value => normalize(value).trim().replace(/\s+/g, " ");

export function wordFilterCommand(context, store) {
    const { command, guild, actor, roles } = context, options = command.options, settings = store.settings(guild.id);
    requirePermission(memberPermissions(actor, roles, guild), PERMS.ADMIN);
    const rules = settings.wordFilters ?? [];
    if (command.sub === "filterlist") {
        const pages = Math.max(1, Math.ceil(rules.length / 10)), page = Math.min(options.page ?? 1, pages);
        const rows = rules.slice((page - 1) * 10, page * 10);
        return embed("Message word filters", rows.length ? rows.map(rule => `${JSON.stringify(rule.word)} · ${rule.action ? rule.action + " at " + rule.strikes + " strikes" : "Delete only"}${rule.reply ? " · Reply enabled" : ""}`).join("\n") + `\n\nPage ${page}/${pages}` : "No filters configured.");
    }
    if (command.sub === "filterexempt") {
        if (options.role === guild.id || !roles.some(role => role.id === options.role)) fail("Choose a role in this server other than everyone.");
        const exemptions = settings.wordFilterExemptions ?? [];
        settings.wordFilterExemptions = options.enabled ? [...new Set([...exemptions, options.role])] : exemptions.filter(id => id !== options.role);
        if (settings.wordFilterExemptions.length > 25) fail("Use up to 25 exempt roles.");
    } else {
        const key = wordKey(options.word), current = rules.find(rule => rule.word === key);
        if (!key || key.length > 80) fail("Enter a word or phrase up to 80 characters.");
        if (command.sub === "filteradd") {
            context.botPermission(PERMS.MESSAGES);
            if (current) fail("That word or phrase already has a filter.");
            if (rules.length >= 25) fail("Use up to 25 message word filters.");
            rules.push({ id: crypto.randomUUID(), word: key });
        } else {
            if (!current) fail("Add this word or phrase first with automod filteradd.");
            if (command.sub === "filterremove") rules.splice(rules.indexOf(current), 1);
            if (command.sub === "filterreply") current.reply = options.text.trim().toLowerCase() === "off" ? "" : options.text.trim();
            if (command.sub === "filteraction") {
                if (options.duration && options.action !== "timeout") fail("A duration only applies to Discord timeouts.");
                if (options.action !== "none") context.botPermission(actions[options.action]);
                const duration = options.action === "timeout" ? parseDuration(options.duration ?? "10m", 28 * 86400_000) : 0;
                const action = options.action === "none" ? "" : options.action, strikes = options.strikes ?? 3;
                if (action !== current.action || strikes !== current.strikes || duration !== current.duration) Object.assign(current, { id: crypto.randomUUID(), action, strikes, duration });
            }
        }
    }
    settings.wordFilters = rules;
    store.saveSettings(guild.id, settings, actor.user.id, "Message word filters");
    return embed("Message word filters saved", "Sonata checks new messages and edits. Repeat violations are counted per member and filter in a 24-hour window.");
}

export function matchWordFilter(data, settings) {
    if (data.author?.bot || data.webhook_id || typeof data.content !== "string" || !featureEnabled(settings, "security") || !settings.wordFilters?.length) return;
    const text = normalize(data.content);
    return settings.wordFilters.find(rule => {
        const term = rule.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
        return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${term}(?![\\p{L}\\p{N}\\p{M}_])`, "u").test(text);
    });
}

export async function wordFilterEvent(data, store, api, botId, perform) {
    const guildId = data.guild_id, channel = data.channel_id;
    if (!isId(channel) || !isId(data.id)) return false;
    if (!data.author?.id) data = await api(`/channels/${channel}/messages/${data.id}`, { optional: true });
    if (!data?.author || data.author.id === botId) return false;
    const actor = data.author.id, id = "word-filter:" + data.id;
    const [guild, roles, target] = await Promise.all([
        api("/guilds/" + guildId, { parallelRead: true }),
        api(`/guilds/${guildId}/roles`, { parallelRead: true }),
        data.member?.roles ? { user: data.author, roles: data.member.roles } : api(`/guilds/${guildId}/members/${actor}`, { optional: true, parallelRead: true }),
    ]);
    const settings = store.settings(guildId), rule = matchWordFilter(data, settings);
    if (!rule || !target || (memberPermissions(target, roles, guild) & PERMS.ADMIN) || target.roles.some(role => settings.wordFilterExemptions?.includes(role))) return false;
    if (!store.claim(id)) return true;
    try { await api(`/channels/${channel}/messages/${data.id}`, { method: "DELETE", reason: "Matched a Sonata word filter." }); }
    catch (error) {
        if (error.status !== 404) { store.run("DELETE FROM requests WHERE id=?", id); throw error; }
        return true;
    }
    const now = Date.now(), mention = `<@${actor}>`;
    if (rule.reply) {
        const content = rule.reply.includes("{user}") ? rule.reply.replaceAll("{user}", mention) : mention + " " + rule.reply;
        try { await api(`/channels/${channel}/messages`, { method: "POST", body: { content, allowed_mentions: { parse: [], users: [actor] } } }); }
        catch (error) { recordCommandFailure(store, { id: "word-filter-reply:" + data.id, guild: guildId, channel, actor, name: "automod", sub: "filterreply" }, error); }
    }
    const latest = store.settings(guildId);
    if (!rule.action || !featureEnabled(latest, "security") || !latest.wordFilters?.some(current => current.id === rule.id)) return true;
    const row = store.get("INSERT INTO word_filter_strikes (guild,rule,member,n,expires) VALUES (?,?,?,1,?) ON CONFLICT(guild,rule,member) DO UPDATE SET n=CASE WHEN expires<=? THEN 1 ELSE n+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING n", guildId, rule.id, actor, now + 86400_000, now, now);
    if (row.n % rule.strikes !== 0) return true;
    const command = { id, actor: botId, guild: guildId, channel };
    await perform({ command, guild, api }, store, "word filter " + rule.action, actor, `Reached ${row.n} violations of a configured word filter in 24 hours.`, rule.duration, async (_, audit) => {
        const [bot, current] = await Promise.all([
            api(`/guilds/${guildId}/members/${botId}`),
            api(`/guilds/${guildId}/members/${actor}`),
        ]);
        canManage({ user: { id: guild.owner_id }, roles: [] }, current, bot, roles, guild);
        if (memberPermissions(current, roles, guild) & PERMS.ADMIN) fail("The member now has Administrator.");
        requirePermission(memberPermissions(bot, roles, guild), actions[rule.action]);
        const route = `/guilds/${guildId}/members/${actor}`;
        if (rule.action === "mute") await api(route, { method: "PATCH", body: { mute: true }, reason: audit });
        if (rule.action === "timeout") {
            const until = Math.max(Date.now() + rule.duration, Date.parse(current.communication_disabled_until) || 0);
            await api(route, { method: "PATCH", body: { communication_disabled_until: new Date(until).toISOString() }, reason: audit });
        }
        if (rule.action === "kick") await api(route, { method: "DELETE", reason: audit });
        if (rule.action === "ban") {
            await api(`/guilds/${guildId}/bans/${actor}`, { method: "PUT", body: { delete_message_seconds: 0 }, reason: audit });
            store.cancelJobs(guildId, actor, "tempban");
        }
    });
    return true;
}
