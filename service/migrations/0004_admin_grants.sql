/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

CREATE TABLE IF NOT EXISTS admin_grants (id TEXT PRIMARY KEY, permissions TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL);
