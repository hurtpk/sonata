/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Game Hub's Roblox: live cards for Roblox links in chat (players online,
// visits, followers…), a look-up for any profile, game, group or item —
// profiles show every username they've had — a group tracker, and a Robux
// calculator. Robux also works in the Converter, and File Converter has
// Roblox-ready image sizes. Uses Roblox's public data; nothing needs logging in.
// (It used to be its own feature, Roblox Tools; its settings keep that name,
// so nothing you set was lost.)

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";
import { metaOf } from "../../_shared/scamGuard";
import { setRobuxRates } from "../../currencyConverter/robux";
import { loadSaved } from "./bookmarks";
import { findLinks, sources } from "./data";
import { setGameAlerts, startGameAlerts, stopGameAlerts } from "./gameAlerts";
import { loadGroups, setGroupAlerts, startGroupChecks, stopGroupChecks } from "./groups";
import { startMe, stopMe } from "./me";
import { MessageCards, openRoblox } from "./Panel";
import { guard, ScamBanner, startGuard, stopGuard } from "./ScamGuard";
import { loadPeople, setPeopleAlerts, startPeopleChecks, stopPeopleChecks } from "./watchlist";

export const robloxSettings = defineFeatureSettings("robloxTools", {
    previews: {
        type: OptionType.SELECT,
        description: "Roblox: live cards under messages with Roblox links",
        options: [
            { label: "Every Roblox link (games, profiles, groups, items)", value: "all", default: true },
            { label: "Game links only", value: "games" },
            { label: "Off", value: "off" },
        ],
    },
    groupHours: {
        type: OptionType.SELECT,
        description: "Roblox: how often to check the groups and people you watch",
        options: [{ label: "Every hour", value: 1 }, { label: "Every 3 hours", value: 3, default: true }, { label: "Every 6 hours", value: 6 }, { label: "Twice a day", value: 12 }],
    },
    groupAlerts: { type: OptionType.BOOLEAN, description: "Roblox: tell me about new group shouts and member milestones", default: true, onChange: (v: boolean) => setGroupAlerts(v) },
    scamGuard: { type: OptionType.BOOLEAN, description: "Roblox: warn me about fake Roblox links (lookalike websites, free-Robux sites, disguised links) — under the message, and before opening one", default: true, onChange: () => applyGuard() },
    scamShortLinks: { type: OptionType.BOOLEAN, description: "Roblox: check where short links (bit.ly and others) in Roblox chats really go — asks the short-link site", default: true, onChange: () => applyGuard() },
    scamTrusted: { type: OptionType.STRING, description: "Internal: websites you told the scam guard to trust.", default: "", hidden: true },
    gameUpdateAlerts: { type: OptionType.BOOLEAN, description: "Roblox: tell me when a game I saved gets an update", default: true, onChange: () => applyGameAlerts() },
    gamePlayerAlerts: { type: OptionType.BOOLEAN, description: "Roblox: tell me when a game I saved hits a player-count milestone (100, 1K, 10K…)", default: true, onChange: () => applyGameAlerts() },
    gameVisitAlerts: { type: OptionType.BOOLEAN, description: "Roblox: tell me when a game I saved passes a visits milestone (1M, 10M, 100M…)", default: true, onChange: () => applyGameAlerts() },
    peopleAlerts: { type: OptionType.BOOLEAN, description: "Roblox: tell me when someone I watch changes their username, display name, bio or avatar", default: true, onChange: (v: boolean) => setPeopleAlerts(v) },
    rolimons: { type: OptionType.BOOLEAN, description: "Roblox: get each game's history — player charts, peak players, average playtime — from Rolimons (only when you open a game)", default: true, onChange: (v: boolean) => { sources.rolimons = v; } },
    apiKey: { type: OptionType.STRING, description: "Roblox API key for downloading newer items (set it in Game Hub → Roblox → Assets)", default: "", hidden: true },
    buyRate: { type: OptionType.STRING, description: "Roblox: US dollars per Robux when buying (Roblox's price)", default: "0.0125" },
    devexRate: { type: OptionType.STRING, description: "Roblox: US dollars per Robux through DevEx (cashing out)", default: "0.0038" },
});

function applyGuard() {
    guard.on = robloxSettings.store.scamGuard !== false;
    guard.shortLinks = robloxSettings.store.scamShortLinks !== false;
    guard.trusted = (robloxSettings.store.scamTrusted ?? "").split(",").map(s => s.trim()).filter(Boolean);
    guard.trust = site => { guard.trusted = [...new Set([...guard.trusted, site])]; robloxSettings.store.scamTrusted = guard.trusted.join(","); };
}

function applyGameAlerts() {
    setGameAlerts({ updates: robloxSettings.store.gameUpdateAlerts !== false, players: robloxSettings.store.gamePlayerAlerts !== false, visits: robloxSettings.store.gameVisitAlerts !== false });
}

export function applyRates() {
    const n = (v: unknown, d: number) => { const x = Number(String(v ?? "").replace(/[$,\s]/g, "")); return x > 0 && x < 1 ? x : d; };
    setRobuxRates({ buy: n(robloxSettings.store.buyRate, 0.0125), devex: n(robloxSettings.store.devexRate, 0.0038) });
}

const Cards = ErrorBoundary.wrap(MessageCards, { noop: true });

export const robloxMessageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    const refs = findLinks(message?.content ?? "");
    if (!refs.length) return;
    const r = refs[0];
    const path = r.kind === "user" ? "users" : r.kind === "game" ? "games" : r.kind === "group" ? "communities" : r.bundle ? "bundles" : "catalog";
    children.push(<Menu.MenuItem id="vc-rbx-open" label="Open in Game Hub" action={() => openRoblox("lookup", `https://www.roblox.com/${path}/${r.id}`)} />);
    const item = refs.find(x => x.kind === "item" && !x.bundle);
    if (item) children.push(<Menu.MenuItem id="vc-rbx-assets" label="Get this item's files" action={() => openRoblox("assets", item.id)} />);
    const game = refs.find(x => x.kind === "game");
    if (game) children.push(<Menu.MenuItem id="vc-rbx-servers" label="Find a Roblox server" action={() => openRoblox("servers", game.id)} />);
};

/** Live cards and fake-link warnings under messages. */
export function robloxAccessory({ message }: Record<string, any>) {
    const mode = robloxSettings.store.previews ?? "all";
    const content: string = message?.content ?? "";
    const cards = mode !== "off" && content.includes("roblox.com/");
    if (!cards && !/https?:\/\/|javascript:/i.test(content)) return null;
    return (
        <>
            <ScamBanner text={content} meta={metaOf(message)} />
            {cards && <Cards content={content} gamesOnly={mode === "games"} />}
        </>
    );
}

export async function startRoblox() {
    applyRates();
    sources.rolimons = robloxSettings.store.rolimons !== false;
    sources.apiKey = robloxSettings.store.apiKey ?? "";
    sources.saveApiKey = key => { robloxSettings.store.apiKey = key; sources.apiKey = key; };
    setGroupAlerts(robloxSettings.store.groupAlerts !== false);
    setPeopleAlerts(robloxSettings.store.peopleAlerts !== false);
    await Promise.all([loadGroups(), loadPeople(), loadSaved()]);
    startGroupChecks(() => Number(robloxSettings.store.groupHours) || 3);
    startPeopleChecks(() => Number(robloxSettings.store.groupHours) || 3);
    startMe(() => Number(robloxSettings.store.groupHours) || 3);
    applyGameAlerts();
    startGameAlerts();
    applyGuard();
    startGuard();
}

export function stopRoblox() {
    stopGroupChecks();
    stopPeopleChecks();
    stopMe();
    stopGameAlerts();
    stopGuard();
}
