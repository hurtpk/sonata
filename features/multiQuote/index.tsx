/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, Menu, showToast, useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { getQuotes, hasQuote, MAX_QUOTES, Quoted, subscribe, toggleQuote } from "./basket";
import { openBasket } from "./Panel";

export const settings = defineFeatureSettings("multiQuote", {
    jumpLinks: {
        type: OptionType.BOOLEAN,
        description: "Include a jump link to each quoted message",
        default: true,
    },
    timestamps: {
        type: OptionType.BOOLEAN,
        description: "Include when each message was sent",
        default: true,
    },
    clearAfterInsert: {
        type: OptionType.BOOLEAN,
        description: "Empty the quote basket after inserting",
        default: true,
    },
});

export function QuoteIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="currentColor" aria-hidden>
            <path d="M4.5 6A2.5 2.5 0 0 0 2 8.5v4A2.5 2.5 0 0 0 4.5 15H6v.5A2.5 2.5 0 0 1 3.5 18a1 1 0 1 0 0 2A4.5 4.5 0 0 0 8 15.5v-7A2.5 2.5 0 0 0 5.5 6h-1Zm10 0A2.5 2.5 0 0 0 12 8.5v4a2.5 2.5 0 0 0 2.5 2.5H16v.5a2.5 2.5 0 0 1-2.5 2.5 1 1 0 1 0 0 2 4.5 4.5 0 0 0 4.5-4.5v-7A2.5 2.5 0 0 0 15.5 6h-1Z" />
        </svg>
    );
}

function whereOf(channelId: string) {
    const ch = ChannelStore.getChannel(channelId) as any;
    if (!ch) return "a chat";
    if (ch.isDM?.()) return "DM";
    if (ch.isGroupDM?.()) return ch.name || "group DM";
    return `#${ch.name}`;
}

function toQuoted(m: Message): Quoted {
    const ch = ChannelStore.getChannel(m.channel_id) as any;
    const guildId = ch?.guild_id ?? null;
    const author = m.author as any;
    const nick = guildId ? GuildMemberStore.getNick(guildId, author.id) : null;
    return {
        id: m.id,
        channelId: m.channel_id,
        guildId,
        authorName: nick ?? author.globalName ?? author.global_name ?? author.username ?? "Someone",
        where: whereOf(m.channel_id),
        content: m.content ?? "",
        attachments: (m.attachments?.length ?? 0),
        timestamp: new Date(m.timestamp as any).getTime() || Date.now(),
    };
}

function toggle(m: Message) {
    const adding = !hasQuote(m.id);
    if (!toggleQuote(toQuoted(m))) {
        showToast(`The quote basket holds up to ${MAX_QUOTES} messages`, "failure");
        return;
    }
    if (adding) showToast(`Added to quote (${getQuotes().length})`, "success");
}

function useBasket() {
    const [, force] = useState(0);
    useEffect(() => subscribe(() => force(n => n + 1)), []);
    return getQuotes();
}

// Chat bar: only shows while there's something in the basket.
const QuoteChatBarButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const quotes = useBasket();
    if (!isMainChat || quotes.length === 0) return null;
    return (
        <ChatBarButton tooltip={`${quotes.length} quoted — click to insert or edit`} onClick={() => openBasket(settings)}>
            <span className="vc-mquote-chatbtn">
                <QuoteIcon />
                <span className="vc-mquote-badge">{quotes.length}</span>
            </span>
        </ChatBarButton>
    );
};

const messageMenu: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message?.id) return;
    children.push(
        <Menu.MenuItem
            id="vc-mquote-toggle"
            label={hasQuote(message.id) ? "Remove from quote" : "Add to quote"}
            icon={QuoteIcon}
            action={() => toggle(message)}
        />
    );
};

export default definePlugin({
    name: "MultiQuote",
    description: "Collect several messages — even from different channels — and reply quoting them all at once.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openBasket(settings),

    contextMenus: { "message": messageMenu },

    messagePopoverButton: {
        icon: QuoteIcon,
        render(message: Message) {
            if (!message?.id) return null;
            return {
                label: hasQuote(message.id) ? "Remove from quote" : "Add to quote",
                icon: QuoteIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: () => toggle(message),
            };
        },
    },

    chatBarButton: {
        icon: QuoteIcon,
        render: QuoteChatBarButton,
    },

});
