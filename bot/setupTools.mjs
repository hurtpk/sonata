/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "node:crypto";
import { COMMANDS } from "./commands.mjs";
import { channelPermissions, fail, isId, PERMS } from "./discord.mjs";
import { featureEnabled } from "./featureGroups.mjs";

const presets = {
    light: { name: "Light", joins: 15, seconds: 30, age: 0, warning: null },
    balanced: { name: "Balanced", joins: 10, seconds: 30, age: 24, warning: [5, 10] },
    strict: { name: "Strict", joins: 6, seconds: 30, age: 72, warning: [3, 30] },
};

export async function setupPreset(input, { guild, actor, roles }, bot) {
    if (actor.user.id !== guild.owner_id) throw Object.assign(new Error("Only the Discord server owner can use setup presets."), { status: 403 });
    if (!Object.hasOwn(presets, input.preset) || !["moderation", "music", "community"].includes(input.profile) || !isId(input.channel) || (input.review !== undefined && typeof input.review !== "string")) fail("Choose a setup, a strictness level and a moderation log channel.");
    const [channel, member] = await Promise.all([
        bot.api("/channels/" + input.channel),
        bot.api(`/guilds/${guild.id}/members/${bot.session.userId}`),
    ]);
    const required = PERMS.VIEW | PERMS.SEND | PERMS.EMBEDS;
    if (channel.guild_id !== guild.id || ![0, 5].includes(channel.type) || (channelPermissions(member, roles, guild, channel) & required) !== required) fail("Choose a text or announcement channel where Sonata can post embeds.");
    const settings = bot.store.settings(guild.id), { name, joins, seconds, age, warning } = presets[input.preset];
    const groups = ["security", "logging", ...(warning ? ["moderation"] : []), ...(input.profile === "music" ? ["music"] : [])];
    const missing = groups.filter(group => !featureEnabled(settings, group));
    if (missing.length) fail("Enable these feature groups first: " + missing.join(", ") + ".");
    const values = {
        logChannel: channel.id,
        antiraid: { enabled: true, channel: channel.id, joins, seconds, age, action: "alert" },
        escalation: warning ? { [warning[0]]: { action: "timeout", duration: warning[1] * 60_000 } } : {},
    };
    if (input.profile === "community" && !settings.eventlogs?.joins) values.joinlogs = channel.id;
    if (input.profile === "music") values.music = { ...settings.music, mode: input.preset === "strict" ? "dj" : "open", threshold: { light: 50, balanced: 60, strict: 75 }[input.preset] };
    const changes = Object.entries(values).map(([key, after]) => ({ key, before: settings[key] ?? null, after })).filter(change => JSON.stringify(change.before) !== JSON.stringify(change.after));
    const review = createHash("sha256").update(JSON.stringify([guild.id, input.profile, input.preset, channel.id, changes])).digest("hex");
    if (input.review !== undefined) {
        if (input.review !== review) throw Object.assign(new Error("These settings changed since your preview. Review the preset again."), { status: 409 });
        if (changes.length) bot.store.saveSettings(guild.id, { ...settings, ...values }, actor.user.id, "Dashboard preset: " + name + " " + input.profile);
    }
    return { name, review, changes, applied: input.review !== undefined };
}

export function commandConflicts(settings) {
    const issues = [], disabled = new Set(settings.disabledCommands ?? []), rules = settings.commandRules ?? [];
    const native = new Map(COMMANDS.flatMap(command => [command.name, ...command.aliases].map(name => [name, command])));
    const disabledBy = name => [name, name.split(" ")[0]].find(value => disabled.has(value));
    const add = (kind, subject, detail) => issues.push({ kind, subject, detail });
    for (const [name, target] of Object.entries(settings.aliases ?? {})) {
        if (native.has(name)) add("Shortcut shadows a command", name, "This shortcut takes precedence over Sonata’s built-in command or shortcut with the same name.");
        const [root, sub] = String(target).trim().toLowerCase().split(/\s+/), command = native.get(root);
        if (!command || (command.options[0]?.type === 1 && !command.options.some(option => option.name === sub))) {
            add("Shortcut target unavailable", name, `${target} does not resolve to a supported command.`);
            continue;
        }
        const full = command.options[0]?.type === 1 ? command.name + " " + sub : command.name;
        const blocked = disabledBy(full);
        if (blocked) add("Shortcut points to a disabled command", name, `${full} is blocked by the disabled setting for ${blocked}.`);
    }
    for (const name of disabled) {
        const root = name.split(" ")[0];
        if (name !== root && disabled.has(root)) add("Parent command disabled", name, `Enabling this subcommand alone leaves ${root} disabled.`);
    }
    for (const name of new Set(rules.map(rule => rule.command))) {
        const root = name.split(" ")[0], blocked = disabledBy(name);
        if (blocked) { add("Rules on a disabled command", name, `These rules cannot take effect while ${blocked} is disabled.`); continue; }
        const applicable = rules.filter(rule => rule.command === name || rule.command === root);
        const channelRules = applicable.filter(rule => rule.kind === "channel");
        const allowLists = [...new Set([root, name])].map(key => channelRules.filter(rule => rule.command === key && rule.mode === "allow").map(rule => rule.target)).filter(list => list.length);
        const denies = new Set(channelRules.filter(rule => rule.mode === "deny").map(rule => rule.target));
        if (allowLists.length && !allowLists[0].some(id => !denies.has(id) && allowLists.every(list => list.includes(id)))) add("No channel can satisfy these rules", name, "Channel allow lists must overlap, and any matching deny takes precedence.");
        for (const rule of applicable.filter(rule => rule.mode === "allow")) {
            if (applicable.some(other => (rule.command === name || other.command === name) && other.kind === rule.kind && other.target === rule.target && other.mode === "deny")) {
                add("Allow and deny overlap", name, `The deny wins for ${rule.kind} ID ${rule.target}.`);
            }
        }
    }
    return { issues };
}
