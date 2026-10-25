/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Server Insights: one window for a server, from one "Server Insights" item
// on its right-click menu, instead of Server Info, View Permissions and Look
// Up a Member each opening their own. Overview is Server Info; Roles is
// every role with what it can do and who has it; Members looks someone up.
// A tab shows while its part is switched on; opening it again switches the
// window that's already open.

import ErrorBoundary from "@components/ErrorBoundary";
import type { Guild, RenderModalProps, RoleOrUserPermission } from "@vencord/discord-types";
import { PermissionOverwriteType } from "@vencord/discord-types/enums";
import { GuildRoleStore, Menu, openModal, React, useEffect, useState } from "@webpack/common";

import { isFeatureRunning } from "../../featureSettings";
import { embeddedContext, Window } from "../_shared/Window";
import { MemberLookupModal } from "./permissionsViewer/components/MemberLookup";
import { RolesAndUsersPermissions } from "./permissionsViewer/components/RolesAndUsersPermissions";
import { loadGetGuildPermissionSpecMap } from "./permissionsViewer/utils";
import { GuildInfoModal } from "./serverInfo/GuildInfoModal";

export type InsightsTab = "overview" | "roles" | "members";
export interface InsightsOpts { query?: string; roleId?: string; }

const tabsNow = (): [InsightsTab, string][] => [
    ...(isFeatureRunning("serverInfo") ? [["overview", "Overview"] as [InsightsTab, string]] : []),
    ...(isFeatureRunning("permissionsViewer") ? [["roles", "Roles & permissions"], ["members", "Members"]] as [InsightsTab, string][] : []),
];

/** The open window: opening Insights again switches it rather than stacking another. */
let live: { guildId: string; go(tab: InsightsTab, opts: InsightsOpts): void; } | null = null;

function InsightsWindow({ modalProps, guild, start, startOpts }: { modalProps: RenderModalProps; guild: Guild; start?: InsightsTab; startOpts: InsightsOpts; }) {
    const tabs = tabsNow();
    const [tab, setTab] = useState<InsightsTab>(() => tabs.find(([id]) => id === start)?.[0] ?? tabs[0]?.[0] ?? "overview");
    const [opts, setOpts] = useState<InsightsOpts>(startOpts);
    // A new key when the same tab is asked for again with something to show (look up someone else).
    const [n, setN] = useState(0);
    const [specsReady, setSpecsReady] = useState(false);
    useEffect(() => void loadGetGuildPermissionSpecMap().then(() => setSpecsReady(true)), []);
    useEffect(() => {
        const me = { guildId: guild.id, go: (t: InsightsTab, o: InsightsOpts) => { setTab(t); setOpts(o); setN(x => x + 1); } };
        live = me;
        return () => { if (live === me) live = null; };
    }, []);

    const Embedded = embeddedContext().Provider;
    const roles = (): RoleOrUserPermission[] => GuildRoleStore.getSortedRoles(guild.id).map(role => ({ type: PermissionOverwriteType.ROLE, ...role })) as any;

    return (
        <Window {...modalProps} size="xl" title="Server Insights" subtitle={guild.name}
            tabs={tabs.length > 1 ? tabs : undefined} tab={tab} onTab={id => { setTab(id as InsightsTab); setOpts({}); }}
            status={[guild.name, tab === "overview" ? "About this server" : tab === "roles" ? "Pick a role to see what it can do and who has it" : "Look someone up by ID, @mention or username"]}>
            <Embedded value>
                <ErrorBoundary key={`${tab}:${n}`} message="This tab hit a problem — try another one, or reopen Server Insights.">
                    {!tabs.length && <div className="vc-tool-empty">Switch on Server Info or Permissions Viewer in Server Insights' options.</div>}
                    {tab === "overview" && <GuildInfoModal guild={guild} modalProps={modalProps} />}
                    {tab === "roles" && (specsReady
                        ? <RolesAndUsersPermissions permissions={roles()} guild={guild} header={guild.name} modalProps={modalProps} selectId={opts.roleId} />
                        : <div className="vc-tool-empty">Loading the server's roles…</div>)}
                    {tab === "members" && <MemberLookupModal modalProps={modalProps} initialGuildId={guild.id} initialQuery={opts.query} />}
                </ErrorBoundary>
            </Embedded>
        </Window>
    );
}

export function openInsights(guild: Guild, tab?: InsightsTab, opts: InsightsOpts = {}) {
    if (live?.guildId === guild.id) { live.go(tab ?? tabsNow()[0]?.[0] ?? "overview", opts); return; }
    openModal(props => <InsightsWindow modalProps={props} guild={guild} start={tab} startOpts={opts} />);
}

/** The one item on a server's right-click menu (added once, whichever part is switched on). */
export function addInsightsItem(children: any[], guild: Guild, icon?: any) {
    const has = (list: any[]): boolean => list.some(c => c?.props?.id === "vc-server-insights" || (Array.isArray(c?.props?.children) && has(c.props.children)));
    if (has(children)) return;
    children.push(<Menu.MenuItem id="vc-server-insights" label="Server Insights" leadingAccessory={icon ? { type: "icon", icon } : undefined} action={() => openInsights(guild)} />);
}
