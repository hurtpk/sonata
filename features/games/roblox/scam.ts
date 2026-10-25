/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Spotting fake Roblox links — the shared checker, with only Roblox in it.
// (Scam Shield uses the same checker for Discord, Steam and the rest.)

import { checkLinkFor, ROBLOX, talkIn } from "../../_shared/scam";

export type { Level, Verdict } from "../../_shared/scam";
export { linksIn, siteOf } from "../../_shared/scam";

export const scamWordsIn = (text: string) => talkIn(text, [ROBLOX]);

/** Does a message talk about Roblox at all (so short links in it are worth checking)? */
export const robloxContext = (text: string) => ROBLOX.context.test(text);

/**
 * What a link really is. `shown` is the link's visible text (a masked link
 * shows one address and goes to another); `context` is the message around it.
 */
export const checkLink = (raw: string, shown = "", context = "") => checkLinkFor([ROBLOX], raw, shown, context);
