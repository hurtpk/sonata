/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, ContextMenuApi, FluxDispatcher, IconUtils, Menu, MessageActions,MessageStore, React, SelectedChannelStore, UserStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";

const PrivateChannelSortStore = findByPropsLazy("getPrivateChannelIds");

let patched = false;
const openedHiddenChannels = new Set<string>();
let origGetMessages: ((channelId: string) => any) | null = null;
let origGetPrivateChannelIds: (() => string[]) | null = null;

const settings = defineFeatureSettings("stealth", {
    // Was the dock icon's left-click. Flipping it here now does everything
    // the dock/keybind toggle does (not just a redraw like before).
    active: {
        type: OptionType.BOOLEAN,
        description: "Stealth mode active.",
        default: true,
        onChange: (on: boolean) => { try { applyStealthActive(on); } catch { } },
    },
    // The hidden list used to live in the dock icon's right-click menu.
    hiddenList: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <HiddenListPanel />,
    },
    hiddenIds: {
        type: OptionType.STRING,
        description: "Hidden channel and user IDs separated by comma.",
        default: "",
    },
    keybind: {
        type: OptionType.STRING,
        description: "Keybind to toggle Stealth.",
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

function getHiddenSet(): Set<string> {
    return new Set(settings.store.hiddenIds.split(",").map(s => s.trim()).filter(Boolean));
}

function isHidden(channelId: string): boolean {
    const hidden = getHiddenSet();
    if (hidden.size === 0) return false;
    const ch = ChannelStore.getChannel(channelId);
    if (!ch || ch.guild_id) return false;
    if (hidden.has(channelId)) return true;
    if (ch.isGroupDM?.()) return false;
    const recipientId = ch.getRecipientId?.();
    return recipientId != null && hidden.has(recipientId);
}

function resolveTargetChannelId(id: string): string | null {
    const ch = ChannelStore.getChannel(id);
    if (ch) return id;
    return ChannelStore.getDMFromUserId?.(id) ?? null;
}

function addHidden(id: string) {
    const set = getHiddenSet();
    set.add(id);
    settings.store.hiddenIds = [...set].join(",");
    if (!settings.store.active) return;
    const targetChannelId = resolveTargetChannelId(id);
    if (targetChannelId) {
        clearStoredMessages(targetChannelId);
        if (SelectedChannelStore.getChannelId?.() === targetChannelId) {
            try {
                FluxDispatcher.dispatch({ type: "CHANNEL_SELECT", channelId: targetChannelId, guildId: null });
            } catch { }
        }
    }
}

function removeHidden(id: string) {
    const set = getHiddenSet();
    set.delete(id);
    openedHiddenChannels.delete(id);
    settings.store.hiddenIds = [...set].join(",");
    if (!settings.store.active) return;
    const targetChannelId = resolveTargetChannelId(id);
    if (targetChannelId) {
        try { MessageActions.fetchMessages({ channelId: targetChannelId }); } catch { }
        if (SelectedChannelStore.getChannelId?.() === targetChannelId) {
            try {
                FluxDispatcher.dispatch({ type: "CHANNEL_SELECT", channelId: targetChannelId, guildId: null });
            } catch { }
        }
    }
}

function isIdHidden(id: string): boolean {
    return getHiddenSet().has(id);
}

function getHiddenUserIds(): Set<string> {
    const hidden = getHiddenSet();
    const userIds = new Set<string>();
    for (const id of hidden) {
        const ch = ChannelStore.getChannel(id);
        const recipientId = ch?.getRecipientId?.();
        if (recipientId) userIds.add(recipientId);
        else if (!ch) userIds.add(id);
    }
    return userIds;
}

function isUserHidden(userId: string): boolean {
    return getHiddenUserIds().has(userId);
}

function createEmptyMessages(channelId: string): any {
    const empty: any[] = [];
    return {
        channelId, ready: true, cached: false, hasFetched: true, error: false,
        hasMoreBefore: false, hasMoreAfter: false, loadingMore: false,
        jumpType: "INSTANT", jumpTargetId: null, jumpTargetOffset: 0,
        jumpSequenceId: 0, jumped: false, jumpedToPresent: true, jumpFlash: false,
        jumpReturnTargetId: null, focusTargetId: null, focusSequenceId: 0,
        initialScrollSequenceId: 0, revealedMessageId: null,
        _array: empty, _map: {},
        _before: { _messages: [], _map: {}, _wasAtEdge: true, _isCacheBefore: false },
        _after: { _messages: [], _map: {}, _wasAtEdge: true, _isCacheBefore: false },
        get length() { return 0; },
        last() { return undefined; },
        get() { return undefined; },
        getByIndex() { return undefined; },
        receiveMessage() { return this; },
        findNewest() { return undefined; },
        findOldest() { return undefined; },
        forEach(cb: any) { empty.forEach(cb); },
        map(cb: any) { return empty.map(cb); },
        filter(cb: any) { return empty.filter(cb); },
        toArray() { return []; },
        [Symbol.iterator]() { return empty[Symbol.iterator](); },
    };
}

function patchSortStore() {
    if (origGetPrivateChannelIds) return;
    if (typeof PrivateChannelSortStore?.getPrivateChannelIds !== "function") return;
    const pcsProto = Object.getPrototypeOf(PrivateChannelSortStore);
    origGetPrivateChannelIds = pcsProto.getPrivateChannelIds ?? PrivateChannelSortStore.getPrivateChannelIds;
    const origPcs = origGetPrivateChannelIds!;
    PrivateChannelSortStore.getPrivateChannelIds = function () {
        const ids: string[] = origPcs.call(this);
        if (!settings.store.active) return ids;
        const currentId = SelectedChannelStore.getChannelId?.();
        if (currentId && isHidden(currentId)) openedHiddenChannels.add(currentId);
        const kept: string[] = [];
        const hiddenOpen: string[] = [];
        for (const id of ids) {
            if (!isHidden(id)) { kept.push(id); continue; }
            if (id === currentId || openedHiddenChannels.has(id)) hiddenOpen.push(id);
        }
        return [...hiddenOpen, ...kept];
    };
}

function reinstallMessageWrapper() {
    if (typeof MessageStore?.getMessages !== "function") return;
    if (origGetMessages) {
        try { MessageStore.getMessages = origGetMessages; } catch { }
    }
    origGetMessages = MessageStore.getMessages;
    const origMsg = origGetMessages!;
    MessageStore.getMessages = function (channelId: string) {
        if (settings.store.active && isHidden(channelId)) {
            const real = origMsg.call(this, channelId);
            if (real == null) return createEmptyMessages(channelId);
            try {
                const proto = Object.getPrototypeOf(real);
                const copy = Object.create(proto);
                Object.assign(copy, real);
                copy._array = [];
                copy._map = {};
                if (real._before) copy._before = { ...real._before, _messages: [], _map: {} };
                if (real._after) copy._after = { ...real._after, _messages: [], _map: {} };
                copy.hasMoreBefore = false;
                copy.hasMoreAfter = false;
                copy.loadingMore = false;
                copy.ready = true;
                copy.cached = false;
                copy.hasFetched = true;
                return copy;
            } catch {
                return createEmptyMessages(channelId);
            }
        }
        return origMsg.call(this, channelId);
    };
}

function ensurePatched() {
    patchSortStore();
    reinstallMessageWrapper();
    patched = !!origGetMessages;
    if (patched && origGetPrivateChannelIds) return;
    let tries = 0;
    const id = window.setInterval(() => {
        patchSortStore();
        reinstallMessageWrapper();
        tries++;
        if ((origGetMessages && origGetPrivateChannelIds) || tries > 20) {
            patched = !!origGetMessages;
            window.clearInterval(id);
        }
    }, 250);
}

function onChannelSelect(payload: { channelId?: string; }) {
    const channelId = payload?.channelId;
    if (!channelId || !settings.store.active || !isHidden(channelId)) return;
    clearStoredMessages(channelId);
}

function onLoadMessagesSuccess(payload: { channelId?: string; }) {
    const channelId = payload?.channelId;
    if (!channelId || !settings.store.active || !isHidden(channelId)) return;
    clearStoredMessages(channelId);
}

function onMessageCreate(payload: { channelId?: string; message?: { channel_id?: string; }; }) {
    const channelId = payload?.channelId ?? payload?.message?.channel_id;
    if (!channelId || !settings.store.active || !isHidden(channelId)) return;
    clearStoredMessages(channelId);
}

function onMessageUpdate(payload: { message?: { channel_id?: string; }; }) {
    const channelId = payload?.message?.channel_id;
    if (!channelId || !settings.store.active || !isHidden(channelId)) return;
    clearStoredMessages(channelId);
}

function clearStoredMessages(channelId: string) {
    if (!origGetMessages) return;
    try {
        const cached = origGetMessages.call(MessageStore, channelId);
        if (cached) {
            cached._array = [];
            cached._map = {};
            if (cached._before) { cached._before._messages = []; cached._before._map = {}; }
            if (cached._after) { cached._after._messages = []; cached._after._map = {}; }
            cached.hasMoreBefore = false;
            cached.hasMoreAfter = false;
        }
        try { MessageStore.emitChange(); } catch { }
    } catch { }
}

function unpatchStore() {
    if (origGetPrivateChannelIds) {
        try { delete PrivateChannelSortStore.getPrivateChannelIds; } catch { }
        if (PrivateChannelSortStore.getPrivateChannelIds !== origGetPrivateChannelIds)
            PrivateChannelSortStore.getPrivateChannelIds = origGetPrivateChannelIds;
        origGetPrivateChannelIds = null;
    }
    if (origGetMessages) {
        MessageStore.getMessages = origGetMessages;
        origGetMessages = null;
    }
    patched = false;
}

function refreshRelationships() {
    const hidden = getHiddenUserIds();
    for (const userId of hidden) {
        try {
            FluxDispatcher.dispatch({
                type: "RELATIONSHIP_UPDATE",
                relationship: { type: settings.store.active ? 0 : 1, id: userId }
            });
        } catch { }
    }
}

function refresh() {
    try { PrivateChannelSortStore.emitChange?.(); } catch { }
    try { MessageStore.emitChange?.(); } catch { }
    refreshRelationships();
}

function applyAllHiddenSideEffects() {
    for (const id of getHiddenSet()) {
        const ch = ChannelStore.getChannel(id);
        const channelId = ch ? id : (ChannelStore.getDMFromUserId?.(id) ?? null);
        if (channelId) clearStoredMessages(channelId);
    }
    const currentId = SelectedChannelStore.getChannelId?.();
    if (currentId && isHidden(currentId)) {
        try { FluxDispatcher.dispatch({ type: "CHANNEL_SELECT", channelId: currentId, guildId: null }); } catch { }
    }
}

// Last state the side effects below were run for, so writing the setting and
// its onChange firing for the same change don't do everything twice.
let appliedActive: boolean | null = null;

function applyStealthActive(on: boolean) {
    if (appliedActive === on) return;
    appliedActive = on;
    if (on) {
        ensurePatched();
        applyAllHiddenSideEffects();
    } else {
        openedHiddenChannels.clear();
    }
    refresh();
    if (!on) {
        const channelId = SelectedChannelStore.getChannelId?.();
        if (channelId && isHidden(channelId)) {
            try { MessageActions.fetchMessages({ channelId }); } catch { }
        }
    }
}

function toggleStealth() {
    settings.store.active = !settings.store.active;
    applyStealthActive(settings.store.active);
}

function keybind(e: KeyboardEvent) {
    if (matchKb(e, settings.store.keybind)) {
        e.preventDefault();
        toggleStealth();
    }
}

const GroupDMContext: NavContextMenuPatchCallback = (children, props) => {
    if (!props?.channel?.id) return;
    settings.use(["hiddenIds"]);
    const { id } = props.channel;
    const hidden = isIdHidden(id);
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuCheckboxItem
                id="stealth-hide"
                label="Hide Group DM"
                checked={hidden}
                action={() => {
                    if (hidden) removeHidden(id);
                    else addHidden(id);
                    refresh();
                }}
            />
        </Menu.MenuGroup>
    );
};

function StealthContextMenu() {
    const hidden = [...getHiddenSet()];
    return (
        <Menu.Menu navId="stealth-context" onClose={() => ContextMenuApi.closeContextMenu()}>
            <Menu.MenuItem
                id="stealth-clear"
                label="Clear All"
                color="danger"
                disabled={hidden.length === 0}
                action={() => { settings.store.hiddenIds = ""; refresh(); }}
            />
            <Menu.MenuSeparator />
            <Menu.MenuGroup label="HIDDEN LIST">
                {hidden.length === 0 ? (
                    <Menu.MenuItem id="stealth-empty" label="No users" disabled />
                ) : (
                    hidden.map(id => {
                        const ch = ChannelStore.getChannel(id);
                        const userId = ch?.getRecipientId?.() ?? (ch ? null : id);
                        const user = userId ? UserStore.getUser(userId) : null;
                        const label = ch?.isGroupDM?.() ? "Group DM" : (user?.username ?? id);
                        const src = user ? IconUtils.getUserAvatarURL(user, false, 24) : IconUtils.getDefaultAvatarURL(userId ?? id);
                        return (
                            <Menu.MenuItem
                                key={id}
                                id={`stealth-${id}`}
                                label={label}
                                iconLeft={() => <img src={src} style={{ width: 20, height: 20, borderRadius: "50%" }} />}
                                action={() => { removeHidden(id); refresh(); }}
                            />
                        );
                    })
                )}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

// Stealth's custom interface: the hidden-list menu that used to open from the
// dock icon's right-click. Exposed as openSettingsModal, so a dock button
// added from ChannelSettings' Dock tab opens it at the cursor. It's a context
// menu, so it needs the click for position; without one it opens the
// settings page, which has the same list.
function openStealthMenu(e?: React.MouseEvent) {
    if (e && typeof e.clientX === "number") {
        ContextMenuApi.openContextMenu(e, () => <StealthContextMenu />);
    } else {
        openPluginModal(plugin);
    }
}

function HiddenListPanel() {
    settings.use(["hiddenIds"]);
    const hidden = [...getHiddenSet()];
    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span className="vc-tool-label" style={{ margin: 0 }}>Hidden ({hidden.length})</span>
                <button type="button" className="vc-tool-btn vc-tool-danger" disabled={hidden.length === 0} onClick={() => { settings.store.hiddenIds = ""; refresh(); }}>
                    Clear All
                </button>
            </div>
            {hidden.length === 0 ? (
                <span className="vc-tool-hint" style={{ }}>
                    Nothing hidden. Right-click a user or group DM and choose Hide.
                </span>
            ) : hidden.map(id => {
                const ch = ChannelStore.getChannel(id);
                const userId = ch?.getRecipientId?.() ?? (ch ? null : id);
                const user = userId ? UserStore.getUser(userId) : null;
                const label = ch?.isGroupDM?.() ? "Group DM" : (user?.username ?? id);
                const src = user ? IconUtils.getUserAvatarURL(user, false, 24) : IconUtils.getDefaultAvatarURL(userId ?? id);
                return (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                        <img src={src} style={{ width: 24, height: 24, borderRadius: "50%" }} />
                        <span className="vc-tool-hint" style={{ flex: 1, margin: 0 }}>{label}</span>
                        <button type="button" className="vc-tool-btn" onClick={() => { removeHidden(id); refresh(); }}>
                            Unhide
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

// "Hide <user>" on the user right-click menu. Used to be added through
// PluginDock's shared "Plugins" submenu; Stealth now adds it itself through
// Vencord's context-menu API, next to its existing group DM entry.
const UserContext: NavContextMenuPatchCallback = (children, props) => {
    const userId = props?.user?.id as string | undefined;
    if (!userId) return;
    settings.use(["hiddenIds"]);
    const channelId = ChannelStore.getDMFromUserId(userId);
    const id = channelId ?? userId;
    const name = UserStore.getUser(userId)?.username ?? "User";
    const hidden = isIdHidden(id);
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuCheckboxItem
                id="stealth-hide-user"
                label={`Hide ${name}`}
                checked={hidden}
                action={() => {
                    if (hidden) removeHidden(id);
                    else addHidden(id);
                    refresh();
                }}
            />
        </Menu.MenuGroup>
    );
};

const plugin = definePlugin({
    name: "Stealth",
    description: "Hide DMs from the sidebar. Right-click a user or DM to hide. Toggle visibility with Alt+H.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    openSettingsModal: openStealthMenu,

    isUserHidden,
    isStealthEnabled: () => settings.store.active,

    patches: [
        {
            find: "\"RelationshipStore\"",
            replacement: [
                {
                    match: /isFriend\((\i)\)\{/,
                    replace: "isFriend($1){if($self.isStealthEnabled()&&$self.isUserHidden($1))return false;"
                },
                {
                    match: /getRelationshipType\((\i)\)\{/,
                    replace: "getRelationshipType($1){if($self.isStealthEnabled()&&$self.isUserHidden($1))return 0;"
                },
            ]
        },
    ],

    contextMenus: {
        "gdm-context": GroupDMContext,
        "user-context": UserContext,
    },
    settings,
    start() {
        appliedActive = settings.store.active;
        ensurePatched();
        if (settings.store.active) refreshRelationships();
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", onLoadMessagesSuccess);
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.subscribe("MESSAGE_UPDATE", onMessageUpdate);
        this._onChannelSelect = onChannelSelect;
        this._onLoadMessagesSuccess = onLoadMessagesSuccess;
        this._onMessageCreate = onMessageCreate;
        this._onMessageUpdate = onMessageUpdate;
        const onReady = () => {
            ensurePatched();
            if (settings.store.active) refreshRelationships();
        };
        FluxDispatcher.subscribe("CONNECTION_OPEN", onReady);
        this._onReady = onReady;
        document.addEventListener("keydown", keybind);
    },
    stop() {
        appliedActive = null;
        document.removeEventListener("keydown", keybind);
        if (this._onReady) FluxDispatcher.unsubscribe("CONNECTION_OPEN", this._onReady);
        if (this._onChannelSelect) FluxDispatcher.unsubscribe("CHANNEL_SELECT", this._onChannelSelect);
        if (this._onLoadMessagesSuccess) FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", this._onLoadMessagesSuccess);
        if (this._onMessageCreate) FluxDispatcher.unsubscribe("MESSAGE_CREATE", this._onMessageCreate);
        if (this._onMessageUpdate) FluxDispatcher.unsubscribe("MESSAGE_UPDATE", this._onMessageUpdate);
        unpatchStore();
        refresh();
    },
});

export default plugin;
