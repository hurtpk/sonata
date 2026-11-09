/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage();
export const moderatorName = (member, id) => `${String(member?.nick || member?.user?.global_name || member?.global_name || member?.user?.username || member?.username || "Moderator").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 100)} | ${id}`;
export const withModerator = (id, name, action) => context.run({ id, label: moderatorName({ username: name }, id) }, action);
export function identifyModerator(member) { const current = context.getStore(); if (current && member?.user?.id === current.id) current.label = moderatorName(member, current.id); }
export function moderatorReason(reason) {
    const current = context.getStore();
    if (current && String(reason).endsWith(`Moderator: ${current.label}`)) return reason;
    return current ? `${String(reason || "Sonata action").slice(0, 340)} · Moderator: ${current.label}` : reason;
}
export function attributeMessage(body, label = context.getStore()?.label) {
    if (!body || !label) return body;
    if (body.embeds?.length) {
        const embeds = body.embeds.map((embed, index) => {
            if (index !== body.embeds.length - 1) return embed;
            const previous = (embed.footer?.text ?? "").replace(/(?: · )?Moderator: [^\n]* \| \d{17,20}$/, "");
            const suffix = `Moderator: ${label}`;
            return { ...embed, footer: { ...embed.footer, text: previous ? `${previous.slice(0, 2045 - suffix.length)} · ${suffix}` : suffix } };
        });
        return { ...body, embeds };
    }
    if (body.flags & 32768) {
        const components = [...(body.components ?? [])];
        const footer = { type: 10, content: `-# Moderator: ${label.replace(/[@`*~_<>\\]/g, "\\$&")}` };
        const container = components.findLastIndex(component => component.type === 17);
        if (container >= 0) {
            const children = [...components[container].components];
            if (children.at(-1)?.type === 10 && children.at(-1).content.startsWith("-# Moderator: ")) children.pop();
            if (children.length < 40) children.push(footer);
            components[container] = { ...components[container], components: children };
        } else if (components.length < 40) components.push(footer);
        return { ...body, components };
    }
    if (typeof body.content === "string" && !body.content.startsWith("Error code:")) {
        const footer = `\n-# Moderator: ${label.replace(/[@`*~_<>\\]/g, "\\$&")}`;
        return { ...body, content: (body.content.endsWith(footer) ? body.content.slice(0, -footer.length) : body.content).slice(0, 2000 - footer.length) + footer };
    }
    return body;
}
