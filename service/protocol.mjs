/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash, randomBytes } from "node:crypto";

export const random = () => randomBytes(32).toString("hex");
export const hash = value => createHash("sha256").update(value).digest("hex");
export const validId = value => typeof value === "string" && /^\d{17,20}$/.test(value);
export const validToken = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
