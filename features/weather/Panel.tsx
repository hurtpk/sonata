/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { Window } from "../_shared/Window";
import type { Forecast, Place } from "./native";
import { conditionOf, findPlaces, forecastFor, myPlace, placeLabel, setMyPlace, settings, unitsOf } from "./store";

/* ── Drawn weather pictures (no emoji) ── */

const Svg = ({ size, children }: { size: number; children: ReactNode; }) => (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
const SUN = () => <><circle cx="16" cy="16" r="5.5" fill="#ffc94d" stroke="#ffc94d" /><path stroke="#ffc94d" d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3M7.2 7.2l2.1 2.1M22.7 22.7l2.1 2.1M7.2 24.8l2.1-2.1M22.7 9.3l2.1-2.1" /></>;
const MOON = () => <path fill="#c9d3ff" stroke="#c9d3ff" d="M21.5 20.5A9 9 0 0 1 12 6.6a9 9 0 1 0 12.3 12.1 9 9 0 0 1-2.8 1.8z" />;
const CLOUD = (y = 0, fill = "#c7ccd6") => <path transform={`translate(0 ${y})`} fill={fill} stroke={fill} d="M9.5 24h13.5a5 5 0 0 0 .6-10 7 7 0 0 0-13.5 1.7A4.2 4.2 0 0 0 9.5 24z" />;
const DROPS = () => <path stroke="#62a8ff" d="M11 26l-1.2 3M16 26l-1.2 3M21 26l-1.2 3" />;
const FLAKES = () => <path stroke="#e3f1ff" d="M11 26.5v2.5M9.8 27.7h2.4M16 26.5v2.5M14.8 27.7h2.4M21 26.5v2.5M19.8 27.7h2.4" />;
const BOLT = () => <path fill="#ffd34d" stroke="#ffd34d" strokeWidth={1.2} d="M17 21l-3 5h3l-2 4 5-6h-3l2-3z" />;
const FOG = () => <path stroke="#aeb4bf" d="M6 12h20M4 17h22M7 22h18M9 27h14" />;

export function WeatherIcon({ code, day = true, size = 32 }: { code: number; day?: boolean; size?: number; }) {
    const c = conditionOf(code);
    const orb = day ? SUN() : MOON();
    if (c.kind === "clear") return <Svg size={size}>{orb}</Svg>;
    if (c.kind === "partly") return <Svg size={size}><g transform="translate(-4 -4) scale(.85)">{orb}</g>{CLOUD(2)}</Svg>;
    if (c.kind === "cloudy") return <Svg size={size}>{CLOUD(-2, "#aeb4bf")}</Svg>;
    if (c.kind === "fog") return <Svg size={size}>{FOG()}</Svg>;
    if (c.kind === "snow") return <Svg size={size}>{CLOUD(-5)}{FLAKES()}</Svg>;
    if (c.kind === "storm") return <Svg size={size}>{CLOUD(-5, "#8f96a3")}{BOLT()}</Svg>;
    return <Svg size={size}>{CLOUD(-5)}{DROPS()}</Svg>;
}

/* ── Times in the place's own clock ── */

const shifted = (t: number, offset: number) => new Date(t + offset * 3_600_000);
const hourText = (t: number, offset: number) => shifted(t, offset).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
const clockText = (t: number, offset: number) => shifted(t, offset).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const dayText = (t: number, offset: number, i: number) => i === 0 ? "Today" : shifted(t, offset).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
const deg = (n: number) => `${Math.round(n)}°`;

/** The forecast for a place, kept fresh while it's showing. */
function useForecast(place: Place | null) {
    const [f, setF] = useState<Forecast | null>(null);
    const [error, setError] = useState<string | null>(null);
    const key = place ? `${place.lat},${place.lon},${unitsOf()}` : "";
    useEffect(() => {
        if (!place) return;
        let alive = true;
        setError(null);
        const load = () => void forecastFor(place).then(r => { if (!alive) return; if (typeof r === "string") setError(r); else setF(r); });
        load();
        const t = setInterval(load, 15 * 60_000);
        return () => { alive = false; clearInterval(t); };
    }, [key]);
    return { f: f && place && f.place.lat === place.lat && f.place.lon === place.lon ? f : null, error };
}

/* ── The window ── */

function PlaceSearch({ onPick, autoFocus }: { onPick(p: Place): void; autoFocus?: boolean; }) {
    const [q, setQ] = useState("");
    const [found, setFound] = useState<Place[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const search = async () => {
        if (q.trim().length < 2) return;
        setBusy(true); setError(null);
        const r = await findPlaces(q);
        setBusy(false);
        if (typeof r === "string") setError(r); else setFound(r);
    };
    return (
        <div className="vc-weather-search">
            <div className="vc-weather-search-row">
                <input className="vc-tool-input" autoFocus={autoFocus} value={q} placeholder="A city or town, like Tokyo or Springfield" aria-label="City"
                    onChange={e => { setQ(e.currentTarget.value); setFound(null); }} onKeyDown={e => { if (e.key === "Enter") void search(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || q.trim().length < 2} onClick={() => void search()}>{busy ? "Looking…" : "Find"}</button>
            </div>
            {error && <span className="vc-tool-hint">{error}</span>}
            {found && !found.length && <span className="vc-tool-hint">No places called “{q.trim()}”. Try the nearest bigger town.</span>}
            {found && found.length > 0 && (
                <div className="vc-weather-places">
                    {found.map((p, i) => (
                        <button key={i} type="button" className="vc-weather-place" onClick={() => { onPick(p); setFound(null); setQ(""); }}>
                            <b>{p.name}</b><span>{[p.region, p.country].filter(Boolean).join(", ")}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function ForecastView({ place }: { place: Place; }) {
    const { f, error } = useForecast(place);
    if (error && !f) return <div className="vc-tool-empty">{error}</div>;
    if (!f) return <div className="vc-tool-empty">Getting the weather for {place.name}…</div>;
    const today = f.days[0];
    const c = conditionOf(f.now.code);
    const lo = Math.min(...f.days.map(d => d.lo)), hi = Math.max(...f.days.map(d => d.hi));
    const unit = f.units === "f" ? "mph" : "km/h";
    return (
        <div className="vc-weather">
            <div className="vc-weather-now">
                <WeatherIcon code={f.now.code} day={f.now.day} size={72} />
                <div className="vc-weather-now-main">
                    <span className="vc-weather-place-name">{placeLabel(f.place)}</span>
                    <b>{deg(f.now.temp)}<small>{f.units.toUpperCase()}</small></b>
                    <span>{c.label}{today ? ` · H ${deg(today.hi)} L ${deg(today.lo)}` : ""}</span>
                </div>
                <div className="vc-weather-facts">
                    <span><small>Feels like</small>{deg(f.now.feels)}</span>
                    <span><small>Humidity</small>{Math.round(f.now.humidity)}%</span>
                    <span><small>Wind</small>{Math.round(f.now.wind)} {unit}</span>
                    {today && <span><small>Sun</small>{clockText(today.sunrise, f.offset)} – {clockText(today.sunset, f.offset)}</span>}
                </div>
            </div>
            <div className="vc-weather-hours" role="list" aria-label="The next 24 hours">
                {f.hours.map((h, i) => (
                    <div key={h.t} className="vc-weather-hour" role="listitem">
                        <small>{i === 0 ? "Now" : hourText(h.t, f.offset)}</small>
                        <WeatherIcon code={h.code} day={h.day} size={26} />
                        <b>{deg(h.temp)}</b>
                        <span className={classes(h.rain < 20 && "vc-weather-dim")}>{h.rain}%</span>
                    </div>
                ))}
            </div>
            <div className="vc-weather-days">
                {f.days.map((d, i) => (
                    <div key={d.t} className="vc-weather-day">
                        <span className="vc-weather-day-name">{dayText(d.t, f.offset, i)}</span>
                        <WeatherIcon code={d.code} size={24} />
                        <span className={classes("vc-weather-day-rain", d.rain < 20 && "vc-weather-dim")}>{d.rain}%</span>
                        <span className="vc-weather-day-lo">{deg(d.lo)}</span>
                        <span className="vc-weather-range"><i style={{ left: `${(d.lo - lo) / Math.max(1, hi - lo) * 100}%`, right: `${100 - (d.hi - lo) / Math.max(1, hi - lo) * 100}%` }} /></span>
                        <span className="vc-weather-day-hi">{deg(d.hi)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function WeatherWindow({ modalProps, start }: { modalProps: RenderModalProps; start?: Place; }) {
    const [mine, setMine] = useState<Place | null>(myPlace());
    const [shown, setShown] = useState<Place | null>(start ?? mine);
    const [changing, setChanging] = useState(!shown);
    const [, bump] = useState(0);
    const units = unitsOf();
    return (
        <Window {...modalProps} size="md" title="Weather" subtitle="Your city's forecast, from Open-Meteo"
            status={[shown ? placeLabel(shown).toLowerCase() : "no city set", `in °${units.toUpperCase()}`]} statusRight="open-meteo.com · no account needed"
            tools={<>
                <button type="button" className="vc-tool-btn" title="Switch between °C and °F" onClick={() => { settings.store.units = units === "f" ? "c" : "f"; bump(n => n + 1); }}>°{units === "f" ? "C" : "F"}</button>
                {shown && <button type="button" className="vc-tool-btn" onClick={() => setChanging(v => !v)}>{changing ? "Done" : "Change city"}</button>}
            </>}>
            <div className="vc-tool-wrap">
                {changing && (
                    <div className="vc-weather-change">
                        <b>{mine ? "Change your city" : "Which city's weather?"}</b>
                        <PlaceSearch autoFocus onPick={p => { setMyPlace(p); setMine(p); setShown(p); setChanging(false); }} />
                    </div>
                )}
                {shown && <ForecastView key={`${shown.lat},${shown.lon},${units}`} place={shown} />}
                {shown && mine && (shown.lat !== mine.lat || shown.lon !== mine.lon) && (
                    <div className="vc-tool-row">
                        <button type="button" className="vc-tool-btn" onClick={() => setShown(mine)}>Back to {mine.name}</button>
                        <button type="button" className="vc-tool-btn" onClick={() => { setMyPlace(shown); setMine(shown); }}>Make {shown.name} my city</button>
                    </div>
                )}
            </div>
        </Window>
    );
}

export const openWeather = (start?: Place) => openModal(props => <WeatherWindow modalProps={props} start={start} />);

/* ── The card under "weather in Tokyo" messages ── */

export function ChatCard({ query }: { query: string; }) {
    const [state, setState] = useState<{ place: Place; f: Forecast; } | null | "none">(null);
    useEffect(() => {
        let alive = true;
        void (async () => {
            const r = await findPlaces(query);
            const place = typeof r === "string" ? null : r[0];
            if (!place) { if (alive) setState("none"); return; }
            const f = await forecastFor(place);
            if (alive) setState(typeof f === "string" ? "none" : { place, f });
        })();
        return () => { alive = false; };
    }, [query, unitsOf()]);
    if (!state || state === "none") return null;
    const { place, f } = state;
    const today = f.days[0];
    return (
        <button type="button" className="vc-weather-card" onClick={() => openWeather(place)} title="Open the full forecast">
            <WeatherIcon code={f.now.code} day={f.now.day} size={36} />
            <span className="vc-weather-card-text">
                <b>{deg(f.now.temp)} · {conditionOf(f.now.code).label}</b>
                <small>{placeLabel(place)}{today ? ` · H ${deg(today.hi)} L ${deg(today.lo)}` : ""} · local time {clockText(Date.now(), f.offset)}</small>
            </span>
        </button>
    );
}
