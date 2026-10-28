/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./merged.css";

import { isSettingHidden } from "@api/PluginManager";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { GuildStore, lodash, React, SelectedChannelStore, SelectedGuildStore, useState, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

import { openOptions, type QolApi } from "../../controller/ControlCenter";
import { GROUPS } from "../../sonata/groups";
import { renderAutoVolume } from "../autoVolume/Panel";
import { renderBirthdays } from "../birthdayReminders/Panel";
import { renderCalendar } from "../calendar/Panel";
import type { SourceOptions } from "../calendar/sources";
import { renderInviteManager } from "../invites/inviteManager/Panel";
import { realName, realRoleName } from "../localNames";
import { renderAllNames } from "../localNames/Panel";
import { renderTagManager } from "../personTags/Manager";
import { renderQuickText } from "../quickText/Panel";
import { renderReminders } from "../reminders/Panel";
import { COLOR_IDS } from "../reminders/store";
import { renderScheduler } from "../scheduledMessages/Panel";
import { InsightsWindow } from "../serverInsights/Insights";
import { renderStreaks } from "../streaks/Panel";
import { renderTodo } from "../todoLists/Panel";
import { renderTranslateModal } from "../translate/TranslateModal";
import { renderTimeline } from "../voiceTimeline/Panel";
import { registerSection } from "./Hub";
import { OptionRow } from "./SettingsForm";
import { Window } from "./Window";
import { FormGroup, FormRow, Toggle } from "./WindowParts";

const NEW_GROUPS = ["people", "planner", "voiceCalls", "writingAssistant"];
const SERVER_SWITCHES = ["showHiddenChannels", "showTimeoutDuration", "forceOwnerCrown", "betterInvites"];
const SECTION_SUBS: Record<string, string> = {
    personTags: "Your private labels", birthdayReminders: "Dates and birthday messages", streaks: "Conversations you keep going",
    calendar: "Your month at a glance", reminders: "Things to come back to", todoLists: "Your channel checklists", scheduledMessages: "Messages for later",
    callTimer: "Time spent on calls", autoVolume: "Balance voices", voiceTimeline: "Your call history", disableCallIdle: "Stay in idle calls",
    quickText: "Your reusable snippets", autoCorrect: "Fix typos as you type", translate: "Read messages in another language", readAloud: "Listen to messages",
    serverInfo: "Details, roles and members", showHiddenChannels: "Channel visibility", showTimeoutDuration: "Timeout lengths", forceOwnerCrown: "Show the server owner's crown",
    betterInvites: "Invite details and previews", inviteManager: "Your invites across servers", localNames: "Names and icons just for you", autoModRegex: "Patterns for Discord AutoMod",
};
const CALENDAR_KEYS: Record<keyof SourceOptions, string> = { birthdays: "showBirthdays", scheduled: "showScheduled", events: "showEvents", reminders: "showReminders", imported: "showImported", packages: "showPackages", episodes: "showEpisodes", weather: "showWeather", interestedOnly: "interestedOnly" };

function FeatureSettings({ api, feature, modalProps }: { api: QolApi; feature: string; modalProps: RenderModalProps; }) {
    const keys = React.useMemo(() => api.optionKeys(feature), [api, feature]);
    const store = api.settings.use(keys);
    const visible = keys.filter(key => !isSettingHidden(api.settings, api.settings.def[key]) && api.settings.def[key].type !== OptionType.CUSTOM);
    return <Window {...modalProps} title={api.partName?.(feature) ?? api.name(feature)} size="lg"><div className="vc-tool-wrap"><p className="vc-tool-hint">{api.description(feature)}</p>{!visible.length && <p>This part works in Discord while its switch is on. Its individual switch is in the group's Options.</p>}{visible.map(key => <OptionRow key={key} id={key} def={api.settings.def[key]} store={store} settings={api.settings} onClose={modalProps.onClose} onChange={(value: unknown) => { store[key] = value; if (api.settings.def[key].restartNeeded) api.markOptionPending(feature); }} />)}</div></Window>;
}

function ServerInsightsHome({ modalProps }: { modalProps: RenderModalProps; }) {
    const guilds = useStateFromStores([GuildStore], () => Object.values(GuildStore.getGuilds()).sort((a, b) => a.name.localeCompare(b.name)), [], lodash.isEqual);
    const [guildId, setGuildId] = useState(SelectedGuildStore.getGuildId() ?? guilds[0]?.id ?? "");
    const guild = guilds.find(entry => entry.id === guildId) ?? guilds[0];
    if (!guild) return <Window {...modalProps} title="Server Insights"><div className="vc-tool-empty">Join a server to view its insights.</div></Window>;
    return <InsightsWindow key={guild.id} modalProps={modalProps} guild={guild} startOpts={{}} tools={<select className="vc-tool-select vc-merged-select" value={guild.id} aria-label="Server for insights" onChange={event => setGuildId(event.currentTarget.value)}>{guilds.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>} />;
}

function ServerSettings({ api, modalProps }: { api: QolApi; modalProps: RenderModalProps; }) {
    const keys = React.useMemo(() => SERVER_SWITCHES.flatMap(feature => [`on_${feature}`, ...api.optionKeys(feature)]), [api]);
    const store = api.settings.use(keys);
    return <Window {...modalProps} title="Server Settings" size="xl" subtitle="Display and invite improvements">
        <div className="vc-tool-wrap">
            <h2 className="vc-tool-section-title">Server Settings</h2>
            <p className="vc-tool-hint">Small improvements that work throughout Discord. Each keeps its own switch and options.</p>
            {SERVER_SWITCHES.map(feature => <FormGroup key={feature}>
                <FormRow label={api.partName?.(feature) ?? feature} help={SECTION_SUBS[feature]}>
                    <Toggle value={store[`on_${feature}`] !== false} onChange={on => api.setOn(feature, on)} label={`Enable ${api.partName?.(feature) ?? feature}`} />
                </FormRow>
                {store[`on_${feature}`] !== false && api.optionKeys(feature).filter(key => !isSettingHidden(api.settings, api.settings.def[key]) && api.settings.def[key].type !== OptionType.CUSTOM).map(key => <OptionRow key={key} id={key} def={api.settings.def[key]} store={store} settings={api.settings} onClose={modalProps.onClose} onChange={(value: unknown) => { store[key] = value; if (api.settings.def[key].restartNeeded) api.markOptionPending(feature); }} />)}
                {["apply-on", "apply-off"].includes(api.status(feature)) && <p className="vc-tool-hint">This switch takes effect after Discord restarts.</p>}
            </FormGroup>)}
            <Button variant="secondary" onClick={() => openOptions(api, "serverTools")}>All Server Tools options</Button>
        </div>
    </Window>;
}

export function installMergedWindows(api: QolApi) {
    const renderers: Record<string, (props: RenderModalProps, store: QolApi["settings"]["store"]) => ReactNode> = {
        personTags: props => renderTagManager(props),
        birthdayReminders: (props, store) => renderBirthdays(props, undefined, Number(store.birthdayReminders_remindHour), !!store.birthdayReminders_confetti),
        streaks: props => renderStreaks(props),
        calendar: (props, store) => {
            const sources: SourceOptions = { birthdays: !!store.calendar_showBirthdays, scheduled: !!store.calendar_showScheduled, events: !!store.calendar_showEvents, reminders: !!store.calendar_showReminders, imported: store.calendar_showImported !== false, packages: store.calendar_showPackages !== false, episodes: store.calendar_showEpisodes !== false, weather: store.calendar_showWeather !== false, interestedOnly: !!store.calendar_interestedOnly };
            return renderCalendar(props, Number(store.calendar_weekStart) === 0 ? 0 : 1, sources, (key, value) => { store[`calendar_${CALENDAR_KEYS[key]}`] = value; });
        },
        reminders: (props, store) => renderReminders(props, COLOR_IDS.find(color => color === store.reminders_defaultColor) ?? "blue"),
        todoLists: props => renderTodo(props, SelectedChannelStore.getChannelId() ?? null),
        scheduledMessages: props => renderScheduler(props),
        autoVolume: props => renderAutoVolume(props),
        voiceTimeline: props => renderTimeline(props),
        quickText: props => renderQuickText(props),
        translate: props => renderTranslateModal(props),
    };
    for (const group of NEW_GROUPS) for (const feature of GROUPS[group].members) {
        if (feature === "timezones") continue;
        const render = renderers[feature];
        registerSection(group, { id: feature, feature,
            name: api.partName?.(feature) ?? api.name(feature), sub: SECTION_SUBS[feature],
            render: props => <ErrorBoundary>{render ? render(props, api.settings.store) : <FeatureSettings api={api} feature={feature} modalProps={props} />}</ErrorBoundary> });
    }
    registerSection("serverTools", { id: "serverInfo", feature: "serverInfo", features: ["serverInfo", "permissionsViewer"], order: 0, name: "Insights", sub: "Details, roles and members", render: props => <ErrorBoundary><ServerInsightsHome modalProps={props} /></ErrorBoundary> });
    registerSection("serverTools", { id: "inviteManager", feature: "inviteManager", features: ["inviteManager", "betterInvites"], order: 2, name: "Invites", sub: "Your server invites", render: props => {
        const { store } = api.settings;
        return <ErrorBoundary>{store.on_inviteManager !== false ? renderInviteManager(props, !!store.inviteManager_everyone, value => { store.inviteManager_everyone = value; }) : <FeatureSettings api={api} feature="betterInvites" modalProps={props} />}</ErrorBoundary>;
    } });
    registerSection("serverTools", { id: "localNames", feature: "localNames", order: 3, name: "Local Names", sub: "Names and icons just for you", render: props => <ErrorBoundary>{renderAllNames(props, realName, realRoleName)}</ErrorBoundary> });
    registerSection("serverTools", { id: "serverSettings", feature: "showHiddenChannels", features: GROUPS.serverTools.members, icon: "gear", order: 4, name: "Settings", sub: "Display and behaviour", render: props => <ErrorBoundary><ServerSettings api={api} modalProps={props} /></ErrorBoundary> });
}
