/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import type { DecoratorProps } from "@api/MemberListDecorators";
import { OwnerCrownIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Channel, Guild, User } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import { GuildMemberStore, GuildRoleStore, GuildStore, PermissionsBits, SelectedGuildStore, Tooltip, useStateFromStores } from "@webpack/common";

const computePermissions: (options: { user: User; context: Guild; }) => bigint = findByCodeLazy(".getCurrentUser()", ".computeLurkerPermissionsAllowList()");

function StaffCrown(props: DecoratorProps & { guildId?: string; }) {
    const rank = useStateFromStores([GuildStore, GuildMemberStore, GuildRoleStore, SelectedGuildStore], () => {
        if (props.type !== "guild") return null;
        const guildId = props.guildId ?? props.channel?.guild_id ?? SelectedGuildStore.getGuildId();
        if (!guildId) return null;
        const guild = GuildStore.getGuild(guildId);
        if (!guild || guild.ownerId === props.user.id) return null;
        const permissions = computePermissions({ user: props.user, context: guild });
        if (permissions & PermissionsBits.ADMINISTRATOR) return "Administrator";
        if (permissions & (PermissionsBits.KICK_MEMBERS | PermissionsBits.BAN_MEMBERS | PermissionsBits.MODERATE_MEMBERS | PermissionsBits.MANAGE_MESSAGES)) return "Moderator";
        return null;
    }, [props.type, props.guildId, props.channel?.guild_id, props.user]);
    if (!rank) return null;
    return <Tooltip text={rank}>{tooltipProps => <OwnerCrownIcon {...tooltipProps} width={14} height={14} aria-label={rank} style={{ color: rank === "Administrator" ? "#b8bec7" : "#ad8058" }} />}</Tooltip>;
}

export default definePlugin({
    name: "ForceOwnerCrown",
    description: "Show gold owner crowns, silver administrator crowns and brown moderator crowns in the member list.",
    authors: [Devs.D3SOX, Devs.Nickyux],
    tags: ["Roles", "Appearance", "Servers"],
    renderMemberListDecorator: props => <StaffCrown {...props} />,
    patches: [
        {
            find: "#{intl::GUILD_OWNER}),children:",
            replacement: {
                match: /(?<=decorators:.{0,200}?isOwner:)\i/,
                replace: "$self.isGuildOwner(arguments[0])"
            }
        }
    ],
    isGuildOwner(props: { user: User, channel: Channel, isOwner: boolean, guildId?: string; }) {
        if (!props?.user?.id) return props.isOwner;
        if (props.channel?.type === 3 /* GROUP_DM */)
            return props.isOwner;

        // guild id is in props twice, fallback if the first is undefined
        const guildId = props.guildId ?? props.channel?.guild_id;
        const userId = props.user.id;

        return GuildStore.getGuild(guildId)?.ownerId === userId;
    },
});
