/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu, React, showToast } from "@webpack/common";
import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings, isFeatureRunning } from "../../featureSettings";
import { cleanText } from "../linkCleaner/clean";
import { fixLinks, SERVICES, Targets } from "./fixer";

export const settings = defineFeatureSettings("linkEmbedFixer", {
    videoOnly: {
        type: OptionType.BOOLEAN,
        description: "Video only: X/Twitter, TikTok and Bluesky links show just the video or picture, without the post around it (Instagram and Reddit keep their normal preview, which already plays videos)",
        default: false,
    },
    ...Object.fromEntries(SERVICES.map(s => [s.id, {
        type: OptionType.STRING,
        description: `${s.label} links are sent through this site so they show a proper preview (leave empty to send them as they are)`,
        default: s.fallback,
    }])) as Record<string, { type: OptionType.STRING; description: string; default: string; }>,
});

const targets = (): Targets => Object.fromEntries(SERVICES.map(s => [s.id, (settings.store as any)[s.id] ?? ""]));
export const fixOutgoing = (text: string) => fixLinks(text, targets(), !!settings.store.videoOnly);

const previewLinks: NavContextMenuPatchCallback = (children, { message }) => {
    const text = message?.content;
    if (typeof text !== "string" || !text.includes("://")) return;
    const cleaned = isFeatureRunning("linkCleaner") ? cleanText(text).text : text;
    const final = fixOutgoing(cleaned);
    if (text === final) return;
    const links = [...new Set(final.match(/https?:\/\/[^\s<>()]+[^\s<>().,!?:;'"\]]/g) ?? [])];
    if (links.length) children.push(React.createElement(Menu.MenuItem, {
        id: "vc-link-tools-final",
        label: "Preview outgoing links",
        action: () => { for (const link of links.slice(0, 3)) showToast(link); },
    }));
};

export default definePlugin({
    name: "LinkEmbedFixer",
    description: "Switches Twitter/X, Instagram, TikTok, Reddit and Bluesky links to embed-friendly versions as you send them, so they show a proper preview. Links in code or <angle brackets> are left alone.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    contextMenus: { message: previewLinks },
});
