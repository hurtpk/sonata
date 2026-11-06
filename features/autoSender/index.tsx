/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, PermissionsBits, PermissionStore, RestAPI, TextInput, UserStore, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openSection, registerSection } from "../_shared/Hub";
import { Window } from "../_shared/Window";
import { openChannelPicker } from "../exploiterReport/ChannelPicker";
import { GRACE_MS, SEND_GAP_MS } from "../scheduledMessages/scheduler";

interface Schedule {
    id: string;
    owner: string;
    channelId: string;
    content: string;
    seconds: number;
    limit: number;
    sent: number;
    next: number;
    paused: boolean;
    error?: string;
}

const settings = defineFeatureSettings("autoSender", {
    schedules: { type: OptionType.STRING, description: "Saved recurring messages.", default: "[]", hidden: true },
});
const MIN_SECONDS = 5;
const MAX_SECONDS = 7 * 24 * 60 * 60;
const UNITS = { seconds: 1, minutes: 60, hours: 3600 };
type Unit = keyof typeof UNITS;
const complete = (schedule: Schedule) => schedule.limit > 0 && schedule.sent >= schedule.limit;
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;

function readSchedules(value: string): Schedule[] {
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed.flatMap(schedule => {
            if (!schedule || !Number.isFinite(schedule.next)) return [];
            const { minutes, ...saved } = schedule;
            const seconds = saved.seconds ?? minutes * 60;
            if (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return [];
            return [{ limit: 0, sent: 0, ...saved, seconds }];
        });
    } catch {
        return [];
    }
}

const getSchedules = () => readSchedules(settings.store.schedules);
const saveSchedules = (schedules: Schedule[]) => { settings.store.schedules = JSON.stringify(schedules); };
const updateSchedule = (id: string, patch: Partial<Schedule>) => saveSchedules(getSchedules().map(schedule => schedule.id === id ? { ...schedule, ...patch } : schedule));
const userId = () => UserStore.getCurrentUser()?.id;

function canSend(id: string) {
    const channel = ChannelStore.getChannel(id);
    return !!channel?.guild_id && [0, 5].includes(channel.type)
        && PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)
        && PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel);
}

async function tick(active: ReturnType<typeof setInterval>) {
    if (busy) return;
    busy = true;
    try {
        const now = Date.now();
        const due = getSchedules().filter(schedule => !schedule.paused && !complete(schedule) && schedule.owner === userId() && schedule.next <= now)
            .sort((a, b) => a.next - b.next);
        for (const queued of due) {
            if (timer !== active) return;
            const schedule = getSchedules().find(entry => entry.id === queued.id);
            if (!schedule || schedule.paused || complete(schedule) || schedule.owner !== userId() || schedule.next > Date.now()) continue;
            if (schedule.next < now - GRACE_MS) {
                updateSchedule(schedule.id, { next: Date.now() + schedule.seconds * 1000 });
                continue;
            }
            if (!canSend(schedule.channelId)) {
                updateSchedule(schedule.id, { paused: true, error: "Channel unavailable or missing permission to send." });
                continue;
            }
            const next = Date.now() + schedule.seconds * 1000;
            updateSchedule(schedule.id, { next, error: undefined });
            try {
                await RestAPI.post({
                    url: `/channels/${schedule.channelId}/messages`,
                    body: { content: schedule.content, allowed_mentions: { parse: [] } },
                });
                updateSchedule(schedule.id, { sent: schedule.sent + 1 });
            } catch {
                if (getSchedules().some(entry => entry.id === schedule.id && entry.next === next))
                    updateSchedule(schedule.id, { paused: true, error: "Discord rejected the message. Check the channel before resuming." });
            }
            await sleep(SEND_GAP_MS);
        }
    } finally {
        busy = false;
    }
}

function channelLabel(id: string) {
    const channel = ChannelStore.getChannel(id);
    return channel ? `${GuildStore.getGuild(channel.guild_id)?.name ?? "Server"} / #${channel.name}` : "Channel unavailable";
}

function intervalUnit(seconds: number): Unit {
    if (seconds % UNITS.hours === 0) return "hours";
    return seconds % UNITS.minutes === 0 ? "minutes" : "seconds";
}

const emptyDraft = { id: "", channel: "", content: "", interval: "15", unit: "minutes" as Unit, limit: "", immediate: false };

function AutoSender({ modalProps }: { modalProps: RenderModalProps; }) {
    const schedules = readSchedules(settings.use(["schedules"]).schedules).filter(schedule => schedule.owner === userId());
    const [draft, setDraft] = useState(emptyDraft);
    const [error, setError] = useState("");
    const editDraft = (patch: Partial<typeof emptyDraft>) => setDraft(previous => ({ ...previous, ...patch }));
    const reset = () => { setDraft(emptyDraft); setError(""); };
    const save = () => {
        const owner = userId();
        const seconds = Number(draft.interval) * UNITS[draft.unit];
        const limit = Number(draft.limit);
        if (!owner || !canSend(draft.channel)) { setError("Choose a channel where you can send messages."); return; }
        if (!/^\d+$/.test(draft.interval) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
            setError("Enter a whole number for an interval from 5 seconds to 7 days.");
            return;
        }
        if (draft.limit && (!/^\d+$/.test(draft.limit) || limit < 1 || limit > 10000)) {
            setError("Enter a send limit from 1 to 10,000, or leave it empty to repeat indefinitely.");
            return;
        }
        if (!draft.content.trim()) { setError("Enter a message."); return; }
        const saved = getSchedules();
        const existing = saved.find(schedule => schedule.id === draft.id && schedule.owner === owner);
        if (draft.id && !existing) { setError("This schedule is no longer available."); return; }
        const changes = { channelId: draft.channel, content: draft.content.trim(), seconds, limit, next: Date.now() + (draft.immediate ? 0 : seconds * 1000), error: undefined };
        if (existing) updateSchedule(existing.id, changes);
        else saveSchedules([...saved, { ...changes, id: crypto.randomUUID(), owner, paused: false, sent: 0 }]);
        reset();
    };
    return <Window {...modalProps} title="Auto Sender" subtitle="Send a message at a regular interval">
        <div className="vc-tool-wrap vc-auto-sender">
            <div className="vc-tool-section vc-auto-sender-editor">
                <div className="vc-auto-sender-heading">
                    <div><h3>{draft.id ? "Edit schedule" : "New schedule"}</h3><p>Recurring messages send while Discord is open.</p></div>
                    <span>{schedules.filter(schedule => !schedule.paused && !complete(schedule)).length} active</span>
                </div>
                <div className="vc-auto-sender-destination">
                    <div><span>Destination</span><b>{draft.channel ? channelLabel(draft.channel) : "Choose a channel"}</b></div>
                    <Button variant="secondary" onClick={() => openChannelPicker(draft.channel, channel => editDraft({ channel }))}>{draft.channel ? "Change channel" : "Browse channels"}</Button>
                </div>
                <div className="vc-auto-sender-grid">
                    <div className="vc-auto-sender-field">
                        <label htmlFor="vc-auto-sender-interval">Repeat every</label>
                        <div className="vc-auto-sender-interval">
                            <TextInput id="vc-auto-sender-interval" inputMode="numeric" value={draft.interval} onChange={interval => editDraft({ interval })} />
                            <div className="vc-auto-sender-segments" role="group" aria-label="Interval unit">
                                {([["seconds", "Sec"], ["minutes", "Min"], ["hours", "Hr"]] as const).map(([unit, label]) =>
                                    <Button key={unit} size="small" variant="none" aria-label={unit} aria-pressed={draft.unit === unit} onClick={() => editDraft({ unit })}>{label}</Button>)}
                            </div>
                        </div>
                    </div>
                    <label className="vc-auto-sender-field">Total send limit
                        <TextInput inputMode="numeric" placeholder="Unlimited" value={draft.limit} onChange={limit => editDraft({ limit })} />
                    </label>
                </div>
                {!draft.id && <div className="vc-auto-sender-field">
                    <span>First send</span>
                    <div className="vc-auto-sender-segments" role="group" aria-label="First send">
                        <Button size="small" variant="none" aria-pressed={!draft.immediate} onClick={() => editDraft({ immediate: false })}>After one interval</Button>
                        <Button size="small" variant="none" aria-pressed={draft.immediate} onClick={() => editDraft({ immediate: true })}>Right away</Button>
                    </div>
                </div>}
                <label className="vc-auto-sender-field">Message
                    <textarea className="vc-tool-area" placeholder="Write a message to send" maxLength={2000} value={draft.content} onChange={event => editDraft({ content: event.currentTarget.value })} />
                </label>
                <div className="vc-auto-sender-footer">
                    <span>{draft.content.length.toLocaleString()} / 2,000</span>
                    <div className="vc-tool-row">
                        {draft.id && <Button variant="secondary" onClick={reset}>Cancel</Button>}
                        <Button onClick={save} disabled={!draft.channel || !draft.content.trim()}>{draft.id ? "Save changes" : "Start schedule"}</Button>
                    </div>
                </div>
                {error && <p role="alert">{error}</p>}
            </div>
            <h3>Saved schedules</h3>
            {!schedules.length && <div className="vc-tool-empty">No recurring messages scheduled.</div>}
            {schedules.map(schedule => {
                const unit = intervalUnit(schedule.seconds);
                const amount = schedule.seconds / UNITS[unit];
                return <div className="vc-tool-section vc-auto-sender-schedule" key={schedule.id}>
                <div className="vc-auto-sender-heading">
                    <b>{channelLabel(schedule.channelId)}</b>
                    <span>{complete(schedule) ? "Completed" : schedule.paused ? "Paused" : "Scheduled"}</span>
                </div>
                <span className="vc-tool-hint">Every {amount} {amount === 1 ? unit.slice(0, -1) : unit} · {schedule.sent}{schedule.limit ? ` / ${schedule.limit}` : ""} sent
                    {!complete(schedule) && !schedule.paused && ` · Next ${new Date(schedule.next).toLocaleString()}`}</span>
                <div className="vc-auto-sender-message">{schedule.content}</div>
                {schedule.error && <span role="status">{schedule.error}</span>}
                <div className="vc-tool-row">
                    <Button size="small" variant="secondary" onClick={() => {
                        setDraft({ id: schedule.id, channel: schedule.channelId, content: schedule.content, interval: String(amount), unit, limit: schedule.limit ? String(schedule.limit) : "", immediate: false });
                        setError("");
                    }}>Edit</Button>
                    {!complete(schedule) && <Button size="small" variant="secondary" onClick={() => updateSchedule(schedule.id, schedule.paused
                        ? { paused: false, next: Date.now() + schedule.seconds * 1000, error: undefined } : { paused: true })}>
                        {schedule.paused ? "Resume" : "Pause"}
                    </Button>}
                    <Button size="small" variant="secondary" onClick={() => {
                        saveSchedules(getSchedules().filter(entry => entry.id !== schedule.id));
                        if (draft.id === schedule.id) reset();
                    }}>Remove</Button>
                </div>
            </div>;
            })}
        </div>
    </Window>;
}

registerSection("autoTools", { id: "autoSender", feature: "autoSender", icon: "scheduled", name: "Auto Sender", sub: "Recurring channel messages", render: props => <AutoSender modalProps={props} /> });

export default definePlugin({
    name: "AutoSender",
    description: "Send a recurring message to a selected channel at the interval you set.",
    authors: [Devs.Ven],
    settings,
    openSettingsModal: () => openSection("autoTools", "autoSender"),
    start() {
        const active = setInterval(() => void tick(active), 1000);
        timer = active;
    },
    stop() {
        clearInterval(timer);
        timer = undefined;
    },
});
