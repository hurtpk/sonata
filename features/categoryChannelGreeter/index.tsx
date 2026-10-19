/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Channel Greeter: when a new channel appears in a category you chose, wait
// for a particular member or bot (or anyone, or no one) to post there, then
// reply with one of your greetings after an optional delay. Several greeters
// can run at once, each set up from its own window (see Panel).

import "../_shared/tool.css";
import "./styles.css";

import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, UserStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openGreeter } from "./Panel";
import { changed, fillIn, loadLog, logSent, newRule, parseRules, Rule, watching } from "./rules";

export const settings = defineFeatureSettings("categoryChannelGreeter", {
    // Pause/resume without disabling the plugin; can be bound to a key from the Keybinds tab.
    active: {
        type: OptionType.BOOLEAN,
        description: "Greeter active. Turn off to pause every greeter without disabling the feature.",
        default: true,
    },
    watchMinutes: {
        type: OptionType.SELECT,
        description: "How long to wait for the first message in a new channel before giving up",
        options: [
            { label: "5 minutes", value: 5 },
            { label: "30 minutes", value: 30, default: true },
            { label: "2 hours", value: 120 },
            { label: "12 hours", value: 720 },
        ],
    },
    rules: { type: OptionType.STRING, description: "Internal: greeters (JSON).", default: "[]", hidden: true },
    migrated: { type: OptionType.BOOLEAN, description: "Internal: old single-greeter settings moved into a greeter.", default: false, hidden: true },
    // The old single greeter's settings, kept only to move them over.
    categoryId: { type: OptionType.STRING, description: "Internal (old).", default: "", hidden: true },
    triggerUserId: { type: OptionType.STRING, description: "Internal (old).", default: "", hidden: true },
    delayMs: { type: OptionType.NUMBER, description: "Internal (old).", default: 0, hidden: true },
    messages: { type: OptionType.STRING, description: "Internal (old).", default: "", hidden: true },
});

export const getRules = () => parseRules(settings.store.rules);
export const saveRules = (rules: Rule[]) => { settings.store.rules = JSON.stringify(rules); changed(); };

/** The old one-greeter settings become the first greeter. */
function migrate() {
    if (settings.store.migrated) return;
    settings.store.migrated = true;
    const s = settings.store;
    if (!s.categoryId?.trim()) return;
    const rule = newRule(1);
    const category: any = ChannelStore.getChannel(s.categoryId.trim());
    Object.assign(rule, {
        categoryId: s.categoryId.trim(),
        guildId: category?.guild_id ?? "",
        triggerUserId: s.triggerUserId?.trim() ?? "",
        trigger: s.triggerUserId?.trim() ? "user" : "anyone",
        delaySec: Math.round((Number(s.delayMs) || 0) / 100) / 10,
        messages: (s.messages || "").split("|").map(m => m.trim()).filter(Boolean),
    });
    if (!rule.messages.length) rule.messages = ["Welcome to the new channel!"];
    saveRules([rule, ...getRules()]);
}

const pendingSends = new Set<ReturnType<typeof setTimeout>>();

function stopWatching(channelId: string) {
    const w = watching.get(channelId);
    if (w) clearTimeout(w.timer);
    watching.delete(channelId);
    changed();
}

export const cancelWatch = stopWatching;

function pick(rule: Rule): string | null {
    const list = rule.messages.map(m => m.trim()).filter(Boolean);
    if (!list.length) return null;
    if (rule.order === "sequence") {
        const text = list[rule.next % list.length];
        saveRules(getRules().map(r => r.id === rule.id ? { ...r, next: (rule.next + 1) % list.length } : r));
        return text;
    }
    return list[Math.floor(Math.random() * list.length)];
}

function greet(rule: Rule, channelId: string, userId?: string) {
    const delay = Math.max(0, rule.delaySec) * 1000;
    const timer = setTimeout(() => {
        pendingSends.delete(timer);
        if (!settings.store.active) return;
        const raw = pick(rule);
        if (!raw) return;
        const text = fillIn(raw, { channelId, userId });
        if (!text) return;
        sendMessage(channelId, { content: text }, false);
        const ch: any = ChannelStore.getChannel(channelId);
        logSent({ t: Date.now(), ruleName: rule.name, guildId: ch?.guild_id, channelId, channelName: ch?.name ?? "channel", text });
    }, delay);
    pendingSends.add(timer);
}

const channelOf = (event: any): { id: string; parent_id?: string | null; } | null =>
    event?.channel?.id ? event.channel : event?.id && "parent_id" in event ? event : null;

export default definePlugin({
    name: "CategoryChannelGreeter",
    description: "When a new channel appears in a category you choose, waits for a member or bot you pick (or anyone) to post, then replies with one of your greetings — several greeters at once, with variables, a delay, and a log of what it sent.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openGreeter(),

    flux: {
        CHANNEL_CREATE(event: any) {
            if (!settings.store.active) return;
            const channel = channelOf(event);
            if (!channel?.parent_id) return;
            const rule = getRules().find(r => r.on && r.categoryId === channel.parent_id);
            if (!rule) return;
            if (rule.trigger === "nobody") { greet(rule, channel.id); return; }
            stopWatching(channel.id);
            const minutes = Number(settings.store.watchMinutes) || 30;
            const since = Date.now();
            const timer = setTimeout(() => stopWatching(channel.id), minutes * 60_000);
            watching.set(channel.id, { channelId: channel.id, ruleId: rule.id, since, until: since + minutes * 60_000, timer });
            changed();
        },

        MESSAGE_CREATE({ message, optimistic }: any) {
            if (optimistic || !settings.store.active) return;
            const w = watching.get(message.channel_id);
            if (!w) return;
            const rule = getRules().find(r => r.id === w.ruleId);
            if (!rule?.on) return;
            const author = message.author?.id;
            // Your own messages never count.
            if (!author || author === UserStore.getCurrentUser()?.id) return;
            if (rule.trigger === "user" && author !== rule.triggerUserId) return;
            if (rule.keyword.trim() && !String(message.content ?? "").toLowerCase().includes(rule.keyword.trim().toLowerCase())) return;
            stopWatching(message.channel_id);
            greet(rule, message.channel_id, author);
        },
    },

    start() {
        migrate();
        void loadLog();
    },

    stop() {
        for (const w of watching.values()) clearTimeout(w.timer);
        watching.clear();
        for (const t of pendingSends) clearTimeout(t);
        pendingSends.clear();
    },
});
