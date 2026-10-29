/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { button, rows } from "./interactionUI.mjs";

export const musicPanel = (guild, channel) => [...rows([
    button(`snmusic:${guild}:${channel}:pause`, "", 2, "⏸️"), button(`snmusic:${guild}:${channel}:resume`, "", 2, "▶️"), button(`snmusic:${guild}:${channel}:skip`, "", 2, "⏭️"), button(`snmusic:${guild}:${channel}:stop`, "", 4, "⏹️"), button(`snmusic:${guild}:${channel}:queue`, "", 2, "📜"), button(`snmusic:${guild}:${channel}:nowplaying`, "Refresh", 1),
    button(`snmusic:${guild}:${channel}:voteskip`, "Vote skip", 2, "🗳️"),
]), { type: 1, components: [{ type: 3, custom_id: `snmusic:${guild}:${channel}:filter`, placeholder: "Audio effect…", min_values: 1, max_values: 1, options: ["off", "bassboost", "nightcore", "vaporwave"].map(value => ({ label: { off: "Effects off", bassboost: "Bass boost", nightcore: "Nightcore", vaporwave: "Vaporwave" }[value], value })) }] }];
export const voicePanel = (guild, channel) => rows([
    ...["lock", "unlock", "hide", "unhide", "claim", "name", "limit", "bitrate", "transfer", "permit", "reject", "reset", "room"].map(action => button(`snvoice:${guild}:${channel}:${action}`, { name: "Rename", room: "Refresh" }[action] ?? action[0].toUpperCase() + action.slice(1), ["claim", "room"].includes(action) ? 1 : 2)),
]);
