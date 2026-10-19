/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Quick Text: save text you type a lot and use it by typing ;word. Snippets
// can fill in the date, time, your name, what you copied or a random pick by
// themselves, and ask you for blanks like {name} before they go in.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { IconProps } from "@utils/types";
import { ComponentDispatch } from "@webpack/common";

import { blanksOf, fill, loadSnippets, replaceTriggers, Snippet, triggersIn, used } from "./expand";
import { askBlanks, openQuickText } from "./Panel";

/** Each snippet's finished text, with the same answers for the same blanks. */
const fillAll = async (found: Snippet[], values: Record<string, string> = {}) =>
    new Map(await Promise.all(found.map(async s => [s.id, await fill(s.text, values)] as [string, string])));

export function QuickTextIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5zM7 9h.01M11 9h.01M15 9h.01M7 13h10M12 20l1.5-3" />
        </svg>
    );
}

const QuickTextButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="Quick Text" onClick={openQuickText}><QuickTextIcon /></ChatBarButton>
    : null;

export default definePlugin({
    name: "QuickText",
    description: "Save text you type a lot and use it by typing ;word — addresses, greetings, rules, links. Snippets can fill in {date}, {time}, {day}, {me}, {clipboard} or {random:a|b} by themselves, and ask you for blanks like {name}.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: openQuickText,
    chatBarButton: { icon: QuickTextIcon, render: QuickTextButton },

    async onBeforeMessageSend(_channelId: string, msg: { content: string; }) {
        if (!msg?.content?.includes(";")) return;
        const found = triggersIn(msg.content);
        if (!found.length) return;
        const original = msg.content;
        const blanks = [...new Set(found.flatMap(s => blanksOf(s.text)))];
        // Blanks to fill in: hold the message, ask, then put the finished text back in the box for you to send.
        if (blanks.length) {
            askBlanks(blanks, async v => replaceTriggers(original, await fillAll(found, v)), async v => {
                const result = replaceTriggers(original, await fillAll(found, v));
                ComponentDispatch?.dispatchToLastSubscribed?.("CLEAR_TEXT");
                setTimeout(() => insertTextIntoChatInputBox(result), 0);
                found.forEach(s => used(s.id));
            });
            return { cancel: true };
        }
        msg.content = replaceTriggers(msg.content, await fillAll(found));
        found.forEach(s => used(s.id));
    },

    start() {
        void loadSnippets();
    },
});
