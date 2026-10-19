/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import * as DataStore from "@api/DataStore";
import { popNotice, showNotice } from "@api/Notices";
import { showNotification } from "@api/Notifications";
import { Settings } from "@api/Settings";
import { openUserProfile } from "@utils/discord";
import definePlugin from "@utils/types";
import { ChannelStore, GuildAvailabilityStore, GuildMemberStore, GuildStore, RelationshipStore, UserStore, UserUtils } from "@webpack/common";

import { avatarOf, describe, friendshipDetails } from "./describe";
import { openLog } from "./Panel";
import { settings } from "./settings";
import {
    addEntries, consumeManual, groupMemberChange, known, loadLog, LogEntry, markManual,
    offlinePlaceChanges, offlineRelationshipChanges, placeGone, PlaceSnap, relationshipAdded,
    relationshipRemoved, seedRelationships, UserSnap,
} from "./tracker";

const GROUP_DM = 3;
const RECIPIENT_REMOVE = 2;

const me = () => UserStore.getCurrentUser()?.id as string | undefined;
const logKey = (id: string) => `relationship-tracker-log-${id}`;
const snapKey = (id: string) => `relationship-tracker-snapshot-${id}`;

interface Snapshot { relationships: [string, number][]; groups: [string, PlaceSnap][]; guilds: [string, PlaceSnap][]; }

let groups = new Map<string, PlaceSnap>();
let guilds = new Map<string, PlaceSnap>();
let ready = false;
let syncing: Promise<void> | null = null;
const seenSystemMessages = new Set<string>();

// ─── Snapshots of Discord's current state ───

function userSnap(u: any, id?: string): UserSnap {
    return u ? { id: u.id, username: u.username, globalName: u.globalName ?? u.global_name ?? null, avatar: u.avatar ?? null } : { id: id!, username: "unknown" };
}

function cachedUser(id: string) {
    return userSnap(UserStore.getUser(id), id);
}

async function fetchedUser(id: string): Promise<UserSnap> {
    const cached = UserStore.getUser(id);
    if (cached) return userSnap(cached);
    const fetched = await UserUtils.getUser(id).catch(() => null);
    return userSnap(fetched, id);
}

// ─── When each friendship started (kept, because Discord forgets it once you're not friends) ───

const sinceKey = (id: string) => `relationship-tracker-since-${id}`;
let since: Record<string, number> = {};

async function loadSince(id: string) {
    since = (await DataStore.get<Record<string, number>>(sinceKey(id)).catch(() => undefined)) ?? {};
    captureSince();
}

/** Copy every current friend's "friends since" date from Discord. */
function captureSince() {
    const all = (RelationshipStore as any).getSinces?.() as Record<string, string> | undefined;
    let changed = false;
    for (const [uid, type] of RelationshipStore.getMutableRelationships()) {
        if (type !== 1) continue;
        const t = Date.parse(all?.[uid] ?? (RelationshipStore as any).getSince?.(uid) ?? "");
        if (Number.isFinite(t) && since[uid] !== t) { since[uid] = t; changed = true; }
    }
    const id = me();
    if (changed && id) DataStore.set(sinceKey(id), since).catch(() => { });
}

/** The last message in your DM with them (by either of you), from its ID. */
function lastTalkedWith(uid: string): number | undefined {
    const dm = ChannelStore.getDMFromUserId(uid);
    const last = dm ? (ChannelStore.getChannel(dm) as any)?.lastMessageId : null;
    if (!last) return undefined;
    try { return Number((BigInt(last) >> 22n) + 1420070400000n); } catch { return undefined; }
}

function withFriendship(e: LogEntry | null): LogEntry | null {
    if (!e || e.kind !== "friend-removed" || !e.user?.id) return e;
    return { ...e, friendsSince: e.friendsSince ?? since[e.user.id], lastTalked: e.lastTalked ?? lastTalkedWith(e.user.id) };
}

function currentRelationships() {
    const out = new Map<string, number>();
    for (const [id, type] of RelationshipStore.getMutableRelationships()) {
        if (type >= 1 && type <= 4) out.set(id, type);
    }
    return out;
}

function groupSnap(ch: any): PlaceSnap {
    const names = (ch.rawRecipients ?? []).map((r: any) => r.global_name ?? r.username).filter(Boolean);
    return { id: ch.id, name: ch.name || names.join(", ") || "Group DM", iconURL: ch.icon ? `https://cdn.discordapp.com/channel-icons/${ch.id}/${ch.icon}.png` : null };
}

function syncGroups() {
    groups = new Map();
    for (const ch of ChannelStore.getSortedPrivateChannels() as any[]) {
        if (ch.type === GROUP_DM) groups.set(ch.id, groupSnap(ch));
    }
}

function syncGuilds() {
    const self = me();
    guilds = new Map();
    for (const [id, g] of Object.entries(GuildStore.getGuilds()) as [string, any][]) {
        if (self && GuildMemberStore.isMember(id, self)) {
            guilds.set(id, { id, name: g.name, iconURL: g.icon ? `https://cdn.discordapp.com/icons/${id}/${g.icon}.png` : null });
        }
    }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveSnapshot() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const id = me();
        if (!id || !ready) return;
        const snap: Snapshot = { relationships: [...known], groups: [...groups], guilds: [...guilds] };
        DataStore.set(snapKey(id), snap).catch(() => { });
    }, 500);
}

/** First run: use what the old Relationship Notifier saved, so nothing is missed. */
async function legacySnapshot(id: string): Promise<Snapshot | undefined> {
    const [friends, oldGroups, oldGuilds] = await DataStore.getMany([
        `relationship-notifier-friends-${id}`, `relationship-notifier-groups-${id}`, `relationship-notifier-guilds-${id}`,
    ]).catch(() => [undefined, undefined, undefined]) as [{ friends?: string[]; requests?: string[]; } | undefined, Map<string, PlaceSnap> | undefined, Map<string, PlaceSnap> | undefined];
    if (!friends && !oldGroups && !oldGuilds) return undefined;
    return {
        relationships: [...(friends?.friends ?? []).map(f => [f, 1] as [string, number]), ...(friends?.requests ?? []).map(r => [r, 3] as [string, number])],
        groups: oldGroups ? [...oldGroups] : [],
        guilds: oldGuilds ? [...oldGuilds] : [],
    };
}

// ─── Notifications ───

function shouldNotify(e: LogEntry) {
    if (e.by === "you") return false;
    const s = settings.store;
    switch (e.kind) {
        case "friend-removed": return s.notifyFriendRemoved;
        case "friend-added": return s.notifyAccepted && e.by === "them";
        case "request-received": return s.notifyRequests;
        case "request-cancelled": case "request-declined": return s.notifyRequestCancelled;
        case "group-removed": return s.notifyGroups;
        case "group-member-removed": case "group-member-left": return s.notifyGroupMembers;
        case "server-removed": return s.notifyServers;
        default: return false;
    }
}

function record(entries: (LogEntry | null)[]) {
    const real = entries.map(withFriendship).filter(Boolean) as LogEntry[];
    addEntries(real);
    for (const e of real) {
        if (!shouldNotify(e)) continue;
        const extra = friendshipDetails(e);
        const text = describe(e).text + (e.offline ? " (while Discord was closed)" : "") + (extra ? ` — ${extra}` : "");
        if (settings.store.notices) showNotice(text, "OK", () => popNotice());
        showNotification({
            title: "Relationship Tracker",
            body: text,
            icon: avatarOf(e.user) ?? e.group?.iconURL ?? e.server?.iconURL ?? undefined,
            onClick: e.user && e.user.username !== "unknown" ? () => openUserProfile(e.user!.id) : openLog,
        });
    }
}

// ─── Startup: sync state, log what changed while Discord was closed ───

async function syncAndCheck() {
    const id = me();
    if (!id) return;
    if (syncing) return syncing;
    syncing = (async () => {
        if (!ready) await loadLog(logKey(id));
        await loadSince(id);
        const saved = (await DataStore.get<Snapshot>(snapKey(id)).catch(() => undefined)) ?? await legacySnapshot(id);

        const rels = currentRelationships();
        syncGroups();
        syncGuilds();

        if (saved && settings.store.offlineChanges) {
            const guildIds = new Set([...guilds.keys(), ...saved.guilds.map(([gid]) => gid).filter(gid => GuildAvailabilityStore.isUnavailable(gid))]);
            const entries = [
                ...offlineRelationshipChanges(new Map(saved.relationships), rels, cachedUser),
                ...offlinePlaceChanges(new Map(saved.groups), new Set(groups.keys()), "group-removed"),
                ...offlinePlaceChanges(new Map(saved.guilds), guildIds, "server-removed"),
            ];
            // Fill in people who aren't cached anymore (e.g. ex-friends).
            await Promise.all(entries.map(async e => { if (e.user?.username === "unknown") e.user = await fetchedUser(e.user.id); }));
            record(entries);
        }

        seedRelationships(rels);
        ready = true;
        saveSnapshot();
    })().finally(() => { syncing = null; });
    return syncing;
}

function migrateFromQol() {
    if (settings.store.migratedFromQol) return;
    const q = Settings.plugins.QOL as any;
    if (q) {
        const map: Record<string, string> = {
            relationshipNotifier_notices: "notices",
            relationshipNotifier_offlineRemovals: "offlineChanges",
            relationshipNotifier_friends: "notifyFriendRemoved",
            relationshipNotifier_friendRequestCancels: "notifyRequestCancelled",
            relationshipNotifier_servers: "notifyServers",
            relationshipNotifier_groups: "notifyGroups",
        };
        for (const [from, to] of Object.entries(map)) {
            if (typeof q[from] === "boolean") (settings.store as any)[to] = q[from];
        }
    }
    settings.store.migratedFromQol = true;
}

export default definePlugin({
    name: "RelationshipTracker",
    description: "Logs every friend added and removed (and who did it), friend requests, and group chat / server removals — with its own log window and notifications.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    // Its own window — opened from the feature's card on the QOL page.
    openSettingsModal: () => openLog(),

    // Mark actions you take yourself, so they're logged as "by you".
    patches: [
        {
            find: "removeRelationship:(",
            replacement: {
                match: /(removeRelationship:\((\i),\i,\i\)=>)/,
                replace: "$1($self.markYou($2),0)||",
            },
        },
        {
            find: "async leaveGuild(",
            replacement: {
                match: /(leaveGuild\((\i)\){)/,
                replace: "$1$self.markYou($2);",
            },
        },
        {
            find: "},closePrivateChannel(",
            replacement: {
                match: /(closePrivateChannel\((\i)\){)/,
                replace: "$1$self.markYou($2);",
            },
        },
    ],

    markYou: markManual,

    flux: {
        CONNECTION_OPEN: () => { syncAndCheck(); },

        RELATIONSHIP_ADD({ relationship }: any) {
            if (!ready || !relationship?.id) return;
            if (relationship.type === 1) setTimeout(captureSince, 500);
            record([relationshipAdded(relationship.id, relationship.type, relationship.user ? userSnap(relationship.user) : cachedUser(relationship.id))]);
            saveSnapshot();
        },

        RELATIONSHIP_UPDATE({ relationship }: any) {
            if (!ready || !relationship?.id || relationship.type == null) return;
            record([relationshipAdded(relationship.id, relationship.type, cachedUser(relationship.id))]);
            saveSnapshot();
        },

        async RELATIONSHIP_REMOVE({ relationship }: any) {
            if (!ready || !relationship?.id) return;
            const entry = relationshipRemoved(relationship.id, relationship.type, cachedUser(relationship.id), consumeManual(relationship.id));
            saveSnapshot();
            if (entry?.user?.username === "unknown") entry.user = await fetchedUser(relationship.id);
            record([entry]);
        },

        // Ignoring an incoming request is your action too.
        RELATIONSHIP_IGNORE_USER_SUCCESS({ userId }: any) {
            if (userId) markManual(userId);
        },

        CHANNEL_CREATE() { syncGroups(); saveSnapshot(); },

        CHANNEL_DELETE({ channel }: any) {
            if (!ready || channel?.type !== GROUP_DM) return;
            const place = groups.get(channel.id) ?? groupSnap(channel);
            groups.delete(channel.id);
            record([placeGone("group", place, consumeManual(channel.id))]);
            saveSnapshot();
        },

        GUILD_CREATE() { syncGuilds(); saveSnapshot(); },

        GUILD_DELETE({ guild }: any) {
            if (!ready || !guild?.id || guild.unavailable || GuildAvailabilityStore.isUnavailable(guild.id)) return;
            const place = guilds.get(guild.id);
            if (!place) return;
            guilds.delete(guild.id);
            record([placeGone("server", place, consumeManual(guild.id))]);
            saveSnapshot();
        },

        // Someone else left / was removed from one of your group chats.
        MESSAGE_CREATE({ channelId, message }: any) {
            if (!ready || message?.type !== RECIPIENT_REMOVE || seenSystemMessages.has(message.id)) return;
            const ch = ChannelStore.getChannel(channelId) as any;
            const target = message.mentions?.[0];
            if (ch?.type !== GROUP_DM || !target || target.id === me()) return;
            seenSystemMessages.add(message.id);
            if (seenSystemMessages.size > 300) seenSystemMessages.clear();
            record([groupMemberChange(groups.get(ch.id) ?? groupSnap(ch), userSnap(target), message.author ? userSnap(message.author) : undefined)]);
        },
    },

    start() {
        migrateFromQol();
        // Same delay the original used, so Discord's stores are filled in.
        setTimeout(syncAndCheck, 5000);
    },

    stop() {
        ready = false;
        clearTimeout(saveTimer);
    },
});
