/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Local Names: rename servers, channels and group chats just for you. The new
// name shows everywhere Discord shows the name — the server list, the channel
// list, the chat header, mentions — but nothing is sent anywhere, so nobody
// else sees it. While you're editing a server or channel in its settings, the
// real name comes back, so saving there never changes it for everyone.
// Same idea as Equicord's CleanChannelName: the name is changed where Discord
// keeps it, on the server's or channel's own record.

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { Channel, Guild } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu } from "@webpack/common";

import { openAllNames, openRename, RealName } from "./Panel";
import { allNames, Kind, loadNames, localName, onNamesChange } from "./store";

const REAL = Symbol("sonataLocalNames.real");

/** What's being edited in its settings right now: it shows its real name until that closes. */
const editing: Record<Kind, string | null> = { guild: null, channel: null };
/** Off: every record reads its real name again, straight away. */
let active = false;

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
    } catch { /* a record Discord locked: it keeps its name */ }
    return rec;
}

export const realName: RealName = (kind, id) => {
    const rec: any = kind === "guild" ? GuildStore.getGuild(id) : ChannelStore.getChannel(id);
    return rec ? String(rec[REAL] ?? rec.name ?? "") : "";
};

/* ── Every server and channel Discord hands out goes through these, so new and updated ones get your name too ── */

const originals: { store: any; key: string; fn: any; own: boolean; }[] = [];

function wrap(store: any, key: string, make: (orig: any) => any) {
    const fn = store[key];
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

/** Re-dresses the ones you renamed (Discord swaps in a new record when one changes) and redraws. */
function refresh() {
    for (const id of Object.keys(localNameIds("guild"))) dress(GuildStore.getGuild(id), "guild");
    for (const id of Object.keys(localNameIds("channel"))) dress(ChannelStore.getChannel(id), "channel");
    GuildStore.emitChange?.();
    ChannelStore.emitChange?.();
}

const localNameIds = (kind: Kind) => allNames()[kind];

/* ── Right-click menus ── */

const item = (kind: Kind, id: string) => (
    <Menu.MenuItem
        id="vc-localnames-rename"
        label={localName(kind, id) ? "Rename just for me… (renamed)" : "Rename just for me…"}
        action={() => openRename(kind, id, realName)}
    />
);

const guildMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    children.push(<Menu.MenuGroup>{item("guild", guild.id)}</Menu.MenuGroup>);
};

const channelMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel) return;
    const group = findGroupChildrenByChildId("mark-channel-read", children) ?? children;
    group.push(item("channel", channel.id));
};

let stopListening: (() => void) | null = null;

export default definePlugin({
    name: "LocalNames",
    description: "Rename servers, channels and group chats just for you. Nobody else sees the new name.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openAllNames(realName),

    contextMenus: {
        "guild-context": guildMenu,
        "guild-header-popout": guildMenu,
        "channel-context": channelMenu,
        "thread-context": channelMenu,
        "gdm-context": channelMenu,
    },

    flux: {
        // While a server's or channel's settings are open, it shows its real name, so saving there never renames it for everyone.
        CHANNEL_SETTINGS_INIT({ channelId }: { channelId: string; }) { editing.channel = channelId; ChannelStore.emitChange?.(); },
        CHANNEL_SETTINGS_CLOSE() { editing.channel = null; ChannelStore.emitChange?.(); },
        GUILD_SETTINGS_INIT({ guildId }: { guildId: string; }) { editing.guild = guildId; GuildStore.emitChange?.(); },
        GUILD_SETTINGS_CLOSE() { editing.guild = null; GuildStore.emitChange?.(); },
    },

    start() {
        active = true;
        wrap(GuildStore, "getGuild", orig => function (this: any, id: string) { return dress(orig.call(this, id), "guild"); });
        wrap(ChannelStore, "getChannel", orig => function (this: any, id: string) { return dress(orig.call(this, id), "channel"); });
        wrap(ChannelStore, "getBasicChannel", orig => function (this: any, id: string) { return dress(orig.call(this, id), "channel"); });
        stopListening = onNamesChange(refresh);
        void loadNames().then(refresh);
    },

    stop() {
        stopListening?.();
        stopListening = null;
        unwrapAll();
        // Names go back to normal straight away: the records read their real name while this is off.
        active = false;
        editing.guild = editing.channel = null;
        GuildStore.emitChange?.();
        ChannelStore.emitChange?.();
    },
});
