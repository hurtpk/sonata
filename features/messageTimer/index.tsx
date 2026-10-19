/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Span } from "@components/Span";
import { classNameFactory } from "@utils/css";
import { getCurrentChannel } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { classes, sleep } from "@utils/misc";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Menu, Modal, React, RestAPI, showToast, useCallback, useEffect, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { defineFeatureSettings } from "../../featureSettings";
import { ToolHero } from "../_shared/ToolHero";

const cl = classNameFactory("vc-msgtimer-");
const tl = classNameFactory("vc-tool-");
const logger = new Logger("MessageTimer");

interface PendingDeletion {
    channelId: string;
    messageId: string;
    deleteAt: number;
}

const settings = defineFeatureSettings("messageTimer", {
    // The timer window used to open from the dock icon's right-click.
    openWindow: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <OpenWindowButton />,
    },
    active: {
        type: OptionType.BOOLEAN,
        description: "Auto-delete your messages after the configured lifespan.",
        default: false,
    },
    messageLifespan: {
        type: OptionType.NUMBER,
        description: "Duration (in ms) before a message is deleted.",
        default: 60000,
    },
    excludedChannels: {
        type: OptionType.STRING,
        description: "Channel IDs to exclude, separated by /",
        default: "",
    },
    excludedServers: {
        type: OptionType.STRING,
        description: "Server IDs to exclude, separated by /",
        default: "",
    },
    keybind: {
        type: OptionType.STRING,
        description: "Keybind to toggle message timer on/off.",
        default: "",
    },
}).withPrivateSettings<{
    pendingDeletions: PendingDeletion[];
}>();

const LAUNCH_PURGE_DELAY = 1250;
const SCHEDULE_WINDOW_MS = 30 * 60 * 1000;
const PERIODIC_INTERVAL_MS = 60 * 1000;

const scheduledTimers = new Set<ReturnType<typeof setTimeout>>();

function getPendingQueue(): PendingDeletion[] {
    try {
        const raw = settings.store.pendingDeletions;
        if (!raw || !Array.isArray(raw)) return [];
        return JSON.parse(JSON.stringify(raw)) as PendingDeletion[];
    } catch {
        return [];
    }
}

function savePendingQueue(queue: PendingDeletion[]) {
    settings.store.pendingDeletions = queue;
}

function addToPendingQueue(entry: PendingDeletion) {
    const queue = getPendingQueue();
    queue.push(entry);
    savePendingQueue(queue);
}

function removeFromPendingQueue(messageId: string) {
    savePendingQueue(getPendingQueue().filter(e => e.messageId !== messageId));
}

function matchesKeybind(e: KeyboardEvent) {
    const parts = settings.store.keybind.split("+").map(p => p.trim().toLowerCase());
    for (const part of parts) {
        if (part === "alt" && !e.altKey) return false;
        if (part === "ctrl" && !e.ctrlKey) return false;
        if (part === "shift" && !e.shiftKey) return false;
        if (part === "meta" && !e.metaKey) return false;
        if (!["alt", "ctrl", "shift", "meta"].includes(part) && e.key.toLowerCase() !== part) return false;
    }
    return true;
}

function handleKeybind(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
    if (!matchesKeybind(e)) return;
    e.preventDefault();
    setActive(!settings.store.active);
}

function setActive(val: boolean) {
    settings.store.active = val;
    showToast(
        `Message Timer ${val ? "enabled" : "disabled"}`,
        val ? "success" : "message",
    );
}

function getExcludedList(raw: string): string[] {
    return raw.split("/").filter(s => s !== "");
}

function toggleExclusion(raw: string, id: string): string {
    const list = getExcludedList(raw);
    const idx = list.indexOf(id);
    if (idx === -1) list.push(id);
    else list.splice(idx, 1);
    return list.join("/");
}

async function deleteMessage(channelId: string, messageId: string): Promise<boolean> {
    try {
        await RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` });
        return true;
    } catch (e: any) {
        if (e?.status === 429) {
            const wait = (e?.body?.retry_after ?? 3) * 1000;
            await sleep(wait);
            return deleteMessage(channelId, messageId);
        }
        if (e?.status === 404 || e?.status === 403) return true;
        logger.error("Delete failed", messageId, e);
        return false;
    }
}

function scheduleDeletion(entry: PendingDeletion, delay: number) {
    const timer = setTimeout(async () => {
        scheduledTimers.delete(timer);
        const success = await deleteMessage(entry.channelId, entry.messageId);
        if (success) removeFromPendingQueue(entry.messageId);
    }, delay);
    scheduledTimers.add(timer);
}

function onMessageCreate(e: any) {
    if (!settings.store.active) return;
    if (e.message.author.id !== UserStore.getCurrentUser().id) return;
    if (getExcludedList(settings.store.excludedChannels).includes(e.channelId)) return;
    if (getExcludedList(settings.store.excludedServers).includes(e.guildId)) return;

    const deleteAt = Date.now() + settings.store.messageLifespan;
    const entry: PendingDeletion = { channelId: e.channelId, messageId: e.message.id, deleteAt };
    addToPendingQueue(entry);
    scheduleDeletion(entry, settings.store.messageLifespan);
}

let processingQueue = false;

async function processExpiredDeletions(isLaunch = false) {
    if (processingQueue) return;
    processingQueue = true;
    try {
        const queue = getPendingQueue();
        if (queue.length === 0) return;

        const now = Date.now();
        const expired = queue.filter(e => e.deleteAt <= now);
        const pending = queue.filter(e => e.deleteAt > now);

        if (expired.length > 0) {
            logger.info(`Purging ${expired.length} expired message${expired.length === 1 ? "" : "s"}${isLaunch ? " from prior session" : ""}`);
            for (const entry of expired) {
                await deleteMessage(entry.channelId, entry.messageId);
                await sleep(LAUNCH_PURGE_DELAY);
            }
            savePendingQueue(pending);
        }

        for (const entry of pending) {
            const delay = entry.deleteAt - now;
            if (delay <= SCHEDULE_WINDOW_MS) scheduleDeletion(entry, delay);
        }
    } catch (e) {
        logger.error("Queue error", e);
    } finally {
        processingQueue = false;
    }
}

let queueInterval: ReturnType<typeof setInterval> | null = null;

function clearQueue() {
    scheduledTimers.forEach(t => clearTimeout(t));
    scheduledTimers.clear();
    savePendingQueue([]);
    showToast("Pending deletions cleared", "success");
}

function TimerIcon({ width = 20, height = 20, className }: { width?: number; height?: number; className?: string; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="M12 9v4l2.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 2h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M18.5 5.5l1 -1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function ClockSmallIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
        </svg>
    );
}

type TimeUnit = "seconds" | "minutes" | "hours" | "days";

interface Preset {
    label: string;
    ms: number;
}

const PRESETS: Preset[] = [
    { label: "30s", ms: 30_000 },
    { label: "1 min", ms: 60_000 },
    { label: "5 min", ms: 5 * 60_000 },
    { label: "30 min", ms: 30 * 60_000 },
    { label: "1 hour", ms: 60 * 60_000 },
    { label: "6 hours", ms: 6 * 60 * 60_000 },
    { label: "1 day", ms: 24 * 60 * 60_000 },
    { label: "3 days", ms: 3 * 24 * 60 * 60_000 },
    { label: "1 week", ms: 7 * 24 * 60 * 60_000 },
];

function formatLifespan(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m`;
    const h = m / 60;
    if (h < 24) return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
    const d = h / 24;
    return d % 1 === 0 ? `${d}d` : `${d.toFixed(1)}d`;
}

function unitFor(ms: number): TimeUnit {
    if (ms >= 24 * 60 * 60_000) return "days";
    if (ms >= 60 * 60_000) return "hours";
    if (ms >= 60_000) return "minutes";
    return "seconds";
}

function TimerSettingsModal({ modalProps }: { modalProps: { onClose(): void; transitionState: number; }; }) {
    const [active, setActiveLocal] = useState(settings.store.active);
    const [lifespan, setLifespan] = useState(settings.store.messageLifespan);
    const [unit, setUnit] = useState<TimeUnit>(unitFor(settings.store.messageLifespan));
    const [pending, setPending] = useState(getPendingQueue().length);

    useEffect(() => {
        const id = setInterval(() => setPending(getPendingQueue().length), 2000);
        return () => clearInterval(id);
    }, []);

    const applyLifespan = useCallback((ms: number) => {
        settings.store.messageLifespan = ms;
        setLifespan(ms);
        setUnit(unitFor(ms));
    }, []);

    const toggle = useCallback((val: boolean) => {
        settings.store.active = val;
        setActiveLocal(val);
    }, []);

    const UNIT_MS: Record<TimeUnit, number> = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
    const amount = Math.max(1, Math.round(lifespan / UNIT_MS[unit]));
    const accent = windowAccent("messageTimer");

    return (
        <Modal {...modalProps} size="lg" title="Message Timer" subtitle="Your messages delete themselves after the time you choose">
            <div className={classes(tl("wrap"), cl("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon={active ? "⏳" : "⌛"} kicker={active ? "On" : "Off"}
                    title={active ? `Gone after ${formatLifespan(lifespan)}` : "Your messages stay"}
                    sub={active ? "Every message you send deletes itself when its time is up." : "Turn it on and your messages delete themselves after the time you pick."}
                    numbers={[{ value: formatLifespan(lifespan), label: "timer" }, { value: pending, label: "waiting" }]}>
                    <button type="button" className={classes(tl("btn"), !active && tl("primary"))} onClick={() => toggle(!active)}>{active ? "Turn off" : "Turn on"}</button>
                </ToolHero>

                <section className={tl("section")}>
                    <h3 className={tl("section-title")}>⏱️ Delete after</h3>
                    <div className={tl("chips")}>
                        {PRESETS.map(p => (
                            <button key={p.label} type="button" className={classes(tl("chip"), lifespan === p.ms && tl("chip-on"))} onClick={() => applyLifespan(p.ms)}>{p.label}</button>
                        ))}
                    </div>
                    <span className={tl("label")}>Or exactly</span>
                    <div className={cl("custom")}>
                        <input className={classes(tl("input"), cl("amount"))} type="number" min={1} value={amount}
                            onChange={e => { const n = Math.max(1, Math.round(Number(e.currentTarget.value) || 1)); applyLifespan(n * UNIT_MS[unit]); }} />
                        <div className={tl("seg")}>
                            {(["seconds", "minutes", "hours", "days"] as TimeUnit[]).map(u => (
                                <button key={u} type="button" className={classes(tl("seg-btn"), unit === u && tl("seg-on"))}
                                    onClick={() => { setUnit(u); applyLifespan(amount * UNIT_MS[u]); }}>{u[0].toUpperCase() + u.slice(1)}</button>
                            ))}
                        </div>
                    </div>
                </section>

                <span className={tl("hint")}>
                    It keeps track across restarts: anything past its time when Discord opens again is deleted then, {LAUNCH_PURGE_DELAY / 1000} s apart.
                </span>

                {pending > 0 && (
                    <div className={classes(tl("section"), cl("queue"))}>
                        <div className={tl("footer")}>
                            <span>{pending} message{pending === 1 ? "" : "s"} waiting to be deleted</span>
                            <span className={tl("spacer")} />
                            <button type="button" className={tl("btn")} onClick={() => { clearQueue(); setPending(0); }}>Forget them (keep the messages)</button>
                        </div>
                    </div>
                )}

                <div className={tl("footer")}>
                    {settings.store.keybind && <span className={tl("hint")}>Shortcut: <kbd className={cl("kbd")}>{settings.store.keybind}</kbd></span>}
                    <span className={tl("spacer")} />
                    <button type="button" className={classes(tl("btn"), tl("primary"))} onClick={modalProps.onClose}>Done</button>
                </div>
            </div>
        </Modal>
    );
}

function openTimerModal() {
    openModal(modalProps => <TimerSettingsModal modalProps={modalProps} />);
}

function renderChatContextEntry() {
    settings.use(["active", "excludedChannels"]);
    const channel = getCurrentChannel();
    if (!channel) return null;
    const isExcluded = getExcludedList(settings.store.excludedChannels).includes(channel.id);
    const enabled = settings.store.active;
    return (
        <Menu.MenuItem id="msg-timer" label="Message Timer">
            <Menu.MenuCheckboxItem
                id="mt-exclude-channel"
                label="Exclude this channel"
                action={() => {
                    settings.store.excludedChannels = toggleExclusion(settings.store.excludedChannels, channel.id);
                }}
                checked={isExcluded}
            />
            <Menu.MenuCheckboxItem
                id="mt-enabled"
                label="Enabled"
                action={() => setActive(!enabled)}
                checked={enabled}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="mt-settings" label="Settings" action={openTimerModal} />
        </Menu.MenuItem>
    );
}

function renderGuildContextEntry(guild: any) {
    settings.use(["active", "excludedServers"]);
    if (!guild) return null;
    const isExcluded = getExcludedList(settings.store.excludedServers).includes(guild.id);
    const enabled = settings.store.active;
    return (
        <Menu.MenuItem id="msg-timer" label="Message Timer">
            <Menu.MenuCheckboxItem
                id="mt-exclude-server"
                label="Exclude this server"
                action={() => {
                    settings.store.excludedServers = toggleExclusion(settings.store.excludedServers, guild.id);
                }}
                checked={isExcluded}
            />
            <Menu.MenuCheckboxItem
                id="mt-enabled"
                label="Enabled"
                action={() => setActive(!enabled)}
                checked={enabled}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="mt-settings" label="Settings" action={openTimerModal} />
        </Menu.MenuItem>
    );
}

function OpenWindowButton() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <button type="button" className="vc-tool-btn" onClick={openTimerModal}>Open Message Timer</button>
            <Span size="sm" color="text-muted">Lifespan presets, pending deletions, and exclusions.</Span>
        </div>
    );
}

// Right-click menus. These used to be added through PluginDock's shared
// "Plugins" submenu; now Message Timer adds them itself through Vencord's
// context-menu API, so they work without any other plugin installed.
const chatInputContextPatch: NavContextMenuPatchCallback = children => {
    const item = renderChatContextEntry();
    if (item) children.push(<Menu.MenuGroup>{item}</Menu.MenuGroup>);
};

const guildContextPatch: NavContextMenuPatchCallback = (children, props) => {
    const item = renderGuildContextEntry(props?.guild);
    if (item) children.push(<Menu.MenuGroup>{item}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "Message Timer",
    description: "Auto-deletes your messages after a configurable lifespan. Persists across restarts, purges overdue messages on launch.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    contextMenus: {
        "textarea-context": chatInputContextPatch,
        "guild-context": guildContextPatch,
        "guild-header-popout": guildContextPatch,
    },
    openSettingsModal: openTimerModal,
    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        document.addEventListener("keydown", handleKeybind, true);
        setTimeout(() => processExpiredDeletions(true), 3000);
        queueInterval = setInterval(() => processExpiredDeletions(false), PERIODIC_INTERVAL_MS);
    },
    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        document.removeEventListener("keydown", handleKeybind, true);
        if (queueInterval) {
            clearInterval(queueInterval);
            queueInterval = null;
        }
        scheduledTimers.forEach(t => clearTimeout(t));
        scheduledTimers.clear();
    },
});
