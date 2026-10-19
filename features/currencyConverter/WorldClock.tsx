/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// World clock: pin cities (or a friend + where they live) and see every time
// at once, shaded for day and night. The planner slides time forward or back
// to find a time that works for everyone, and can put it in your message as a
// Discord timestamp — which shows each reader the time in their own zone.

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import { showToast, useEffect, useState } from "@webpack/common";

import { settings } from "./index";
import { findZone, hourIn, hoursFromMe, localZone, timeIn, zoneName } from "./special";

const cl = classNameFactory("vc-tool-");
const cw = classNameFactory("vc-conv-wc-");

/** zone: the time zone; place: the city as you typed it ("Miami" is in New York's zone); name: a person. */
interface Clock { zone: string; place?: string; name?: string; }

const QUICK = ["London", "New York", "Los Angeles", "Tokyo", "Sydney", "Dubai", "Paris", "Sao Paulo"];

function readClocks(): Clock[] {
    try {
        const v = JSON.parse(settings.store.clocksJson || "[]");
        return Array.isArray(v) ? v.filter(c => c && typeof c.zone === "string") : [];
    } catch { return []; }
}

/** "Night", "Morning"… and a look for the card. */
function partOfDay(h: number) {
    if (h < 5 || h >= 22) return { word: "Night", icon: "🌙", cls: "night" };
    if (h < 8) return { word: "Early morning", icon: "🌅", cls: "dawn" };
    if (h < 12) return { word: "Morning", icon: "☀️", cls: "day" };
    if (h < 17) return { word: "Afternoon", icon: "☀️", cls: "day" };
    if (h < 20) return { word: "Evening", icon: "🌇", cls: "dusk" };
    return { word: "Late evening", icon: "🌙", cls: "night" };
}

function fromMe(hrs: number) {
    if (Math.abs(hrs) < 0.01) return "Same as you";
    const a = Math.abs(hrs);
    const s = a % 1 ? `${Math.floor(a)} h ${Math.round(a % 1 * 60)} min` : `${a} h`;
    return hrs > 0 ? `${s} ahead` : `${s} behind`;
}

const dayWord = (d: number) => d === 0 ? "" : d === 1 ? "Tomorrow" : d === -1 ? "Yesterday" : d > 0 ? `+${d} days` : `${d} days`;

function ClockCard({ clock, t, mine, onRemove }: { clock: Clock; t: number; mine?: boolean; onRemove?(): void; }) {
    const me = localZone();
    const info = timeIn(clock.zone, t, me);
    const part = partOfDay(hourIn(clock.zone, t));
    const place = clock.place || zoneName(clock.zone);
    return (
        <div className={classes(cw("card"), cw(part.cls))}>
            <div className={cw("top")}>
                <span className={cw("name")}>{mine ? "You" : clock.name || place}</span>
                {onRemove && <button type="button" className={cw("x")} title="Unpin" aria-label="Unpin" onClick={onRemove}>✕</button>}
            </div>
            <span className={cw("place")}>{clock.name || mine ? `${place} · ` : ""}{info.offset}</span>
            <b className={cw("time")}>{info.time}</b>
            <span className={cw("when")}>{part.icon} {part.word} · {info.weekday}{dayWord(info.dayDiff) ? ` · ${dayWord(info.dayDiff)}` : ""}</span>
            {!mine && <span className={cw("diff")}>{fromMe(hoursFromMe(clock.zone, t))}</span>}
        </div>
    );
}

export function WorldClock() {
    const [clocks, setClocks] = useState<Clock[]>(readClocks);
    const [now, setNow] = useState(Date.now());
    const [shift, setShift] = useState(0); // minutes from now
    const [place, setPlace] = useState("");
    const [name, setName] = useState("");

    // Ticks on the minute.
    useEffect(() => {
        let iv: ReturnType<typeof setInterval> | undefined;
        const first = setTimeout(() => { setNow(Date.now()); iv = setInterval(() => setNow(Date.now()), 60_000); }, 60_000 - Date.now() % 60_000 + 50);
        return () => { clearTimeout(first); if (iv) clearInterval(iv); };
    }, []);

    const save = (list: Clock[]) => { setClocks(list); settings.store.clocksJson = JSON.stringify(list); };
    const add = (where: string, who = "") => {
        const zone = findZone(where);
        if (!zone) { showToast(`Couldn't find "${where}" — try a big city near it, or a zone like EST or Europe/Paris`, "failure"); return; }
        const nm = who.trim() || undefined;
        // Keep a city name as typed ("Miami"), but not zone codes ("EST") or "Europe/Paris".
        const typed = where.trim();
        const city = typed.length > 4 && !typed.includes("/") ? typed.replace(/(^|s)S/g, c => c.toUpperCase()) : undefined;
        const pl = city && city.toLowerCase() !== zoneName(zone).toLowerCase() ? city : undefined;
        if (clocks.some(c => c.zone === zone && (c.name ?? "") === (nm ?? "") && (c.place ?? "") === (pl ?? ""))) { showToast("That one's already pinned", "message"); return; }
        save([...clocks, { zone, place: pl, name: nm }]);
        setPlace(""); setName("");
    };

    const t = now + shift * 60_000;
    const planned = shift !== 0;
    const a = Math.abs(shift);
    const shiftText = `${shift > 0 ? "+" : "−"}${Math.floor(a / 60) ? `${Math.floor(a / 60)} h` : ""}${a % 60 ? ` ${a % 60} min` : ""}`.trim();
    const sorted = [...clocks].sort((x, y) => hoursFromMe(x.zone, t) - hoursFromMe(y.zone, t));

    return (
        <section className={classes("vc-conv-main", cw("wrap"))}>
            <div className={cw("add")}>
                <input className={cl("input")} value={place} placeholder="City or time zone — Tokyo, Lima, EST, Europe/Paris" onChange={e => setPlace(e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === "Enter" && place.trim()) add(place, name); }} />
                <input className={classes(cl("input"), cw("who"))} value={name} placeholder="Name (optional)" maxLength={32} onChange={e => setName(e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === "Enter" && place.trim()) add(place, name); }} />
                <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!place.trim()} onClick={() => add(place, name)}>Pin</button>
            </div>
            {clocks.length < 4 && (
                <div className={cw("quick")}>
                    <span className={cl("hint")}>Quick add:</span>
                    {QUICK.filter(q => !clocks.some(c => c.zone === findZone(q) && !c.name)).slice(0, 6).map(q => (
                        <button key={q} type="button" className="vc-conv-example" onClick={() => add(q)}>{q}</button>
                    ))}
                </div>
            )}

            <div className={cw("grid")}>
                <ClockCard clock={{ zone: localZone() }} t={t} mine />
                {sorted.map(c => <ClockCard key={`${c.zone}|${c.place ?? ""}|${c.name ?? ""}`} clock={c} t={t} onRemove={() => save(clocks.filter(x => x !== c))} />)}
            </div>

            <div className={cw("plan")}>
                <div className={cw("plan-head")}>
                    <b>{planned ? `Planning: ${shiftText} from now` : "Plan a time"}</b>
                    <span className={cl("hint")}>{planned ? `${new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(t)} your time` : "Slide to see what time it'd be everywhere."}</span>
                    <span className={cl("spacer")} />
                    {planned && <button type="button" className={cl("link")} onClick={() => setShift(0)}>Back to now</button>}
                    <button type="button" className={cl("btn")} title="Everyone sees this in their own time"
                        onClick={() => { insertTextIntoChatInputBox(`<t:${Math.floor(t / 60_000) * 60}:F> `); showToast("Added — everyone sees it in their own time", "success"); }}>
                        ↵ Put {planned ? "this time" : "now"} in message
                    </button>
                </div>
                <input type="range" className={cl("range")} min={-24 * 60} max={48 * 60} step={15} value={shift} onChange={e => setShift(Number(e.currentTarget.value))} />
                <div className={cw("ticks")}><span>−1 day</span><span>now</span><span>+1 day</span><span>+2 days</span></div>
            </div>
        </section>
    );
}
