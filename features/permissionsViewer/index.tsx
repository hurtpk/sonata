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

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { SafetyIcon } from "@components/Icons";
import { TooltipContainer } from "@components/TooltipContainer";
import { Devs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { Guild, RoleOrUserPermission } from "@vencord/discord-types";
import { PermissionOverwriteType } from "@vencord/discord-types/enums";
import { findCssClassesLazy } from "@webpack";
import { Button, ChannelStore, Dialog, GuildMemberStore, GuildRoleStore, GuildStore, match, Menu, PermissionsBits, Popout, SelectedGuildStore, useEffect, useRef, UserStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openMemberLookup } from "./components/MemberLookup";
import openRolesAndUsersPermissionsModal from "./components/RolesAndUsersPermissions";
import UserPermissions from "./components/UserPermissions";
import { getSortedRolesForMember, loadGetGuildPermissionSpecMap, sortPermissionOverwrites } from "./utils";

const PopoutClasses = findCssClassesLazy("container", "popoutRoleDot");

export const enum PermissionsSortOrder {
    HighestRole,
    LowestRole
}

const enum MenuItemParentType {
    User,
    Channel,
    Guild
}

export const settings = defineFeatureSettings("permissionsViewer", {
    lookup: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => openMemberLookup()}>Open Member Lookup</button>
                <span className="vc-tool-hint">Paste someone's ID or username to see their roles, permissions, and when they joined. Also on a server's right-click menu.</span>
            </div>
        ),
    },
    recentLookups: {
        type: OptionType.STRING,
        description: "Internal: people you looked up recently.",
        default: "",
        hidden: true,
    },
    clickRoles: {
        type: OptionType.BOOLEAN,
        description: "Click a role on someone's profile to open it here — with its ID, colour codes and icon (restart Discord after changing)",
        default: true,
        restartNeeded: true,
    },
    permissionsSortOrder: {
        description: "The sort method used for defining which role grants an user a certain permission",
        type: OptionType.SELECT,
        options: [
            { label: "Highest Role", value: PermissionsSortOrder.HighestRole, default: true },
            { label: "Lowest Role", value: PermissionsSortOrder.LowestRole }
        ]
    },
});

function MenuItem(guildId: string, { id, type, withIcon }: { id?: string, type?: MenuItemParentType, withIcon?: boolean; }) {
    if (type === MenuItemParentType.User && !GuildMemberStore.isMember(guildId, id!)) return null;

    return (
        <Menu.MenuItem
            id="perm-viewer-permissions"
            label="View Permissions"
            leadingAccessory={withIcon ? { type: "icon", icon: SafetyIcon } : undefined}
            action={() => {
                const guild = GuildStore.getGuild(guildId);

                const { permissions, header } = match(type)
                    .returnType<{ permissions: RoleOrUserPermission[], header: string; }>()
                    .with(MenuItemParentType.User, () => {
                        const member = GuildMemberStore.getMember(guildId, id!)!;

                        const permissions: RoleOrUserPermission[] = getSortedRolesForMember(guild, member)
                            .map(role => ({
                                type: PermissionOverwriteType.ROLE,
                                ...role
                            }));

                        if (guild.ownerId === id) {
                            permissions.push({
                                type: PermissionOverwriteType.OWNER,
                                permissions: Object.values(PermissionsBits).reduce((prev, curr) => prev | curr, 0n)
                            });
                        }

                        return {
                            permissions,
                            header: member.nick ?? UserStore.getUser(member.userId).username
                        };
                    })
                    .with(MenuItemParentType.Channel, () => {
                        const channel = ChannelStore.getChannel(id!);

                        const permissions = sortPermissionOverwrites(Object.values(channel.permissionOverwrites).map(({ id, allow, deny, type }) => ({
                            type,
                            id,
                            overwriteAllow: allow,
                            overwriteDeny: deny
                        })), guildId);

                        return {
                            permissions,
                            header: channel.name
                        };
                    })
                    .otherwise(() => {
                        const permissions = GuildRoleStore.getSortedRoles(guild.id).map(role => ({
                            type: PermissionOverwriteType.ROLE,
                            ...role
                        }));

                        return {
                            permissions,
                            header: guild.name
                        };
                    });

                openRolesAndUsersPermissionsModal(permissions, guild, header);
            }}
        />
    );
}

/** Every role in a server, opened on one of them. */
export function openRole(guildId: string, roleId: string) {
    const guild = GuildStore.getGuild(guildId);
    if (!guild) return;
    const permissions = GuildRoleStore.getSortedRoles(guild.id).map(role => ({ type: PermissionOverwriteType.ROLE, ...role })) as RoleOrUserPermission[];
    openRolesAndUsersPermissionsModal(permissions, guild, guild.name, roleId);
}

/** Right-clicking a role anywhere (Discord's "Copy Role ID" menu). */
const roleMenu: NavContextMenuPatchCallback = (children, { id }: { id?: string; }) => {
    const guildId = SelectedGuildStore.getGuildId();
    if (!id || !guildId || !GuildRoleStore.getRole(guildId, id)) return;
    children.push(<Menu.MenuItem id="vc-permviewer-open-role" label="Role Info & Permissions" leadingAccessory={{ type: "icon", icon: SafetyIcon }} action={() => openRole(guildId, id)} />);
};

function makeContextMenuPatch(childId: string | string[], type?: MenuItemParentType, withIcon = false): NavContextMenuPatchCallback {
    return (children, props) => {
        if (
            !props ||
            (type === MenuItemParentType.User && !props.user) ||
            (type === MenuItemParentType.Guild && !props.guild) ||
            (type === MenuItemParentType.Channel && (!props.channel || !props.guild))
        ) {
            return;
        }

        const group = findGroupChildrenByChildId(childId, children);

        const item = match(type)
            .with(MenuItemParentType.User, () => MenuItem(props.guildId, { id: props.user.id, type, withIcon }))
            .with(MenuItemParentType.Channel, () => MenuItem(props.guild.id, { id: props.channel.id, type, withIcon }))
            .with(MenuItemParentType.Guild, () => MenuItem(props.guild.id, { withIcon }))
            .otherwise(() => null);

        if (item == null) return;

        const lookup = type === MenuItemParentType.Guild
            ? <Menu.MenuItem id="perm-viewer-lookup" label="Look Up a Member" leadingAccessory={withIcon ? { type: "icon", icon: SafetyIcon } : undefined} action={() => openMemberLookup(props.guild.id)} />
            : type === MenuItemParentType.User && props.guildId
                ? <Menu.MenuItem id="perm-viewer-lookup" label="Member Lookup" action={() => openMemberLookup(props.guildId, props.user.id)} />
                : null;
        if (group) {
            group.push(item);
            if (lookup) group.push(lookup);
            return;
        }

        // "roles" may not be present due to the member not having any roles. In that case, add it above "Copy ID"
        if (childId === "roles" && props.guildId) {
            children.splice(-1, 0, <Menu.MenuGroup>{item}{lookup}</Menu.MenuGroup>);
        }
    };
}

export default definePlugin({
    name: "PermissionsViewer",
    description: "View the permissions a user or channel has, and the roles of a server",
    tags: ["Servers", "Roles", "Utility"],
    authors: [Devs.Nuckyz, Devs.Ven],
    settings,

    patches: [
        {
            // The role pills on someone's profile — the same spot Equicord's Clickable Roles uses, so it steps aside when that's on.
            find: "#{intl::zr0Y5R::raw}",
            predicate: () => settings.store.clickRoles !== false && !Settings.plugins.ClickableRoles?.enabled,
            replacement: {
                match: /(\.colorString\?\?\i;)return(.*?enableTooltip:!1\}\)\}\):null,\i\]\}\))/,
                replace: "$1return $self.clickableRole(arguments[0],()=>$2)",
            },
        },
        {
            find: "#{intl::COLLAPSE_ROLES}",
            replacement: {
                match: /(?<=\i\.id\)\),\i\(\))(?=,\i\?)/,
                replace: ",$self.ViewPermissionsButton(arguments[0])"
            }
        }
    ],

    clickableRole(props: { role?: { id: string; }; guildId?: string; }, render: () => React.ReactNode) {
        const roleId = props?.role?.id, guildId = props?.guildId;
        if (!roleId || !guildId) return render();
        return (
            <span className="vc-permviewer-clickable-role" title="Open this role in Permissions Viewer"
                onClick={e => {
                    // Not when removing the role with its little ×.
                    if ((e.target as HTMLElement).closest?.('[class*="roleRemove"], [class*="removeButton"]')) return;
                    openRole(guildId, roleId);
                }}>
                {render()}
            </span>
        );
    },

    ViewPermissionsButton: ErrorBoundary.wrap(({ className, guild, userId }: { className: string; guild: Guild; userId: string; }) => {
        const buttonRef = useRef(null);
        useEffect(() => void loadGetGuildPermissionSpecMap(), []);

        const guildMember = GuildMemberStore.getMember(guild.id, userId);
        if (!guildMember) return null;

        return (
            <Popout
                position="bottom"
                align="center"
                targetElementRef={buttonRef}
                renderPopout={({ closePopout }) => (
                    <Dialog className={PopoutClasses.container} style={{ width: "500px" }}>
                        <UserPermissions guild={guild} guildMember={guildMember} closePopout={closePopout} />
                    </Dialog>
                )}
            >
                {popoutProps => (
                    <TooltipContainer text="View Permissions">
                        <Button
                            {...popoutProps}
                            ref={buttonRef}
                            color={Button.Colors.CUSTOM}
                            look={Button.Looks.FILLED}
                            size={Button.Sizes.NONE}
                            className={classes(className, "vc-permviewer-role-button")}
                        >
                            <SafetyIcon height="16" width="16" />
                        </Button>
                    </TooltipContainer>
                )}
            </Popout>
        );
    }, { noop: true }),

    contextMenus: {
        "user-context": makeContextMenuPatch("roles", MenuItemParentType.User),
        "channel-context": makeContextMenuPatch(["mute-channel", "unmute-channel"], MenuItemParentType.Channel),
        "guild-context": makeContextMenuPatch("privacy", MenuItemParentType.Guild),
        "guild-header-popout": makeContextMenuPatch("privacy", MenuItemParentType.Guild, true),
        "dev-context": roleMenu,
    }
});
