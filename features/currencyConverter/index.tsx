/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Converter: type any amount — "5 ft 3 in", "72°F", "100 USD", "3pm EST",
// "2 h 30 min", "0xff" — and see it in every other unit (see Panel). Also,
// prices and measurements in messages ("$20", "£15", "5 miles", "6'2\"")
// shown in your own currency and units on a small line under the message,
// when you hover it or always. Exchange rates update twice a day.
// (The feature's key is still "currencyConverter", so settings carry over.)

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { DataStore } from "@api/index";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconProps, OptionType, PluginNative } from "@utils/types";
import { useEffect, useReducer, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { coinPrice, findCoins } from "./coins";
import { findMeasurements, guessSystem } from "./measurements";
import { openConverter } from "./Panel";

const Native = VencordNative?.pluginHelpers?.Sonata as PluginNative<typeof import("./native")> | undefined;

/** Currency codes people can pick, with their symbols. */
export const CURRENCIES: [string, string, string][] = [
    ["USD", "$", "US dollar"], ["EUR", "€", "Euro"], ["GBP", "£", "British pound"], ["CAD", "CA$", "Canadian dollar"], ["AUD", "A$", "Australian dollar"],
    ["NZD", "NZ$", "New Zealand dollar"], ["JPY", "¥", "Japanese yen"], ["CNY", "CN¥", "Chinese yuan"], ["KRW", "₩", "South Korean won"], ["INR", "₹", "Indian rupee"],
    ["BRL", "R$", "Brazilian real"], ["MXN", "MX$", "Mexican peso"], ["CHF", "CHF", "Swiss franc"], ["SEK", "kr", "Swedish krona"], ["NOK", "kr", "Norwegian krone"],
    ["DKK", "kr", "Danish krone"], ["PLN", "zł", "Polish złoty"], ["CZK", "Kč", "Czech koruna"], ["HUF", "Ft", "Hungarian forint"], ["TRY", "₺", "Turkish lira"],
    ["RUB", "₽", "Russian ruble"], ["UAH", "₴", "Ukrainian hryvnia"], ["ZAR", "R", "South African rand"], ["SGD", "S$", "Singapore dollar"], ["HKD", "HK$", "Hong Kong dollar"],
    ["PHP", "₱", "Philippine peso"], ["IDR", "Rp", "Indonesian rupiah"], ["THB", "฿", "Thai baht"], ["VND", "₫", "Vietnamese dong"], ["MYR", "RM", "Malaysian ringgit"],
    ["ILS", "₪", "Israeli shekel"], ["AED", "AED", "UAE dirham"], ["SAR", "SAR", "Saudi riyal"], ["EGP", "E£", "Egyptian pound"], ["NGN", "₦", "Nigerian naira"],
    ["ARS", "AR$", "Argentine peso"], ["CLP", "CL$", "Chilean peso"], ["COP", "CO$", "Colombian peso"], ["PEN", "S/", "Peruvian sol"], ["TWD", "NT$", "New Taiwan dollar"],
];

const CODES = new Set(CURRENCIES.map(c => c[0]));

export const settings = defineFeatureSettings("currencyConverter", {
    target: {
        type: OptionType.SELECT,
        description: "Your currency",
        options: CURRENCIES.map(([code, sym, name]) => ({ label: `${name} (${code}${sym !== code ? ` · ${sym}` : ""})`, value: code, default: code === "USD" })),
    },
    dollarIs: {
        type: OptionType.SELECT,
        description: "A plain \"$\" means",
        options: [
            { label: "US dollars", value: "USD", default: true },
            { label: "Canadian dollars", value: "CAD" },
            { label: "Australian dollars", value: "AUD" },
            { label: "My currency, if it's a dollar", value: "mine" },
        ],
    },
    measurements: {
        type: OptionType.BOOLEAN,
        description: "Also convert measurements in messages (miles, °F, lbs… into your units)",
        default: true,
    },
    favoritesJson: { type: OptionType.STRING, description: "Internal: conversions you starred.", default: "", hidden: true },
    recentJson: { type: OptionType.STRING, description: "Internal: your last conversions.", default: "", hidden: true },
    clocksJson: { type: OptionType.STRING, description: "Internal: the places pinned in World clock.", default: "", hidden: true },
    crypto: {
        type: OptionType.BOOLEAN,
        description: "Also show crypto amounts in messages in your currency (0.01 btc, 2 eth, 100 usdt…) — checks today's price with CoinGecko",
        default: true,
    },
    system: {
        type: OptionType.SELECT,
        description: "Your units",
        options: [
            { label: "Work it out from my language", value: "auto", default: true },
            { label: "Metric (km, kg, °C)", value: "metric" },
            { label: "Imperial (miles, lbs, °F)", value: "imperial" },
        ],
    },
    when: {
        type: OptionType.SELECT,
        description: "Show conversions under messages",
        options: [
            { label: "When I hover the message", value: "hover", default: true },
            { label: "Always", value: "always" },
        ],
    },
});

// ─── Finding prices ───

/** Symbols (longest first, so "CA$" wins over "$"). */
const SYMBOLS: [string, string][] = [
    ["CA$", "CAD"], ["A$", "AUD"], ["NZ$", "NZD"], ["US$", "USD"], ["HK$", "HKD"], ["S$", "SGD"], ["R$", "BRL"], ["MX$", "MXN"], ["NT$", "TWD"],
    ["€", "EUR"], ["£", "GBP"], ["¥", "JPY"], ["₩", "KRW"], ["₹", "INR"], ["₽", "RUB"], ["₺", "TRY"], ["₴", "UAH"], ["₱", "PHP"], ["₫", "VND"], ["₪", "ILS"], ["₦", "NGN"], ["฿", "THB"], ["$", "$"],
];
const esc = (s: string) => s.replace(/[$^*+?.()|[\]{}\\]/g, "\\$&");
const NUM = String.raw`(\d{1,3}(?:[,\s.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(k|m|bn)?\b`;
const SYM_RE = new RegExp(`(${SYMBOLS.map(s => esc(s[0])).join("|")})\\s?${NUM}`, "gi");
const CODE_AFTER_RE = new RegExp(`${NUM}\\s?(${[...CODES].join("|")})\\b`, "g");
const CODE_BEFORE_RE = new RegExp(`\\b(${[...CODES].join("|")})\\s?${NUM}`, "g");

function parseAmount(raw: string, suffix?: string) {
    let s = raw.replace(/\s/g, "");
    // "1.234,56" (European) vs "1,234.56": the last separator with 1–2 digits after it is the decimal point.
    const m = s.match(/[.,](\d{1,2})$/);
    if (m) s = `${s.slice(0, -m[0].length).replace(/[.,]/g, "")}.${m[1]}`;
    else s = s.replace(/[.,]/g, "");
    let n = Number(s);
    const k = suffix?.toLowerCase();
    if (k === "k") n *= 1e3; else if (k === "m") n *= 1e6; else if (k === "bn") n *= 1e9;
    return Number.isFinite(n) ? n : NaN;
}

export interface Price { text: string; amount: number; code: string; }

export function findPrices(content: string): Price[] {
    const out: Price[] = [];
    const seen = new Set<string>();
    const add = (text: string, amount: number, code: string) => {
        if (!amount || !CODES.has(code) && code !== "$") return;
        const key = `${code}:${amount}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ text: text.trim(), amount, code });
    };
    // Code blocks and links aren't prices.
    const text = content.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g, " ");
    for (const m of text.matchAll(SYM_RE)) add(m[0], parseAmount(m[2], m[3]), SYMBOLS.find(s => s[0].toLowerCase() === m[1].toLowerCase())?.[1] ?? "$");
    for (const m of text.matchAll(CODE_AFTER_RE)) add(m[0], parseAmount(m[1], m[2]), m[3]);
    for (const m of text.matchAll(CODE_BEFORE_RE)) add(m[0], parseAmount(m[2], m[3]), m[1]);
    return out.slice(0, 6);
}

// ─── Rates ───

const RATES_KEY = "Sonata_currency_rates";
const MAX_AGE = 12 * 60 * 60 * 1000;
let rates: { base: string; at: number; rates: Record<string, number>; } | null = null;
let loading = false;
const listeners = new Set<() => void>();

export const mySystem = (): "metric" | "imperial" => settings.store.system === "metric" || settings.store.system === "imperial" ? settings.store.system : guessSystem();

export const onRatesChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const currentRates = () => rates;

export async function ensureRates() {
    const base = settings.store.target;
    if (rates && rates.base === base && Date.now() - rates.at < MAX_AGE) return;
    if (loading) return;
    loading = true;
    try {
        const saved = await DataStore.get(RATES_KEY);
        if (saved?.base === base && Date.now() - saved.at < MAX_AGE) { rates = saved; return; }
        const res = await Native?.fetchExchangeRates(base);
        if (res?.ok && res.rates) {
            rates = { base, at: Date.now(), rates: res.rates };
            void DataStore.set(RATES_KEY, rates);
        } else if (saved?.base === base) rates = saved;
    } finally {
        loading = false;
        listeners.forEach(l => l());
    }
}

/** The amount in your currency, or null if a rate is missing. */
function convert(p: Price): number | null {
    if (!rates) return null;
    let { code } = p;
    if (code === "$") code = settings.store.dollarIs === "mine" ? (["USD", "CAD", "AUD", "NZD", "SGD", "HKD"].includes(rates.base) ? rates.base : "USD") : settings.store.dollarIs;
    if (code === rates.base) return null;
    const r = rates.rates[code];
    return r ? p.amount / r : null;
}

export const money = (n: number, code: string) => {
    try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
    } catch {
        return `${n.toFixed(2)} ${code}`;
    }
};

const Conversions = ErrorBoundary.wrap(({ content }: { content: string; }) => {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        listeners.add(bump);
        void ensureRates();
        return () => void listeners.delete(bump);
    }, []);
    const prices = findPrices(content);
    const rows = prices.map(p => ({ p, v: convert(p) })).filter(r => r.v != null);
    const measures = settings.store.measurements !== false ? findMeasurements(content, mySystem()) : [];
    const coins = settings.store.crypto !== false ? findCoins(content) : [];
    const base = rates?.base ?? "USD";
    const [coinPrices, setCoinPrices] = useState<Record<string, number | null>>({});
    const coinKey = coins.map(c => c.coin).join(",") + ":" + base;
    useEffect(() => {
        if (!coins.length) return;
        let alive = true;
        void Promise.all(coins.map(async c => [c.coin, await coinPrice(c.coin, base)] as const))
            .then(list => { if (alive) setCoinPrices(Object.fromEntries(list)); });
        return () => { alive = false; };
    }, [coinKey]);
    const coinRows = coins.filter(c => coinPrices[c.coin] != null);
    if (!rows.length && !measures.length && !coinRows.length) return null;
    return (
        <div className={`vc-cur-line${settings.store.when === "hover" ? " vc-cur-hover" : ""}`}>
            {rows.length > 0 && <span className="vc-cur-icon" aria-hidden>💱</span>}
            {rows.map(({ p, v }, i) => (
                <span key={i} className="vc-cur-item">
                    <span className="vc-cur-from">{p.text}</span> ≈ <b>{money(v!, rates!.base)}</b>
                </span>
            ))}
            {coinRows.length > 0 && <span className="vc-cur-icon" aria-hidden>🪙</span>}
            {coinRows.map((c, i) => (
                <span key={`c${i}`} className="vc-cur-item">
                    <span className="vc-cur-from">{c.text}</span> ≈ <b>{money(c.amount * coinPrices[c.coin]!, base)}</b>
                </span>
            ))}
            {measures.length > 0 && <span className="vc-cur-icon" aria-hidden>📏</span>}
            {measures.map((m, i) => (
                <span key={`m${i}`} className="vc-cur-item">
                    <span className="vc-cur-from">{m.text}</span> ≈ <b>{m.out}</b>
                </span>
            ))}
        </div>
    );
}, { noop: true });

export function ConverterIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
        </svg>
    );
}

const ConverterButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return <ChatBarButton tooltip="Converter" onClick={() => openConverter()}><ConverterIcon /></ChatBarButton>;
};

export default definePlugin({
    name: "Converter",
    description: "Type any amount — \"5 ft 3 in\", \"72°F\", \"100 USD\", \"3pm EST\", \"2 h 30 min\", \"0xff\" — and see it in every other unit: currency, length, weight, volume & cooking, temperature, speed & wind, time, time zones, data, energy, pressure, fuel economy, shoe sizes, number systems and more. Prices and measurements in messages also get converted to your currency and units.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openConverter(),
    chatBarButton: { icon: ConverterIcon, render: ConverterButton },

    renderMessageAccessory: ({ message }: Record<string, any>) => {
        const content: string = message?.content ?? "";
        // Cheap check first: anything that could be a price or a measurement at all.
        if (!/\d/.test(content) || !/[$€£¥₩₹₽₺₴₱₫₪₦฿°'"]|\b[A-Z]{3}\b|\d\s?[a-z]/i.test(content)) return null;
        // Only messages that really have something to convert get the line (and its listener).
        if (!findPrices(content).length && !(settings.store.measurements !== false && findMeasurements(content, mySystem()).length) && !(settings.store.crypto !== false && findCoins(content).length)) return null;
        return <Conversions content={content} />;
    },
});
