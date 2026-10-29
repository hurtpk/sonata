/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fail } from "./discord.mjs";

export const button = (id, label, style = 2, emoji) => ({ type: 2, style, custom_id: id, ...(label ? { label } : {}), ...(emoji ? { emoji: { name: emoji } } : {}) });
export const rows = values => Array.from({ length: Math.ceil(values.length / 5) }, (_, index) => ({ type: 1, components: values.slice(index * 5, index * 5 + 5) }));
export const actorId = data => data.member?.user?.id ?? data.user?.id;
export function genuineControl(data, botId) {
    return data.message?.author?.id === botId && data.message.components?.some(row => row.components?.some(value => value.custom_id === data.data.custom_id && !value.disabled));
}
export function openForm(data, store, guild, kind, details, title, label, max = 1000) {
    if (store.get("SELECT COUNT(*) AS n FROM forms WHERE actor=? AND kind<>'modlogs' AND expires>?", actorId(data), Date.now()).n >= 5) fail("Finish an existing form or wait ten minutes before opening another.");
    const id = crypto.randomUUID();
    store.run("INSERT INTO forms VALUES (?,?,?,?,?,?)", id, actorId(data), guild, kind, JSON.stringify(details), Date.now() + 600_000);
    return { type: 9, data: { custom_id: `snform:${id}`, title, components: [{ type: 18, label, component: { type: 4, custom_id: "value", style: max > 100 ? 2 : 1, required: true, min_length: 1, max_length: max } }] } };
}
export function consumeForm(data, store) {
    const id = /^snform:([\da-f-]{36})$/.exec(data.data.custom_id)?.[1];
    if (!id) fail("This form is invalid.");
    const row = store.get("DELETE FROM forms WHERE id=? AND actor=? AND expires>? RETURNING *", id, actorId(data), Date.now());
    if (!row) fail("This form expired or was already submitted. Open it again.");
    const values = data.data.components.flatMap(value => value.component ? [value.component] : value.components ?? []);
    const value = values.find(value => value.custom_id === "value")?.value;
    if (typeof value !== "string" || !value.trim() || value.length > 1000) fail("Enter a valid response.");
    return { ...row, details: JSON.parse(row.data), value: value.trim() };
}
