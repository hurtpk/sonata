/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyWithToast, insertTextIntoChatInputBox, openUserProfile } from "@utils/discord";
import { saveFile } from "@utils/web";
import { Alerts, ChannelStore, closeAllModals, FluxDispatcher, GuildStore, IconUtils, NavigationRouter, openModal, showToast, UserStore } from "@webpack/common";

import { windowAccent } from "../../../../controller/accent";
import { db, deleteMessagesBulkIDB, initIDB } from "../../db";
import { autoCleanup, clearLogs } from "../../index";
import { dropMeta, loadMeta, setMeta } from "../../meta";
import { settings } from "../../settings";
import { addToXAndRemoveFromOpposite, removeFromX } from "../../utils";
import { deleteMessageImages } from "../../utils/saveImage";
import { getImage } from "../../utils/saveImage/ImageManager";
import { importLogs } from "../../utils/settingsUtils";
import { setWatched, watchedIds } from "../../watch";
import { LMessage } from "../LogsModal";
import { Backend } from "./bits";
import { Entry, LogRecord, Media } from "./data";
import { Explorer } from "./Explorer";

async function localBlob(att: any): Promise<Blob | null> {
    if (!att?.id) return null;
    const data = await getImage(att.id, att.fileExtension);
    if (!data) return null;
    return new Blob([data], { type: att.content_type?.split(";")[0] || "" });
}

// Discord's message look changes the message it's given, so it gets its own copy.
const copies = new WeakMap<object, any>();
const copyOf = (m: any) => { let c = copies.get(m); if (!c) { c = structuredClone(m); copies.set(m, c); } return c; };

const backend: Backend = {
    async load() {
        await initIDB();
        return await db.getAll("messages") as LogRecord[];
    },
    async remove(records) {
        await deleteMessagesBulkIDB(records.map(r => r.message_id));
        for (const r of records) await deleteMessageImages(r.message).catch(() => { });
        await dropMeta(records.map(r => r.message_id));
    },
    meta: () => loadMeta(),
    setMeta: (id, patch) => setMeta(id, patch),
    ignored: () => (settings.store.blacklistedIds || "").split(",").map(x => x.trim()).filter(Boolean),
    setIgnored: (id, off) => { if (off) addToXAndRemoveFromOpposite("blacklistedIds", id); else removeFromX("blacklistedIds", id); },
    watched: () => watchedIds(),
    setWatched: (id, on) => setWatched(id, on),
    cleanupDays: () => settings.store.autoDeleteDays ?? 0,
    setCleanupDays: days => { settings.store.autoDeleteDays = days; },
    cleanupNow: days => autoCleanup(days),
    describe(id) {
        const g: any = GuildStore.getGuild(id);
        if (g) return { name: g.name, kind: "Server", icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=64` : null };
        const c: any = ChannelStore.getChannel(id);
        if (c) { const u: any = c.type === 1 ? UserStore.getUser(c.recipients?.[0]) : null; return { name: u ? `DMs with ${u.globalName ?? u.username}` : c.name ? `#${c.name}` : "Group DM", kind: "Channel", icon: null }; }
        const u: any = UserStore.getUser(id);
        if (u) return { name: u.globalName ?? u.username, kind: "Person", icon: IconUtils.getUserAvatarURL(u, false, 64) };
        return { name: "Unknown", kind: "ID", icon: null };
    },
    clearAll: () => clearLogs(false),
    async localUrl(att) {
        const blob = await localBlob(att);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        return { url, revoke: () => URL.revokeObjectURL(url) };
    },
    async download(media: Media) {
        try {
            const blob = media.saved ? await localBlob(media.att) : await fetch(media.url).then(r => r.ok ? r.blob() : null);
            if (!blob) throw new Error("gone");
            saveFile(new File([blob], media.name.replace(/^SPOILER_/, ""), { type: blob.type }));
        } catch {
            showToast(media.saved ? "Couldn't read the saved copy" : "Discord has removed this file, and no copy was saved", "failure");
        }
    },
    jump(e: Entry) {
        closeAllModals();
        NavigationRouter.transitionTo(`/channels/${e.place.guildId ?? "@me"}/${e.channelId}/${e.id}`);
    },
    profile(id) {
        closeAllModals();
        openUserProfile(id).catch(() => showToast("Couldn't open that profile", "failure"));
    },
    quote(text) {
        closeAllModals();
        insertTextIntoChatInputBox(`${(text || "(no text)").split("\n").map(l => `> ${l}`).join("\n")}\n`);
    },
    copy: text => copyWithToast(text),
    save: (name, type, data) => saveFile(new File([data], name, { type })),
    confirm: (title, body, ok, onOk) => Alerts.show({ title, body, confirmText: ok, cancelText: "Cancel", confirmVariant: "critical-primary", onConfirm: onOk }),
    toast: (text, ok = true) => showToast(text, ok ? "success" : "failure"),
    watch(cb) {
        const onDelete = () => cb();
        const onUpdate = (p: any) => { if (p?.message?.edited_timestamp && p.message.content != null) cb(); };
        FluxDispatcher.subscribe("MESSAGE_DELETE", onDelete);
        FluxDispatcher.subscribe("MESSAGE_DELETE_BULK", onDelete);
        FluxDispatcher.subscribe("MESSAGE_UPDATE", onUpdate);
        return () => {
            FluxDispatcher.unsubscribe("MESSAGE_DELETE", onDelete);
            FluxDispatcher.unsubscribe("MESSAGE_DELETE_BULK", onDelete);
            FluxDispatcher.unsubscribe("MESSAGE_UPDATE", onUpdate);
        };
    },
    storage: async () => {
        const s = await navigator.storage?.estimate?.();
        return s ? { usage: s.usage ?? 0, quota: s.quota ?? 0 } : null;
    },
    importOld: () => importLogs(),
    discordView: (e, groupStart) => <LMessage log={{ message: copyOf(e.m) }} isGroupStart={groupStart} reset={() => { }} />,
};

export function openExplorer(initialQuery?: string) {
    openModal(props => <Explorer modalProps={props} backend={backend} initialQuery={initialQuery} accent={windowAccent("messageLoggerEnhanced")} />);
}
