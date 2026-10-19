/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openTimeline } from "./Panel";
import { endSession, getCurrent, handleVoiceStates, reset, startSession, VoiceStateLike } from "./tracker";

const settings = defineFeatureSettings("voiceTimeline", {
    openWindow: {
        type: OptionType.COMPONENT,
        component: () => <button type="button" className="vc-tool-btn" onClick={openTimeline}>Open Voice Timeline</button>,
    },
});

const myId = () => UserStore.getCurrentUser()?.id;
const occupantsOf = (channelId: string) => Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {});

// Right-click the voice channel you're in → "Voice timeline".
const channelMenu: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel?.id || channel.id !== getCurrent()?.channelId) return;
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem id="vc-vtl-open" label="Voice timeline" action={openTimeline} />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "VoiceTimeline",
    description: "Live timeline of your voice channel: who joined, left or moved, when, and how long everyone's been there. Keeps your last 10 calls.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    // ChannelSettings' Dock tab opens this window from a dock button.
    openSettingsModal: () => openTimeline(),

    contextMenus: {
        "channel-context": channelMenu,
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceStateLike[]; }) {
            const me = myId();
            if (me) handleVoiceStates(voiceStates ?? [], me, occupantsOf);
        },
    },

    start() {
        // Already in a call when the plugin starts: track from now on.
        const me = myId();
        const channelId = SelectedChannelStore.getVoiceChannelId();
        if (me && channelId) startSession(channelId, me, occupantsOf(channelId), Date.now(), true);
    },

    stop() {
        const me = myId();
        if (me) endSession(me);
        reset();
    },
});
