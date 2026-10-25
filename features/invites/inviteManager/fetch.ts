/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Collecting invites. Discord has no "all my invites" list, so this asks each
// server where you can see its invites (Manage Server), or each channel where
// you can (Manage Channels), and looks up the ones you created elsewhere by code.

import { ChannelStore, GuildChannelStore, GuildStore, PermissionsBits, PermissionStore, RestAPI, UserStore } from "@webpack/common";

import { expiryOf, InviteRow } from "./invites";
import { savedInvites } from "./store";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function get(url: string, query?: Record<string, any>): Promise<any> {
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return (await RestAPI.get({ url, query })).body;
        } catch (e: any) {
            // Slowed down by Discord: wait as long as it asks, then try again.
            const wait = Number(e?.body?.retry_after ?? 0);
            if (e?.status === 429 && wait) { await sleep(wait * 1000 + 150); continue; }
            throw e;
        }
    }
    throw new Error("Discord kept asking to slow down");
}

function rowFrom(raw: any, source: InviteRow["source"]): InviteRow {
    const guildId = raw.guild?.id ?? raw.guild_id ?? null;
    const guild = guildId ? GuildStore.getGuild(guildId) : null;
    return {
        code: raw.code,
        guildId,
        guildName: guild?.name ?? raw.guild?.name ?? (raw.channel?.type === 3 ? "Group DM" : "Unknown server"),
        guildIcon: guild?.icon ?? raw.guild?.icon ?? null,
        channelId: raw.channel?.id ?? null,
        channelName: raw.channel?.name ?? (raw.channel?.id ? ChannelStore.getChannel(raw.channel.id)?.name ?? null : null),
        inviterId: raw.inviter?.id ?? null,
        uses: typeof raw.uses === "number" ? raw.uses : null,
        maxUses: raw.max_uses ?? 0,
        maxAge: typeof raw.max_age === "number" ? raw.max_age : null,
        temporary: !!raw.temporary,
        createdAt: raw.created_at ? Date.parse(raw.created_at) : null,
        expiresAt: expiryOf(raw),
        source,
    };
}

export const canRevoke = (r: InviteRow) => {
    const guild = r.guildId ? GuildStore.getGuild(r.guildId) : null;
    const channel = r.channelId ? ChannelStore.getChannel(r.channelId) : null;
    return !!((guild && PermissionStore.can(PermissionsBits.MANAGE_GUILD, guild)) || (channel && PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, channel)));
};

export interface Progress { done: number; total: number; label: string; }

/**
 * Every invite we can find. `everyone` includes invites other people made in
 * servers you manage; otherwise only yours.
 */
export async function collectInvites(everyone: boolean, onProgress: (p: Progress) => void, isCancelled: () => boolean) {
    const me = UserStore.getCurrentUser()?.id;
    const rows = new Map<string, InviteRow>();
    const problems: string[] = [];
    const guilds = Object.values(GuildStore.getGuilds()).sort((a, b) => a.name.localeCompare(b.name));
    const saved = savedInvites();
    const total = guilds.length + saved.length;
    let done = 0;

    for (const guild of guilds) {
        if (isCancelled()) return null;
        onProgress({ done: done++, total, label: guild.name });
        try {
            let list: any[] = [];
            if (PermissionStore.can(PermissionsBits.MANAGE_GUILD, guild)) {
                list = await get(`/guilds/${guild.id}/invites`);
            } else {
                // Without Manage Server, each channel you manage can still be asked.
                const channels = ((GuildChannelStore.getChannels(guild.id)?.SELECTABLE ?? []) as any[]).map(e => e.channel)
                    .concat(((GuildChannelStore.getChannels(guild.id) as any)?.VOCAL ?? []).map((e: any) => e.channel))
                    .filter(c => c && PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, c))
                    .slice(0, 25);
                for (const c of channels) {
                    if (isCancelled()) return null;
                    list.push(...await get(`/channels/${c.id}/invites`));
                    await sleep(120);
                }
            }
            for (const raw of list) {
                if (!everyone && raw.inviter?.id !== me) continue;
                rows.set(raw.code, rowFrom(raw, "server"));
            }
        } catch (e: any) {
            if (e?.status !== 403) problems.push(guild.name);
        }
        await sleep(150);
    }

    // Ones you made where you can't list the server's invites: look each up by code.
    for (const s of saved) {
        if (isCancelled()) return null;
        onProgress({ done: done++, total, label: `discord.gg/${s.code}` });
        if (rows.has(s.code)) continue;
        try {
            const raw = await get(`/invites/${s.code}`, { with_counts: true, with_expiration: true });
            const row = rowFrom({ ...raw, created_at: raw.created_at ?? new Date(s.createdAt).toISOString(), max_age: raw.max_age ?? s.maxAge, max_uses: raw.max_uses ?? s.maxUses }, "saved");
            row.inviterId = me ?? null;
            rows.set(s.code, row);
        } catch (e: any) {
            if (e?.status === 404) {
                // Expired or revoked.
                const guild = s.guildId ? GuildStore.getGuild(s.guildId) : null;
                rows.set(s.code, {
                    code: s.code, guildId: s.guildId, guildName: guild?.name ?? "Unknown server", guildIcon: guild?.icon ?? null,
                    channelId: s.channelId, channelName: s.channelId ? ChannelStore.getChannel(s.channelId)?.name ?? null : null,
                    inviterId: me ?? null, uses: null, maxUses: s.maxUses, maxAge: s.maxAge, temporary: false,
                    createdAt: s.createdAt, expiresAt: s.maxAge ? s.createdAt + s.maxAge * 1000 : null, source: "saved", gone: true,
                });
            }
        }
        await sleep(150);
    }

    onProgress({ done: total, total, label: "" });
    return { rows: [...rows.values()], problems };
}

export async function revokeInvite(code: string) {
    await RestAPI.del({ url: `/invites/${code}` });
}
