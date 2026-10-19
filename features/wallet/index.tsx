/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Wallet: your PayPal, Cash App, Venmo, Zelle, crypto addresses and Roblox in
// one place — hidden until you show them, one click to copy or send, and
// typed as ;paypal or ;btc in chat. Crypto addresses are checked for typos,
// and it warns you if an address you're sending or pasting has been swapped
// (some viruses replace copied addresses with their own).

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { alerts, startAlerts, stopAlerts } from "./alerts";
import { ADDRESS_LIKE, kindOf, KINDS, linkFor, lookalike, tidy } from "./kinds";
import { openWallet, WalletIcon } from "./Panel";
import { firstOf, lastCopy, loadWallet, qrPrefs, savedAddresses } from "./store";

const settings = defineFeatureSettings("wallet", {
    open: { type: OptionType.COMPONENT, description: "", component: () => <button type="button" className="vc-tool-btn vc-tool-primary" onClick={openWallet}>Open Wallet</button> },
    chatButton: { type: OptionType.BOOLEAN, description: "Show the wallet button in the chat bar", default: true },
    quickInsert: { type: OptionType.BOOLEAN, description: "Turn ;paypal, ;cashapp, ;venmo, ;zelle, ;btc, ;eth, ;sol, ;ltc, ;usdt, ;usdc and ;roblox into yours when you send a message", default: true },
    paymentAlerts: {
        type: OptionType.BOOLEAN,
        description: "Tell me when crypto arrives at one of my addresses (checks every few minutes — each check asks a public blockchain explorer about your addresses)",
        default: false,
        onChange: () => applyAlerts(),
    },
    alertMinutes: {
        type: OptionType.SELECT,
        description: "How often to check for payments",
        options: [{ label: "Every 5 minutes", value: 5 }, { label: "Every 15 minutes", value: 15, default: true }, { label: "Every 30 minutes", value: 30 }, { label: "Every hour", value: 60 }],
        onChange: () => applyAlerts(),
    },
    qrCard: {
        type: OptionType.BOOLEAN,
        description: "QR pictures you copy or save show your name and the coin's (or app's) logo",
        default: false,
        onChange: () => applyQr(),
    },
    qrName: {
        type: OptionType.STRING,
        description: "Name on QR pictures (\"Pay …\") — leave empty to use your Discord name",
        default: "",
        onChange: () => applyQr(),
    },
    swapGuard: { type: OptionType.BOOLEAN, description: "Warn me if an address I'm sending or pasting looks like mine but isn't (some viruses swap copied addresses)", default: true },
});

function applyQr() {
    qrPrefs.card = settings.store.qrCard === true;
    qrPrefs.name = settings.store.qrName ?? "";
}
qrPrefs.set = (card: boolean) => { settings.store.qrCard = card; applyQr(); };

function applyAlerts() {
    alerts.on = settings.store.paymentAlerts === true;
    alerts.minutes = Number(settings.store.alertMinutes) || 15;
}
alerts.onOpen = () => openWallet();
alerts.set = (on: boolean, minutes: number) => {
    settings.store.paymentAlerts = on;
    settings.store.alertMinutes = minutes;
    applyAlerts();
};

/* ── The warning ── */

function SwapModal({ modalProps, found, mine, pasted }: { modalProps: RenderModalProps; found: string; mine: string; pasted: boolean; }) {
    return (
        <Modal {...modalProps} size="sm" title="🚨 That isn't your address" subtitle={pasted ? "What you pasted isn't what you copied from your wallet" : "It looks like one of yours, but it's different"}>
            <div className="vc-tool-wrap vc-wallet-swap">
                <div className="vc-wallet-swap-row"><span>{pasted ? "You pasted" : "Your message has"}</span><code className="vc-wallet-swap-bad">{found}</code></div>
                <div className="vc-wallet-swap-row"><span>{pasted ? "You copied" : "Your saved one is"}</span><code className="vc-wallet-swap-good">{mine}</code></div>
                <p>
                    {pasted
                        ? "Something changed your clipboard between copying and pasting. That's what address-swapping viruses do — anyone paying this address would be paying someone else."
                        : "It starts and ends the same as yours but the middle is different. Scammers and viruses make look-alike addresses like this so nobody notices the swap."}
                </p>
                <p>{pasted ? "Delete what you pasted and put your address in with ;btc (or the right word), or copy it again from your wallet. If this keeps happening, scan your computer for viruses." : "Your message wasn't sent. Fix the address — or type ;btc, ;eth… to put your real one in — then send it again."}</p>
                <div className="vc-tool-footer"><span className="vc-tool-spacer" /><button type="button" className="vc-tool-btn vc-tool-primary" onClick={modalProps.onClose}>OK</button></div>
            </div>
        </Modal>
    );
}
const warnSwap = (found: string, mine: string, pasted = false) => openModal(props => <ErrorBoundary><SwapModal modalProps={props} found={found} mine={mine} pasted={pasted} /></ErrorBoundary>);

/** A pasted address that isn't what you just copied from the wallet. */
function onPaste(e: ClipboardEvent) {
    if (settings.store.swapGuard === false || !lastCopy.text || Date.now() - lastCopy.at > 10 * 60_000) return;
    if (!(e.target as HTMLElement | null)?.closest?.('[role="textbox"], textarea, input')) return;
    const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
    if (!text || text === lastCopy.text) return;
    const copied = lastCopy.text.match(ADDRESS_LIKE)?.[0];
    const pasted = text.match(ADDRESS_LIKE)?.[0];
    // Only when an address went in and a different address came out.
    if (copied && pasted && pasted !== copied && text.length < copied.length + 20) warnSwap(pasted, copied, true);
}

/* ── Sending ── */

const WORDS = new Map(KINDS.map(k => [k.word, k.id]));

function insertWords(content: string) {
    return content.replace(/(^|\s);([a-z]{3,7})(?=$|[\s.,!?])/gi, (all, lead: string, word: string) => {
        const kind = WORDS.get(word.toLowerCase());
        const e = kind && firstOf(kind);
        if (!e) return all;
        const k = kindOf(e.kind);
        return lead + (k.crypto ? tidy(e) : linkFor(e) ?? tidy(e));
    });
}

function ChatButton(props: any) {
    if (!props.isMainChat || settings.store.chatButton === false) return null;
    return <ChatBarButton tooltip="Wallet" onClick={openWallet}><WalletIcon /></ChatBarButton>;
}
const WalletButton: ChatBarButtonFactory = props => <ChatButton {...props} />;

export default definePlugin({
    name: "Wallet",
    description: "Keep your PayPal, Cash App, Venmo, Zelle, crypto addresses (Bitcoin, Ethereum, Solana, Litecoin, USDT, USDC) and Roblox in one place — hidden until you show them, one click to copy, QR codes, and ;paypal or ;btc in chat. Addresses are checked for typos, and it warns you if one gets swapped. Kept only on this computer.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: openWallet,
    chatBarButton: { icon: WalletIcon as any, render: WalletButton },

    onBeforeMessageSend(_channelId: string, msg: { content: string; }) {
        if (!msg?.content) return;
        if (settings.store.quickInsert !== false && msg.content.includes(";")) msg.content = insertWords(msg.content);
        if (settings.store.swapGuard === false) return;
        const mine = savedAddresses();
        if (!mine.length) return;
        for (const found of msg.content.match(ADDRESS_LIKE) ?? []) {
            const real = lookalike(found, mine);
            if (real) {
                warnSwap(found, real);
                return { cancel: true };
            }
        }
    },

    async start() {
        await loadWallet();
        document.addEventListener("paste", onPaste, true);
        applyAlerts();
        applyQr();
        startAlerts();
    },

    stop() {
        document.removeEventListener("paste", onPaste, true);
        stopAlerts();
    },
});
