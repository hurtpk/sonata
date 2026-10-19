/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, ContextMenuApi, FluxDispatcher, Menu, React, showToast, UserStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";

const { toggleSelfMute } = findByPropsLazy("toggleSelfMute");
const { toggleSelfDeaf } = findByPropsLazy("toggleSelfDeaf");
const VoiceStateStore = findByPropsLazy("getVoiceStateForUser");
const StreamStore = findByPropsLazy("getAnyStreamForUser");
const settings = defineFeatureSettings("fakedeafen", {
    // Fake Screenshare used to be reachable only from the dock icon's
    // right-click menu, so it gets a button here on the settings page too.
    quickActions: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <QuickActions />,
    },
    enableFakeDeafen: {
        description: "Enable or disable fake deafen.",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: () => { try { applyFakeDeaf(); } catch { } },
    },
    enableFakeMute: {
        description: "Enable or disable fake mute.",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: () => { try { applyFakeMute(); } catch { } },
    },
    enableFakeVideo: {
        description: "Enable or disable fake camera.",
        type: OptionType.BOOLEAN,
        default: true,
    },
    deafenKeybind: {
        description: "Keybind to toggle fake deafen.",
        type: OptionType.STRING,
        default: "",
    },
    muteKeybind: {
        description: "Keybind to toggle fake mute.",
        type: OptionType.STRING,
        default: "",
    },
});

function matchKb(e: KeyboardEvent, str: string): boolean {
    if (!str) return false;
    let ctrl = false, alt = false, shift = false, meta = false, key = "";
    for (const p of str.split("+").map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (p === "ctrl" || p === "control") ctrl = true;
        else if (p === "alt") alt = true;
        else if (p === "shift") shift = true;
        else if (p === "meta" || p === "cmd" || p === "super") meta = true;
        else key = p;
    }
    return !!key && ctrl === e.ctrlKey && alt === e.altKey && shift === e.shiftKey && meta === e.metaKey && e.key.toLowerCase() === key;
}

function BXaaaxFOZH(e) {
    if (matchKb(e, settings.store.deafenKeybind)) {
        settings.store.enableFakeDeafen = !settings.store.enableFakeDeafen;
        showToast(`Fake deafen is now: ${settings.store.enableFakeDeafen ? "disabled" : "enabled"}`, "failure");
        toggleSelfDeaf();
        toggleSelfDeaf();
    }
}

function ZGhRbNJztb(e) {
    if (matchKb(e, settings.store.muteKeybind)) {
        settings.store.enableFakeMute = !settings.store.enableFakeMute;
        showToast(`Fake mute is now: ${settings.store.enableFakeMute ? "disabled" : "enabled"}`, "failure");
        toggleSelfMute();
        toggleSelfMute();
    }
}

function applyFakeDeaf() {
    toggleSelfDeaf();
    toggleSelfDeaf();
}

function applyFakeMute() {
    toggleSelfMute();
    toggleSelfMute();
}

function applyFakeVideo() {
    toggleSelfDeaf();
    toggleSelfDeaf();
}

function toggleFakeStream() {
    const me = UserStore.getCurrentUser();
    const vs = VoiceStateStore.getVoiceStateForUser(me?.id);
    if (!vs?.channelId) return;

    const existing = StreamStore.getAnyStreamForUser(me.id);
    if (existing) {
        FluxDispatcher.dispatch({ type: "STREAM_CLOSE", streamKey: `guild:${vs.guildId ?? ""}:${vs.channelId}:${me.id}` });
        return;
    }

    const channel = ChannelStore.getChannel(vs.channelId);
    FluxDispatcher.dispatch({
        type: "STREAM_START",
        streamType: "guild",
        guildId: channel?.guild_id,
        channelId: vs.channelId,
    });
}

function FakeDeafenContextMenu() {
    const [, forceUpdate] = React.useState(0);
    return (
        <Menu.Menu navId="fakedeafen-menu" onClose={() => ContextMenuApi.closeContextMenu()}>
            <Menu.MenuGroup label="FAKE STATES">
                <Menu.MenuCheckboxItem
                    id="fake-deafen"
                    label="Fake Deafen"
                    checked={!settings.store.enableFakeDeafen}
                    action={() => {
                        settings.store.enableFakeDeafen = !settings.store.enableFakeDeafen;
                        applyFakeDeaf();
                        forceUpdate(n => n + 1);
                    }}
                />
                <Menu.MenuCheckboxItem
                    id="fake-mute"
                    label="Fake Mute"
                    checked={!settings.store.enableFakeMute}
                    action={() => {
                        settings.store.enableFakeMute = !settings.store.enableFakeMute;
                        applyFakeMute();
                        forceUpdate(n => n + 1);
                    }}
                />
                <Menu.MenuCheckboxItem
                    id="fake-video"
                    label="Fake Camera"
                    checked={!settings.store.enableFakeVideo}
                    action={() => {
                        settings.store.enableFakeVideo = !settings.store.enableFakeVideo;
                        applyFakeVideo();
                        forceUpdate(n => n + 1);
                    }}
                />
                <Menu.MenuItem
                    id="fake-stream"
                    label="Fake Screenshare"
                    action={() => {
                        toggleFakeStream();
                        forceUpdate(n => n + 1);
                    }}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function QuickActions() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <button type="button" className="vc-tool-btn" onClick={toggleFakeStream}>Toggle Fake Screenshare</button>
            <span className="vc-tool-hint" style={{ margin: 0 }}>
                Only works while you're in a voice channel.
            </span>
        </div>
    );
}

// FakeDeafen's custom interface: the quick menu (fake deafen / mute /
// camera checkboxes + Fake Screenshare) that used to open from the dock
// icon's right-click. Exposed as openSettingsModal, the hook ChannelSettings
// looks for, so a dock button added from its Dock tab opens this menu at the
// cursor. It's a context menu, so it needs the click event for position;
// when opened without one, it falls back to the settings page.
function openFakeDeafenMenu(e?: React.MouseEvent) {
    if (e && typeof e.clientX === "number") {
        ContextMenuApi.openContextMenu(e, () => <FakeDeafenContextMenu />);
    } else {
        openPluginModal(plugin);
    }
}

const plugin = definePlugin({
    name: "FakeDeafen",
    description: "Fake deafen, mute, camera, and screenshare. Ctrl+L for deafen, Ctrl+J for mute.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: openFakeDeafenMenu,

    state: (type: string, real: boolean) => {
        if (type === "mute" && !settings.store.enableFakeMute) return true;
        if (type === "deafen" && !settings.store.enableFakeDeafen) return true;
        if (type === "video" && !settings.store.enableFakeVideo) return true;
        return real;
    },

    patches: [
        {
            find: "}voiceStateUpdate(",
            replacement: {
                match: /self_mute:(\i),self_deaf:(\i),self_video:(\i),flags:(\i)\}/,
                replace: "self_mute:$self.state('mute',$1),self_deaf:$self.state('deafen',$2),self_video:$self.state('video',$3),flags:$4}",
            }
        },
    ],

    start() {
        document.addEventListener("keydown", BXaaaxFOZH);
        document.addEventListener("keydown", ZGhRbNJztb);
    },
    stop() {
        document.removeEventListener("keydown", BXaaaxFOZH);
        document.removeEventListener("keydown", ZGhRbNJztb);
    },
});

export default plugin;
