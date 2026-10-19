/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Calculator's Dates & time tab: days between dates, a date plus or
// minus some days, ages, adding up durations, and "what time is it after…".

import { useState } from "@webpack/common";

import { Card, Chips, Field, fmtN, Out, Row } from "./ui";

const DAY = 86_400_000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** A date input's value at local midnight (no time-zone surprises). */
const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
const longDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
/** Whole days between two local dates (DST-proof). */
const daysBetween = (a: Date, b: Date) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);

/** Years, months and days from a to b. */
function ymd(a: Date, b: Date) {
    const [from, to] = a <= b ? [a, b] : [b, a];
    let y = to.getFullYear() - from.getFullYear(), m = to.getMonth() - from.getMonth(), d = to.getDate() - from.getDate();
    if (d < 0) { m--; d += new Date(to.getFullYear(), to.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return { y, m, d };
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ymdText = ({ y, m, d }: { y: number; m: number; d: number; }) => [y && plural(y, "year"), m && plural(m, "month"), (d || (!y && !m)) && plural(d, "day")].filter(Boolean).join(", ");

function BetweenCard() {
    const today = iso(new Date());
    const [a, setA] = useState(today);
    const [b, setB] = useState(iso(new Date(Date.now() + 30 * DAY)));
    const [inclusive, setInclusive] = useState(false);
    const da = parseDay(a), db = parseDay(b);
    let days = NaN, work = NaN;
    if (da && db) {
        days = daysBetween(da, db) + (inclusive ? Math.sign(daysBetween(da, db)) || 1 : 0);
        // Weekdays only (Mon–Fri).
        const [s, e] = da <= db ? [da, db] : [db, da];
        // Whole weeks have 5 each; only the leftover days need looking at one by one.
        const span = daysBetween(s, e) + (inclusive ? 1 : 0);
        work = Math.floor(span / 7) * 5;
        const t = new Date(s);
        t.setDate(t.getDate() + Math.floor(span / 7) * 7);
        for (let i = 0; i < span % 7; i++, t.setDate(t.getDate() + 1)) if (t.getDay() % 6) work++;
    }
    return (
        <Card title="Days between dates" icon="📅">
            <Row>
                <Field label="From" type="date" value={a} onChange={setA} />
                <Field label="To" type="date" value={b} onChange={setB} />
            </Row>
            <label className="vc-tool-check"><input type="checkbox" checked={inclusive} onChange={e => setInclusive(e.currentTarget.checked)} /> Count both the first and the last day</label>
            <Row>
                <Out label="Days" value={Number.isFinite(days) ? fmtN(Math.abs(days), 0) : "—"} big />
                <Out label="Weeks" value={Number.isFinite(days) ? `${Math.floor(Math.abs(days) / 7)} w ${Math.abs(days) % 7} d` : "—"} />
                <Out label="Weekdays (Mon–Fri)" value={Number.isFinite(work) ? fmtN(work, 0) : "—"} />
            </Row>
            {da && db && <Out label="That's" value={ymdText(ymd(da, db))} />}
        </Card>
    );
}

function AddCard() {
    const [start, setStart] = useState(iso(new Date()));
    const [amount, setAmount] = useState("90");
    const [unit, setUnit] = useState<"days" | "weeks" | "months" | "years" | "workdays">("days");
    const [sign, setSign] = useState<1 | -1>(1);
    const d = parseDay(start), n = Math.trunc(Number(amount));
    let out: Date | null = null;
    if (d && Number.isFinite(n)) {
        out = new Date(d);
        const k = n * sign;
        if (unit === "days") out.setDate(out.getDate() + k);
        else if (unit === "weeks") out.setDate(out.getDate() + 7 * k);
        else if (unit === "months") out.setMonth(out.getMonth() + k);
        else if (unit === "years") out.setFullYear(out.getFullYear() + k);
        else for (let left = Math.abs(k); left > 0;) { out.setDate(out.getDate() + Math.sign(k)); if (out.getDay() % 6) left--; }
    }
    return (
        <Card title="Add or take away time" icon="➕">
            <Row>
                <Field label="Start" type="date" value={start} onChange={setStart} />
                <Field label="How many" value={amount} onChange={setAmount} width={110} />
            </Row>
            <Chips value={sign} options={[[1, "Add"], [-1, "Take away"]]} onChange={setSign} />
            <Chips value={unit} options={[["days", "Days"], ["weeks", "Weeks"], ["months", "Months"], ["years", "Years"], ["workdays", "Weekdays"]]} onChange={setUnit} />
            <Out label="Lands on" value={out ? longDate(out) : "—"} big hint={out && d ? `${fmtN(Math.abs(daysBetween(d, out)), 0)} days ${out >= d ? "later" : "earlier"}` : undefined} />
        </Card>
    );
}

function AgeCard() {
    const [born, setBorn] = useState("2005-06-15");
    const b = parseDay(born), now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let next: Date | null = null, age: ReturnType<typeof ymd> | null = null;
    if (b && b <= today) {
        age = ymd(b, today);
        next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
        if (next < today) next.setFullYear(next.getFullYear() + 1);
    }
    return (
        <Card title="Age" icon="🎂">
            <Field label="Birthday" type="date" value={born} onChange={setBorn} />
            <Row>
                <Out label="Age" value={age ? ymdText(age) : "—"} big />
                <Out label="Days alive" value={b && age ? fmtN(daysBetween(b, today), 0) : "—"} />
            </Row>
            <Out label="Next birthday" value={next && age ? (daysBetween(today, next) === 0 ? "Today! 🎉" : `${longDate(next)} — in ${plural(daysBetween(today, next), "day")}`) : "—"} hint={next && age ? `turning ${age.y + (daysBetween(today, next) === 0 ? 0 : 1)}` : undefined} />
        </Card>
    );
}

/** "2h 45m + 1h 30m - 20m", "1:30 + 0:45", "90 min" → seconds. */
export function parseDurations(s: string): number | null {
    const parts = s.replace(/\s+/g, " ").trim().split(/\s*([+-])\s*/);
    let total = 0, sign = 1, any = false;
    for (const part of parts) {
        if (part === "+") { sign = 1; continue; }
        if (part === "-") { sign = -1; continue; }
        if (!part) continue;
        let secs = 0;
        const clock = part.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
        if (clock) secs = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0);
        else {
            const re = /(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)/gi;
            let m: RegExpExecArray | null, matched = "";
            while ((m = re.exec(part))) {
                const v = Number(m[1]), u = m[2][0].toLowerCase();
                secs += v * (u === "d" ? 86400 : u === "h" ? 3600 : u === "m" ? 60 : 1);
                matched += m[0];
            }
            if (matched.replace(/\s/g, "").length !== part.replace(/\s/g, "").length) return null;
        }
        total += sign * secs;
        any = true;
    }
    return any ? total : null;
}

export function durationText(secs: number) {
    const sign = secs < 0 ? "−" : "", a = Math.abs(Math.round(secs));
    const d = Math.floor(a / 86400), h = Math.floor(a % 86400 / 3600), m = Math.floor(a % 3600 / 60), s = a % 60;
    return sign + ([d && `${d} d`, h && `${h} h`, m && `${m} min`, s && `${s} s`].filter(Boolean).join(" ") || "0 min");
}

function DurationCard() {
    const [text, setText] = useState("2h 45m + 1h 30m - 20m");
    const total = parseDurations(text);
    return (
        <Card title="Add up time" icon="⏳">
            <Field label="Durations, with + and −" value={text} onChange={setText} placeholder="1:30 + 45m + 2h" />
            <Row>
                <Out label="Total" value={total != null ? durationText(total) : "—"} big />
                <Out label="In hours" value={total != null ? fmtN(total / 3600, 3) : "—"} />
                <Out label="In minutes" value={total != null ? fmtN(total / 60, 2) : "—"} />
            </Row>
        </Card>
    );
}

function ClockCard() {
    const [start, setStart] = useState("09:40");
    const [plus, setPlus] = useState("3h 20m");
    const [sign, setSign] = useState<1 | -1>(1);
    const [h, m] = start.split(":").map(Number);
    const dur = parseDurations(plus);
    let out = "—", note: string | undefined;
    if (Number.isFinite(h) && Number.isFinite(m) && dur != null) {
        const mins = h * 60 + m + sign * dur / 60;
        const days = Math.floor(mins / 1440), t = ((mins % 1440) + 1440) % 1440;
        const d = new Date(2000, 0, 1, Math.floor(t / 60), Math.round(t % 60));
        out = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        if (days) note = days > 0 ? `${plural(days, "day")} later` : `${plural(-days, "day")} earlier`;
    }
    return (
        <Card title="What time will it be?" icon="🕘">
            <Row>
                <Field label="Starting at" type="time" value={start} onChange={setStart} />
                <Field label="Duration" value={plus} onChange={setPlus} placeholder="3h 20m" />
            </Row>
            <Chips value={sign} options={[[1, "After"], [-1, "Before"]]} onChange={setSign} />
            <Out label="It'll be" value={out} big hint={note} />
        </Card>
    );
}

export function DatesTab() {
    return (
        <div className="vc-calc-tools">
            <BetweenCard />
            <AddCard />
            <AgeCard />
            <DurationCard />
            <ClockCard />
        </div>
    );
}
