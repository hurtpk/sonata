/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Watching a person: whatever else is left out, their messages are always
// logged, and you get a notification (with what it said) the moment they
// delete or edit one. Clicking it opens everything logged from them.

import { showNotification } from "@api/Notifications";
import { ChannelStore, GuildStore, IconUtils, UserStore } from "@webpack/common";

import { openLogModal } from "./components/LogsModal";
import { settings } from "./settings";

export const watchedIds = () => (settings.store.watchedIds || "").split(",").map(x => x.trim()).filter(Boolean);
export const isWatched = (id?: string | null) => !!id && watchedIds().includes(id);

export function setWatched(id: string, on: boolean) {
    const ids = new Set(watchedIds());
    if (on) ids.add(id); else ids.delete(id);
    settings.store.watchedIds = [...ids].join(",");
}

const snip = (text: string, n = 110) => {
    const t = (text ?? "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

function where(channelId: string) {
    const c: any = ChannelStore.getChannel(channelId);
    if (!c) return "somewhere";
    if (c.guild_id) return `#${c.name} in ${GuildStore.getGuild(c.guild_id)?.name ?? "a server"}`;
    return c.type === 1 ? "your DMs" : c.name || "a group chat";
}

/** Edits come in more than once (embeds loading count as one), so each is told about once. */
const told = new Map<string, string>();

export function watchAlert(message: any, kind: "deleted" | "edited") {
    const id: string | undefined = message?.author?.id;
    if (settings.store.watchAlerts === false || !isWatched(id)) return;
    const key = `${message.id}:${kind}`;
    const content: string = message.content ?? "";
    if (told.get(key) === content) return;
    told.set(key, content);
    if (told.size > 300) told.delete(told.keys().next().value!);

    const user: any = UserStore.getUser(id!) ?? message.author;
    const name = user?.globalName ?? user?.global_name ?? user?.username ?? "Someone";
    const files = (message.attachments?.length ?? 0) > 0;
    const said = snip(content) || (files ? "a picture or file" : "(no text)");
    const before = kind === "edited" ? snip(message.editHistory?.at(-1)?.content ?? "", 60) : "";
    showNotification({
        title: `👁 ${name} ${kind} a message`,
        body: kind === "edited" && before ? `${where(message.channel_id)}: “${before}” → “${said}”` : `${where(message.channel_id)}: “${said}”`,
        icon: user?.avatar !== undefined ? IconUtils.getUserAvatarURL(user, false, 64) : undefined,
        onClick: () => openLogModal(`user:${id}`),
    });
}
