/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { copyToClipboard } from "@utils/clipboard";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { Menu, showToast } from "@webpack/common";

import { isFeatureRunning } from "../../../featureSettings";
import embedSender from "../embedSender";
import { toApiEmbed, toApiMessage } from "./convert";

/** EmbedSender's "open with this message", while it's on. */
const openInEmbedSender = (): ((m: { content?: string | null; embeds: any[]; }) => void) | undefined =>
    isFeatureRunning("embedSender") ? (embedSender as any).openWithMessage : undefined;

/** Which of the message's embeds was right-clicked, if it was one. */
function clickedEmbed(message: Message, target: Element | undefined): number | null {
    const article = target?.closest?.('article[class*="embed"]');
    const box = article?.closest('[id^="message-accessories-"]');
    if (!article || !box) return null;
    const all = Array.from(box.querySelectorAll('article[class*="embed"]')).filter(a => !a.parentElement?.closest('article[class*="embed"]'));
    const i = all.indexOf(article);
    return i >= 0 && i < (message.embeds?.length ?? 0) ? i : null;
}

function copyJson(value: unknown, what: string) {
    copyToClipboard(JSON.stringify(value, null, 2));
    showToast(`Copied ${what} as JSON`, "success");
}

const messageMenu: NavContextMenuPatchCallback = (children, { message, target }: { message?: Message; target?: Element; }) => {
    const embeds = (message?.embeds ?? []).filter((e: any) => e.type === "rich" || e.rawTitle || e.rawDescription || e.fields?.length);
    if (!message || !embeds.length) return;

    const index = clickedEmbed(message, target);
    const one = index != null ? message.embeds[index] : embeds.length === 1 ? embeds[0] : null;
    const send = openInEmbedSender();

    children.push(
        <Menu.MenuItem id="vc-embedcopy" label={one ? "Embed" : `Embeds (${embeds.length})`}>
            <Menu.MenuItem
                id="vc-embedcopy-edit"
                label={send ? "Edit & re-send in EmbedSender" : "Edit in EmbedSender (turn EmbedSender on)"}
                disabled={!send}
                action={() => send?.(one ? { embeds: [toApiEmbed(one)] } : { content: message.content, embeds: embeds.map(toApiEmbed) })}
            />
            <Menu.MenuItem
                id="vc-embedcopy-json"
                label={one ? "Copy embed JSON" : "Copy all embeds JSON"}
                action={() => one ? copyJson(toApiEmbed(one), "the embed") : copyJson(toApiMessage(message.content, embeds), `${embeds.length} embeds`)}
            />
            {one && embeds.length > 1 && (
                <Menu.MenuItem
                    id="vc-embedcopy-json-all"
                    label={`Copy whole message JSON (${embeds.length} embeds)`}
                    action={() => copyJson(toApiMessage(message.content, embeds), "the message")}
                />
            )}
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "EmbedCopier",
    description: "Right-click a message with an embed to open it in EmbedSender, ready to edit and re-send through your webhook, or copy it as JSON (works with Discohook too).",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    contextMenus: { "message": messageMenu },
});
