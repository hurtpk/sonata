/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Roblox scam guard: a warning under any message with a fake Roblox link,
// and a popup if you click one. Short links (bit.ly…) in Roblox chats are
// checked for where they really go. Sites you trust can be let through.

import { makeGuard } from "../_shared/scamGuard";
import { checkLink, robloxContext } from "./scam";

const roblox = makeGuard({ check: checkLink, shortContext: robloxContext, fallback: "This link isn't Roblox's website.", source: "roblox" });

export const { guard, ScamBanner, messageVerdicts, openWarning } = roblox;
export const startGuard = roblox.start;
export const stopGuard = roblox.stop;
