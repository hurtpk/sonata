/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconProps, OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import { openCharacters } from "./Panel";

const MAX_RECENT = 32;

export const settings = defineFeatureSettings("charactersPicker", {
    recent: {
        type: OptionType.STRING,
        description: "Internal: characters picked lately (JSON).",
        default: "[]",
        hidden: true,
    },
});

/** Characters picked lately, newest first (shared with Embed Sender's picker). */
export function recent(): string[] {
    try { const r = JSON.parse(settings.store.recent || "[]"); return Array.isArray(r) ? r.filter(x => typeof x === "string") : []; } catch { return []; }
}

export function remember(ch: string) {
    const next = [ch, ...recent().filter(x => x !== ch)].slice(0, MAX_RECENT);
    settings.store.recent = JSON.stringify(next);
    return next;
}

const open = () => openCharacters(recent(), remember);

/** The picker for another text box: picked characters go to insert() instead of the chat box. */
export const pickCharacters = (insert: (ch: string) => void, target?: string) => openCharacters(recent(), remember, insert, target);

export function CharactersIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" />
            <path d="M3 21h4M10 21h4M17 21h4" />
        </svg>
    );
}

const CharactersChatBarButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton tooltip="Characters" onClick={open}>
            <CharactersIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "CharactersPicker",
    description: "A chat bar picker with over 1,000 characters — aesthetic symbols, decorations and dividers, stars and flowers, shapes and box lines, numbers, music notation, chess, dice and zodiac, arrows, maths, currency and kaomoji. Searchable, and it remembers the ones you pick.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: open,

    chatBarButton: {
        icon: CharactersIcon,
        render: CharactersChatBarButton,
    },
});
