/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Local Names: rename servers, channels, group chats and roles, and give
// servers a different icon, just for you. The new name or icon shows
// everywhere Discord shows it — the server list, the channel list, the chat
// header, mentions, role pills — but nothing is sent anywhere, so nobody else
// sees it. While you're editing a server or channel in its settings, the real
// names and icon come back, so saving there never changes them for everyone.
// Same idea as Equicord's CleanChannelName: the name is changed where Discord
// keeps it, on the record itself.

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { Channel, Guild } from "@vencord/discord-types";
import { ChannelStore, GuildRoleStore, GuildStore, IconUtils, Menu } from "@webpack/common";

import { openAllNames, openRename, openServer, RealName } from "./Panel";
import { allNames, Kind, loadNames, localIcon, localName, localRole, onNamesChange, renamedRolesIn } from "./store";

const REAL = Symbol("sonataLocalNames.real");
const REAL_ICON = Symbol("sonataLocalNames.realIcon");
/** Stands in for a server's icon hash when it has none of its own but has one of yours, so Discord draws a picture at all. */
const LOCAL_ICON = "sonata-local";

/** What's being edited in its settings right now: it shows its real name until that closes. */
const editing: Record<Kind, string | null> = { guild: null, channel: null };
/** Off: every record reads its real name again, straight away. */
let active = false;

const showsMine = (guildId: string) => active && editing.guild !== guildId;

/** Gives a record your name for it (once — after that, the getter decides). */
function dress<T extends Guild | Channel>(rec: T | undefined, kind: Kind): T | undefined {
    if (!rec) return rec;
    const r = rec as any;
    if (r[REAL] !== undefined) return rec;
    try {
        const own = Object.getOwnPropertyDescriptor(r, "name");
        if (own && !own.configurable) return rec;
        r[REAL] = r.name;
        Object.defineProperty(r, "name", {
            configurable: true,
            enumerable: true,
            get() { return !active || editing[kind] === r.id ? r[REAL] : localName(kind, r.id) ?? r[REAL]; },
            set(v: string) { r[REAL] = v; },
        });
        if (kind === "guild") {
            const ownIcon = Object.getOwnPropertyDescriptor(r, "icon");
            if (!ownIcon || ownIcon.configurable) {
                r[REAL_ICON] = r.icon;
                Object.defineProperty(r, "icon", {
                    configurable: true,
                    enumerable: true,
                    get() { return showsMine(r.id) && localIcon(r.id) ? r[REAL_ICON] ?? LOCAL_ICON : r[REAL_ICON]; },
                    set(v: string | null) { r[REAL_ICON] = v; },
                });
            }
        }
    } catch { /* a record Discord locked: it keeps its name */ }
    return rec;
}

/** A role with your name for it: the same role, or (if Discord locked it) a copy with your name. */
function named(role: any, guildId: string) {
    if (!role || !localRole(role.id)) return role;
    if (role[REAL] !== undefined) return role;
    try {
        const own = Object.getOwnPropertyDescriptor(role, "name");
        if (own && !own.configurable) throw 0;
        role[REAL] = role.name;
        Object.defineProperty(role, "name", {
            configurable: true,
            enumerable: true,
            get() { return showsMine(guildId) ? localRole(role.id) ?? role[REAL] : role[REAL]; },
            set(v: string) { role[REAL] = v; },
        });
        return role;
    } catch {
        return showsMine(guildId) ? { ...role, name: localRole(role.id) } : role;
    }
}

export const realName: RealName = (kind, id) => {
    const rec: any = kind === "guild" ? GuildStore.getGuild(id) : ChannelStore.getChannel(id);
    return rec ? String(rec[REAL] ?? rec.name ?? "") : "";
};
export const realRoleName = (role: any) => String(role?.[REAL] ?? role?.name ?? "");

/* ── Every server, channel and role Discord hands out goes through these, so new and updated ones get yours too ── */

const originals: { store: any; key: string; fn: any; own: boolean; }[] = [];

function wrap(store: any, key: string, make: (orig: any) => any) {
    const fn = store?.[key];
    if (typeof fn !== "function") return;
    originals.push({ store, key, fn, own: Object.prototype.hasOwnProperty.call(store, key) });
    store[key] = make(fn);
}

function unwrapAll() {
    for (const { store, key, fn, own } of originals.splice(0)) {
        if (own) store[key] = fn;
        else delete store[key];
    }
}

/** A server's roles (by id) with yours swapped in, without touching Discord's own collection. */
function withMine(guildId: string, roles: Record<string, any> | undefined) {
    if (!roles) return roles;
    let out = roles;
    for (const id of renamedRolesIn(guildId)) {
        const r = roles[id];
        if (!r) continue;
        const n = named(r, guildId);
        if (n !== r) { if (out === roles) out = { ...roles }; out[id] = n; }
    }
    return out;
}

/** Re-dresses the ones you changed (Discord swaps in a new record when one changes) and redraws. */
function refresh() {
    const n = allNames();
    for (const id of new Set([...Object.keys(n.guild), ...Object.keys(n.icon)])) dress(GuildStore.getGuild(id), "guild");
    for (const id of Object.keys(n.channel)) dress(ChannelStore.getChannel(id), "channel");
    GuildStore.emitChange?.();
    ChannelStore.emitChange?.();
    (GuildRoleStore as any)?.emitChange?.();
}

/* ── Right-click menus ── */

const item = (kind: Kind, id: string) => (
    <Menu.MenuItem
        id="vc-localnames-rename"
        label={localName(kind, id) ? "Rename just for me… (renamed)" : "Rename just for me…"}
        action={() => openRename(kind, id, realName)}
    />
);

/** A server's one item: its name, icon and role names, just for you, in one window. */
const guildMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    const roles = renamedRolesIn(guild.id).length;
    const changed = [localName("guild", guild.id) && "renamed", localIcon(guild.id) && "new icon", roles && `${roles} role${roles === 1 ? "" : "s"}`].filter(Boolean);
    children.push(
        <Menu.MenuItem id="vc-localnames-server" label="Just for me…" subtext={changed.length ? changed.join(" · ") : "Name, icon and role names only you see"}
            action={() => openServer(guild.id, realName, realRoleName)} />
    );
};

const channelMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel) return;
    const group = findGroupChildrenByChildId("mark-channel-read", children) ?? children;
    group.push(item("channel", channel.id));
};

let stopListening: (() => void) | null = null;

export default definePlugin({
    name: "LocalNames",
    description: "Rename servers, channels, group chats and roles, and give servers a different icon, just for you. Nobody else sees it.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openAllNames(realName, realRoleName),

    contextMenus: {
        "guild-context": guildMenu,
        "guild-header-popout": guildMenu,
        "channel-context": channelMenu,
        "thread-context": channelMenu,
        "gdm-context": channelMenu,
    },

    flux: {
        // While a server's or channel's settings are open, it shows its real name, icon and roles, so saving there never changes them for everyone.
        CHANNEL_SETTINGS_INIT({ channelId }: { channelId: string; }) { editing.channel = channelId; ChannelStore.emitChange?.(); },
        CHANNEL_SETTINGS_CLOSE() { editing.channel = null; ChannelStore.emitChange?.(); },
        GUILD_SETTINGS_INIT({ guildId }: { guildId: string; }) { editing.guild = guildId; GuildStore.emitChange?.(); (GuildRoleStore as any)?.emitChange?.(); },
        GUILD_SETTINGS_CLOSE() { editing.guild = null; GuildStore.emitChange?.(); (GuildRoleStore as any)?.emitChange?.(); },
    },

    start() {
        active = true;
        wrap(GuildStore, "getGuild", orig => function (this: any, id: string) { return dress(orig.call(this, id), "guild"); });
        wrap(ChannelStore, "getChannel", orig => function (this: any, id: string) { return dress(orig.call(this, id), "channel"); });
        wrap(ChannelStore, "getBasicChannel", orig => function (this: any, id: string) { return dress(orig.call(this, id), "channel"); });
        // Your icons: wherever Discord asks for a server's icon picture.
        wrap(IconUtils, "getGuildIconURL", orig => function (this: any, d: any) {
            const mine = d?.id && showsMine(d.id) ? localIcon(d.id) : undefined;
            return mine ?? orig.call(this, d);
        });
        wrap(IconUtils, "getGuildIconSource", orig => function (this: any, d: any) {
            const mine = d?.id && showsMine(d.id) ? localIcon(d.id) : undefined;
            return mine ? { uri: mine } : orig.call(this, d);
        });
        // Your role names.
        wrap(GuildRoleStore, "getRole", orig => function (this: any, g: string, id: string) { return named(orig.call(this, g, id), g); });
        wrap(GuildRoleStore, "getManyRoles", orig => function (this: any, g: string, ids: string[]) { const r = orig.call(this, g, ids); return renamedRolesIn(g).length ? r?.map((x: any) => named(x, g)) : r; });
        wrap(GuildRoleStore, "getSortedRoles", orig => function (this: any, g: string) { const r = orig.call(this, g); return renamedRolesIn(g).length ? r?.map((x: any) => named(x, g)) : r; });
        wrap(GuildRoleStore, "getRolesSnapshot", orig => function (this: any, g: string) { return withMine(g, orig.call(this, g)); });
        wrap(GuildRoleStore, "getUnsafeMutableRoles", orig => function (this: any, g: string) { return withMine(g, orig.call(this, g)); });
        stopListening = onNamesChange(refresh);
        void loadNames().then(refresh);
    },

    stop() {
        stopListening?.();
        stopListening = null;
        unwrapAll();
        // Back to normal straight away: the records read their real name and icon while this is off.
        active = false;
        editing.guild = editing.channel = null;
        GuildStore.emitChange?.();
        ChannelStore.emitChange?.();
        (GuildRoleStore as any)?.emitChange?.();
    },
});
