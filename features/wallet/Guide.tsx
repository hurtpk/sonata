/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How to turn crypto into US dollars: send it to an exchange, sell it there,
// and withdraw to your bank — with notes for each coin and where to go.

import ErrorBoundary from "@components/ErrorBoundary";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal } from "@webpack/common";

import { KindId, kindOf } from "./kinds";

const open = (url: string) => VencordNative.native.openExternal(url);

const PLACES: { name: string; url: string; what: string; }[] = [
    { name: "Coinbase", url: "https://www.coinbase.com", what: "Takes Bitcoin, Ethereum, Solana, Litecoin, USDC and USDT. USDC turns into dollars 1:1." },
    { name: "Kraken", url: "https://www.kraken.com", what: "Takes all of these coins, on more networks than most." },
    { name: "Gemini", url: "https://www.gemini.com", what: "Takes Bitcoin, Ethereum, Solana, Litecoin and USDC." },
    { name: "Cash App", url: "https://cash.app/bitcoin", what: "Bitcoin only — sells straight into your Cash App balance." },
    { name: "PayPal", url: "https://www.paypal.com/us/digital-wallet/manage-money/crypto", what: "Some coins, like Bitcoin, Ethereum and Litecoin — check PayPal's list first." },
];

const NOTES: Partial<Record<KindId, string>> = {
    btc: "Bitcoin is the easiest to cash out — every place below takes it, and Cash App can do it in a few taps.",
    eth: "Coinbase, Kraken, Gemini and PayPal take Ethereum. Send it on Ethereum itself, not another network like Base.",
    sol: "Coinbase, Kraken and Gemini take Solana.",
    ltc: "Coinbase, Kraken, Gemini and PayPal take Litecoin.",
    usdt: "USDT is worth about $1 each. Not every place takes every network — check that the exchange accepts USDT on your network (Tron in particular) before sending.",
    usdc: "USDC is worth $1 each, and Coinbase turns it into dollars 1:1. Check the exchange accepts your network (Ethereum, Solana, Base…) before sending.",
};

const STEPS: [string, string][] = [
    ["Make an account on an exchange", "Pick one below. You'll need to verify your ID, which can take a day the first time. You have to be 18 or older — if you're not, ask a parent or guardian to do it with you."],
    ["Find your deposit address there", "Search for the coin, choose Receive or Deposit, and pick the same network your crypto is on. Copy that address."],
    ["Send it — a little first", "From the wallet holding the crypto, send a small test amount to that address. Once it arrives, send the rest."],
    ["Sell it for dollars", "When it shows up on the exchange, choose Sell (or Convert) to USD."],
    ["Withdraw to your bank", "Link your bank and withdraw the dollars. Bank transfers are usually free and take 1–5 working days."],
];

function GuideModal({ modalProps, kind }: { modalProps: RenderModalProps; kind?: KindId; }) {
    const k = kind ? kindOf(kind) : null;
    return (
        <Modal {...modalProps} size="md" title={k ? `Turning ${k.name} into US dollars` : "Turning crypto into US dollars"} subtitle="Send it to an exchange, sell it there, and withdraw to your bank">
            <div className="vc-tool-wrap vc-wallet-guide">
                {k && NOTES[k.id] && (
                    <div className="vc-wallet-guide-note" style={{ "--k": k.color } as React.CSSProperties}>
                        <span className="vc-wallet-badge" style={{ background: k.color }}>{k.glyph}</span>
                        <span>{NOTES[k.id]}</span>
                    </div>
                )}

                <ol className="vc-wallet-steps">
                    {STEPS.map(([head, body], i) => (
                        <li key={i}><b>{head}</b><span>{body}</span></li>
                    ))}
                </ol>

                <section className="vc-tool-section">
                    <span className="vc-tool-label">Where to do it</span>
                    <div className="vc-tool-list">
                        {PLACES.map(p => (
                            <button key={p.name} type="button" className="vc-tool-item vc-wallet-place" onClick={() => open(p.url)}>
                                <span className="vc-tool-item-main"><span className="vc-tool-item-title">{p.name} ↗</span><span className="vc-tool-item-sub">{p.what}</span></span>
                            </button>
                        ))}
                    </div>
                    <span className="vc-tool-hint">These open in your browser. Always type the exchange's address yourself or use its app — never a link someone sent you.</span>
                </section>

                <section className="vc-tool-section">
                    <span className="vc-tool-label">Good to know</span>
                    <ul className="vc-wallet-tips">
                        <li><b>Fees:</b> sending costs a small network fee, and selling usually costs 0.5–2%.</li>
                        <li><b>The network matters:</b> crypto sent on the wrong network usually can't be got back.</li>
                        <li><b>Taxes:</b> in the US, selling crypto for more than you got it for counts as income. <button type="button" className="vc-tool-link" onClick={() => open("https://www.irs.gov/filing/digital-assets")}>The IRS explains it here ↗</button></li>
                        <li><b>Scams:</b> no real exchange makes you pay a fee to “unlock” a withdrawal, or asks you to send crypto to “verify” your wallet. Anyone who does is stealing.</li>
                    </ul>
                </section>
            </div>
        </Modal>
    );
}

export const openGuide = (kind?: KindId) => openModal(props => <ErrorBoundary><GuideModal modalProps={props} kind={kind} /></ErrorBoundary>);
