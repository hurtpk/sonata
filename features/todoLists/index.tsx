/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// To-do Lists: a checklist for each channel or DM ("stuff to bring
// Saturday"), opened from the chat bar — which shows how many are left —
// or filled from messages with right-click → Add to to-do list.

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps } from "@utils/types";
import { Menu, SelectedChannelStore, showToast, useStateFromStores } from "@webpack/common";

import { openTodo, useTodos } from "./Panel";
import { addItem, loadTodos, openCount } from "./store";

export function TodoIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11 7h9M11 13h9M11 19h9" />
        </svg>
    );
}

const TodoButton: ChatBarButtonFactory = ({ isMainChat }) => {
    useTodos();
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    if (!isMainChat) return null;
    const n = openCount(channelId);
    return (
        <ChatBarButton tooltip={n ? `To-do · ${n} left` : "To-do list"} onClick={() => openTodo(channelId ?? null)}>
            <span className="vc-todo-btn">
                <TodoIcon />
                {n > 0 && <span className="vc-todo-badge">{n > 99 ? "99+" : n}</span>}
            </span>
        </ChatBarButton>
    );
};

const messageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    if (!message?.channel_id) return;
    const text = (message.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "That message";
    children.push(
        <Menu.MenuItem id="vc-todo-add" label="Add to to-do list" action={() => {
            addItem(message.channel_id, text, { messageId: message.id, author: message.author?.globalName || message.author?.username });
            showToast("Added to this chat's to-do list", "success");
        }} />
    );
};

export default definePlugin({
    name: "TodoLists",
    description: "A to-do checklist for each channel or DM — \"stuff to bring Saturday\". Open it from the chat bar (it shows how many are left), right-click messages to add them, drag to reorder, share the list in chat, and set reminders on items.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openTodo(SelectedChannelStore.getChannelId() ?? null),
    contextMenus: { message: messageMenu },
    chatBarButton: { icon: TodoIcon, render: TodoButton },

    start() { void loadTodos(); },
});
