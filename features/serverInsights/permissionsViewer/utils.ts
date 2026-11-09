/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { classNameFactory } from "@utils/css";
import { Guild, GuildMember, Role } from "@vencord/discord-types";
import { PermissionOverwriteType } from "@vencord/discord-types/enums";
import { extractAndLoadChunksLazy, filters, find } from "@webpack";
import { GuildRoleStore, i18n, PermissionsBits } from "@webpack/common";

import { PermissionsSortOrder, settings } from ".";

const loadPermissionChunk = extractAndLoadChunksLazy([".PRIMARY,badgeTooltipDelay:"]);

export async function loadGetGuildPermissionSpecMap() {
    try { await loadPermissionChunk(); } catch { return; }
}

export function getGuildPermissionSpecMap(guild: Guild): Record<string, { title: string; description: string; }> {
    let native: Record<string, { title?: string; description?: unknown; }> | undefined;
    try {
        native = find(filters.byProps("getGuildPermissionSpecMap"), { isIndirect: true })?.getGuildPermissionSpecMap(guild);
    } catch { /* Discord can move or remove its permission metadata. */ }

    return Object.fromEntries(Object.entries(PermissionsBits).map(([name, bit]) => {
        const spec = native?.[String(bit)];
        let description = spec?.description;
        if (typeof description === "function") {
            try { description = i18n.intl.format(description, {}); } catch { description = ""; }
        }
        return [String(bit), {
            title: spec?.title ?? name.replaceAll("_", " ").toLowerCase().replace(/^./, letter => letter.toUpperCase()),
            description: typeof description === "string" ? description : ""
        }];
    }));
}

export const cl = classNameFactory("vc-permviewer-");

export function getSortedRolesForMember({ id: guildId }: Guild, member: GuildMember) {
    // The guild id is the @everyone role
    return GuildRoleStore
        .getSortedRoles(guildId)
        .filter(role => role.id === guildId || member.roles.includes(role.id));
}

export function sortUserRoles(roles: Role[]) {
    switch (settings.store.permissionsSortOrder) {
        case PermissionsSortOrder.HighestRole:
            return roles.sort((a, b) => b.position - a.position);
        case PermissionsSortOrder.LowestRole:
            return roles.sort((a, b) => a.position - b.position);
        default:
            return roles;
    }
}

export function sortPermissionOverwrites<T extends { id: string; type: number; }>(overwrites: T[], guildId: string) {
    const roles = GuildRoleStore.getRolesSnapshot(guildId);

    return overwrites.sort((a, b) => {
        if (a.type !== PermissionOverwriteType.ROLE || b.type !== PermissionOverwriteType.ROLE) return 0;

        const roleA = roles[a.id];
        const roleB = roles[b.id];

        const posA = roleA?.position ?? -Infinity;
        const posB = roleB?.position ?? -Infinity;

        return posB - posA;
    });
}
