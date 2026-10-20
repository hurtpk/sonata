/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The wallet window: your payment links and addresses as cards, hidden until
// you choose to show one — with copy, QR code, edit and delete — plus adding
// new ones (checked as you type) and sending a few to chat.

import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useMemo, UserStore, useState } from "@webpack/common";

import { Window } from "../_shared/Window";
import { makeQr, qrPng } from "../qrCodes/qr";
import { alerts, checkNow, lastSeen, onStatus, status } from "./alerts";
import { openGuide } from "./Guide";
import { chatLine, Check, check, Entry, KindId, kindOf, KINDS, linkFor, networkName, qrFor, robloxItemKind, tidy } from "./kinds";
import { OwedView } from "./OwedView";
import { checkBalance, coinAmount, COINS, usd, usePrices } from "./prices";
import { qrCardPng } from "./qrCard";
import { RequestsView } from "./RequestsView";
import { lastCopy, moveEntry, putEntry, qrPrefs, removeEntry, useWallet } from "./store";

/* ── Icons ── */

export function WalletIcon({ size = 20, className }: { size?: number; className?: string; }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 18.5 8H5.5A2.5 2.5 0 0 1 3 6.5" />
            <circle cx="16" cy="14" r="1.4" fill="currentColor" stroke="none" />
        </svg>
    );
}

const Eye = ({ open }: { open: boolean; }) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {open ? <>
            <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
            <circle cx="12" cy="12" r="3" />
            <circle cx="13.2" cy="10.8" r="0.9" fill="currentColor" stroke="none" />
        </> : <>
            <path d="M3 3l18 18" />
            <path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.5 6.6C3.9 8.3 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.4 9.4 0 0 0 4.6-1.2" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>}
    </svg>
);

const RedX = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
);

const Badge = ({ kind, size = 36 }: { kind: KindId; size?: number; }) => {
    const k = kindOf(kind);
    return <span className="vc-wallet-badge" style={{ background: k.color, width: size, height: size, fontSize: size * 0.5 }}>{k.glyph}</span>;
};

function Qr({ text }: { text: string; }) {
    const qr = useMemo(() => { try { return makeQr(text); } catch { return null; } }, [text]);
    if (!qr) return null;
    return (
        <svg className="vc-wallet-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" aria-label="QR code">
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.path} fill="#000" />
        </svg>
    );
}

/** Your name for "Pay …" on QR pictures: the one you set, or your Discord name. */
const payName = () => qrPrefs.name.trim() || (UserStore.getCurrentUser() as any)?.globalName || UserStore.getCurrentUser()?.username || "";
const qrPicture = (e: Entry, card: boolean) => card ? qrCardPng(e, payName()) : qrPng(qrFor(e));

async function copyQr(e: Entry, card: boolean) {
    try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": await qrPicture(e, card) })]);
        showToast("QR code copied as a picture", "success");
    } catch { showToast("Couldn't copy the picture", "failure"); }
}

async function saveQr(e: Entry, card: boolean) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await qrPicture(e, card));
    a.download = `${kindOf(e.kind).name.toLowerCase().replace(/s+/g, "-")}-qr.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** The QR as it'll be shared — plain, or on its card. */
function QrPreview({ e, card }: { e: Entry; card: boolean; }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!card) { setUrl(null); return; }
        let alive = true, made: string | null = null;
        void qrCardPng(e, payName()).then(b => { made = URL.createObjectURL(b); if (alive) setUrl(made); else URL.revokeObjectURL(made); });
        return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    }, [card, qrFor(e), e.label, e.network]);
    if (!card) return <Qr text={qrFor(e)} />;
    return url ? <img className="vc-wallet-qr-card" src={url} alt="QR card" /> : <div className="vc-wallet-qr-card" />;
}

const copy = (text: string, what: string) => {
    copyToClipboard(text);
    lastCopy.text = text;
    lastCopy.at = Date.now();
    showToast(`Copied your ${what}`, "success");
};

/* ── One card ── */

const CopyIcon = () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
);

const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function Card({ e, picking, picked, onPick, onEdit, first, last, price }: { e: Entry; picking: boolean; picked: boolean; onPick(): void; onEdit(): void; first: boolean; last: boolean; price?: number; }) {
    const [shown, setShown] = useState(false);
    const [qr, setQr] = useState(false);
    const [card, setCard] = useState(qrPrefs.card);
    const toggleCard = (on: boolean) => { setCard(on); qrPrefs.set(on); };
    const [sure, setSure] = useState(false);
    const [bal, setBal] = useState<{ loading?: boolean; amount?: number; error?: string; at?: number; } | null>(() => {
        const s = lastSeen(e);
        return s != null ? { amount: s, at: status.lastCheck } : null;
    });
    const askBalance = (fresh = false) => {
        setShown(true);
        setBal({ loading: true });
        void checkBalance(e, fresh).then(r => setBal(r.ok ? { amount: r.amount, at: Date.now() } : { error: r.error }));
    };
    const k = kindOf(e.kind);
    const symbol = e.kind.toUpperCase();
    const value = tidy(e);
    const link = linkFor(e);
    const sub = networkName(e) ?? (k.crypto ? `${k.name} network` : e.kind === "roblox" ? "Robux" : "Payment app");

    return (
        <div className={classes("vc-wallet-card", picking && "vc-wallet-card-picking", picking && picked && "vc-wallet-card-picked")} style={{ "--k": k.color } as React.CSSProperties} onClick={picking ? onPick : undefined}>
            <div className="vc-wallet-card-head">
                {picking && <input type="checkbox" className="vc-wallet-check" checked={picked} readOnly />}
                <Badge kind={e.kind} size={40} />
                <div className="vc-wallet-card-title">
                    <b>{k.name}{e.label ? <span> · {e.label}</span> : null}</b>
                    <span>{sub}</span>
                </div>
                {!picking && (
                    <div className="vc-wallet-actions">
                        <button type="button" className="vc-wallet-btn" title={shown ? "Hide it again" : "Show it"} onClick={() => { setShown(v => !v); if (shown) setQr(false); }}>
                            <Eye open={!shown} />{shown ? "Hide" : "Show"}
                        </button>
                        <button type="button" className="vc-wallet-btn" onClick={onEdit}>Edit</button>
                        {sure ? (
                            <span className="vc-wallet-sure">
                                <button type="button" className="vc-wallet-btn vc-wallet-btn-danger" onClick={() => removeEntry(e.id)}>Delete</button>
                                <button type="button" className="vc-wallet-btn" onClick={() => setSure(false)}>Keep</button>
                            </span>
                        ) : (
                            <button type="button" className="vc-wallet-x" title="Delete" onClick={() => setSure(true)}><RedX /></button>
                        )}
                    </div>
                )}
            </div>

            <div className="vc-wallet-valuebox">
                {shown
                    ? <code className="vc-wallet-value">{value}</code>
                    : <span className="vc-wallet-hidden" aria-label="Hidden">{"•".repeat(Math.min(22, Math.max(10, value.length)))}</span>}
                {!picking && <button type="button" className="vc-wallet-copy" title={`Copy your ${k.name}${shown ? "" : " (stays hidden)"}`} onClick={() => copy(value, k.name)}><CopyIcon /></button>}
            </div>

            {shown && (e.note || (e.kind === "roblox" && e.pass)) && (
                <div className="vc-wallet-extra">
                    {e.kind === "roblox" && e.pass && <span>{robloxItemKind(e.pass) === "Game pass" ? "🎟️" : "👕"} {robloxItemKind(e.pass)}: {e.pass}</span>}
                    {e.note && <span>📝 {e.note}</span>}
                </div>
            )}

            {k.crypto && (
                <div className="vc-wallet-money">
                    {shown && bal ? (
                        bal.loading ? <span className="vc-wallet-muted">Checking the balance…</span>
                            : bal.error ? <span className="vc-wallet-muted">Couldn't check: {bal.error}</span>
                                : <>
                                    <span className="vc-wallet-muted">Balance</span>
                                    <b>{coinAmount(bal.amount!)} {symbol}</b>
                                    {price != null && <span className="vc-wallet-usd">≈ {usd(bal.amount! * price)}</span>}
                                    {bal.at ? <span className="vc-wallet-muted">· {ago(bal.at)}</span> : null}
                                    <button type="button" className="vc-tool-link" title="Check again" onClick={() => askBalance(true)}>↻</button>
                                </>
                    ) : <span className="vc-wallet-muted">{price != null ? <>1 {symbol} = <b>{usd(price)}</b></> : "Getting today's price…"}</span>}
                </div>
            )}

            {!picking && (
                <div className="vc-wallet-card-row">
                    {link && <button type="button" className="vc-tool-chip" onClick={() => copy(link, `${k.name} link`)}>🔗 Copy link</button>}
                    <button type="button" className={classes("vc-tool-chip", qr && "vc-tool-chip-on")} onClick={() => { setQr(v => !v); setShown(true); }}>▦ QR code</button>
                    {k.crypto && <button type="button" className="vc-tool-chip" title="Asks a public blockchain explorer — nothing to sign in to" onClick={() => askBalance(bal?.amount != null)}>💰 {bal?.amount != null ? "Update balance" : "Check balance"}</button>}
                    {k.crypto && <button type="button" className="vc-tool-chip" onClick={() => openGuide(e.kind)}>💵 Cash out</button>}
                    <span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-icon" title="Move up" disabled={first} onClick={() => moveEntry(e.id, -1)}>↑</button>
                    <button type="button" className="vc-tool-icon" title="Move down" disabled={last} onClick={() => moveEntry(e.id, 1)}>↓</button>
                </div>
            )}

            {!picking && qr && shown && (
                <div className="vc-wallet-qr-box">
                    <QrPreview e={e} card={card} />
                    <div className="vc-wallet-qr-side">
                        <span className="vc-tool-hint">{k.crypto ? "Scan with a wallet app to send to this address." : "Scan to open it."}</span>
                        <label className="vc-tool-check"><input type="checkbox" checked={card} onChange={ev => toggleCard(ev.currentTarget.checked)} /> With my name and the {k.crypto ? "coin's" : "app's"} logo</label>
                        <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => void copyQr(e, card)}>Copy as picture</button>
                        <button type="button" className="vc-tool-btn" onClick={() => void saveQr(e, card)}>Save picture</button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── Adding and editing ── */

function Form({ start, onDone }: { start: Entry | null; onDone(): void; }) {
    const [kind, setKind] = useState<KindId>(start?.kind ?? "paypal");
    const [value, setValue] = useState(start?.value ?? "");
    const [network, setNetwork] = useState(start?.network ?? "");
    const [label, setLabel] = useState(start?.label ?? "");
    const [note, setNote] = useState(start?.note ?? "");
    const [pass, setPass] = useState(start?.pass ?? "");
    const [result, setResult] = useState<Check | null>(null);
    const k = kindOf(kind);

    useEffect(() => {
        let alive = true;
        if (!value.trim()) { setResult(null); return; }
        const t = setTimeout(() => void check({ kind, value, network, pass }).then(r => alive && setResult(r)), 200);
        return () => { alive = false; clearTimeout(t); };
    }, [kind, value, network, pass]);

    const save = async () => {
        const r = await check({ kind, value, network, pass });
        setResult(r);
        if (!r.ok) return;
        putEntry({ id: start?.id ?? Math.random().toString(36).slice(2, 10), kind, value: value.trim(), network: k.networks ? network : undefined, label: label.trim() || undefined, note: note.trim() || undefined, pass: kind === "roblox" ? pass.trim() || undefined : undefined });
        showToast(start ? "Saved" : `Added your ${k.name}`, "success");
        onDone();
    };

    return (
        <div className="vc-wallet-form">
            <span className="vc-tool-label">{start ? "Edit" : "Add to your wallet"}</span>
            <div className="vc-wallet-kinds">
                {KINDS.map(x => (
                    <button key={x.id} type="button" className={classes("vc-wallet-kind", kind === x.id && "vc-wallet-kind-on")} onClick={() => { setKind(x.id); setNetwork(""); }}>
                        <Badge kind={x.id} size={28} /><span>{x.name}</span>
                    </button>
                ))}
            </div>

            {k.networks && (
                <div className="vc-wallet-field">
                    <span className="vc-tool-label">Network</span>
                    <div className="vc-tool-chips">
                        {k.networks.map(n => <button key={n.id} type="button" className={classes("vc-tool-chip", network === n.id && "vc-tool-chip-on")} onClick={() => setNetwork(n.id)}>{n.name}</button>)}
                    </div>
                </div>
            )}

            <div className="vc-wallet-field">
                <span className="vc-tool-label">{k.crypto ? "Address" : kind === "roblox" ? "Username" : kind === "zelle" ? "Email or phone" : "Username or link"}</span>
                <input className={classes("vc-tool-input", result && !result.ok && "vc-wallet-input-bad")} value={value} placeholder={k.placeholder} spellCheck={false} autoFocus
                    onChange={e => setValue(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") void save(); }} />
                <span className={classes("vc-tool-hint", result && !result.ok && "vc-wallet-bad", result?.ok && !result.warn && "vc-wallet-good")}>
                    {result ? (result.ok ? (result.warn ? `⚠ ${result.message}` : "✓ Looks right") : result.message) : k.hint}
                </span>
            </div>

            {kind === "roblox" && (
                <div className="vc-wallet-field">
                    <span className="vc-tool-label">Game pass or catalog item link (optional)</span>
                    <input className="vc-tool-input" value={pass} placeholder="roblox.com/game-pass/12345 or roblox.com/catalog/12345" spellCheck={false} onChange={e => setPass(e.currentTarget.value)} />
                    <span className="vc-tool-hint">A game pass, shirt, pants or other item people can buy to pay you Robux.</span>
                </div>
            )}

            <div className="vc-wallet-two">
                <div className="vc-wallet-field">
                    <span className="vc-tool-label">Name (optional)</span>
                    <input className="vc-tool-input" value={label} maxLength={30} placeholder="Main, For trades…" onChange={e => setLabel(e.currentTarget.value)} />
                </div>
                <div className="vc-wallet-field">
                    <span className="vc-tool-label">Note (optional)</span>
                    <input className="vc-tool-input" value={note} maxLength={120} placeholder="Only for friends…" onChange={e => setNote(e.currentTarget.value)} />
                </div>
            </div>

            <div className="vc-tool-footer">
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn" onClick={onDone}>Cancel</button>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!result?.ok} onClick={() => void save()}>{start ? "Save" : "Add"}</button>
            </div>
        </div>
    );
}

/* ── The converter: two boxes, type in either one ── */

function Converter({ prices }: { prices: Record<string, number> | null; }) {
    const [coin, setCoin] = useState<KindId>("btc");
    const [coinText, setCoinText] = useState("1");
    const [usdText, setUsdText] = useState("");
    const [edited, setEdited] = useState<"coin" | "usd">("coin");
    const price = prices?.[coin];
    const num = (s: string) => { const n = Number(s.replace(/[,$\s]/g, "")); return Number.isFinite(n) ? n : NaN; };
    const fmtCoin = (n: number) => n === 0 ? "0" : n >= 1 ? String(Number(n.toFixed(6))) : String(Number(n.toPrecision(6)));
    const fmtUsd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fromCoin = (v: string) => { const n = num(v); return price == null || Number.isNaN(n) || !v.trim() ? "" : fmtUsd(n * price); };
    const fromUsd = (v: string) => { const n = num(v); return price == null || Number.isNaN(n) || !v.trim() ? "" : fmtCoin(n / price); };

    // Whichever side you typed in stays; the other follows the price.
    useEffect(() => {
        if (price == null) return;
        if (edited === "coin") setUsdText(fromCoin(coinText)); else setCoinText(fromUsd(usdText));
    }, [price, coin]);

    const typeCoin = (v: string) => { setEdited("coin"); setCoinText(v); setUsdText(fromCoin(v)); };
    const typeUsd = (v: string) => { setEdited("usd"); setUsdText(v); setCoinText(fromUsd(v)); };
    const k = kindOf(coin);
    const sym = coin.toUpperCase();
    // The box on the left is the one you type in; the arrow swaps them.
    const [flipped, setFlipped] = useState(false);
    const swap = () => { setFlipped(f => !f); setEdited(flipped ? "coin" : "usd"); };
    // Long numbers get smaller instead of being cut off.
    const size = (v: string) => ({ fontSize: v.length > 11 ? 15 : v.length > 8 ? 18 : 22 });
    const coinBox = (
        <label className="vc-wallet-field-box">
            <span>{k.name}</span>
            <input inputMode="decimal" value={coinText} placeholder="0" style={size(coinText)} onChange={e => typeCoin(e.currentTarget.value)} />
            <i>{sym}</i>
        </label>
    );
    const usdBox = (
        <label className="vc-wallet-field-box">
            <span>US dollars</span>
            <input inputMode="decimal" value={usdText} placeholder="0.00" style={size(usdText)} onChange={e => typeUsd(e.currentTarget.value)} />
            <i>USD</i>
        </label>
    );
    const quick = flipped ? ["10", "25", "50", "100"] : coin === "btc" ? ["0.001", "0.01", "0.1", "1"] : coin === "usdt" || coin === "usdc" ? ["10", "50", "100", "500"] : ["0.1", "1", "5", "10"];

    return (
        <section className="vc-wallet-panel vc-wallet-conv">
            <div className="vc-wallet-panel-head"><b>🪙 Converter</b><span>{price != null ? `1 ${sym} = ${usd(price)} right now` : prices ? `No price for ${k.name} right now` : "Getting today's prices…"}</span></div>
            <div className="vc-wallet-coins">
                {COINS.map(c => (
                    <button key={c} type="button" className={classes("vc-wallet-coin", coin === c && "vc-wallet-coin-on")} style={{ "--k": kindOf(c).color } as React.CSSProperties} onClick={() => setCoin(c)}>
                        <Badge kind={c} size={22} /><span>{c.toUpperCase()}</span>
                    </button>
                ))}
            </div>
            <div className={classes("vc-wallet-conv-row", flipped && "vc-wallet-conv-flipped")}>
                {flipped ? usdBox : coinBox}
                <button type="button" className="vc-wallet-conv-swap" title="Swap" aria-label={flipped ? "Put the coin first" : "Put dollars first"} onClick={swap}>⇄</button>
                {flipped ? coinBox : usdBox}
            </div>
            <div className="vc-wallet-quick">
                {quick.map(q => <button key={q} type="button" className="vc-tool-chip" onClick={() => flipped ? typeUsd(q) : typeCoin(q)}>{flipped ? `$${q}` : `${q} ${sym}`}</button>)}
            </div>
        </section>
    );
}

/* ── Payment alerts ── */

function Alerts({ cryptoCount }: { cryptoCount: number; }) {
    const [, bump] = useState(0);
    useEffect(() => onStatus(() => bump(n => n + 1)), []);
    const [on, setOn] = useState(alerts.on);
    const [minutes, setMinutes] = useState(alerts.minutes);
    const save = (o: boolean, m: number) => { setOn(o); setMinutes(m); alerts.set(o, m); };
    return (
        <section className="vc-wallet-panel vc-wallet-alerts">
            <div className="vc-wallet-panel-head"><b>🔔 Payment alerts</b><span>A notification when crypto arrives</span></div>
            <label className="vc-wallet-switch">
                <input type="checkbox" checked={on} onChange={e => save(e.currentTarget.checked, minutes)} />
                <span className="vc-wallet-switch-track"><i /></span>
                <span>{on ? "On" : "Off"}</span>
            </label>
            <span className="vc-tool-hint">Check every</span>
            <div className="vc-tool-chips">
                {[5, 15, 30, 60].map(m => <button key={m} type="button" className={classes("vc-tool-chip", minutes === m && "vc-tool-chip-on")} disabled={!on} onClick={() => save(on, m)}>{m < 60 ? `${m} min` : "1 hour"}</button>)}
            </div>
            <span className="vc-tool-hint">
                {status.checking ? "Checking your addresses…" : status.lastCheck ? `Last checked ${ago(status.lastCheck)} · ${cryptoCount} address${cryptoCount === 1 ? "" : "es"}.` : "Not checked yet."}
                {" "}<button type="button" className="vc-tool-link" disabled={status.checking || !cryptoCount} onClick={() => void checkNow()}>Check now</button>
            </span>
            <span className="vc-wallet-fine">Each check asks a public blockchain explorer about your addresses. Nothing to sign in to.</span>
        </section>
    );
}

/* ── The window ── */

function WalletModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const { entries, loaded } = useWallet();
    const [editing, setEditing] = useState<Entry | "new" | null>(null);
    const [tab, setTab] = useState<"wallet" | "requests" | "owed">("wallet");
    const [picking, setPicking] = useState(false);
    const [picked, setPicked] = useState<string[]>([]);
    const crypto = entries.filter(e => kindOf(e.kind).crypto);
    const apps = entries.filter(e => !kindOf(e.kind).crypto);
    const prices = usePrices();

    const send = () => {
        const lines = entries.filter(e => picked.includes(e.id)).map(chatLine);
        if (!lines.length) return;
        insertTextIntoChatInputBox(lines.join("\n"));
        modalProps.onClose();
    };

    const section = (name: string, list: Entry[]) => list.length > 0 && (
        <section className="vc-wallet-section">
            <span className="vc-tool-label">{name} · {list.length}</span>
            <div className="vc-wallet-grid">
                {list.map(e => {
                    const i = entries.indexOf(e);
                    return (
                        <Card key={e.id} e={e} first={i === 0} last={i === entries.length - 1} price={kindOf(e.kind).crypto ? prices?.[e.kind] : undefined}
                            picking={picking} picked={picked.includes(e.id)}
                            onPick={() => setPicked(p => p.includes(e.id) ? p.filter(x => x !== e.id) : [...p, e.id])}
                            onEdit={() => setEditing(e)} />
                    );
                })}
            </div>
        </section>
    );

    return (
        <Window {...modalProps} size="lg" title="Wallet" subtitle="Your payment links and addresses — kept only on this computer"
            tabs={editing || picking ? undefined : [["wallet", "Wallet"], ["requests", "Requests"], ["owed", "Who owes me"]]} tab={tab} onTab={id => setTab(id as typeof tab)}
            status={[`${apps.length} payment app${apps.length === 1 ? "" : "s"} · ${crypto.length} crypto`, "kept only on this computer"]}>
            <div className="vc-tool-wrap vc-wallet">
                {editing ? (
                    <Form start={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
                ) : tab === "requests" ? (
                    <RequestsView entries={entries} />
                ) : tab === "owed" ? (
                    <OwedView close={modalProps.onClose} />
                ) : (
                    <>
                        <div className="vc-wallet-bar">
                            {picking ? <>
                                <span className="vc-tool-hint">Pick what to put in the chat box</span>
                                <span className="vc-tool-spacer" />
                                <button type="button" className="vc-tool-btn" onClick={() => { setPicking(false); setPicked([]); }}>Cancel</button>
                                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!picked.length} onClick={send}>Put {picked.length || ""} in chat box</button>
                            </> : <>
                                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => setEditing("new")}>+ Add</button>
                                {entries.length > 0 && <button type="button" className="vc-tool-btn" onClick={() => setPicking(true)}>Send to chat…</button>}
                                <span className="vc-tool-spacer" />
                                <button type="button" className="vc-tool-link" onClick={() => openGuide()}>💵 Crypto → USD guide</button>
                            </>}
                        </div>

                        {!picking && (
                            <div className={classes("vc-wallet-top", !crypto.length && "vc-wallet-top-one")}>
                                <Converter prices={prices} />
                                {crypto.length > 0 && <Alerts cryptoCount={crypto.length} />}
                            </div>
                        )}

                        {loaded && !entries.length && (
                            <div className="vc-tool-empty">
                                <span className="vc-tool-empty-icon">👛</span>
                                Nothing here yet. Add your PayPal, Cash App, Venmo, Zelle, crypto or Roblox so they're one click away.
                            </div>
                        )}

                        {section("Payment apps", apps)}
                        {section("Crypto", crypto)}

                        {entries.length > 0 && <span className="vc-tool-hint">Tip: type <code>;paypal</code>, <code>;btc</code>, <code>;roblox</code>… in a message and it becomes yours when you send.</span>}
                    </>
                )}
            </div>
        </Window>
    );
}

export const openWallet = () => openModal(props => <ErrorBoundary><WalletModal modalProps={props} /></ErrorBoundary>);
