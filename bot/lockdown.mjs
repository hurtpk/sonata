/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channelPermissions, embed, fail, isId, PERMS, requirePermission } from "./discord.mjs";
import { editBits } from "./restrictions.mjs";

const mask = PERMS.SEND | PERMS.THREAD_SEND;
const snapshot = (channel, id, type) => { const old = channel.permission_overwrites?.find(value => value.id === id); return { id, type, allow: (BigInt(old?.allow ?? "0") & mask).toString(), deny: (BigInt(old?.deny ?? "0") & mask).toString() }; };

export async function lockdownCommand(context, store, perform) {
    const { command, api, guild, roles, bot, actor } = context, saved = store.restriction(guild.id, guild.id, "lockdown");
    if (command.sub === "view") return embed("Server lockdown", saved ? `Started by <@${saved.actor}>\nReason: ${saved.reason}\n\n${saved.channels.map(value => `<#${value.channel}>`).join("\n")}` : "No active lockdown.");
    context.botPermission(PERMS.CHANNELS | PERMS.ROLES | PERMS.SEND | PERMS.THREAD_SEND);
    if (command.sub === "start") {
        if (saved) fail("Restore the current lockdown before starting another.");
        const all = await api(`/guilds/${guild.id}/channels`), ids = command.options.channels === "all" ? all.filter(value => [0, 5].includes(value.type)).map(value => value.id) : [...new Set(command.options.channels.split(/[\s,]+/).map(value => value.replace(/^<#|>$/g, "")))];
        if (!ids.length || ids.length > 50 || !ids.every(isId)) fail("Choose one to fifty text channel IDs, separated by commas, or all for a server with at most fifty text channels.");
        const channels = ids.map(id => all.find(channel => channel.id === id));
        for (const channel of channels) {
            if (!channel || ![0, 5].includes(channel.type) || store.restriction(guild.id, channel.id, "lock")) fail("Choose text or announcement channels that are not already individually locked.");
            requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.CHANNELS);
            requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.CHANNELS | PERMS.ROLES);
        }
        const record = { actor: actor.user.id, reason: command.options.reason || "Server incident.", channels: [] };
        store.saveRestriction(guild.id, guild.id, "lockdown", record);
        return perform(context, store, "server lockdown", guild.id, record.reason, 0, async (_, audit) => {
            for (const channel of channels) {
                const entry = { channel: channel.id, everyone: snapshot(channel, guild.id, 0), bot: snapshot(channel, bot.user.id, 1) };
                record.channels.push(entry); store.saveRestriction(guild.id, guild.id, "lockdown", record);
                await editBits(api, channel, bot.user.id, 1, mask, mask, 0n, audit);
                await editBits(api, channel, guild.id, 0, mask, 0n, mask, audit);
            }
            return `Locked ${record.channels.length} text channels for everyone. Administrators and explicit role/member allows can still grant access. Use lockdown restore to undo only these changes.`;
        });
    }
    if (!saved) fail("No lockdown permissions are saved.");
    return perform(context, store, "server lockdown restored", guild.id, "Restored saved lockdown permissions.", 0, async (_, audit) => {
        let restored = 0, preserved = 0;
        for (const entry of saved.channels) {
            const channel = await api(`/channels/${entry.channel}`, { optional: true });
            if (!channel) continue;
            if (channel.guild_id !== guild.id) fail("A saved channel no longer belongs to this server.");
            requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.CHANNELS);
            for (const [key, allow, deny] of [["everyone", 0n, mask], ["bot", mask, 0n]]) {
                const old = entry[key], current = channel.permission_overwrites?.find(value => value.id === old.id), actualAllow = BigInt(current?.allow ?? "0") & mask, actualDeny = BigInt(current?.deny ?? "0") & mask;
                if (actualAllow === BigInt(old.allow) && actualDeny === BigInt(old.deny)) continue;
                if (actualAllow !== allow || actualDeny !== deny) { preserved++; continue; }
                await editBits(api, channel, old.id, old.type, mask, BigInt(old.allow), BigInt(old.deny), audit); restored++;
            }
        }
        store.clearRestriction(guild.id, guild.id, "lockdown");
        return `Restored ${restored} permission overwrites. Preserved ${preserved} overwrites whose message permissions were changed after lockdown. Other permission bits were kept.`;
    });
}
