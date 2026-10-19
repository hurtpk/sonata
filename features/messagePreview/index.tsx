/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, createRoot, MessageStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { PreviewPopover, setPreview } from "./Popover";
import { dmChannelFor, ResolveDeps } from "./resolve";

export const settings = defineFeatureSettings("messagePreview", {
    delay: {
        type: OptionType.SLIDER,
        description: "How long to hover before the preview shows (ms)",
        markers: [0, 150, 300, 500, 800],
        default: 300,
        stickToMarkers: true,
    },
    count: {
        type: OptionType.SLIDER,
        description: "How many recent messages to show",
        markers: [3, 5, 8, 10],
        default: 5,
        stickToMarkers: true,
    },
    showImages: {
        type: OptionType.BOOLEAN,
        description: "Show image thumbnails in the preview",
        default: true,
    },
});

const deps: ResolveDeps = {
    isPrivateChannel(id) {
        const ch = ChannelStore.getChannel(id) as any;
        return !!ch && (ch.isDM?.() || ch.isGroupDM?.());
    },
    dmFromUser: userId => ChannelStore.getDMFromUserId(userId),
};

let anchor: Element | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

const popoverEl = () => container?.querySelector(".vc-dmprev-popover") ?? null;

function hideSoon(ms = 150) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { anchor = null; setPreview(null); }, ms);
}

function hideNow() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    anchor = null;
    setPreview(null);
}

function onOver(e: MouseEvent) {
    const hit = dmChannelFor(e.target as Element, deps);
    if (!hit) return;
    clearTimeout(hideTimer);
    if (hit.anchor === anchor) return;
    anchor = hit.anchor;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
        if (anchor !== hit.anchor) return;
        setPreview({ channelId: hit.channelId, rect: hit.anchor.getBoundingClientRect() });
    }, settings.store.delay);
}

function onOut(e: MouseEvent) {
    if (!anchor || !anchor.contains(e.target as Node)) return;
    const to = e.relatedTarget as Node | null;
    if (to && (anchor.contains(to) || popoverEl()?.contains(to))) return;
    hideSoon();
}

function onDown(e: MouseEvent) {
    if (!popoverEl()?.contains(e.target as Node)) hideNow();
}

function Mounted() {
    const { count, showImages } = settings.use(["count", "showImages"]);
    return (
        <PreviewPopover
            count={count}
            showImages={showImages}
            messageStore={MessageStore}
            onEnter={() => clearTimeout(hideTimer)}
            onLeave={() => hideSoon()}
        />
    );
}

export default definePlugin({
    name: "MessagePreview",
    description: "Hover a DM in the server list (the unread bubbles with counts) to read what they sent without opening it — nothing gets marked as read.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    start() {
        container = document.createElement("div");
        container.id = "vc-dmprev-root";
        document.body.appendChild(container);
        root = createRoot(container);
        root.render(<ErrorBoundary noop><Mounted /></ErrorBoundary>);

        document.addEventListener("mouseover", onOver, { passive: true });
        document.addEventListener("mouseout", onOut, { passive: true });
        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("scroll", hideNow, { capture: true, passive: true });
        window.addEventListener("blur", hideNow);
    },

    stop() {
        document.removeEventListener("mouseover", onOver);
        document.removeEventListener("mouseout", onOut);
        document.removeEventListener("mousedown", onDown, true);
        document.removeEventListener("scroll", hideNow, true);
        window.removeEventListener("blur", hideNow);
        hideNow();
        root?.unmount();
        container?.remove();
        root = null;
        container = null;
    },
});
