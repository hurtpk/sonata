/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Calculator's Money tab: fees, tips, tax, discounts, percentages, unit
// prices, savings and loans, and pay — each a small form that answers as
// you type.

import { useState } from "@webpack/common";

import { Card, Chips, Field, fmt, fmtN, num, ok, Out, Row } from "./ui";

/** Payment fees: a percentage plus a flat amount. Published standard rates; check yours, they change. */
const FEES: { id: string; name: string; pct: number; flat: number; }[] = [
    { id: "paypal", name: "PayPal (goods & services)", pct: 3.49, flat: 0.49 },
    { id: "paypalintl", name: "PayPal (from abroad)", pct: 4.99, flat: 0.49 },
    { id: "stripe", name: "Stripe", pct: 2.9, flat: 0.3 },
    { id: "square", name: "Square (in person)", pct: 2.6, flat: 0.15 },
    { id: "cashapp", name: "Cash App (business)", pct: 2.75, flat: 0 },
    { id: "venmo", name: "Venmo (goods & services)", pct: 2.99, flat: 0 },
    { id: "ebay", name: "eBay (most categories)", pct: 13.6, flat: 0.4 },
    { id: "etsy", name: "Etsy (listing + payment)", pct: 9.5, flat: 0.45 },
    { id: "custom", name: "My own", pct: 0, flat: 0 },
];

function FeesCard() {
    const [amount, setAmount] = useState("100");
    const [fee, setFee] = useState("paypal");
    const [pct, setPct] = useState("3.49");
    const [flat, setFlat] = useState("0.49");
    const a = num(amount), p = num(pct) / 100, f = num(flat) || 0;
    const cut = a * p + f;
    // To end up with `a`, charge x where x − (x·p + f) = a.
    const charge = (a + f) / (1 - p);
    return (
        <Card title="Fees" icon="💳" wide>
            <div className={"vc-calc-fee-list"}>
                {FEES.map(x => (
                    <button key={x.id} type="button" className={`vc-calc-chip${fee === x.id ? " vc-calc-chip-on" : ""}`}
                        onClick={() => { setFee(x.id); if (x.id !== "custom") { setPct(String(x.pct)); setFlat(String(x.flat)); } }}>
                        {x.name}{x.id !== "custom" ? ` · ${x.pct}%${x.flat ? ` + ${x.flat}` : ""}` : ""}
                    </button>
                ))}
            </div>
            <Row>
                <Field label="Amount" value={amount} onChange={setAmount} />
                <Field label="Fee %" value={pct} onChange={v => { setPct(v); setFee("custom"); }} suffix="%" width={110} />
                <Field label="Plus flat fee" value={flat} onChange={v => { setFlat(v); setFee("custom"); }} width={120} />
            </Row>
            <Row>
                <Out label="Fee" value={ok(a, p) ? fmt(cut) : "—"} />
                <Out label="You receive" value={ok(a, p) ? fmt(a - cut) : "—"} big />
                <Out label={`Charge this to receive ${ok(a) ? fmt(a) : "it"}`} value={ok(a, p) && p < 1 ? fmt(charge) : "—"} big hint="covers the fee" />
            </Row>
            <span className="vc-tool-hint">The presets are the usual published rates — yours may differ (country, account type), and they change now and then.</span>
        </Card>
    );
}

function TipCard() {
    const [bill, setBill] = useState("64.50");
    const [tip, setTip] = useState(18);
    const [custom, setCustom] = useState("");
    const [people, setPeople] = useState("2");
    const [roundUp, setRoundUp] = useState(false);
    const b = num(bill), t = (custom ? num(custom) : tip) / 100, n = Math.max(1, Math.floor(num(people) || 1));
    const tipAmount = b * t, total = b + tipAmount;
    const each = roundUp ? Math.ceil(total / n) : total / n;
    return (
        <Card title="Tip & split the bill" icon="🍽️">
            <Row>
                <Field label="Bill" value={bill} onChange={setBill} />
                <Field label="People" value={people} onChange={setPeople} width={90} />
            </Row>
            <Chips value={custom ? -1 : tip} options={[[10, "10%"], [15, "15%"], [18, "18%"], [20, "20%"], [25, "25%"]]} onChange={v => { setTip(v); setCustom(""); }} />
            <Row>
                <Field label="Or my own tip" value={custom} onChange={setCustom} suffix="%" placeholder="e.g. 12" />
            </Row>
            <label className="vc-tool-check"><input type="checkbox" checked={roundUp} onChange={e => setRoundUp(e.currentTarget.checked)} /> Round each person up to a whole amount</label>
            <Row>
                <Out label="Tip" value={ok(b, t) ? fmt(tipAmount) : "—"} />
                <Out label="Total" value={ok(b, t) ? fmt(total) : "—"} />
                <Out label={n > 1 ? "Each person" : "You pay"} value={ok(b, t) ? fmt(each) : "—"} big />
            </Row>
        </Card>
    );
}

function TaxCard() {
    const [price, setPrice] = useState("50");
    const [rate, setRate] = useState("20");
    const [mode, setMode] = useState<"add" | "remove">("add");
    const p = num(price), r = num(rate) / 100;
    const net = mode === "add" ? p : p / (1 + r), gross = mode === "add" ? p * (1 + r) : p;
    return (
        <Card title="Tax / VAT" icon="🧾">
            <Chips value={mode} options={[["add", "Add tax"], ["remove", "Take tax out"]]} onChange={setMode} />
            <Row>
                <Field label={mode === "add" ? "Price before tax" : "Price with tax"} value={price} onChange={setPrice} />
                <Field label="Rate" value={rate} onChange={setRate} suffix="%" width={100} />
            </Row>
            <Row>
                <Out label="Before tax" value={ok(p, r) ? fmt(net) : "—"} />
                <Out label="Tax" value={ok(p, r) ? fmt(gross - net) : "—"} />
                <Out label="With tax" value={ok(p, r) ? fmt(gross) : "—"} big />
            </Row>
        </Card>
    );
}

function DiscountCard() {
    const [price, setPrice] = useState("80");
    const [off, setOff] = useState("30");
    const [then, setThen] = useState("");
    const p = num(price), d1 = num(off) / 100, d2 = (num(then) || 0) / 100;
    const final = p * (1 - d1) * (1 - d2);
    return (
        <Card title="Discounts" icon="🏷️">
            <Row>
                <Field label="Price" value={price} onChange={setPrice} />
                <Field label="Off" value={off} onChange={setOff} suffix="%" width={90} />
                <Field label="Then off" value={then} onChange={setThen} suffix="%" width={100} placeholder="—" />
            </Row>
            <Row>
                <Out label="You pay" value={ok(p, d1) ? fmt(final) : "—"} big />
                <Out label="You save" value={ok(p, d1) ? fmt(p - final) : "—"} />
                <Out label="Total discount" value={ok(p, d1) ? `${fmtN((1 - final / p) * 100, 2)}%` : "—"} hint={d2 ? "stacked discounts don't simply add up" : undefined} />
            </Row>
        </Card>
    );
}

function PercentCard() {
    const [from, setFrom] = useState("40");
    const [to, setTo] = useState("55");
    const [x, setX] = useState("15");
    const [y, setY] = useState("60");
    const a = num(from), b = num(to), px = num(x), py = num(y);
    const change = (b - a) / Math.abs(a) * 100;
    return (
        <Card title="Percentages" icon="📊">
            <Row>
                <Field label="From" value={from} onChange={setFrom} />
                <Field label="To" value={to} onChange={setTo} />
            </Row>
            <Out label="Change" value={ok(a, b) && a !== 0 ? `${change > 0 ? "+" : ""}${fmtN(change, 2)}%` : "—"} big hint={ok(a, b) && a !== 0 ? (change > 0 ? "an increase" : change < 0 ? "a decrease" : "no change") : undefined} />
            <Row>
                <Field label="X" value={x} onChange={setX} width={110} />
                <Field label="Y" value={y} onChange={setY} width={110} />
            </Row>
            <Row>
                <Out label="X is what % of Y" value={ok(px, py) && py !== 0 ? `${fmtN(px / py * 100, 2)}%` : "—"} />
                <Out label="X% of Y" value={ok(px, py) ? fmtN(px / 100 * py) : "—"} />
            </Row>
        </Card>
    );
}

function UnitPriceCard() {
    const [pa, setPa] = useState("3.49");
    const [qa, setQa] = useState("500");
    const [pb, setPb] = useState("5.99");
    const [qb, setQb] = useState("1000");
    const ua = num(pa) / num(qa), ub = num(pb) / num(qb);
    const better = ok(ua, ub) ? (ua < ub ? "A" : ub < ua ? "B" : null) : null;
    const saving = better ? (1 - Math.min(ua, ub) / Math.max(ua, ub)) * 100 : 0;
    return (
        <Card title="Which is the better deal?" icon="🛒">
            <Row>
                <Field label="A: price" value={pa} onChange={setPa} />
                <Field label="A: amount (g, ml, items…)" value={qa} onChange={setQa} />
            </Row>
            <Row>
                <Field label="B: price" value={pb} onChange={setPb} />
                <Field label="B: amount" value={qb} onChange={setQb} />
            </Row>
            <Row>
                <Out label="A per 100" value={ok(ua) ? fmt(ua * 100, 3) : "—"} />
                <Out label="B per 100" value={ok(ub) ? fmt(ub * 100, 3) : "—"} />
                <Out label="Better deal" value={better ? `${better} (${fmtN(saving, 1)}% cheaper)` : ok(ua, ub) ? "Same price" : "—"} big />
            </Row>
        </Card>
    );
}

function GrowthCard() {
    const [mode, setMode] = useState<"save" | "loan">("save");
    const [start, setStart] = useState("1000");
    const [monthly, setMonthly] = useState("100");
    const [rate, setRate] = useState("5");
    const [years, setYears] = useState("10");
    const P = num(start), m = num(monthly) || 0, r = num(rate) / 100 / 12, n = Math.round(num(years) * 12);
    let a = NaN, b = NaN, c = NaN;
    if (ok(P, r, n) && n > 0) {
        if (mode === "save") {
            // Monthly compounding, deposits at the end of each month.
            const g = (1 + r) ** n;
            a = P * g + (r ? m * (g - 1) / r : m * n);
            b = P + m * n;
            c = a - b;
        } else {
            a = r ? P * r / (1 - (1 + r) ** -n) : P / n;
            b = a * n;
            c = b - P;
        }
    }
    return (
        <Card title={mode === "save" ? "Savings & interest" : "Loan payments"} icon="📈">
            <Chips value={mode} options={[["save", "Savings"], ["loan", "Loan"]]} onChange={setMode} />
            <Row>
                <Field label={mode === "save" ? "Starting amount" : "Loan amount"} value={start} onChange={setStart} />
                {mode === "save" && <Field label="Added each month" value={monthly} onChange={setMonthly} />}
            </Row>
            <Row>
                <Field label="Yearly interest" value={rate} onChange={setRate} suffix="%" />
                <Field label="Years" value={years} onChange={setYears} />
            </Row>
            {mode === "save" ? (
                <Row>
                    <Out label="You'll have" value={fmt(a)} big />
                    <Out label="You put in" value={fmt(b)} />
                    <Out label="Interest earned" value={fmt(c)} />
                </Row>
            ) : (
                <Row>
                    <Out label="Each month" value={fmt(a)} big />
                    <Out label="Total paid" value={fmt(b)} />
                    <Out label="Total interest" value={fmt(c)} />
                </Row>
            )}
        </Card>
    );
}

function PayCard() {
    const [mode, setMode] = useState<"hourly" | "yearly">("hourly");
    const [value, setValue] = useState("20");
    const [hours, setHours] = useState("40");
    const [weeks, setWeeks] = useState("52");
    const v = num(value), h = num(hours), w = num(weeks);
    const yearly = mode === "hourly" ? v * h * w : v, hourly = mode === "yearly" ? v / (h * w) : v;
    return (
        <Card title="Hourly ↔ salary" icon="💼">
            <Chips value={mode} options={[["hourly", "I know the hourly rate"], ["yearly", "I know the salary"]]} onChange={setMode} />
            <Row>
                <Field label={mode === "hourly" ? "Per hour" : "Per year"} value={value} onChange={setValue} />
                <Field label="Hours a week" value={hours} onChange={setHours} width={110} />
                <Field label="Weeks a year" value={weeks} onChange={setWeeks} width={110} />
            </Row>
            <Row>
                <Out label="Per hour" value={ok(hourly) ? fmt(hourly) : "—"} big={mode === "yearly"} />
                <Out label="Per week" value={ok(yearly, w) ? fmt(yearly / w) : "—"} />
                <Out label="Per month" value={ok(yearly) ? fmt(yearly / 12) : "—"} />
                <Out label="Per year" value={ok(yearly) ? fmt(yearly, 0) : "—"} big={mode === "hourly"} />
            </Row>
        </Card>
    );
}

export function MoneyTab() {
    return (
        <div className="vc-calc-tools">
            <FeesCard />
            <TipCard />
            <TaxCard />
            <DiscountCard />
            <PercentCard />
            <UnitPriceCard />
            <GrowthCard />
            <PayCard />
        </div>
    );
}
