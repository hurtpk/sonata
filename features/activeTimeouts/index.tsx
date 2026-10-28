/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import { openUserProfile } from "@utils/discord";
import { useFixedTimer } from "@utils/react";
import { formatDurationMs } from "@utils/text";
import definePlugin from "@utils/types";
import type { Guild, RenderModalProps } from "@vencord/discord-types";
import { GuildMemberStore, GuildStore, IconUtils, lodash, Menu, PermissionsBits, PermissionStore, SelectedGuildStore, TextInput, UserStore, useState, useStateFromStores } from "@webpack/common";

import { isFeatureRunning } from "../../featureSettings";
import { Window } from "../_shared/Window";
import { openMemberLogs } from "../memberLogs";
import { openModeration, registerModerationPart } from "../serverTools/Moderation";

export function ActiveTimeoutsWindow({ modalProps, initialGuildId }: { modalProps: RenderModalProps; initialGuildId?: string; }) {
    const guilds = useStateFromStores([GuildStore, PermissionStore], () => Object.values(GuildStore.getGuilds()).filter(guild => PermissionStore.can(PermissionsBits.MODERATE_MEMBERS, guild)).sort((a, b) => a.name.localeCompare(b.name)), [], lodash.isEqual);
    const [guildId, setGuildId] = useState(initialGuildId ?? SelectedGuildStore.getGuildId() ?? guilds[0]?.id ?? "");
    const [query, setQuery] = useState("");
    const now = useFixedTimer({ initialTime: 0 });
    const canView = useStateFromStores([PermissionStore, GuildStore], () => !!GuildStore.getGuild(guildId) && PermissionStore.can(PermissionsBits.MODERATE_MEMBERS, GuildStore.getGuild(guildId)), [guildId]);
    const members = useStateFromStores([GuildMemberStore, UserStore], () => canView ? GuildMemberStore.getMembers(guildId).filter(member => {
        const ends = member.communicationDisabledUntil ? new Date(member.communicationDisabledUntil).getTime() : 0;
        const user = UserStore.getUser(member.userId);
        return ends > now && `${member.nick ?? ""} ${user?.username ?? ""} ${member.userId}`.toLowerCase().includes(query.trim().toLowerCase());
    }).sort((a, b) => new Date(a.communicationDisabledUntil ?? 0).getTime() - new Date(b.communicationDisabledUntil ?? 0).getTime()) : [], [guildId, canView, now, query], lodash.isEqual);
    return <Window {...modalProps} size="lg" title="Active Timeouts" subtitle="Review timed-out members and their remaining time">
        <div className="vc-tool-wrap">
            <select className="vc-tool-select vc-merged-select" value={guildId} aria-label="Server for active timeouts" onChange={event => setGuildId(event.currentTarget.value)}><option value="">Choose a server</option>{guilds.map(guild => <option key={guild.id} value={guild.id}>{guild.name}</option>)}</select>
            <TextInput value={query} onChange={setQuery} placeholder="Search a member, nickname or ID" aria-label="Search active timeouts" />
            <p className="vc-tool-hint">{members.length} active timeouts among members Discord has loaded. Open the server's Members page to load more. The list updates as Discord receives member changes. This view requires the Timeout Members permission.</p>
            {!canView && <div className="vc-tool-empty">Choose a server where you can time out members.</div>}
            {canView && !members.length && <div className="vc-tool-empty">No matching active timeouts in the loaded member data.</div>}
            {members.map(member => {
                const user = UserStore.getUser(member.userId);
                const ends = new Date(member.communicationDisabledUntil ?? 0).getTime();
                return <div key={member.userId} className="vc-tool-section"><div className="vc-tool-row">{user && <img src={IconUtils.getUserAvatarURL(user, false, 64)} width={36} height={36} alt="" />}<b>{member.nick ?? user?.username ?? member.userId}</b><span className="vc-tool-hint">{member.userId}</span></div><span>{formatDurationMs(ends - now)} remaining</span><span className="vc-tool-hint">Ends {new Date(ends).toLocaleString()}</span><div className="vc-tool-row"><Button size="small" variant="secondary" onClick={() => openUserProfile(member.userId)}>Review profile</Button>{isFeatureRunning("memberLogs") && <Button size="small" variant="secondary" onClick={() => openMemberLogs(member.userId, guildId)}>Personal member log</Button>}</div></div>;
            })}
        </div>
    </Window>;
}

export const openActiveTimeouts = (guildId?: string) => openModeration("activeTimeouts", props => <ActiveTimeoutsWindow modalProps={props} initialGuildId={guildId} />);
registerModerationPart("activeTimeouts", props => <ActiveTimeoutsWindow modalProps={props} />);
export default definePlugin({
    name: "ActiveTimeouts", description: "Review active timeouts in Discord's loaded member data, search members and see remaining times in servers you moderate.", authors: [Devs.Ven],
    openSettingsModal: () => openActiveTimeouts(),
    contextMenus: { "guild-context": (children, { guild }: { guild?: Guild; }) => { if (guild && PermissionStore.can(PermissionsBits.MODERATE_MEMBERS, guild)) children.push(<Menu.MenuItem id="sonata-active-timeouts" label="Active Timeouts" action={() => openActiveTimeouts(guild.id)} />); } },
});
