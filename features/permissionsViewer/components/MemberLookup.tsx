/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Look up one person in a server — by ID, @mention or username — and see
// who they are, their roles, and exactly what they can do (server-wide or in
// a channel) and why. It asks Discord about that one person only; it never
// downloads the whole member list.

import "../../_shared/tool.css";

import { copyWithToast, fetchUserProfile, insertTextIntoChatInputBox, openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import type { Channel, Guild, GuildMember, Role, User } from "@vencord/discord-types";
import { PermissionOverwriteType } from "@vencord/discord-types/enums";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, closeAllModals, FluxDispatcher, GuildChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, IconUtils, Modal, openModal, PermissionsBits, PresenceStore, RelationshipStore, SelectedChannelStore, SortedGuildStore, useEffect, useMemo, UserStore, UserUtils, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { ToolHero } from "../../_shared/ToolHero";
import { settings } from "..";
import { getGuildPermissionSpecMap, getSortedRolesForMember, loadGetGuildPermissionSpecMap } from "../utils";
import openRolesAndUsersPermissionsModal from "./RolesAndUsersPermissions";

const GuildActions = findByPropsLazy("requestMembersById", "banUser");
const EPOCH = 1420070400000;
const createdAt = (id: string) => Number(BigInt(id) >> 22n) + EPOCH;
const ALL = () => Object.values(PermissionsBits).reduce((a, b) => a | b, 0n);

/* ── Finding the person ─────────────────────────────────────────────── */

/** Waits for Discord to answer a member request (or gives up after a few seconds). */
function waitForMembers(guildId: string, check: () => boolean, ms = 5000): Promise<void> {
    return new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearInterval(poll); clearTimeout(timer); FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK_BATCH", onChunk); FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", onChunk); resolve(); };
        const onChunk = () => setTimeout(() => check() && finish(), 50);
        const poll = setInterval(() => check() && finish(), 250);
        const timer = setTimeout(finish, ms);
        FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK_BATCH", onChunk);
        FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK", onChunk);
        if (check()) finish();
    });
}

async function memberById(guildId: string, id: string): Promise<GuildMember | null> {
    const have = GuildMemberStore.getMember(guildId, id);
    if (have) return have;
    try {
        if (GuildActions?.requestMembersById) GuildActions.requestMembersById(guildId, [id], false);
        else FluxDispatcher.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds: [guildId], userIds: [id] });
    } catch { }
    await waitForMembers(guildId, () => !!GuildMemberStore.getMember(guildId, id), 4000);
    return GuildMemberStore.getMember(guildId, id) ?? null;
}

const nameMatch = (q: string, u: User | undefined, m: GuildMember | null) => {
    if (!u) return 0;
    const n = [u.username, (u as any).globalName, m?.nick].filter(Boolean).map(s => s!.toLowerCase());
    if (n.some(s => s === q)) return 3;
    if (n.some(s => s.startsWith(q))) return 2;
    if (n.some(s => s.includes(q))) return 1;
    return 0;
};

/** By name: members Discord already has loaded, plus Discord's own name search (up to 10 people). */
async function membersByName(guildId: string, raw: string): Promise<string[]> {
    const q = raw.replace(/^@/, "").replace(/#0$/, "").trim().toLowerCase();
    if (!q) return [];
    const score = (id: string) => nameMatch(q, UserStore.getUser(id), GuildMemberStore.getMember(guildId, id));
    const local = () => GuildMemberStore.getMemberIds(guildId).filter(id => score(id) > 0);
    if (!local().some(id => score(id) === 3)) {
        try {
            if (GuildActions?.requestMembers) GuildActions.requestMembers(guildId, q, 10, false);
            else FluxDispatcher.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds: [guildId], query: q, limit: 10 });
        } catch { }
        await waitForMembers(guildId, () => local().some(id => score(id) >= 2), 3500);
    }
    return local().sort((a, b) => score(b) - score(a)).slice(0, 10);
}

/* ── What they can do, and why ──────────────────────────────────────── */

export interface PermRow { bit: bigint; key: string; title: string; description: string; on: boolean; why: string; }

function computePerms(guild: Guild, member: GuildMember, channel: Channel | null, spec: Record<string, any>) {
    const roles = GuildRoleStore.getRolesSnapshot(guild.id) as Record<string, Role>;
    const everyone = roles[guild.id];
    const mine = getSortedRolesForMember(guild, member).sort((a, b) => b.position - a.position);
    const bits = Object.entries(PermissionsBits) as [string, bigint][];
    const state = new Map<bigint, { on: boolean; why: string; }>();
    const isOwner = guild.ownerId === member.userId;
    const admin = mine.find(r => (r.permissions & PermissionsBits.ADMINISTRATOR) === PermissionsBits.ADMINISTRATOR);

    for (const [, bit] of bits) {
        if (isOwner) { state.set(bit, { on: true, why: "Server owner — can do everything" }); continue; }
        if (admin) { state.set(bit, { on: true, why: `Administrator, from ${admin.id === guild.id ? "@everyone" : admin.name}` }); continue; }
        const from = mine.find(r => (r.permissions & bit) === bit);
        state.set(bit, from ? { on: true, why: `From ${from.id === guild.id ? "@everyone" : `the ${from.name} role`}` } : { on: false, why: "None of their roles give this" });
    }

    let notes: string[] = [];
    if (channel && !isOwner && !admin) {
        const ow = channel.permissionOverwrites ?? {};
        const apply = (allow: bigint, deny: bigint, label: string) => {
            for (const [, bit] of bits) {
                if ((deny & bit) === bit) state.set(bit, { on: false, why: `Blocked in #${channel.name} for ${label}` });
                if ((allow & bit) === bit) state.set(bit, { on: true, why: `Allowed in #${channel.name} for ${label}` });
            }
        };
        const e = ow[guild.id];
        if (e) apply(BigInt(e.allow), BigInt(e.deny), "@everyone");
        // Role overrides add up together: allows win over denies from other roles.
        let allow = 0n, deny = 0n;
        const allowBy = new Map<bigint, string>(), denyBy = new Map<bigint, string>();
        for (const r of mine) {
            const o = ow[r.id];
            if (!o || r.id === guild.id) continue;
            for (const [, bit] of bits) {
                if ((BigInt(o.allow) & bit) === bit && !allowBy.has(bit)) allowBy.set(bit, r.name);
                if ((BigInt(o.deny) & bit) === bit && !denyBy.has(bit)) denyBy.set(bit, r.name);
            }
            allow |= BigInt(o.allow); deny |= BigInt(o.deny);
        }
        for (const [, bit] of bits) {
            if ((deny & bit) === bit) state.set(bit, { on: false, why: `Blocked in #${channel.name} for the ${denyBy.get(bit)} role` });
            if ((allow & bit) === bit) state.set(bit, { on: true, why: `Allowed in #${channel.name} for the ${allowBy.get(bit)} role` });
        }
        const m = ow[member.userId];
        if (m) apply(BigInt(m.allow), BigInt(m.deny), "them personally");
        if (!state.get(PermissionsBits.VIEW_CHANNEL)?.on) notes.push(`They can't see #${channel.name}, so nothing else here applies to them.`);
    }

    const until = member.communicationDisabledUntil ? Date.parse(member.communicationDisabledUntil) : 0;
    if (until > Date.now() && !isOwner && !admin) notes = [`Timed out until ${new Date(until).toLocaleString()} — they can only read until then.`, ...notes];

    const rows: PermRow[] = bits.map(([key, bit]) => {
        const s = spec?.[String(bit)];
        const st = state.get(bit)!;
        return { bit, key, title: s?.title ?? key.replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase()), description: s?.description ?? "", on: st.on, why: st.why };
    }).filter((r, i, a) => a.findIndex(x => x.bit === r.bit) === i);
    return { rows, notes, isOwner, admin: !!admin, everyone };
}

const KEY_PERMS = ["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_ROLES", "MANAGE_CHANNELS", "KICK_MEMBERS", "BAN_MEMBERS", "MODERATE_MEMBERS", "MANAGE_MESSAGES", "MENTION_EVERYONE", "MANAGE_WEBHOOKS"];
const KEY_LABEL: Record<string, string> = { ADMINISTRATOR: "Admin", MANAGE_GUILD: "Manage server", MANAGE_ROLES: "Manage roles", MANAGE_CHANNELS: "Manage channels", KICK_MEMBERS: "Kick", BAN_MEMBERS: "Ban", MODERATE_MEMBERS: "Time out", MANAGE_MESSAGES: "Delete messages", MENTION_EVERYONE: "@everyone", MANAGE_WEBHOOKS: "Webhooks" };

/* ── Small helpers ──────────────────────────────────────────────────── */

function ago(t: number): string {
    const d = (Date.now() - t) / 86400000;
    if (d < 1) return "today";
    if (d < 2) return "yesterday";
    if (d < 60) return `${Math.round(d)} days ago`;
    if (d < 730) return `${Math.round(d / 30.4)} months ago`;
    const y = Math.floor(d / 365.25), m = Math.round((d - y * 365.25) / 30.4);
    return `${y} year${y === 1 ? "" : "s"}${m ? `, ${m} month${m === 1 ? "" : "s"}` : ""} ago`;
}
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const fmtDur = (ms: number) => { const d = ms / 86400000; return d < 1 ? `${Math.max(1, Math.round(ms / 3600000))} hours` : d < 60 ? `${Math.round(d)} days` : d < 730 ? `${Math.round(d / 30.4)} months` : `${(d / 365.25).toFixed(1)} years`; };

const FLAGS: [number, string][] = [[1 << 0, "Discord Staff"], [1 << 1, "Partnered Server Owner"], [1 << 2, "HypeSquad Events"], [1 << 3, "Bug Hunter"], [1 << 6, "HypeSquad Bravery"], [1 << 7, "HypeSquad Brilliance"], [1 << 8, "HypeSquad Balance"], [1 << 9, "Early Supporter"], [1 << 14, "Bug Hunter Gold"], [1 << 16, "Verified Bot"], [1 << 17, "Early Verified Bot Developer"], [1 << 18, "Moderator Programs Alumni"], [1 << 22, "Active Developer"]];

const STATUS: Record<string, [string, string]> = { online: ["Online", "#23a55a"], idle: ["Idle", "#f0b232"], dnd: ["Do not disturb", "#f23f43"], offline: ["Offline", "#80848e"], invisible: ["Offline", "#80848e"] };

/* ── The window ─────────────────────────────────────────────────────── */

type Found = { user: User; member: GuildMember | null; };

function recent(): { id: string; name: string; }[] {
    try { return JSON.parse(settings.store.recentLookups || "[]"); } catch { return []; }
}
function remember(id: string, name: string) {
    settings.store.recentLookups = JSON.stringify([{ id, name }, ...recent().filter(r => r.id !== id)].slice(0, 8));
}

function MemberLookupModal({ modalProps, initialGuildId, initialQuery }: { modalProps: any; initialGuildId: string; initialQuery?: string; }) {
    const [guildId, setGuildId] = useState(initialGuildId);
    const guild = GuildStore.getGuild(guildId);
    const [query, setQuery] = useState(initialQuery ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [choices, setChoices] = useState<string[] | null>(null);
    const [found, setFound] = useState<Found | null>(null);
    const [, setRecentTick] = useState(0);
    const accent = windowAccent("permissionsViewer");

    useEffect(() => void loadGetGuildPermissionSpecMap(), []);
    useEffect(() => { if (initialQuery) lookUp(initialQuery); }, []);

    const show = async (id: string) => {
        setChoices(null);
        setBusy(true); setError(null);
        let user: User | undefined = UserStore.getUser(id);
        if (!user) user = await UserUtils.getUser(id).catch(() => undefined);
        if (!user) { setBusy(false); setError("No Discord account has that ID."); setFound(null); return; }
        const member = await memberById(guildId, id);
        setBusy(false);
        setFound({ user, member });
        remember(id, (user as any).globalName ?? user.username);
        setRecentTick(t => t + 1);
    };

    const lookUp = async (raw = query) => {
        const q = raw.trim();
        if (!q || !guild) return;
        const id = q.match(/(\d{17,20})/)?.[1];
        if (id) return show(id);
        setBusy(true); setError(null); setFound(null); setChoices(null);
        const ids = await membersByName(guildId, q);
        setBusy(false);
        if (!ids.length) { setError(`Nobody called “${q}” in ${guild.name}. Try their ID — right-click them → Copy User ID.`); return; }
        if (ids.length === 1) return show(ids[0]);
        setChoices(ids);
    };

    const guilds = useMemo(() => {
        const order: string[] = (SortedGuildStore as any)?.getFlattenedGuildIds?.() ?? Object.keys(GuildStore.getGuilds());
        return order.map(id => GuildStore.getGuild(id)).filter(Boolean) as Guild[];
    }, []);

    return (
        <Modal {...modalProps} size="lg" title="Member Lookup" subtitle="Paste someone's ID, @mention or username to see their roles, permissions and details">
            <div className="vc-tool-wrap vc-permlookup" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                {!found && !choices && (
                    <ToolHero icon="🔎" kicker={guild?.name ?? "Member Lookup"} title="Look someone up"
                        sub="Their roles, what they can do here, badges and linked accounts."
                        numbers={recent().length ? [{ value: recent().length, label: "recent" }] : []} />
                )}
                <div className="vc-permlookup-bar">
                    <select className="vc-tool-select vc-permlookup-guild" value={guildId} onChange={e => { setGuildId(e.currentTarget.value); setFound(null); setChoices(null); setError(null); }}>
                        {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <input className="vc-tool-input" autoFocus value={query} placeholder="123456789012345678  ·  @someone  ·  username"
                        onChange={e => setQuery(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") lookUp(); }} />
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !query.trim()} onClick={() => lookUp()}>{busy ? "Looking…" : "Look up"}</button>
                </div>
                {recent().length > 0 && !found && !choices && (
                    <div className="vc-tool-chips">
                        <span className="vc-tool-hint">Recent:</span>
                        {recent().map(r => <button key={r.id} type="button" className="vc-tool-chip" onClick={() => { setQuery(r.id); show(r.id); }}>{r.name}</button>)}
                    </div>
                )}

                {error && <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🔍</span>{error}</div>}
                {busy && !found && <div className="vc-tool-empty"><span className="vc-tool-empty-icon">⏳</span>Asking Discord…</div>}

                {choices && (
                    <section className="vc-tool-section">
                        <span className="vc-tool-label">Who did you mean?</span>
                        <div className="vc-tool-list">
                            {choices.map(id => {
                                const u = UserStore.getUser(id); const m = GuildMemberStore.getMember(guildId, id);
                                return (
                                    <button key={id} type="button" className="vc-tool-item vc-permlookup-choice" onClick={() => show(id)}>
                                        <img className="vc-tool-avatar" src={u ? IconUtils.getUserAvatarURL(u, false, 64) : ""} alt="" />
                                        <span className="vc-tool-item-main">
                                            <span className="vc-tool-item-title">{m?.nick ?? (u as any)?.globalName ?? u?.username}</span>
                                            <span className="vc-tool-item-sub">@{u?.username} · {id}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {found && guild && <Result guild={guild} found={found} onClose={modalProps.onClose} />}
            </div>
        </Modal>
    );
}

/* ── Profile: badges and linked accounts ────────────────────────────── */

const ACCOUNTS: Record<string, { label: string; icon: string; url?: (a: { id: string; name: string; }) => string; }> = {
    steam: { label: "Steam", icon: "🎮", url: a => `https://steamcommunity.com/profiles/${a.id}` },
    twitch: { label: "Twitch", icon: "📺", url: a => `https://twitch.tv/${a.name}` },
    youtube: { label: "YouTube", icon: "▶️", url: a => `https://youtube.com/channel/${a.id}` },
    github: { label: "GitHub", icon: "🐙", url: a => `https://github.com/${a.name}` },
    twitter: { label: "X (Twitter)", icon: "𝕏", url: a => `https://x.com/${a.name}` },
    twitter_legacy: { label: "X (Twitter)", icon: "𝕏", url: a => `https://x.com/${a.name}` },
    reddit: { label: "Reddit", icon: "👽", url: a => `https://reddit.com/user/${a.name}` },
    spotify: { label: "Spotify", icon: "🎧", url: a => `https://open.spotify.com/user/${a.id}` },
    instagram: { label: "Instagram", icon: "📸", url: a => `https://instagram.com/${a.name}` },
    tiktok: { label: "TikTok", icon: "🎵", url: a => `https://www.tiktok.com/@${a.name}` },
    roblox: { label: "Roblox", icon: "🧱", url: a => `https://www.roblox.com/users/${a.id}/profile` },
    bluesky: { label: "Bluesky", icon: "🦋", url: a => `https://bsky.app/profile/${a.name}` },
    soundcloud: { label: "SoundCloud", icon: "☁️", url: a => `https://soundcloud.com/${a.name}` },
    mastodon: { label: "Mastodon", icon: "🐘", url: a => { const [u, host] = a.name.replace(/^@/, "").split("@"); return host ? `https://${host}/@${u}` : ""; } },
    domain: { label: "Website", icon: "🌐", url: a => `https://${a.name}` },
    ebay: { label: "eBay", icon: "🛍️", url: a => `https://www.ebay.com/usr/${a.name}` },
    xbox: { label: "Xbox", icon: "🟩" },
    playstation: { label: "PlayStation", icon: "🎮" },
    "playstation-stg": { label: "PlayStation", icon: "🎮" },
    battlenet: { label: "Battle.net", icon: "⚔️" },
    epicgames: { label: "Epic Games", icon: "🎯" },
    riotgames: { label: "Riot Games", icon: "🛡️" },
    leagueoflegends: { label: "League of Legends", icon: "🛡️" },
    crunchyroll: { label: "Crunchyroll", icon: "🍥" },
    facebook: { label: "Facebook", icon: "📘" },
    paypal: { label: "PayPal", icon: "💳" },
    "amazon-music": { label: "Amazon Music", icon: "🎶" },
    bungie: { label: "Bungie", icon: "🪐" },
};

function ProfileExtras({ userId, guildId, fallbackFlags }: { userId: string; guildId: string; fallbackFlags: string[]; }) {
    const [profile, setProfile] = useState<any>(null);
    const [state, setState] = useState<"loading" | "done" | "error">("loading");
    useEffect(() => {
        let alive = true;
        setState("loading");
        // One request, for this person only — the same one Discord makes when you open their profile.
        fetchUserProfile(userId, { guild_id: guildId, with_mutual_guilds: false } as any, false)
            .then(p => { if (alive) { setProfile(p ?? null); setState("done"); } })
            .catch(() => alive && setState("error"));
        return () => { alive = false; };
    }, [userId]);

    const badges: { id: string; description: string; icon: string; link?: string; }[] = profile?.badges ?? [];
    const accounts: { type: string; id: string; name: string; verified: boolean; }[] = (profile?.connectedAccounts ?? []).filter((a: any) => !a.revoked);
    const nitro = profile?.premiumSince ? new Date(profile.premiumSince).getTime() : 0;
    const anyBoost = profile?.premiumGuildSince ? new Date(profile.premiumGuildSince).getTime() : 0;

    return (
        <section className="vc-tool-section">
            <div className="vc-tool-head">
                <span className="vc-tool-label">Profile</span>
                {state === "loading" && <span className="vc-tool-hint">Getting their profile…</span>}
                {state === "error" && <span className="vc-tool-hint">Discord didn't share their profile.</span>}
            </div>
            {(badges.length > 0 || fallbackFlags.length > 0) && (
                <div className="vc-permlookup-badges">
                    {badges.length
                        ? badges.map(b => (
                            <span key={b.id} className="vc-permlookup-badge" title={b.description}>
                                <img src={`https://cdn.discordapp.com/badge-icons/${b.icon}.png`} alt="" />{b.description}
                            </span>
                        ))
                        : fallbackFlags.map(f => <span key={f} className="vc-permlookup-badge">{f}</span>)}
                </div>
            )}
            {state === "done" && (
                <div className="vc-tool-stats">
                    {profile?.pronouns && <div className="vc-tool-stat"><span>Pronouns</span><b>{profile.pronouns}</b></div>}
                    {nitro > 0 && <div className="vc-tool-stat"><span>Nitro since</span><b>{fmtDate(nitro)}</b><small>{ago(nitro)}</small></div>}
                    {anyBoost > 0 && <div className="vc-tool-stat"><span>Boosting a server since</span><b>{fmtDate(anyBoost)}</b><small>{ago(anyBoost)}</small></div>}
                    {profile?.legacyUsername && <div className="vc-tool-stat"><span>Old username</span><b style={{ fontSize: 14 }}>{profile.legacyUsername}</b></div>}
                </div>
            )}
            {state === "done" && (
                accounts.length ? (
                    <div className="vc-permlookup-accounts">
                        {accounts.map(a => {
                            const info = ACCOUNTS[a.type] ?? { label: a.type, icon: "🔗" };
                            const url = info.url?.(a);
                            return (
                                <div key={`${a.type}:${a.id}`} className="vc-permlookup-account">
                                    <span className="vc-permlookup-account-icon">{info.icon}</span>
                                    <span className="vc-permlookup-account-main">
                                        <b>{a.name}{a.verified && <span title="Verified" className="vc-permlookup-verified">✔</span>}</b>
                                        <span>{info.label}</span>
                                    </span>
                                    {url && <a className="vc-tool-icon" href={url} target="_blank" rel="noreferrer" title={`Open on ${info.label}`}>↗</a>}
                                    <button type="button" className="vc-tool-icon" title="Copy" onClick={() => copyWithToast(a.name)}>⧉</button>
                                </div>
                            );
                        })}
                    </div>
                ) : <span className="vc-tool-hint">No linked accounts shown on their profile.</span>
            )}
        </section>
    );
}

function Result({ guild, found, onClose }: { guild: Guild; found: Found; onClose(): void; }) {
    const { user, member } = found;
    const [channelId, setChannelId] = useState<string>(() => {
        const cur = SelectedChannelStore.getChannelId();
        return cur && ChannelStore.getChannel(cur)?.guild_id === guild.id ? cur : "";
    });
    const [show, setShow] = useState<"all" | "on" | "off">("on");
    const [find, setFind] = useState("");
    const [roleFilter, setRoleFilter] = useState<string | null>(null);

    const spec = useMemo(() => { try { return getGuildPermissionSpecMap(guild); } catch { return {}; } }, [guild.id]);
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    const perms = useMemo(() => member ? computePerms(guild, member, channel, spec) : null, [member, channelId, guild.id]);
    const roles = member ? getSortedRolesForMember(guild, member).filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position) : [];

    const channels = useMemo(() => {
        const c = GuildChannelStore.getChannels(guild.id) as any;
        const cats: Record<string, string> = {};
        for (const x of c?.[4] ?? []) cats[x.channel.id] = x.channel.name;
        return [...(c?.SELECTABLE ?? []), ...(c?.VOCAL ?? [])].map((x: any) => x.channel).filter((ch: any) => ch?.id)
            .map((ch: any) => ({ id: ch.id, name: ch.name, vocal: ch.type === 2 || ch.type === 13, cat: cats[ch.parent_id] ?? "" }));
    }, [guild.id]);

    const created = createdAt(user.id);
    const joined = member?.joinedAt ? Date.parse(member.joinedAt) : 0;
    const boosting = member?.premiumSince ? Date.parse(member.premiumSince) : 0;
    const timeout = member?.communicationDisabledUntil ? Date.parse(member.communicationDisabledUntil) : 0;
    const status = PresenceStore.getStatus(user.id) ?? "offline";
    const rel = RelationshipStore.isFriend(user.id) ? "Friends" : RelationshipStore.isBlocked?.(user.id) ? "You blocked them" : "Not friends";
    const flags = FLAGS.filter(([f]) => ((user as any).publicFlags ?? 0) & f).map(([, n]) => n);
    const seenIn = Object.keys(GuildStore.getGuilds()).filter(id => GuildMemberStore.isMember(id, user.id)).length;
    const name = member?.nick ?? (user as any).globalName ?? user.username;
    const avatar = member?.avatar ? IconUtils.getGuildMemberAvatarURLSimple?.({ guildId: guild.id, userId: user.id, avatar: member.avatar }) : IconUtils.getUserAvatarURL(user, true, 128);
    const color = member?.colorString;

    const roleBits = roleFilter ? (GuildRoleStore.getRolesSnapshot(guild.id) as Record<string, Role>)[roleFilter]?.permissions ?? 0n : null;
    const rows = (perms?.rows ?? []).filter(r =>
        (show === "all" || (show === "on" ? r.on : !r.on))
        && (!find || r.title.toLowerCase().includes(find.toLowerCase()))
        && (roleBits == null || (roleBits & r.bit) === r.bit));
    const onCount = perms?.rows.filter(r => r.on).length ?? 0;

    return (
        <>
            <section className="vc-tool-section vc-permlookup-hero" style={color ? ({ "--vc-permlookup-color": color } as React.CSSProperties) : undefined}>
                <img className="vc-permlookup-avatar" src={avatar} alt="" />
                <div className="vc-permlookup-who">
                    <b style={color ? { color } : undefined}>{name}</b>
                    <span>@{user.username}{user.bot ? " · BOT" : ""}</span>
                    <div className="vc-tool-chips">
                        <span className="vc-tool-badge"><i className="vc-permlookup-dot" style={{ background: STATUS[status]?.[1] }} />{STATUS[status]?.[0] ?? status}</span>
                        {perms?.isOwner && <span className="vc-tool-badge vc-tool-badge-accent">👑 Server owner</span>}
                        {perms?.admin && !perms.isOwner && <span className="vc-tool-badge vc-tool-badge-accent">🛡️ Administrator</span>}
                        {!member && <span className="vc-tool-badge vc-tool-badge-bad">Not in this server</span>}
                        {boosting > 0 && <span className="vc-tool-badge" style={{ color: "#f47fff" }}>💎 Boosting</span>}
                        {timeout > Date.now() && <span className="vc-tool-badge vc-tool-badge-bad">⏳ Timed out</span>}
                        {member?.isPending && <span className="vc-tool-badge">Hasn't accepted the rules</span>}
                        {joined > 0 && joined - created < 7 * 86400000 && <span className="vc-tool-badge vc-tool-badge-bad">⚠️ Account was new when they joined</span>}
                    </div>
                </div>
                <div className="vc-permlookup-actions">
                    <button type="button" className="vc-tool-btn" onClick={() => { onClose(); openUserProfile(user.id); }}>Profile</button>
                    <button type="button" className="vc-tool-btn" onClick={() => copyWithToast(user.id)}>Copy ID</button>
                    <button type="button" className="vc-tool-btn" onClick={() => { closeAllModals(); insertTextIntoChatInputBox(`<@${user.id}> `); }}>Mention</button>
                </div>
            </section>

            <div className="vc-tool-stats">
                <div className="vc-tool-stat"><span>User ID</span><b className="vc-permlookup-mono" onClick={() => copyWithToast(user.id)} title="Copy">{user.id}</b></div>
                <div className="vc-tool-stat"><span>Account made</span><b>{fmtDate(created)}</b><small>{ago(created)}</small></div>
                <div className="vc-tool-stat"><span>Joined {guild.name}</span><b>{joined ? fmtDate(joined) : "–"}</b><small>{joined ? `${ago(joined)} · ${fmtDur(joined - created)} after making the account` : member ? "Not shared by Discord" : "Not a member"}</small></div>
                {boosting > 0 && <div className="vc-tool-stat"><span>Boosting since</span><b>{fmtDate(boosting)}</b><small>{ago(boosting)}</small></div>}
                {timeout > Date.now() && <div className="vc-tool-stat"><span>Timed out until</span><b>{new Date(timeout).toLocaleString()}</b></div>}
                <div className="vc-tool-stat"><span>Server nickname</span><b>{member?.nick ?? "–"}</b></div>
                <div className="vc-tool-stat"><span>Highest role</span><b style={roles[0]?.colorString ? { color: roles[0].colorString } : undefined}>{roles[0]?.name ?? "@everyone"}</b><small>{roles.length} role{roles.length === 1 ? "" : "s"}</small></div>
                <div className="vc-tool-stat"><span>You and them</span><b>{rel}</b><small>In {seenIn} of your servers{seenIn ? " (that Discord has loaded)" : ""}</small></div>
            </div>

            <ProfileExtras userId={user.id} guildId={guild.id} fallbackFlags={flags} />

            {member && (
                <section className="vc-tool-section">
                    <div className="vc-tool-head">
                        <span className="vc-tool-label">Roles · {roles.length}</span>
                        <button type="button" className="vc-tool-link" onClick={() => openRolesAndUsersPermissionsModal(
                            [...getSortedRolesForMember(guild, member).map(r => ({ type: PermissionOverwriteType.ROLE, ...r })), ...(perms?.isOwner ? [{ type: PermissionOverwriteType.OWNER, permissions: ALL() }] : [])] as any,
                            guild, name)}>Role details</button>
                    </div>
                    {roles.length ? (
                        <div className="vc-tool-chips">
                            {roles.map(r => (
                                <button key={r.id} type="button" className={classes("vc-tool-chip", "vc-permlookup-role", roleFilter === r.id && "vc-tool-chip-on")} title="Show only what this role gives" onClick={() => setRoleFilter(f => f === r.id ? null : r.id)}>
                                    <i style={{ background: r.colorString ?? "var(--text-muted)" }} />{r.name}
                                </button>
                            ))}
                        </div>
                    ) : <span className="vc-tool-hint">Only @everyone.</span>}
                </section>
            )}

            {perms && (
                <section className="vc-tool-section">
                    <div className="vc-tool-head">
                        <span className="vc-tool-label">Can they…</span>
                        <select className="vc-tool-select vc-permlookup-ch" value={channelId} onChange={e => setChannelId(e.currentTarget.value)}>
                            <option value="">Across the whole server</option>
                            {channels.map(c => <option key={c.id} value={c.id}>{c.vocal ? "🔊 " : "# "}{c.name}{c.cat ? ` — ${c.cat}` : ""}</option>)}
                        </select>
                    </div>
                    <div className="vc-permlookup-keys">
                        {KEY_PERMS.map(k => {
                            const r = perms.rows.find(x => x.key === k);
                            if (!r) return null;
                            return <span key={k} className={classes("vc-permlookup-key", r.on ? "vc-permlookup-yes" : "vc-permlookup-no")} title={r.why}>{r.on ? "✓" : "✕"} {KEY_LABEL[k]}</span>;
                        })}
                    </div>
                    {perms.notes.map(n => <div key={n} className="vc-permlookup-note">⚠️ {n}</div>)}

                    <div className="vc-permlookup-filter">
                        <div className="vc-tool-seg">
                            {([["on", `Allowed · ${onCount}`], ["off", `Not allowed · ${perms.rows.length - onCount}`], ["all", "All"]] as const).map(([k, l]) => (
                                <button key={k} type="button" className={classes("vc-tool-seg-btn", show === k && "vc-tool-seg-on")} onClick={() => setShow(k)}>{l}</button>
                            ))}
                        </div>
                        <input className="vc-tool-input" placeholder="Find a permission" value={find} onChange={e => setFind(e.currentTarget.value)} />
                    </div>
                    {roleFilter && <span className="vc-tool-hint">Showing what the {roles.find(r => r.id === roleFilter)?.name} role gives. <button type="button" className="vc-tool-link" onClick={() => setRoleFilter(null)}>Show all</button></span>}
                    <div className="vc-permlookup-perms">
                        {rows.map(r => (
                            <div key={r.key} className={classes("vc-permlookup-perm", r.on ? "vc-permlookup-yes" : "vc-permlookup-no")} title={r.description}>
                                <span className="vc-permlookup-mark">{r.on ? "✓" : "✕"}</span>
                                <span className="vc-permlookup-perm-main"><b>{r.title}</b><span>{r.why}</span></span>
                            </div>
                        ))}
                        {!rows.length && <span className="vc-tool-hint">Nothing to show.</span>}
                    </div>
                </section>
            )}
        </>
    );
}

export function openMemberLookup(guildId?: string, query?: string) {
    const id = guildId ?? (SelectedChannelStore.getChannelId() && ChannelStore.getChannel(SelectedChannelStore.getChannelId())?.guild_id) ?? Object.keys(GuildStore.getGuilds())[0];
    if (!id) return;
    openModal(props => <MemberLookupModal modalProps={props} initialGuildId={id} initialQuery={query} />);
}
