/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The slash command viewer: the commands a bot has registered — everywhere,
// and in each server you share with it — read from the same lists Discord
// loads when you type "/".

import { RestAPI } from "@webpack/common";

export interface CmdOption { type: number; name: string; description: string; required?: boolean; choices?: { name: string; value: string | number; }[]; options?: CmdOption[]; min_value?: number; max_value?: number; autocomplete?: boolean; }
export interface Cmd { id: string; name: string; description: string; type: number; options: CmdOption[]; guildId: string | null; defaultPerms: string | null; }

export const OPTION_TYPES: Record<number, string> = { 1: "subcommand", 2: "group", 3: "text", 4: "whole number", 5: "true / false", 6: "user", 7: "channel", 8: "role", 9: "user or role", 10: "number", 11: "file" };
export const COMMAND_TYPES: Record<number, string> = { 1: "Slash command", 2: "Right-click a user", 3: "Right-click a message", 4: "App launcher" };

function pick(body: any, appId: string): Cmd[] {
    const list: any[] = Array.isArray(body?.application_commands) ? body.application_commands : [];
    return list.filter(c => String(c.application_id) === appId).map(c => ({
        id: String(c.id), name: String(c.name), description: String(c.description ?? ""), type: Number(c.type ?? 1),
        options: Array.isArray(c.options) ? c.options : [], guildId: c.guild_id ? String(c.guild_id) : null,
        defaultPerms: c.default_member_permissions ?? null,
    }));
}

/** The bot's commands that work everywhere (no shared server needed). */
export async function appCommands(appId: string): Promise<Cmd[] | null> {
    try { return pick((await RestAPI.get({ url: `/applications/${appId}/application-command-index` }) as any)?.body, appId); } catch { return null; }
}

/** Its commands as they are in one server you share with it (including that server's own commands). */
export async function guildCommands(guildId: string, appId: string): Promise<Cmd[] | null> {
    try { return pick((await RestAPI.get({ url: `/guilds/${guildId}/application-command-index` }) as any)?.body, appId); } catch { return null; }
}

/** "/ban member reason?" — how the command looks when you use it. */
export function usage(c: Cmd) {
    if (c.type !== 1) return c.name;
    const opts = c.options.filter(o => o.type > 2).map(o => o.required ? o.name : `${o.name}?`);
    return `/${c.name}${opts.length ? ` ${opts.join(" ")}` : ""}`;
}
