/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Rates: your own Robux prices ("$5 for every 1,000 Robux"), worked out for
// whatever amount is in the Robux tab — next to Roblox's own buy and DevEx
// rates. Saved on this computer.

import { DataStore } from "@api/index";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useReducer, useState } from "@webpack/common";

import { ROBUX } from "../currencyConverter/robux";

const rb = classNameFactory("vc-rbx-");

export interface Rate {
    id: string;
    name: string;
    /** Money for `per` Robux. */
    price: number;
    per: number;
    currency: string;
    /** Paid with a game pass: Roblox keeps 30%, so the pass has to cost more. */
    gamepass: boolean;
}

const KEY = "Sonata_robloxRates";
let rates: Rate[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, rates);
const newId = () => Math.random().toString(36).slice(2, 9);

async function loadRates() {
    if (loaded) return;
    const got = await DataStore.get<Rate[]>(KEY).catch(() => undefined);
    rates = got ?? [{ id: newId(), name: "My rate", price: 5, per: 1000, currency: "USD", gamepass: false }];
    loaded = true;
    emit();
}

function useRates() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { listeners.add(bump); void loadRates(); return () => void listeners.delete(bump); }, []);
    return rates;
}

/** "10k" → 10000. */
export function amountOf(text: string) {
    const t = text.replace(/[,\s]/g, "").toLowerCase();
    const k = t.endsWith("k") ? 1e3 : t.endsWith("m") ? 1e6 : t.endsWith("b") ? 1e9 : 1;
    const n = Number(t.replace(/[kmb]$/, "")) * k;
    return Number.isFinite(n) && n > 0 ? n : 0;
}

interface Props {
    dir: "from" | "to";
    /** Robux (from) or money in `mine` (to). */
    amount: number;
    mine: string;
    money(n: number, code: string): string;
    /** Money from one currency to another, with the Converter's rates (NaN if unknown). */
    convert(n: number, from: string, to: string): number;
}

const rbx = (n: number) => `R$ ${Math.round(n).toLocaleString()}`;

function Editor({ rate, mine, onDone }: { rate: Rate | null; mine: string; onDone(): void; }) {
    const [name, setName] = useState(rate?.name ?? "");
    const [price, setPrice] = useState(String(rate?.price ?? "5"));
    const [per, setPer] = useState(String(rate?.per ?? "1000"));
    const [currency, setCurrency] = useState(rate?.currency ?? mine);
    const [gamepass, setGamepass] = useState(rate?.gamepass ?? false);
    const p = Number(price.replace(/[^\d.]/g, "")), n = amountOf(per);
    const ok = p > 0 && n > 0;
    const done = () => {
        if (!ok) return;
        const r: Rate = { id: rate?.id ?? newId(), name: name.trim() || `${currency} ${p} / ${n.toLocaleString()}`, price: p, per: n, currency: currency.trim().toUpperCase().slice(0, 4) || "USD", gamepass };
        rates = rate ? rates.map(x => x.id === rate.id ? r : x) : [...rates, r];
        save(); emit(); onDone();
    };
    return (
        <div className={rb("rate-edit")}>
            <input className="vc-tool-input" value={name} placeholder="Name (e.g. My shop, Seller X)" onChange={e => setName(e.currentTarget.value)} />
            <div className={rb("rate-edit-row")}>
                <input className={classes("vc-tool-input", rb("rate-num"))} inputMode="decimal" value={price} onChange={e => setPrice(e.currentTarget.value)} aria-label="Price" />
                <input className={classes("vc-tool-input", rb("rate-cur"))} value={currency} onChange={e => setCurrency(e.currentTarget.value.toUpperCase())} aria-label="Currency" maxLength={4} />
                <span>for every</span>
                <input className={classes("vc-tool-input", rb("rate-num"))} inputMode="numeric" value={per} onChange={e => setPer(e.currentTarget.value)} aria-label="Robux" />
                <span>Robux</span>
            </div>
            <label className={rb("rate-check")}>
                <input type="checkbox" checked={gamepass} onChange={e => setGamepass(e.currentTarget.checked)} />
                Paid with a game pass — Roblox keeps {Math.round(ROBUX.fee * 100)}%, so show what the pass needs to cost
            </label>
            <div className={rb("rate-edit-row")}>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!ok} onClick={done}>{rate ? "Save" : "Add rate"}</button>
                <button type="button" className="vc-tool-btn" onClick={onDone}>Cancel</button>
            </div>
        </div>
    );
}

export function RobuxRates({ dir, amount, mine, money, convert }: Props) {
    const list = useRates();
    const [editing, setEditing] = useState<string | null>(null);

    /** For one rate: what the amount comes to. */
    const work = (price: number, per: number, currency: string, gamepass: boolean) => {
        if (dir === "from") {
            const inRate = amount / per * price;
            const inMine = currency === mine ? inRate : convert(inRate, currency, mine);
            return { main: money(inRate, currency), also: currency !== mine && Number.isFinite(inMine) ? money(inMine, mine) : null, score: Number.isFinite(inMine) ? inMine : inRate, pass: gamepass ? Math.ceil(amount / (1 - ROBUX.fee)) : null };
        }
        const inRate = currency === mine ? amount : convert(amount, mine, currency);
        const robux = Number.isFinite(inRate) ? inRate / price * per : NaN;
        return { main: Number.isFinite(robux) ? rbx(robux) : "Getting exchange rates…", also: null, score: robux, pass: gamepass && Number.isFinite(robux) ? Math.ceil(robux / (1 - ROBUX.fee)) : null };
    };

    const rows = list.map(r => ({ r, w: work(r.price, r.per, r.currency, r.gamepass) }));
    const best = rows.length > 1 ? rows.reduce((a, b) => (b.w.score > a.w.score ? b : a)).r.id : null;
    const builtIn = [
        { name: "Buying from Roblox", ...work(ROBUX.buy * 1000, 1000, "USD", false), sub: `$${(ROBUX.buy * 1000).toFixed(2)} per 1,000` },
        { name: "Cashing out (DevEx)", ...work(ROBUX.devex * 1000, 1000, "USD", false), sub: `$${(ROBUX.devex * 1000).toFixed(2)} per 1,000` },
    ];

    if (!amount) return null;
    return (
        <div className={rb("rates")}>
            <div className={rb("outfit-head")}>
                <div>
                    <b>💱 Rates</b>
                    <span>{dir === "from" ? `What ${rbx(amount)} comes to at each rate` : `How many Robux ${money(amount, mine)} gets at each rate`}</span>
                </div>
                <span className={rb("spacer")} />
                {editing !== "new" && <button type="button" className={rb("link")} onClick={() => setEditing("new")}>＋ Add a rate</button>}
            </div>
            {editing === "new" && <Editor rate={null} mine={mine} onDone={() => setEditing(null)} />}
            {rows.map(({ r, w }) => editing === r.id ? <Editor key={r.id} rate={r} mine={mine} onDone={() => setEditing(null)} /> : (
                <div key={r.id} className={classes(rb("rate"), best === r.id && rb("rate-best"))}>
                    <div className={rb("rate-name")}>
                        <b>{r.name}</b>
                        <span>{money(r.price, r.currency)} for every {r.per.toLocaleString()} Robux{r.gamepass ? " · game pass" : ""}</span>
                    </div>
                    <div className={rb("rate-out")}>
                        <b>{w.main}</b>
                        {w.also && <small>≈ {w.also}</small>}
                        {w.pass != null && <small>game pass price: {rbx(w.pass)}</small>}
                        {best === r.id && <small className={rb("rate-tag")}>{dir === "from" ? "Pays the most" : "Gets the most Robux"}</small>}
                    </div>
                    <button type="button" className="vc-tool-icon" title="Edit" onClick={() => setEditing(r.id)}>✎</button>
                    <button type="button" className="vc-tool-icon" title="Remove" onClick={() => { rates = rates.filter(x => x.id !== r.id); save(); emit(); }}>✕</button>
                </div>
            ))}
            {builtIn.map(b => (
                <div key={b.name} className={classes(rb("rate"), rb("rate-ref"))}>
                    <div className={rb("rate-name")}><b>{b.name}</b><span>Roblox's own · {b.sub}</span></div>
                    <div className={rb("rate-out")}><b>{b.main}</b>{b.also && <small>≈ {b.also}</small>}</div>
                </div>
            ))}
            {!list.length && <span className="vc-tool-hint">Add your own rate — like $5 for every 1,000 Robux — to see what any amount comes to.</span>}
        </div>
    );
}
