/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../_shared/tool.css";
import "./styles.css";

import { classNameFactory } from "@utils/css";
import { getGuildAcronym, openImageModal, openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import { Guild, RenderModalProps, User } from "@vencord/discord-types";
import { FluxDispatcher, GuildChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, IconUtils, openModal, Parser, PresenceStore, RelationshipStore, ScrollerThin, SnowflakeUtils, Timestamp, useEffect, UserStore, UserUtils, useState, useStateFromStores } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { Window } from "../../_shared/Window";
import { settings } from ".";

const cl = classNameFactory("vc-gp-");
const tl = classNameFactory("vc-tool-");

export function openGuildInfoModal(guild: Guild) {
    openModal(props => <GuildInfoModal guild={guild} modalProps={props} />);
}

const enum Tabs {
    ServerInfo,
    Friends,
    BlockedUsers,
    IgnoredUsers,
    MutualMembers
}

interface GuildProps {
    guild: Guild;
}

interface RelationshipProps extends GuildProps {
    setCount(count: number): void;
}

const fetched = {
    friends: false,
    blocked: false,
    ignored: false
};

function renderTimestamp(timestamp: number) {
    return (
        <Timestamp timestamp={new Date(timestamp)} />
    );
}

function GuildInfoModal({ guild, modalProps }: GuildProps & { modalProps: RenderModalProps; }) {
    const [friendCount, setFriendCount] = useState<number>();
    const [blockedCount, setBlockedCount] = useState<number>();
    const [ignoredCount, setIgnoredCount] = useState<number>();
    const [mutualMembersCount, setMutualMembersCount] = useState<number>();

    useEffect(() => {
        fetched.friends = false;
        fetched.blocked = false;
        fetched.ignored = false;
    }, []);

    const [currentTab, setCurrentTab] = useState(Tabs.ServerInfo);

    const bannerUrl = guild.banner && IconUtils.getGuildBannerURL(guild, true)!.replace(/\?size=\d+$/, "?size=1024");

    const iconUrl = guild.icon && IconUtils.getGuildIconURL({
        id: guild.id,
        icon: guild.icon,
        canAnimate: true,
        size: 512
    });

    const accent = windowAccent("serverInfo");
    const memberCount = (GuildMemberStore.getMemberIds(guild.id) ?? []).length;
    const tabs: [Tabs, string, number | undefined][] = [
        [Tabs.ServerInfo, "ℹ️ About", undefined],
        [Tabs.Friends, "🫂 Friends", friendCount],
        [Tabs.MutualMembers, "🔗 Mutual", mutualMembersCount],
        [Tabs.BlockedUsers, "🚫 Blocked", blockedCount],
        [Tabs.IgnoredUsers, "🙈 Ignored", ignoredCount],
    ];

    return (
        <Window {...modalProps} size="lg" title="Server Info" subtitle={guild.name}>
            <div className={classes(tl("wrap"), cl("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("hero")} style={bannerUrl ? { backgroundImage: `linear-gradient(180deg, transparent 20%, hsl(0 0% 0% / 0.75)), url("${bannerUrl}")` } : undefined}
                    onClick={bannerUrl ? () => openImageModal({ url: bannerUrl, width: 1024 }) : undefined} title={bannerUrl ? "Open the banner" : undefined}>
                    {iconUrl
                        ? <img className={cl("icon")} src={iconUrl} alt="" onClick={e => { e.stopPropagation(); openImageModal({ url: iconUrl, height: 512, width: 512 }); }} />
                        : <div aria-hidden className={cl("icon-text")}>{getGuildAcronym(guild)}</div>}
                    <div className={cl("hero-text")}>
                        <b>{guild.name}</b>
                        {guild.description && <span>{guild.description}</span>}
                        {memberCount > 0 && <span className={cl("members")}>{memberCount.toLocaleString()} members loaded</span>}
                    </div>
                </div>

                <div className={tl("tabs")}>
                    {tabs.map(([id, label, count]) => (
                        <button key={id} type="button" className={classes(tl("tab"), currentTab === id && tl("tab-on"))} onClick={() => setCurrentTab(id)}>
                            {label}{count !== undefined && <span className={classes(tl("badge"), cl("count"))}>{count}</span>}
                        </button>
                    ))}
                </div>

                <div className={cl("tab-content")}>
                    {currentTab === Tabs.ServerInfo && <ServerInfoTab guild={guild} />}
                    {currentTab === Tabs.Friends && <FriendsTab guild={guild} setCount={setFriendCount} />}
                    {currentTab === Tabs.MutualMembers && <MutualMembersTab guild={guild} setCount={setMutualMembersCount} />}
                    {currentTab === Tabs.BlockedUsers && <BlockedUsersTab guild={guild} setCount={setBlockedCount} />}
                    {currentTab === Tabs.IgnoredUsers && <IgnoredUserTab guild={guild} setCount={setIgnoredCount} />}
                </div>
            </div>
        </Window>
    );
}

function Owner(guildId: string, owner: User) {
    const guildAvatar = GuildMemberStore.getMember(guildId, owner.id)?.avatar;
    const ownerAvatarUrl =
        guildAvatar
            ? IconUtils.getGuildMemberAvatarURLSimple({
                userId: owner!.id,
                avatar: guildAvatar,
                guildId,
                canAnimate: true
            })
            : IconUtils.getUserAvatarURL(owner, true);

    return (
        <div className={cl("owner")}>
            <img
                className={tl("avatar")}
                src={ownerAvatarUrl}
                alt=""
                onClick={() => openImageModal({
                    url: ownerAvatarUrl,
                    height: 512,
                    width: 512
                })}
            />
            {Parser.parse(`<@${owner.id}>`)}
        </div>
    );
}

function ServerInfoTab({ guild }: GuildProps) {
    const [owner] = useAwaiter(() => UserUtils.getUser(guild.ownerId), {
        deps: [guild.ownerId],
        fallbackValue: null
    });

    const Fields = {
        "Server Owner": owner ? Owner(guild.id, owner) : "Loading...",
        "Created At": renderTimestamp(SnowflakeUtils.extractTimestamp(guild.id)),
        "Joined At": guild.joinedAt ? renderTimestamp(guild.joinedAt.getTime()) : "-", // Not available in lurked guild
        "Vanity Link": guild.vanityURLCode ? (<a>{`discord.gg/${guild.vanityURLCode}`}</a>) : "-", // Making the anchor href valid would cause Discord to reload
        "Preferred Locale": guild.preferredLocale || "-",
        "Verification Level": ["None", "Low", "Medium", "High", "Highest"][guild.verificationLevel] || "?",
        "Server Boosts": `${guild.premiumSubscriberCount ?? 0} (Level ${guild.premiumTier ?? 0})`,
        "Channels": GuildChannelStore.getChannels(guild.id)?.count - 1 || "?", // - null category
        "Roles": GuildRoleStore.getSortedRoles(guild.id).length - 1, // - @everyone
    };

    return (
        <div className={cl("facts")}>
            {Object.entries(Fields).map(([name, node]) => (
                <div className={tl("stat")} key={name}>
                    <span>{name}</span>
                    <b className={cl("fact")}>{node}</b>
                </div>
            ))}
        </div>
    );
}

function FriendsTab({ guild, setCount }: RelationshipProps) {
    return UserList("friends", guild, RelationshipStore.getFriendIDs(), setCount);
}

function BlockedUsersTab({ guild, setCount }: RelationshipProps) {
    const blockedIds = RelationshipStore.getBlockedIDs();
    return UserList("blocked", guild, blockedIds, setCount);
}

function IgnoredUserTab({ guild, setCount }: RelationshipProps) {
    const ignoredIds = RelationshipStore.getIgnoredIDs();
    return UserList("ignored", guild, ignoredIds, setCount);
}

function UserList(type: "friends" | "blocked" | "ignored", guild: Guild, ids: string[], setCount: (count: number) => void) {
    const missing = [] as string[];
    const members = [] as string[];

    for (const id of ids) {
        if (GuildMemberStore.isMember(guild.id, id))
            members.push(id);
        else
            missing.push(id);
    }

    // Used for side effects (rerender on member request success)
    useStateFromStores(
        [GuildMemberStore],
        () => GuildMemberStore.getMemberIds(guild.id),
        null,
        (old, curr) => old.length === curr.length
    );

    useEffect(() => {
        if (!fetched[type] && missing.length) {
            fetched[type] = true;
            FluxDispatcher.dispatch({
                type: "GUILD_MEMBERS_REQUEST",
                guildIds: [guild.id],
                userIds: missing
            });
        }
    }, []);

    useEffect(() => setCount(members.length), [members.length]);

    const sortedMembers = members
        .map(id => UserStore.getUser(id) as User & { globalName: string; })
        .sort(
            (a, b) => {
                switch (settings.store.sorting) {
                    case "username":
                        return a.username.localeCompare(b.username);
                    case "displayname":
                        return a?.globalName?.localeCompare(b?.globalName || b.username)
                            || a.username.localeCompare(b?.globalName || b.username);
                    default:
                        return 0;
                }
            }
        );

    if (!sortedMembers.length) return <Empty type={type} />;
    return (
        <ScrollerThin fade className={classes(tl("list"), cl("scroller"))}>
            {sortedMembers.map(user => <Person key={user.id} user={user} />)}
        </ScrollerThin>
    );
}

const EMPTY = {
    friends: ["🫂", "None of your friends are in this server."],
    blocked: ["🚫", "Nobody you've blocked is in this server."],
    ignored: ["🙈", "Nobody you've ignored is in this server."],
    mutual: ["🔗", "Nobody here shares another server with you."],
} as const;

function Empty({ type }: { type: keyof typeof EMPTY; }) {
    return <div className={tl("empty")}><span className={tl("empty-icon")}>{EMPTY[type][0]}</span>{EMPTY[type][1]}</div>;
}

const STATUS_COLOR: Record<string, string> = { online: "#23a55a", idle: "#f0b232", dnd: "#f23f43", streaming: "#593695" };

function Person({ user, right }: { user: User & { globalName?: string; }; right?: React.ReactNode; }) {
    const status = PresenceStore.getStatus(user.id) || "offline";
    return (
        <div className={classes(tl("item"), cl("person"))} role="button" tabIndex={0} onClick={() => openUserProfile(user.id)}
            onKeyDown={e => { if (e.key === "Enter") openUserProfile(user.id); }}>
            <span className={cl("avatar-wrap")}>
                <img className={tl("avatar")} src={IconUtils.getUserAvatarURL(user, false, 64)} alt="" />
                <span className={cl("status")} style={{ background: STATUS_COLOR[status] ?? "#80848e" }} title={status} />
            </span>
            <span className={tl("item-main")}>
                <span className={tl("item-title")}>{user.globalName || user.username}</span>
                <span className={tl("item-sub")}>@{user.username}</span>
            </span>
            {right}
        </div>
    );
}

interface MemberWithMutuals {
    id: string;
    mutualCount: number;
    mutualGuilds: Array<{
        guild: Guild;
        iconUrl: string | null;
    }>;
}

function getMutualGuilds(id: string): MemberWithMutuals {
    const mutualGuilds: Array<{ guild: Guild; iconUrl: string | null; }> = [];

    for (const guild of Object.values(GuildStore.getGuilds())) {
        if (GuildMemberStore.isMember(guild.id, id)) {
            const iconUrl = guild.icon
                ? IconUtils.getGuildIconURL({
                    id: guild.id,
                    icon: guild.icon,
                    canAnimate: true,
                    size: 20
                }) ?? null
                : null;

            mutualGuilds.push({ guild, iconUrl });
        }
    }

    return {
        id,
        mutualCount: mutualGuilds.length,
        mutualGuilds
    };
}

function MutualServerIcons({ member }: { member: MemberWithMutuals; }) {
    const MAX_ICONS = 3;
    const { mutualGuilds, mutualCount } = member;

    return (
        <div className={cl("mutual-guilds")}>
            {mutualGuilds.slice(0, MAX_ICONS).map(({ guild, iconUrl }) => (
                <div key={guild.id} className={cl("guild-icon")} role="img" aria-label={guild.name}>
                    {iconUrl ? (
                        <img src={iconUrl} alt="" />
                    ) : (
                        <div className={cl("guild-acronym")}>{getGuildAcronym(guild)}</div>
                    )}
                </div>
            ))}
            {mutualCount > MAX_ICONS && (
                <div className={cl("guild-count")}>
                    +{mutualCount - MAX_ICONS}
                </div>
            )}
        </div>
    );
}

function MutualMembersTab({ guild, setCount }: RelationshipProps) {
    const [members, setMembers] = useState<MemberWithMutuals[]>([]);
    const currentUserId = UserStore.getCurrentUser().id;

    useEffect(() => {
        const guildMembers = GuildMemberStore.getMemberIds(guild.id);
        const membersWithMutuals = guildMembers
            .map(id => getMutualGuilds(id))
            // dont show yourself and members that are only in this server
            .filter(member => member.mutualCount > 1 && member.id !== currentUserId);

        // sort by mutual server count (descending)
        membersWithMutuals.sort((a, b) => b.mutualCount - a.mutualCount);

        setMembers(membersWithMutuals);
        setCount(membersWithMutuals.length);
    }, [guild.id]);

    if (!members.length) return <Empty type="mutual" />;
    return (
        <ScrollerThin fade className={classes(tl("list"), cl("scroller"))}>
            {members
                .map(member => ({ ...member, user: UserStore.getUser(member.id) as User & { globalName: string; } }))
                .filter(m => m.user)
                .sort((a, b) => {
                    switch (settings.store.sorting) {
                        case "username":
                            return a.user.username.localeCompare(b.user.username);
                        case "displayname":
                            return a.user?.globalName?.localeCompare(b.user?.globalName || b.user.username)
                                || a.user.username.localeCompare(b.user?.globalName || b.user.username);
                        default:
                            return 0;
                    }
                })
                .map(member => (
                    <Person key={member.id} user={member.user} right={
                        <span className={cl("mutual")} onClick={e => e.stopPropagation()}>
                            <span className={tl("badge")}>{member.mutualCount} servers</span>
                            <MutualServerIcons member={member} />
                        </span>
                    } />
                ))}
        </ScrollerThin>
    );
}
