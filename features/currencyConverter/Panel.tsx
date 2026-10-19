/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useEffect, useMemo, useReducer, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { CURRENCIES, currentRates, ensureRates, findPrices, money, mySystem, onRatesChange, settings } from "./index";
import { askFor, priceResult, usePrice } from "./prices";
import { robuxResult } from "./robux";
import { localZone, parseNumberSystem, parseZoneTime, SHOW_ZONES, timeIn, zoneName } from "./special";
import { CATEGORIES, categoryById, compound, convertUnit, formatNumber, parseQuantity, Unit } from "./units";

const cl = classNameFactory("vc-tool-");
const cv = classNameFactory("vc-conv-");

type Mode = "auto" | "currency" | "tz" | "numbers" | string;

const SPECIAL = [
    { id: "currency", name: "Currency", icon: "💱" },
    { id: "tz", name: "Time zones", icon: "🌍" },
    { id: "numbers", name: "Number systems", icon: "🔢" },
    { id: "crypto", name: "Crypto", icon: "🪙" },
    { id: "stocks", name: "Stocks", icon: "📈" },
    { id: "robux", name: "Robux", icon: "🧱" },
];

const EXAMPLES = ["5 ft 3 in", "72°F", "100 USD", "1 BTC", "$AAPL", "50k robux", "3pm EST", "2 h 30 min", "3 cups", "30 mph", "10 GB", "6 L/100km", "9 UK shoe", "0xff"];

interface Row { value: string; label: string; sub?: string; strong?: boolean; }

/* ── Favourites and recent ── */

interface Saved { text: string; mode: Mode; }
const MAX_RECENT = 10;
const readList = (raw: string | undefined): Saved[] => { try { const j = JSON.parse(raw || "[]"); return Array.isArray(j) ? j.filter(x => typeof x?.text === "string") : []; } catch { return []; } };
const same = (a: Saved, b: Saved) => a.text.trim().toLowerCase() === b.text.trim().toLowerCase() && a.mode === b.mode;
const modeIcon = (m: Mode) => m === "auto" ? "" : SPECIAL.find(k => k.id === m)?.icon ?? CATEGORIES.find(c => c.id === m)?.icon ?? "";

function SavedChips({ favs, recent, onPick, onUnfav, onClearRecent }: { favs: Saved[]; recent: Saved[]; onPick(s: Saved): void; onUnfav(s: Saved): void; onClearRecent(): void; }) {
    const others = recent.filter(r => !favs.some(f => same(f, r)));
    if (!favs.length && !others.length) return null;
    return (
        <div className={cv("saved")}>
            {favs.length > 0 && (
                <div className={cv("saved-row")}>
                    <span className={cv("saved-label")}>⭐ Favourites</span>
                    {favs.map((f, n) => (
                        <span key={`f${n}`} className={classes(cv("chip"), cv("chip-fav"))}>
                            <button type="button" onClick={() => onPick(f)}>{modeIcon(f.mode)} {f.text}</button>
                            <button type="button" className={cv("chip-x")} title="Remove from favourites" onClick={() => onUnfav(f)}>×</button>
                        </span>
                    ))}
                </div>
            )}
            {others.length > 0 && (
                <div className={cv("saved-row")}>
                    <span className={cv("saved-label")}>🕘 Recent</span>
                    {others.slice(0, 8).map((r, n) => (
                        <span key={`r${n}`} className={cv("chip")}><button type="button" onClick={() => onPick(r)}>{modeIcon(r.mode)} {r.text}</button></span>
                    ))}
                    <button type="button" className={cv("saved-clear")} onClick={onClearRecent}>Clear</button>
                </div>
            )}
        </div>
    );
}

function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => showToast("Copied", "success"), () => showToast("Couldn't copy", "failure"));
}

function Rows({ rows }: { rows: Row[]; }) {
    return (
        <div className={cv("rows")}>
            {rows.map((r, i) => (
                <div key={i} className={classes(cv("row"), r.strong && cv("row-strong"))}>
                    <button type="button" className={cv("value")} title="Copy" onClick={() => copy(r.value)}>{r.value}</button>
                    <span className={cv("label")}>{r.label}{r.sub && <span className={cv("sub")}> · {r.sub}</span>}</span>
                    <button type="button" className={cv("ins")} title="Put it in your message" onClick={() => { insertTextIntoChatInputBox(`${r.value} `); showToast("Added to your message", "success"); }}>↵</button>
                </div>
            ))}
        </div>
    );
}

function useRates() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { void ensureRates(); return onRatesChange(bump); }, []);
    return currentRates();
}

/** Units of a kind, the ones in your system first. */
function unitRows(catId: string, value: number, from: Unit, all: boolean): Row[] {
    const cat = categoryById(catId)!;
    const sys = mySystem();
    const units = cat.units.filter(u => all || !u.rare || u === from);
    const rank = (u: Unit) => u === from ? 0 : u.system === sys ? 1 : u.system ? 3 : 2;
    return [...units].sort((a, b) => rank(a) - rank(b)).map(u => {
        const v = convertUnit(value, from, u);
        const nice = compound(cat.id, u, v);
        return { value: `${formatNumber(v)} ${u.symbol}`, label: u.name, sub: nice ?? undefined, strong: u === from };
    });
}

function ConverterModal({ modalProps, initial }: { modalProps: RenderModalProps; initial: string; }) {
    const accent = windowAccent("currencyConverter");
    const rates = useRates();
    const [text, setText] = useState(initial);
    const [mode, setMode] = useState<Mode>("auto");
    const [fromUnit, setFromUnit] = useState<string>("");
    const [showAll, setShowAll] = useState(false);
    const [favs, setFavs] = useState<Saved[]>(() => readList(settings.store.favoritesJson));
    const [recent, setRecent] = useState<Saved[]>(() => readList(settings.store.recentJson));
    const saveFavs = (list: Saved[]) => { setFavs(list); settings.store.favoritesJson = JSON.stringify(list); };
    const saveRecent = (list: Saved[]) => { setRecent(list); settings.store.recentJson = JSON.stringify(list); };
    const current: Saved = { text: text.trim(), mode };
    const starred = !!current.text && favs.some(f => same(f, current));
    const toggleStar = () => starred ? saveFavs(favs.filter(f => !same(f, current))) : saveFavs([current, ...favs].slice(0, 12));
    const pickSaved = (s: Saved) => { setMode(s.mode); setFromUnit(""); setText(s.text); };
    const mine = settings.store.target ?? "USD";
    const ask = useMemo(() => askFor(text, mode), [text, mode]);
    const vs = [...new Set([ask?.kind === "crypto" && ask.to ? ask.to : null, mine, "USD", "EUR", "GBP"].filter(Boolean) as string[])];
    const price = usePrice(ask, vs);

    const result = useMemo((): { title: string; kind: string; rows: Row[]; note?: string; } | null => {
        const q = text.trim();
        if (!q) return null;
        const rbx = robuxResult(mode === "robux" && /^[\d,.]+\s*[kmb]?$/i.test(q) ? `${q} robux` : q, { rates, mine, money, fmt: formatNumber });
        if (rbx && (mode === "auto" || mode === "robux")) return rbx;
        if (mode === "robux") return { title: q, kind: "Robux", rows: [], note: "Try \"50k robux\", \"R$ 1,000\" or \"$100 to robux\"." };
        if (ask) return priceResult(ask, price, { q, mine, rates, money, fmt: formatNumber, currencyName: c => CURRENCIES.find(x => x[0] === c)?.[2] ?? c });
        const bare = q.match(/^-?[\d,]*\.?\d+(?:e-?\d+)?$/) ? Number(q.replace(/,/g, "")) : null;

        // Currency: "100 usd", "$20", "€5 to gbp", or a bare number in Currency mode.
        const currency = (amount: number, code: string, to?: string) => {
            if (!rates) return { title: `${formatNumber(amount)} ${code}`, kind: "Currency", rows: [], note: "Getting exchange rates…" };
            const inBase = code === rates.base ? amount : amount / (rates.rates[code] ?? NaN);
            if (!Number.isFinite(inBase)) return { title: `${amount} ${code}`, kind: "Currency", rows: [], note: `No rate for ${code}` };
            const codes = CURRENCIES.map(c => c[0]).filter(c => c !== code);
            const order = [...(to ? [to] : []), mine, ...codes.filter(c => c !== mine && c !== to)].filter((c, i, a) => a.indexOf(c) === i && c !== code);
            return {
                title: money(amount, code), kind: "Currency",
                rows: order.map(c => ({ value: money(inBase * (c === rates.base ? 1 : rates.rates[c] ?? NaN), c), label: CURRENCIES.find(x => x[0] === c)?.[2] ?? c, strong: c === to || (!to && c === mine) })).filter(r => !r.value.includes("NaN")),
                note: `Rates from ${new Date(rates.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
            };
        };

        if (mode === "currency" || mode === "auto") {
            const to = q.match(/\s(?:to|in|into)\s+([a-z]{3})\s*$/i)?.[1]?.toUpperCase();
            const body = to ? q.replace(/\s(?:to|in|into)\s+[a-z]{3}\s*$/i, "") : q;
            const p = findPrices(body.length > 3 && /^[a-z]{3}\s?\d|\d\s?[a-z]{3}$/i.test(body) ? body.toUpperCase() : body)[0];
            if (p && p.text.length >= body.trim().length - 1) return currency(p.amount, p.code === "$" ? "USD" : p.code, to);
            if (mode === "currency" && bare != null) return currency(bare, fromUnit || "USD");
        }
        if (mode === "tz" || mode === "auto") {
            const t = parseZoneTime(q);
            if (t) {
                const here = localZone(), unix = Math.floor(t.instant / 1000);
                const zones = [here, t.zone, ...SHOW_ZONES].filter((z, i, a) => a.indexOf(z) === i);
                return {
                    title: q, kind: "Time zones",
                    rows: [
                        ...zones.map(z => {
                            const v = timeIn(z, t.instant, t.zone);
                            return { value: `${v.time}${v.dayDiff ? ` (${v.dayDiff > 0 ? "+" : ""}${v.dayDiff} day)` : ""}`, label: z === here ? `${zoneName(z)} — you` : zoneName(z), sub: `${v.weekday} · ${v.offset}`, strong: z === here };
                        }),
                        { value: `<t:${unix}:t>`, label: "Discord timestamp", sub: "everyone sees it in their own time" },
                        { value: `<t:${unix}:R>`, label: "Discord countdown", sub: "\"in 3 hours\"" },
                    ],
                };
            }
            if (mode === "tz") return { title: q, kind: "Time zones", rows: [], note: "Try \"3pm EST\", \"15:30 Tokyo\", \"noon in London\" or \"now\"." };
        }
        if (mode === "numbers" || (mode === "auto" && /^-?(0x[0-9a-f]+|0b[01]+|0o[0-7]+)$|^[mdclxvi]{2,}$/i.test(q.replace(/\s/g, "")))) {
            const n = parseNumberSystem(q);
            if (!n) return mode === "numbers" ? { title: q, kind: "Number systems", rows: [], note: "Type a whole number, 0x… hex, 0b… binary, 0o… octal, or Roman numerals." } : null;
            return {
                title: q, kind: "Number systems",
                rows: [
                    { value: n.decimal, label: "Decimal" }, { value: n.hex, label: "Hexadecimal" }, { value: n.binary, label: "Binary" }, { value: n.octal, label: "Octal" },
                    ...(n.roman ? [{ value: n.roman, label: "Roman numerals" }] : []), { value: n.words, label: "In words" },
                ],
            };
        }

        // Units: typed with a unit, or a bare number with a kind and unit picked.
        if (mode !== "auto" && bare != null) {
            const cat = categoryById(mode);
            const unit = cat?.units.find(u => u.id === fromUnit) ?? cat?.units[0];
            if (cat && unit) return { title: `${formatNumber(bare)} ${unit.symbol}`, kind: cat.name, rows: unitRows(cat.id, bare, unit, showAll) };
        }
        const p = parseQuantity(q, mode === "auto" ? undefined : mode);
        if (p) {
            const rows = unitRows(p.cat.id, p.value, p.unit, showAll);
            if (p.to) {
                const v = convertUnit(p.value, p.unit, p.to);
                rows.unshift({ value: `${formatNumber(v)} ${p.to.symbol}`, label: p.to.name, sub: compound(p.cat.id, p.to, v) ?? undefined, strong: true });
            }
            return { title: p.text, kind: p.cat.name, rows };
        }
        if (bare != null) return { title: q, kind: "", rows: [], note: "Add a unit (like \"100 km\" or \"100 USD\"), or pick a kind on the left." };
        return { title: q, kind: "", rows: [], note: "Not sure what that is. Try one of the examples below." };
    }, [text, mode, fromUnit, rates, showAll, ask, price]);

    // A conversion that's stayed on screen for a moment goes into Recent.
    useEffect(() => {
        if (!current.text || !result?.rows.length) return;
        const t = setTimeout(() => saveRecent([current, ...recent.filter(r => !same(r, current))].slice(0, MAX_RECENT)), 1500);
        return () => clearTimeout(t);
    }, [text, mode, !!result?.rows.length]);

    const pickMode = (m: Mode) => { setMode(m); setFromUnit(""); };
    const top = result?.rows.find(r => r.strong) ?? result?.rows[0];
    const units = mode !== "auto" && mode !== "tz" && mode !== "numbers" && mode !== "crypto" && mode !== "stocks" && mode !== "robux" ? (mode === "currency" ? CURRENCIES.map(c => ({ id: c[0], name: `${c[0]} — ${c[2]}` })) : categoryById(mode)?.units.map(u => ({ id: u.id, name: `${u.symbol} — ${u.name}` })) ?? []) : [];

    return (
        <Modal {...modalProps} size="lg" title="Converter" subtitle="Type an amount with its unit — it shows up in every other one.">
            <div className={classes(cl("wrap"), cv("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <nav className={cv("kinds")}>
                    <button type="button" className={classes(cv("kind"), mode === "auto" && cv("kind-on"))} onClick={() => pickMode("auto")}>✨ Anything</button>
                    {SPECIAL.map(k => <button key={k.id} type="button" className={classes(cv("kind"), mode === k.id && cv("kind-on"))} onClick={() => pickMode(k.id)}>{k.icon} {k.name}</button>)}
                    {CATEGORIES.map(c => <button key={c.id} type="button" className={classes(cv("kind"), mode === c.id && cv("kind-on"))} onClick={() => pickMode(c.id)}>{c.icon} {c.name}</button>)}
                </nav>
                <section className={cv("main")}>
                    <div className={cv("ask")}>
                        <input className={classes(cl("input"), cv("input"))} autoFocus value={text} placeholder={mode === "tz" ? "3pm EST" : mode === "numbers" ? "255, 0xff, 0b1010, XIV" : mode === "robux" ? "50k robux, R$ 1000, $100 to robux" : mode === "crypto" ? "1 btc, 0.5 eth to eur, doge" : mode === "stocks" ? "AAPL, $TSLA, 10 nvda shares, microsoft" : mode === "auto" ? "Try 5 ft 3 in, 72°F, 100 USD, 1 BTC, $AAPL…" : "Type a number"}
                            onChange={e => setText(e.currentTarget.value)} />
                        {current.text && <button type="button" className={classes(cv("star"), starred && cv("star-on"))} title={starred ? "Remove from favourites" : "Add to favourites"} onClick={toggleStar}>{starred ? "★" : "☆"}</button>}
                        {units.length > 0 && (
                            <select className={classes(cl("input"), cv("unit"))} value={fromUnit || units[0].id} onChange={e => setFromUnit(e.currentTarget.value)}>
                                {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                        )}
                    </div>

                    <SavedChips favs={favs} recent={recent} onPick={pickSaved} onUnfav={f => saveFavs(favs.filter(x => !same(x, f)))} onClearRecent={() => saveRecent([])} />

                    {result ? (
                        <>
                            <div className={cv("answer")}>
                                <div className={cv("answer-text")}>
                                    {result.kind && <span className={cv("answer-kind")}>{result.kind}</span>}
                                    <span className={cv("answer-from")}>{result.title}{top ? " =" : ""}</span>
                                    {top && <button type="button" className={cv("answer-big")} title="Copy" onClick={() => copy(top.value)}>{top.value}</button>}
                                    {top && <span className={cv("answer-label")}>{top.label}{top.sub ? ` · ${top.sub}` : ""}</span>}
                                </div>
                                <div className={cv("answer-side")}>
                                    {top && <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={() => { insertTextIntoChatInputBox(`${top.value} `); showToast("Added to your message", "success"); }}>↵ Put in message</button>}
                                    {result.rows.length > 4 && result.kind !== "Currency" && result.kind !== "Time zones" && result.kind !== "Number systems" && (
                                        <button type="button" className={cv("all")} onClick={() => setShowAll(s => !s)}>{showAll ? "Fewer units" : "Every unit"}</button>
                                    )}
                                </div>
                            </div>
                            {result.rows.length > 1 && <Rows rows={result.rows.filter(r => r !== top)} />}
                            {result.note && <span className={cl("hint")}>{result.note}</span>}
                        </>
                    ) : (
                        <div className={cv("examples")}>
                            <span className={cl("hint")}>Some things to try:</span>
                            {EXAMPLES.map(e => <button key={e} type="button" className={cv("example")} onClick={() => { setMode("auto"); setText(e); }}>{e}</button>)}
                        </div>
                    )}
                    <span className={cl("hint")}>Click a result to copy it, or ↵ to put it in your message. Your units: {mySystem() === "metric" ? "metric" : "imperial"} · your currency: {mine} (change in the feature's settings).</span>
                </section>
            </div>
        </Modal>
    );
}

export function openConverter(text = "") {
    openModal(props => <ConverterModal modalProps={props} initial={text} />);
}
