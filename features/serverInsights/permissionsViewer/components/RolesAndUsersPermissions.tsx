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

import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { CopyIdIcon, InfoIcon, OwnerCrownIcon } from "@components/Icons";
import { buildExtraRoleContextMenuItems } from "@plugins/betterRoleContext";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { getIntlMessage, getUniqueUsername } from "@utils/discord";
import { classes } from "@utils/misc";
import { Guild, RenderModalProps, Role, RoleOrUserPermission, UnicodeEmoji, User } from "@vencord/discord-types";
import { PermissionOverwriteType } from "@vencord/discord-types/enums";
import { findByCodeLazy } from "@webpack";
import { ContextMenuApi, FluxDispatcher, GuildMemberStore, GuildRoleStore, i18n, Menu, openModalLazy, PermissionsBits, ScrollerThin, Tooltip, useEffect, useMemo, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import { windowAccent } from "../../../../controller/accent";
import { Window } from "../../../_shared/Window";
import { settings } from "..";
import { cl, getGuildPermissionSpecMap, loadGetGuildPermissionSpecMap } from "../utils";
import { CompareView, RolePicker } from "./Compare";
import { PermissionAllowedIcon, PermissionDeniedIcon } from "./icons";
import { roleFill,RoleInfo } from "./RoleInfo";
import { openWhoHas } from "./WhoHas";

const tl = classNameFactory("vc-tool-");

type GetRoleIconData = (role: Role, size: number) => { customIconSrc?: string; unicodeEmoji?: UnicodeEmoji; };
const getRoleIconData: GetRoleIconData = findByCodeLazy("convertSurrogateToName", "customIconSrc", "unicodeEmoji");

function getRoleIconSrc(role: Role, size = 20) {
    const icon = getRoleIconData(role, size);
    if (!icon) return;

    const { customIconSrc, unicodeEmoji } = icon;
    return customIconSrc ?? unicodeEmoji?.url;
}

function RolesAndUsersPermissionsComponent({ permissions, guild, modalProps, header, selectId }: { permissions: Array<RoleOrUserPermission>; guild: Guild; modalProps: RenderModalProps; header: string; selectId?: string; }) {
    const guildPermissionSpecMap = useMemo(() => getGuildPermissionSpecMap(guild), [guild.id]);

    useStateFromStores(
        [GuildMemberStore],
        () => GuildMemberStore.getMemberIds(guild.id),
        null,
        (old, current) => old.length === current.length
    );

    useEffect(() => {
        permissions.sort((a, b) => a.type - b.type);
    }, [permissions]);

    useEffect(() => {
        const usersToRequest = permissions
            .filter(p => p.type === PermissionOverwriteType.MEMBER && !GuildMemberStore.isMember(guild.id, p.id!))
            .map(({ id }) => id);

        FluxDispatcher.dispatch({
            type: "GUILD_MEMBERS_REQUEST",
            guildIds: [guild.id],
            userIds: usersToRequest
        });
    }, []);

    const [selectedItemIndex, selectItem] = useState(() => Math.max(0, selectId ? permissions.findIndex(p => p.id === selectId) : 0));
    // Opened on one role: bring it into view in the list.
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!selectId) return;
        const t = setTimeout(() => listRef.current?.querySelector(".vc-tool-item-on")?.scrollIntoView({ block: "center" }), 60);
        return () => clearTimeout(t);
    }, []);
    const selectedItem = permissions[selectedItemIndex];

    const roles = GuildRoleStore.getRolesSnapshot(guild.id);
    const permName = (bit: bigint) => guildPermissionSpecMap[String(bit)]?.title ?? Object.entries(PermissionsBits).find(([, b]) => b === bit)?.[0] ?? String(bit);

    // Comparing the selected role with another one.
    const [compareWith, setCompareWith] = useState<string | null>(null);
    useEffect(() => setCompareWith(null), [selectedItemIndex]);
    const selectedRole = selectedItem?.type === PermissionOverwriteType.ROLE ? roles[selectedItem.id ?? ""] : undefined;
    const otherRole = compareWith ? roles[compareWith] : undefined;
    const otherRoles = selectedRole ? Object.values(roles).filter(r => r.id !== selectedRole.id).sort((a, b) => b.position - a.position) : [];
    const accent = windowAccent("permissionsViewer");

    // How many permissions the selected role / person has allowed and denied.
    const counts = { allowed: 0, denied: 0 };
    if (selectedItem) for (const bit of Object.values(PermissionsBits)) {
        const { permissions: p, overwriteAllow, overwriteDeny } = selectedItem;
        if (p != null) (p & bit) === bit ? counts.allowed++ : counts.denied++;
        else if (overwriteAllow && (overwriteAllow & bit) === bit) counts.allowed++;
        else if (overwriteDeny && (overwriteDeny & bit) === bit) counts.denied++;
    }

    return (
        <Window
            {...modalProps}
            size="xl"
            title={`${header} Permissions`}
            subtitle="Pick a role or person on the left to see what they can and can't do"
        >
            <div className={classes(tl("wrap"), cl("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
            {!selectedItem && (
                <div className={tl("empty")}><span className={tl("empty-icon")}>🔓</span>There are no permissions to show here.</div>
            )}

            {selectedItem && (
                <div className={cl("modal-container")}>
                    <ScrollerThin className={cl("modal-list")} orientation="auto">
                        <div ref={listRef} style={{ display: "contents" }}>
                        {permissions.map((permission, index) => {
                            const user: User | undefined = UserStore.getUser(permission.id ?? "");
                            const role: Role | undefined = roles[permission.id ?? ""];
                            const roleIconSrc = role != null ? getRoleIconSrc(role) : undefined;

                            return (
                                <div
                                    key={index}
                                    className={cl("modal-list-item-btn")}
                                    onClick={() => selectItem(index)}
                                    role="button"
                                    tabIndex={0}
                                >
                                    <div
                                        className={classes(tl("item"), cl("modal-list-item"), selectedItemIndex === index && tl("item-on"))}
                                        onContextMenu={e => {
                                            if (permission.type === PermissionOverwriteType.ROLE)
                                                ContextMenuApi.openContextMenu(e, () => (
                                                    <RoleContextMenu
                                                        guild={guild}
                                                        roleId={permission.id!}
                                                        onClose={modalProps.onClose}
                                                    />
                                                ));
                                            else if (permission.type === PermissionOverwriteType.MEMBER) {
                                                ContextMenuApi.openContextMenu(e, () => (
                                                    <UserContextMenu
                                                        userId={permission.id!}
                                                    />
                                                ));
                                            }
                                        }}
                                    >
                                        {(permission.type === PermissionOverwriteType.ROLE || permission.type === PermissionOverwriteType.OWNER) && (
                                            <span
                                                className={cl("modal-role-circle")}
                                                style={{ background: roleFill(role) }}
                                            />
                                        )}
                                        {permission.type === PermissionOverwriteType.ROLE && roleIconSrc != null && (
                                            <img
                                                className={cl("modal-role-image")}
                                                src={roleIconSrc}
                                            />
                                        )}
                                        {permission.type === PermissionOverwriteType.MEMBER && user != null && (
                                            <img
                                                className={cl("modal-user-img")}
                                                src={user.getAvatarURL(void 0, void 0, false)}
                                            />
                                        )}
                                        <span className={classes(tl("item-title"), cl("modal-list-item-text"))}>
                                            {
                                                permission.type === PermissionOverwriteType.ROLE
                                                    ? role?.name ?? "Unknown Role"
                                                    : permission.type === PermissionOverwriteType.MEMBER
                                                        ? (user != null && getUniqueUsername(user)) ?? "Unknown User"
                                                        : (
                                                            <Flex gap="0.2em">
                                                                @owner
                                                                <OwnerCrownIcon height={18} width={18} aria-hidden="true" />
                                                            </Flex>
                                                        )
                                            }
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                        </div>
                    </ScrollerThin>
                    <ScrollerThin className={classes(tl("section"), cl("modal-perms"))} orientation="auto">
                        {selectedRole && otherRoles.length > 0 && (
                            <div className={cl("cmp-pick")}>
                                <span className={tl("hint")}>Compare with</span>
                                <RolePicker roles={otherRoles} value={compareWith} onChange={setCompareWith} iconOf={r => getRoleIconSrc(r)} />
                            </div>
                        )}
                        {selectedRole && otherRole ? <CompareView a={selectedRole} b={otherRole} name={permName} onClose={() => setCompareWith(null)} /> : <>
                        {selectedRole && (
                            <RoleInfo role={selectedRole} guild={guild} iconSrc={getRoleIconSrc(selectedRole, 64)} />
                        )}
                        <div className={tl("head")}>
                            <span className={tl("label")}>What this can do</span>
                            <span className={classes(tl("badge"), tl("badge-good"))}>✓ {counts.allowed} allowed</span>
                            {counts.denied > 0 && <span className={classes(tl("badge"), tl("badge-bad"))}>✕ {counts.denied} denied</span>}
                        </div>
                        {Object.values(PermissionsBits).map(bit => {
                            const overrideType = (() => {
                                const { permissions, overwriteAllow, overwriteDeny } = selectedItem;

                                if (permissions != null)
                                    return (permissions & bit) === bit
                                        ? "allowed"
                                        : "denied";

                                if (overwriteAllow && (overwriteAllow & bit) === bit)
                                    return "allowed";
                                if (overwriteDeny && (overwriteDeny & bit) === bit)
                                    return "denied";

                                return "default";
                            })();

                            if (overrideType === "default") return null;

                            return (
                                <div key={bit} className={classes(cl("modal-perms-item"), cl(`perm-${overrideType}`))}>
                                    <div className={cl("modal-perms-item-icon")}>
                                        {overrideType === "allowed" && <PermissionAllowedIcon />}
                                        {overrideType === "denied" && <PermissionDeniedIcon />}
                                    </div>
                                    <span className={cl("perm-name")}>{guildPermissionSpecMap[String(bit)].title}</span>
                                    <button type="button" className={classes(tl("icon"), cl("who-btn"))} title="Who in this server can do this?" onClick={() => openWhoHas(guild, bit, permName(bit))}>👥</button>

                                    <Tooltip text={
                                        (() => {
                                            const { description } = guildPermissionSpecMap[String(bit)];
                                            return typeof description === "function" ? i18n.intl.format(description, {}) : description;
                                        })()
                                    }>
                                        {props => <InfoIcon {...props} />}
                                    </Tooltip>
                                </div>
                            );
                        })}
                        </>}
                    </ScrollerThin>
                </div>
            )}
            </div>
        </Window>
    );
}

function ViewAsRoleIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="currentColor" d="M20.7 12.7a1 1 0 0 0 0-1.4l-5-5a1 1 0 1 0-1.4 1.4l3.29 3.3H4a1 1 0 1 0 0 2h13.59l-3.3 3.3a1 1 0 0 0 1.42 1.4l5-5Z" />
        </svg>
    );
}

function RoleContextMenu({ guild, roleId, onClose }: { guild: Guild; roleId: string; onClose: () => void; }) {
    const popoutRef = useRef(null);
    const role = GuildRoleStore.getRole(guild.id, roleId);
    const { before, after } = buildExtraRoleContextMenuItems(role, guild, popoutRef);

    return (
        <Menu.Menu
            navId={cl("role-context-menu")}
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Role Options"
        >
            {before}

            <Menu.MenuItem
                id={cl("copy-role-id")}
                label={getIntlMessage("COPY_ID_ROLE")}
                icon={CopyIdIcon}
                leadingAccessory={{ type: "icon", icon: CopyIdIcon }}
                action={() => copyToClipboard(roleId)}
            />

            {after}

            {(settings.store as any).unsafeViewAsRole && (
                <Menu.MenuItem
                    id={cl("view-as-role")}
                    label={getIntlMessage("VIEW_AS_ROLE")}
                    icon={ViewAsRoleIcon}
                    leadingAccessory={{ type: "icon", icon: ViewAsRoleIcon }}
                    action={() => {
                        onClose();
                        FluxDispatcher.dispatch({
                            type: "IMPERSONATE_UPDATE",
                            guildId: guild.id,
                            data: {
                                type: "ROLES",
                                roles: {
                                    [roleId]: role
                                }
                            }
                        });
                    }}
                />
            )}
        </Menu.Menu>
    );
}

function UserContextMenu({ userId }: { userId: string; }) {
    return (
        <Menu.Menu
            navId={cl("user-context-menu")}
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="User Options"
        >
            <Menu.MenuItem
                id={cl("copy-user-id")}
                label={getIntlMessage("COPY_ID_USER")}
                leadingAccessory={{ type: "icon", icon: CopyIdIcon }}
                action={() => {
                    copyToClipboard(userId);
                }}
            />
        </Menu.Menu>
    );
}

const RolesAndUsersPermissions = ErrorBoundary.wrap(RolesAndUsersPermissionsComponent);

export default function openRolesAndUsersPermissionsModal(permissions: Array<RoleOrUserPermission>, guild: Guild, header: string, selectId?: string) {
    return openModalLazy(async () => {
        await loadGetGuildPermissionSpecMap();

        return modalProps => (
            <RolesAndUsersPermissions
                modalProps={modalProps}
                permissions={permissions}
                guild={guild}
                header={header}
                selectId={selectId}
            />
        );
    });
}
