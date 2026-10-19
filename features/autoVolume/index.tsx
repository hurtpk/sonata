/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Auto Volume Balance: everyone in your call at a comfortable volume — a set
// volume when they join, quiet and loud people evened out as they talk, and
// a local mute for anyone who's way too loud. See balancer.ts.

import "../_shared/tool.css";
import "./styles.css";

import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import { BalancerSettings, onLocalVolume, onVoiceStates, startBalancer, stopBalancer } from "./balancer";
import { openAutoVolume } from "./Panel";

export const settings = defineFeatureSettings("autoVolume", {
    setOnJoin: {
        type: OptionType.BOOLEAN,
        description: "Set people to a starting volume when they join your call (and everyone there when you join)",
        default: true,
    },
    joinEveryTime: {
        type: OptionType.SELECT,
        description: "Use the starting volume",
        options: [
            { label: "Only the first time Sonata hears someone (keeps their volume after that)", value: false, default: true },
            { label: "Every time they join a call", value: true },
        ],
    },
    joinVolume: {
        type: OptionType.SLIDER,
        description: "Starting volume, as Discord's volume slider shows it (100 is Discord's normal)",
        markers: [0, 25, 50, 75, 100, 125, 150, 175, 200],
        default: 100,
        stickToMarkers: false,
    },
    balance: {
        type: OptionType.BOOLEAN,
        description: "Even out loud and quiet people while they talk",
        default: true,
    },
    target: {
        type: OptionType.SELECT,
        description: "How loud everyone should end up",
        options: [
            { label: "Soft", value: -18 },
            { label: "Normal", value: -13, default: true },
            { label: "Loud", value: -9 },
        ],
    },
    minVolume: {
        type: OptionType.SLIDER,
        description: "Never turn anyone below",
        markers: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        default: 20,
        stickToMarkers: true,
    },
    maxVolume: {
        type: OptionType.SLIDER,
        description: "Never turn anyone above",
        markers: [100, 125, 150, 175, 200],
        default: 200,
        stickToMarkers: true,
    },
    muteTooLoud: {
        type: OptionType.BOOLEAN,
        description: "Mute people who are WAY too loud (clipping / ear-rape) — only for you",
        default: true,
    },
    tooLoud: {
        type: OptionType.SELECT,
        description: "Way too loud means",
        options: [
            { label: "Only complete ear-rape (recommended)", value: "smart", default: true },
            { label: "Ear-rape and blasted music or soundboard (can also catch nonstop shouting)", value: "smartMusic" },
            { label: "Anything clipping for a moment", value: -1.2 },
            { label: "Only extreme distortion", value: -0.3 },
            { label: "My own limit (set below)", value: "custom" },
        ],
    },
    customLoud: {
        type: OptionType.SLIDER,
        description: "Your limit, in dB below the loudest a mic can go (0 dB = maxed out and distorting; talking is about -20 to -10, shouting -6 to -3). The Auto Volume window shows everyone's level live.",
        markers: [-24, -20, -16, -12, -9, -6, -3, -1, 0],
        default: -3,
        stickToMarkers: false,
        hidden: () => settings.store.tooLoud !== "custom",
    },
    tooLoudFor: {
        type: OptionType.SELECT,
        description: "...for at least",
        hidden: () => settings.store.tooLoud === "smart" || settings.store.tooLoud === "smartMusic",
        options: [
            { label: "1 second", value: 1 },
            { label: "2.5 seconds", value: 2.5, default: true },
            { label: "5 seconds", value: 5 },
        ],
    },
    spareFriends: {
        type: OptionType.BOOLEAN,
        description: "Never auto-mute my friends",
        default: false,
    },
    unmuteAfter: {
        type: OptionType.SELECT,
        description: "Unmute them again after",
        options: [
            { label: "15 seconds", value: 15 },
            { label: "30 seconds", value: 30, default: true },
            { label: "1 minute", value: 60 },
            { label: "5 minutes", value: 300 },
            { label: "Never (unmute them yourself)", value: 0 },
        ],
    },
    leaveManual: {
        type: OptionType.BOOLEAN,
        description: "Leave alone anyone whose volume you set yourself",
        default: true,
    },
});

/** The loudness (dB below maximum) that counts as way too loud. */
export const tooLoudLimit = (): number | "smart" | "smartMusic" => settings.store.tooLoud === "smart" || settings.store.tooLoud === "smartMusic" ? settings.store.tooLoud : settings.store.tooLoud === "custom" ? Math.min(0, Number(settings.store.customLoud)) : Number(settings.store.tooLoud);

const current = (): BalancerSettings => {
    const s = settings.store;
    return {
        setOnJoin: s.setOnJoin, joinEveryTime: !!s.joinEveryTime, joinVolume: s.joinVolume, balance: s.balance, target: Number(s.target),
        minVolume: Math.min(s.minVolume, s.maxVolume), maxVolume: Math.max(s.minVolume, s.maxVolume),
        muteTooLoud: s.muteTooLoud, tooLoud: tooLoudLimit(), tooLoudFor: Number(s.tooLoudFor) || 2.5, spareFriends: s.spareFriends,
        unmuteAfter: Number(s.unmuteAfter), leaveManual: s.leaveManual,
    };
};

export default definePlugin({
    name: "AutoVolumeBalance",
    description: "Keeps everyone in your call at a comfortable volume: a starting volume when they join, loud and quiet people evened out as they talk, and an automatic (local) mute for anyone who's way too loud. Only changes what you hear.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openAutoVolume(),

    flux: {
        VOICE_STATE_UPDATES: onVoiceStates,
        VOICE_CHANNEL_SELECT: () => void setTimeout(onVoiceStates, 300),
        AUDIO_SET_LOCAL_VOLUME: onLocalVolume,
    },

    start() {
        void startBalancer(current);
    },

    stop() {
        stopBalancer();
    },
});
