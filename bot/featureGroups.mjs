/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { fail, memberPermissions, PERMS } from "./discord.mjs";

export const FEATURE_GROUPS = [
    { id: "moderation", name: "Moderation", description: "Manual punishments, warnings, case commands and warning escalation. Existing timed bans and jails still expire.", commands: "ban tempban softban banlist unban kick timeout untimeout nickname warn warnings warnremove warnclear escalation jailsetup jail unjail case modstats" },
    { id: "security", name: "Security & AutoMod", description: "Native AutoMod filters, honeypots, join protection, anti-nuke and nickname enforcement. Saved rules are kept when paused.", commands: "honeypot automod antiraid antinuke lockdown nicknamepolicy" },
    { id: "logging", name: "Logging", description: "Moderation log messages, member arrival/departure logs and server event logs. Saved cases and evidence remain available.", commands: "eventlog joinlogs" },
    { id: "music", name: "Music & Last.fm", description: "Voice music playback, queues, DJs and Last.fm commands. Disabling stops playback and clears the active music queue.", commands: "play pause resume skip stop queue nowplaying volume shuffle remove loop seek filter voteskip musicsettings fm" },
    { id: "voice", name: "Voice tools", description: "Voice moderation and temporary VoiceMaster rooms. Empty-room cleanup and restoring room privacy remain available.", commands: "voice voicemaster" },
    { id: "media", name: "Media & downloads", description: "Automatic video embeds, file downloads, and emoji/sticker tools.", commands: "download emoji sticker sonata" },
    { id: "community", name: "Community & support", description: "Welcome messages, role menus, autoroles, XP, AFK, tags, polls, tickets, appeals and giveaways. Existing tickets can still be closed or exported; pending giveaway draws pause.", commands: "welcome goodbye rolemenu autorole autonick autoresponder tag poll giveaway levels verification afk ticket appeals" },
    { id: "server", name: "Server tools", description: "Role and channel management, message cleanup, sticky messages, pins, starboard and role recovery. Temporary roles still expire.", commands: "role channel purge slowmode lock unlock hide unhide pin unpin pins stick" },
];
export const featureEnabled = (settings, id) => settings.disabledFeatures?.includes(id) !== true;
export const featurePermission = (context, settings) => context.actor.user.id === context.guild.owner_id || (!!(memberPermissions(context.actor, context.roles, context.guild) & PERMS.ADMIN) && settings.featureAdministrators !== false);
export function requireFeature(command, settings) {
    const group = FEATURE_GROUPS.find(group => group.commands.split(" ").includes(command.name));
    const cleanup = command.name === "stop" || command.name === "fm" && (command.sub === "remove" || command.sub === "participate" && command.options?.enabled === false) || ["unban", "untimeout", "unjail", "unlock", "unhide", "unpin"].includes(command.name) || command.name === "lockdown" && command.sub === "restore" || command.name === "ticket" && ["close", "transcript", "archive"].includes(command.sub) || command.name === "voicemaster" && ["reset", "unlock", "unhide", "room"].includes(command.sub) || command.name === "stick" && command.sub === "remove";
    if (group && !featureEnabled(settings, group.id) && !cleanup) fail(`${group.name} is disabled in this server. The server owner or an allowed administrator can enable it in Dashboard → Features.`, "denied");
}

const signature = rule => JSON.stringify([rule.trigger_metadata, rule.actions, rule.exempt_roles, rule.exempt_channels]);
async function nativeFilters(bot, guild, enabled, settings) {
    const rules = await bot.api(`/guilds/${guild}/auto-moderation/rules`), ids = new Set(Object.values(settings.automod ?? {})), saved = settings.pausedFeatureRules ?? [];
    const changes = enabled ? saved.map(old => ({ rule: rules.find(rule => rule.id === old.id && rule.creator_id === bot.session.userId && rule.enabled === false && signature(rule) === old.signature), enabled: true })).filter(change => change.rule) : rules.filter(rule => ids.has(rule.id) && rule.creator_id === bot.session.userId && rule.enabled).map(rule => ({ rule, enabled: false }));
    const done = [];
    try {
        for (const change of changes) { await bot.api(`/guilds/${guild}/auto-moderation/rules/${change.rule.id}`, { method: "PATCH", body: { enabled: change.enabled }, reason: "Sonata feature group changed" }); done.push(change); }
    } catch {
        let restored = true;
        for (const change of done) try { await bot.api(`/guilds/${guild}/auto-moderation/rules/${change.rule.id}`, { method: "PATCH", body: { enabled: !change.enabled }, reason: "Restore incomplete Sonata feature change" }); } catch { restored = false; }
        fail(restored ? "The AutoMod change failed and completed changes were restored. The feature setting was kept." : "The AutoMod change could not finish or be fully restored. Review Discord's AutoMod rules before retrying.");
    }
    return enabled ? [] : changes.map(({ rule }) => ({ id: rule.id, signature: signature(rule) }));
}

export async function featureGroupRequest(request, input, context, bot) {
    const { guild, actor } = context, settings = bot.store.settings(guild.id);
    const result = () => {
        const current = bot.store.settings(guild.id);
        return { groups: FEATURE_GROUPS.map(({ commands, ...group }) => ({ ...group, enabled: featureEnabled(current, group.id) })), serverOwner: actor.user.id === guild.owner_id, canManage: featurePermission(context, current), administrators: current.featureAdministrators !== false };
    };
    if (request.method === "GET") return result();
    if (Object.hasOwn(input, "administrators")) {
        if (actor.user.id !== guild.owner_id) throw Object.assign(new Error("Only the server owner can change administrator feature access."), { status: 403 });
        if (typeof input.administrators !== "boolean" || Object.hasOwn(input, "group")) fail("Choose whether administrators can manage feature groups.");
        settings.featureAdministrators = input.administrators; bot.store.saveSettings(guild.id, settings, actor.user.id, "Dashboard feature access"); return result();
    }
    if (!featurePermission(context, settings)) throw Object.assign(new Error("Only the server owner and permitted administrators can change feature groups."), { status: 403 });
    if (!FEATURE_GROUPS.some(group => group.id === input.group) || typeof input.enabled !== "boolean") fail("Choose a valid feature group and enabled state.");
    if (featureEnabled(settings, input.group) === input.enabled) return result();
    let paused;
    if (input.group === "security" && (Object.keys(settings.automod ?? {}).length || settings.pausedFeatureRules?.length)) paused = await nativeFilters(bot, guild.id, input.enabled, settings);
    if (input.group === "music" && !input.enabled) {
        const state = await bot.api(`/guilds/${guild.id}/voice-states/${bot.session.userId}`, { optional: true });
        if (state?.channel_id) await bot.api(`/guilds/${guild.id}/members/${bot.session.userId}`, { method: "PATCH", body: { channel_id: null }, reason: "Sonata music feature disabled" });
        if (bot.music) {
            for (const [id, pending] of bot.music.jobs) if (pending.job.guild === guild.id && pending.job.kind !== "video") { clearTimeout(pending.timer); pending.resolve({ title: "Music stopped", description: "Music was disabled by server management." }); bot.music.jobs.delete(id); }
            if (state?.channel_id && !bot.music.channels.has(guild.id)) bot.music.channels.set(guild.id, state.channel_id);
            bot.music.event("VOICE_STATE_UPDATE", { guild_id: guild.id, user_id: bot.session.userId, channel_id: null, session_id: "" }, bot.session.userId);
        }
    }
    const current = bot.store.settings(guild.id);
    current.disabledFeatures = input.enabled ? (current.disabledFeatures ?? []).filter(id => id !== input.group) : [...new Set([...(current.disabledFeatures ?? []), input.group])];
    if (paused) current.pausedFeatureRules = paused;
    bot.store.saveSettings(guild.id, current, actor.user.id, "Dashboard feature switch");
    return result();
}
