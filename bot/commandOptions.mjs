/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const option = (name, type, description, required = true, extra = {}) => ({ name, type, description, required, ...extra });
export const member = () => option("member", 6, "The member to moderate");
export const reason = () => option("reason", 3, "The reason for this action", false, { max_length: 500 });
export const duration = () => option("duration", 3, "Duration, such as 30m, 2h or 7d");
export const caseNumber = () => option("case", 4, "The case number", true, { min_value: 1 });
export const text = (name, description, required = true) => option(name, 3, description, required, { max_length: 1000 });
export const sub = (name, description, options = []) => ({ name, description, type: 1, options });
export const command = (name, description, permission, options = [], aliases = []) => ({ name, description, permission, options, aliases });
export const role = () => option("role", 8, "The role to manage");
export const channel = (types, required = true) => option("channel", 7, "The server channel", required, { channel_types: types });
