/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Roblox Tools: live cards for Roblox links in chat (players online, visits,
// followers…), a look-up for any profile, game, group or item — profiles
// show every username they've had — a group tracker, and a Robux calculator.
// Robux also works in the Converter, and File Converter has Roblox-ready
// image sizes. Uses Roblox's public data; nothing needs logging in.

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { metaOf } from "../_shared/scamGuard";
import { setRobuxRates } from "../currencyConverter/robux";
import { loadSaved } from "./bookmarks";
import { findLinks, sources } from "./data";
import { setGameAlerts, startGameAlerts, stopGameAlerts } from "./gameAlerts";
import { loadGroups, setGroupAlerts, startGroupChecks, stopGroupChecks } from "./groups";
import { startMe, stopMe } from "./me";
import { MessageCards, openRoblox } from "./Panel";
import { guard, ScamBanner, startGuard, stopGuard } from "./ScamGuard";
import { loadPeople, setPeopleAlerts, startPeopleChecks, stopPeopleChecks } from "./watchlist";

const settings = defineFeatureSettings("robloxTools", {
    previews: {
        type: OptionType.SELECT,
        description: "Live cards under messages with Roblox links",
        options: [
            { label: "Every Roblox link (games, profiles, groups, items)", value: "all", default: true },
            { label: "Game links only", value: "games" },
            { label: "Off", value: "off" },
        ],
    },
    groupHours: {
        type: OptionType.SELECT,
        description: "How often to check the groups and people you watch",
        options: [{ label: "Every hour", value: 1 }, { label: "Every 3 hours", value: 3, default: true }, { label: "Every 6 hours", value: 6 }, { label: "Twice a day", value: 12 }],
    },
    groupAlerts: { type: OptionType.BOOLEAN, description: "Tell me about new group shouts and member milestones", default: true, onChange: (v: boolean) => setGroupAlerts(v) },
    scamGuard: { type: OptionType.BOOLEAN, description: "Warn me about fake Roblox links (lookalike websites, free-Robux sites, disguised links) — under the message, and before opening one", default: true, onChange: () => applyGuard() },
    scamShortLinks: { type: OptionType.BOOLEAN, description: "Check where short links (bit.ly and others) in Roblox chats really go — asks the short-link site", default: true, onChange: () => applyGuard() },
    scamTrusted: { type: OptionType.STRING, description: "Internal: websites you told the scam guard to trust.", default: "", hidden: true },
    gameUpdateAlerts: { type: OptionType.BOOLEAN, description: "Tell me when a game I saved gets an update", default: true, onChange: () => applyGameAlerts() },
    gamePlayerAlerts: { type: OptionType.BOOLEAN, description: "Tell me when a game I saved hits a player-count milestone (100, 1K, 10K…)", default: true, onChange: () => applyGameAlerts() },
    gameVisitAlerts: { type: OptionType.BOOLEAN, description: "Tell me when a game I saved passes a visits milestone (1M, 10M, 100M…)", default: true, onChange: () => applyGameAlerts() },
    peopleAlerts: { type: OptionType.BOOLEAN, description: "Tell me when someone I watch changes their username, display name, bio or avatar", default: true, onChange: (v: boolean) => setPeopleAlerts(v) },
    rolimons: { type: OptionType.BOOLEAN, description: "Get each game's history — player charts, peak players, average playtime — from Rolimons (only when you open a game)", default: true, onChange: (v: boolean) => { sources.rolimons = v; } },
    apiKey: { type: OptionType.STRING, description: "Roblox API key for downloading newer items (set it in Roblox Tools → Assets)", default: "", hidden: true },
    buyRate: { type: OptionType.STRING, description: "US dollars per Robux when buying (Roblox's price)", default: "0.0125" },
    devexRate: { type: OptionType.STRING, description: "US dollars per Robux through DevEx (cashing out)", default: "0.0038" },
});

function applyGuard() {
    guard.on = settings.store.scamGuard !== false;
    guard.shortLinks = settings.store.scamShortLinks !== false;
    guard.trusted = (settings.store.scamTrusted ?? "").split(",").map(s => s.trim()).filter(Boolean);
    guard.trust = site => { guard.trusted = [...new Set([...guard.trusted, site])]; settings.store.scamTrusted = guard.trusted.join(","); };
}

function applyGameAlerts() {
    setGameAlerts({ updates: settings.store.gameUpdateAlerts !== false, players: settings.store.gamePlayerAlerts !== false, visits: settings.store.gameVisitAlerts !== false });
}

function applyRates() {
    const n = (v: unknown, d: number) => { const x = Number(String(v ?? "").replace(/[$,\s]/g, "")); return x > 0 && x < 1 ? x : d; };
    setRobuxRates({ buy: n(settings.store.buyRate, 0.0125), devex: n(settings.store.devexRate, 0.0038) });
}

export function RobloxIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden>
            <path d="M6.2 2.5 21.5 6.2 17.8 21.5 2.5 17.8Z" />
            <path d="M10.6 9.1 14.9 10.6 13.4 14.9 9.1 13.4Z" fill="currentColor" />
        </svg>
    );
}

const RobloxButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="Roblox Tools" onClick={() => { applyRates(); openRoblox(); }}><RobloxIcon /></ChatBarButton>
    : null;

const Cards = ErrorBoundary.wrap(MessageCards, { noop: true });

const messageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    const refs = findLinks(message?.content ?? "");
    if (!refs.length) return;
    const r = refs[0];
    const path = r.kind === "user" ? "users" : r.kind === "game" ? "games" : r.kind === "group" ? "communities" : r.bundle ? "bundles" : "catalog";
    children.push(<Menu.MenuItem id="vc-rbx-open" label="Open in Roblox Tools" action={() => openRoblox("lookup", `https://www.roblox.com/${path}/${r.id}`)} />);
    const item = refs.find(x => x.kind === "item" && !x.bundle);
    if (item) children.push(<Menu.MenuItem id="vc-rbx-assets" label="Get this item's files" action={() => openRoblox("assets", item.id)} />);
    const game = refs.find(x => x.kind === "game");
    if (game) children.push(<Menu.MenuItem id="vc-rbx-servers" label="Find a Roblox server" action={() => openRoblox("servers", game.id)} />);
};

export default definePlugin({
    name: "RobloxTools",
    description: "Live cards for Roblox links in chat (players online, visits, likes, followers, group members, item prices), look up any Roblox profile, game, group or item — with every username a profile has had and what their outfit is worth — find a server to join, compare games, get an item's 3D model and textures, see a player's limiteds value and when they were last online, see a game's passes and products and a group's games, watch profiles for name and avatar changes, watch Roblox groups grow, and work out Robux ↔ money. Robux also works in the Converter, and File Converter makes Roblox-ready icons, thumbnails, decals and clothing.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => { applyRates(); openRoblox(); },
    chatBarButton: { icon: RobloxIcon, render: RobloxButton },
    contextMenus: { message: messageMenu },

    renderMessageAccessory: ({ message }: Record<string, any>) => {
        const mode = settings.store.previews ?? "all";
        const content: string = message?.content ?? "";
        const cards = mode !== "off" && content.includes("roblox.com/");
        if (!cards && !/https?:\/\/|javascript:/i.test(content)) return null;
        return (
            <>
                <ScamBanner text={content} meta={metaOf(message)} />
                {cards && <Cards content={content} gamesOnly={mode === "games"} />}
            </>
        );
    },

    async start() {
        applyRates();
        sources.rolimons = settings.store.rolimons !== false;
        sources.apiKey = settings.store.apiKey ?? "";
        sources.saveApiKey = key => { settings.store.apiKey = key; sources.apiKey = key; };
        setGroupAlerts(settings.store.groupAlerts !== false);
        setPeopleAlerts(settings.store.peopleAlerts !== false);
        await Promise.all([loadGroups(), loadPeople(), loadSaved()]);
        startGroupChecks(() => Number(settings.store.groupHours) || 3);
        startPeopleChecks(() => Number(settings.store.groupHours) || 3);
        startMe(() => Number(settings.store.groupHours) || 3);
        applyGameAlerts();
        startGameAlerts();
        applyGuard();
        startGuard();
    },

    stop() {
        stopGroupChecks();
        stopPeopleChecks();
        stopMe();
        stopGameAlerts();
        stopGuard();
    },
});
