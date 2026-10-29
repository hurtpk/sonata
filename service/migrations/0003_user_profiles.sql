/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

CREATE TABLE IF NOT EXISTS user_profiles (id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, avatar TEXT NOT NULL DEFAULT '', discriminator TEXT NOT NULL DEFAULT '0', updated INTEGER NOT NULL);
