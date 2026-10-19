/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Link Cleaner: before a message is sent (or edited), the tracking bits
// sites add to links are removed — ?si= on YouTube and Spotify, utm_…,
// fbclid, Amazon's ref=… and many more — and redirect links (google.com/url,
// l.facebook.com…) are unwrapped to where they really go. Right-click any
// message with links → "Copy clean link" to clean other people's links too.

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { copyWithToast } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, showToast } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { cleanText, cleanUrl } from "./clean";
import { isShortener, startPreview, stopPreview, whereItGoes } from "./preview";

const settings = defineFeatureSettings("linkCleaner", {
    edits: {
        type: OptionType.BOOLEAN,
        description: "Clean links when you edit a message too",
        default: true,
    },
    toast: {
        type: OptionType.BOOLEAN,
        description: "Show a little note when links were cleaned",
        default: false,
    },
    hoverPreview: {
        type: OptionType.BOOLEAN,
        description: "Hover a short link (bit.ly, t.co, tinyurl…) to see where it really goes",
        default: true,
        onChange: (v: boolean) => { stopPreview(); if (v) startPreview(() => !!settings.store.hoverAll); },
    },
    hoverAll: {
        type: OptionType.BOOLEAN,
        description: "Check every link on hover, not just short links (each check contacts that site)",
        default: false,
    },
});

function clean(msg: { content: string; }) {
    if (!msg?.content || !/https?:\/\//.test(msg.content)) return;
    const { text, count } = cleanText(msg.content);
    if (!count) return;
    msg.content = text;
    if (settings.store.toast) showToast(`Cleaned ${count} link${count === 1 ? "" : "s"} 🧹`, "success");
}

const LINK = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?*_~)\]]/g;

const messageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    const links = [...new Set<string>(String(message?.content ?? "").match(LINK) ?? [])];
    const dirty = links.map(l => [l, cleanUrl(l)] as const).filter(([a, b]) => a !== b);
    const short = links.filter(isShortener);
    if (links.length) children.push(
        <Menu.MenuItem id="vc-link-cleaner-where" label={links.length === 1 ? "Where does this link go?" : "Where do these links go?"} action={async () => {
            showToast("Checking…");
            for (const l of (short.length ? short : links).slice(0, 3)) {
                const r = await whereItGoes(l);
                showToast(r.error ? `Couldn't check it: ${r.error}` : `→ ${r.final}`, r.error ? "failure" : "message");
            }
        }} />
    );
    if (!dirty.length) return;
    children.push(
        <Menu.MenuItem
            id="vc-link-cleaner-copy"
            label={dirty.length === 1 ? "Copy clean link" : `Copy ${dirty.length} clean links`}
            action={() => copyWithToast(dirty.map(([, c]) => c).join("\n"), "Clean link copied")}
        />
    );
};

export default definePlugin({
    name: "LinkCleaner",
    description: "Removes tracking from links you send — ?si=, utm_…, fbclid, Amazon's ref=… and more — and unwraps redirect links. Right-click a message → \"Copy clean link\" for other people's links, and hover a short link to see where it really goes.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    contextMenus: { message: messageMenu },

    start() {
        if (settings.store.hoverPreview !== false) startPreview(() => !!settings.store.hoverAll);
    },

    stop() {
        stopPreview();
    },

    onBeforeMessageSend(_channelId: string, msg: { content: string; }) {
        clean(msg);
    },

    onBeforeMessageEdit(_channelId: string, _messageId: string, msg: { content: string; }) {
        if (settings.store.edits) clean(msg);
    },
});
