/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Scam Shield: the Roblox scam guard, for everything else. A warning under
// messages with fake Discord, Nitro, Steam, Epic or PayPal links, IP
// loggers, and programs sent as "try my game" — and a popup before you
// open one. Messages that sound like a scam (fake Discord staff, QR-code
// logins, asking for your token or a wallet's seed phrase) get a warning
// too, even with no link. Pictures are checked for Discord login QR codes,
// and links from accounts made this week get a heads-up.

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu, useEffect, useRef, UserStore, useState } from "@webpack/common";

import { defineFeatureSettings, isFeatureRunning } from "../../featureSettings";
import { Brand, DISCORD, EPIC, linksIn, PAYPAL, ROBLOX, STEAM, Verdict } from "../_shared/scam";
import { makeGuard, metaOf } from "../_shared/scamGuard";
import { logPrefs } from "../_shared/scamLog";
import { imagesOf, scan } from "../qrCodes/AutoQr";
import { guard as robloxGuard } from "../robloxTools/ScamGuard";
import { openChecker } from "./Checker";
import { checkAny, fileWarning, newAccountWarning, qrWarning, shield, talkWarning, worthResolving } from "./checks";
import { openDashboard } from "./Dashboard";

const settings = defineFeatureSettings("scamShield", {
    checker: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => openShield()}>🛡️ Open Scam Shield</button>
                <button type="button" className="vc-tool-btn" onClick={() => openChecker()}>🔍 Check a link</button>
                <span className="vc-tool-hint">See what it's protected you from, and check any link yourself.</span>
            </div>
        ),
    },
    discordLinks: { type: OptionType.BOOLEAN, description: "Fake Discord links — fake Nitro gifts, look-alike login pages, and QR-code login links", default: true },
    steamLinks: { type: OptionType.BOOLEAN, description: "Fake Steam links — fake gifts, trade offers and “vote for my team” logins", default: true },
    otherLinks: { type: OptionType.BOOLEAN, description: "Fake Epic Games (free V-Bucks) and PayPal links", default: true },
    robloxLinks: { type: OptionType.BOOLEAN, description: "Fake Roblox links (only while Roblox Tools' own scam guard is off, so you never get two warnings)", default: true },
    ipLoggers: { type: OptionType.BOOLEAN, description: "IP loggers (Grabify, IPLogger…) — links that record your IP address and location", default: true, onChange: () => apply() },
    files: { type: OptionType.BOOLEAN, description: "Programs sent in chat (.exe, .scr, .bat, .jar…) — the “try my game” scam", default: true, onChange: () => apply() },
    talk: {
        type: OptionType.SELECT,
        description: "Warn about messages that sound like a scam, even with no link (fake Discord staff, QR-code logins, asking for your token or seed phrase, “try my game”)",
        options: [
            { label: "In DMs and group chats", value: "dms", default: true },
            { label: "Everywhere", value: "all" },
            { label: "Off", value: "off" },
        ],
    },
    qrPictures: { type: OptionType.BOOLEAN, description: "Check pictures for Discord login QR codes (and QR codes leading to scam sites) — each picture once, only when it's on screen", default: true },
    newAccounts: {
        type: OptionType.SELECT,
        description: "Warn when an account made recently sends you a link in DMs (worked out from their ID — nothing is looked up)",
        options: [
            { label: "Made in the last week", value: 7, default: true },
            { label: "Made in the last month", value: 30 },
            { label: "Off", value: 0 },
        ],
    },
    shortLinks: { type: OptionType.BOOLEAN, description: "Check where short links (bit.ly and others) really go when the message looks risky — asks the short-link site", default: true, onChange: () => apply() },
    history: { type: OptionType.BOOLEAN, description: "Keep a history of what Scam Shield caught and the links you checked (only on this computer)", default: true, onChange: () => applyHistory() },
    historyDays: {
        type: OptionType.SELECT,
        description: "Keep the history for",
        options: [{ label: "30 days", value: 30 }, { label: "90 days", value: 90, default: true }, { label: "A year", value: 365 }, { label: "Forever", value: 0 }],
        onChange: () => applyHistory(),
    },
    trusted: { type: OptionType.STRING, description: "Internal: websites you told Scam Shield to trust.", default: "", hidden: true },
});

/** Roblox Tools warns about Roblox itself when its guard is on. */
const robloxCovered = () => isFeatureRunning("robloxTools") && robloxGuard.on;

shield.brands = () => {
    const s = settings.store, list: Brand[] = [];
    if (s.discordLinks !== false) list.push(DISCORD);
    if (s.steamLinks !== false) list.push(STEAM);
    if (s.otherLinks !== false) list.push(EPIC, PAYPAL);
    if (s.robloxLinks !== false && !robloxCovered()) list.push(ROBLOX);
    return list;
};

const shieldGuard = makeGuard({ check: checkAny, shortContext: worthResolving, fallback: "This link looks like a scam.", source: "shield" });
const { guard, ScamBanner } = shieldGuard;

function applyHistory() {
    logPrefs.on = settings.store.history !== false;
    logPrefs.days = Number(settings.store.historyDays ?? 90);
}

const openShield = () => openDashboard({
    trusted: () => guard.trusted,
    untrust: site => { guard.trusted = guard.trusted.filter(s => s !== site); settings.store.trusted = guard.trusted.join(","); },
});

function apply() {
    shield.ipLoggers = settings.store.ipLoggers !== false;
    shield.files = settings.store.files !== false;
    guard.shortLinks = settings.store.shortLinks !== false;
    guard.trusted = (settings.store.trusted ?? "").split(",").map(s => s.trim()).filter(Boolean);
    guard.trust = site => { guard.trusted = [...new Set([...guard.trusted, site])]; settings.store.trusted = guard.trusted.join(","); };
}

function talkHere(channelId: string) {
    const mode = settings.store.talk ?? "dms";
    return mode === "all" || (mode === "dms" && !!ChannelStore.getChannel(channelId)?.isPrivate());
}

function Accessory({ message }: { message: any; }) {
    const content: string = message?.content ?? "";
    const mine = message?.author?.id === UserStore.getCurrentUser()?.id;
    const hasLink = /https?:\/\/|javascript:/i.test(content);
    const extra: Verdict[] = [];
    // Your own messages only get link checks — you know what you sent.
    if (!mine) {
        for (const a of message?.attachments ?? []) {
            const w = fileWarning(a?.filename ?? "", a?.url ?? "", content);
            if (w) extra.push(w);
        }
        if (content && talkHere(message.channel_id) && !linksIn(content).length) {
            const t = talkWarning(content);
            if (t) extra.push(t);
        }
        const days = Number(settings.store.newAccounts ?? 7);
        if (days > 0 && hasLink && !message.author?.bot && ChannelStore.getChannel(message.channel_id)?.isPrivate()) {
            const w = newAccountWarning(message.author?.id ?? "", days);
            if (w) extra.push(w);
        }
    }

    // QR codes in pictures: read once each picture is on screen.
    const pictures = !mine && settings.store.qrPictures !== false ? imagesOf(message) : [];
    const key = pictures.join("|");
    const probe = useRef<HTMLSpanElement>(null);
    const [qr, setQr] = useState<Verdict[]>([]);
    useEffect(() => {
        setQr([]);
        if (!key || !probe.current) return;
        let alive = true;
        const io = new IntersectionObserver(es => {
            if (!es.some(e => e.isIntersecting)) return;
            io.disconnect();
            void Promise.all(pictures.map(u => scan(u).then(t => t ? qrWarning(t) : null, () => null)))
                .then(list => { if (alive) setQr(list.filter((v): v is Verdict => !!v)); });
        }, { rootMargin: "200px" });
        io.observe(probe.current);
        return () => { alive = false; io.disconnect(); };
    }, [key]);

    const all = [...qr, ...extra];
    return (
        <>
            {key && <span ref={probe} className="vc-scam-probe" />}
            {(all.length > 0 || hasLink) && <ScamBanner text={content} extra={all} meta={metaOf(message)} />}
        </>
    );
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    const content: string = message?.content ?? "";
    if (!linksIn(content).length) return;
    children.push(<Menu.MenuItem id="vc-shield-check" label="Check links with Scam Shield" action={() => openChecker(content)} />);
};

const SafeAccessory = ErrorBoundary.wrap(Accessory, { noop: true });

export default definePlugin({
    name: "ScamShield",
    description: "Warns you about scams in chat: fake Discord, Nitro-gift, Steam, Epic Games and PayPal links (look-alike addresses, disguised links, QR-code login links), IP loggers, and programs sent as “try my game” — with a popup before you open one. Messages that sound like a scam, like fake Discord staff or someone asking for your token, get a warning too.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openShield(),
    contextMenus: { message: messageMenu },

    renderMessageAccessory: ({ message }: Record<string, any>) => <SafeAccessory message={message} />,

    start() {
        apply();
        applyHistory();
        shieldGuard.start();
    },

    stop() {
        shieldGuard.stop();
    },
});
