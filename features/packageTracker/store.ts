/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Package Tracker keeps on this computer (DataStore): your parcels and
// food orders, with only the facts read off their tracking pages — never the
// address or anyone's name. Plus the background checks and their alerts.

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { OptionType } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { Carrier, CARRIERS, Found, Service, SERVICES, shortNumber } from "./detect";
import type { ReadResult } from "./native";
import type { FoodInfo, FoodStage, ParcelInfo, ParcelStatus } from "./parse";

export const settings = defineFeatureSettings("packageTracker", {
    foodAlerts: { type: OptionType.BOOLEAN, description: "Tell me when a food order moves along (being made, on the way, delivered)", default: true },
    parcelAlerts: { type: OptionType.BOOLEAN, description: "Tell me when a parcel is out for delivery, delivered, or its day changes", default: true },
    calendarByDefault: { type: OptionType.BOOLEAN, description: "Put new parcels' arrival days on the Calendar straight away", default: false },
    warnBeforeSending: { type: OptionType.BOOLEAN, description: "Warn me before I send a DoorDash, Uber Eats or Postmates tracking link (it shows your address and name)", default: true },
    hideLinks: { type: OptionType.BOOLEAN, description: "Blur DoorDash, Uber Eats and Postmates tracking links and their previews in chat until you hover them", default: true },
    showInChat: { type: OptionType.BOOLEAN, description: "Show a Track button under messages with a tracking number or delivery link", default: true },
});

export interface Change { at: number; text: string; }
export interface Entry {
    id: string;
    kind: "parcel" | "food";
    /** Your name for it ("New headphones", "Pizza"). */
    name?: string;
    carrier?: Carrier;
    number?: string;
    service?: Service;
    url: string;
    added: number;
    checked?: number;
    /** Why the last check didn't work ("blocked" means the site checks for bots). */
    problem?: string;
    blocked?: boolean;
    food?: FoodInfo;
    parcel?: ParcelInfo;
    /** The first arrival day it was given, to show how far it has moved. */
    firstExpected?: number;
    calendar?: boolean;
    /** What you typed in yourself when the page doesn't show it. */
    myStore?: string;
    myItems?: string[];
    history: Change[];
    done?: boolean;
}

const KEY = "Sonata_packages";
let entries: Entry[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, entries);
const put = (next: Entry[]) => { entries = next; emit(); save(); };
const patch = (id: string, p: Partial<Entry> | ((e: Entry) => Partial<Entry>)) =>
    put(entries.map(e => e.id === id ? { ...e, ...(typeof p === "function" ? p(e) : p) } : e));

export const loadPackages = () => loaded ??= DataStore.get<Entry[]>(KEY).then(v => { if (Array.isArray(v)) entries = v; emit(); }).catch(() => { });
export const allPackages = () => entries;
export const packageById = (id: string) => entries.find(e => e.id === id);

export function usePackages() {
    const [, bump] = useState(0);
    useEffect(() => { void loadPackages(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return entries;
}

/* ── Words for things ── */

export const FOOD_STEPS: { stage: FoodStage; label: string; }[] = [
    { stage: "placed", label: "Order placed" },
    { stage: "preparing", label: "Being made" },
    { stage: "onTheWay", label: "On the way" },
    { stage: "delivered", label: "Delivered" },
];
export const FOOD_LABEL: Record<FoodStage, string> = {
    placed: "Order placed", preparing: "Being made", pickup: "Being picked up", onTheWay: "On the way", delivered: "Delivered", cancelled: "Cancelled",
};
/** Where each stage sits on the four steps (being picked up is still the "being made" step). */
export const foodStep = (s?: FoodStage) => s === "pickup" ? 1 : Math.max(0, FOOD_STEPS.findIndex(x => x.stage === s));

export const PARCEL_STEPS: { status: ParcelStatus; label: string; }[] = [
    { status: "label", label: "Label created" },
    { status: "transit", label: "In transit" },
    { status: "out", label: "Out for delivery" },
    { status: "delivered", label: "Delivered" },
];
export const PARCEL_LABEL: Record<ParcelStatus, string> = {
    label: "Label created", transit: "In transit", out: "Out for delivery", delayed: "Delayed", delivered: "Delivered", exception: "Needs a look",
};
export const parcelStep = (s?: ParcelStatus) => s === "delayed" || s === "exception" ? 1 : Math.max(0, PARCEL_STEPS.findIndex(x => x.status === s));

export const dayText = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const longDayText = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
export const timeText = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** "7:40–7:50 PM": a range of times, without saying PM twice. */
export function rangeText(from: number, to?: number) {
    const a = timeText(from);
    if (!to || to <= from) return a;
    const b = timeText(to), tail = / ?[AP]M$/i.exec(a)?.[0];
    return tail && b.endsWith(tail.trim()) ? `${a.slice(0, -tail.length)}–${b}` : `${a}–${b}`;
}
const newId = (k: string) => `${k}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** "UPS parcel" / "Taco Palace" — what to call an entry when you haven't named it. */
export function titleOf(e: Entry) {
    if (e.name) return e.name;
    if (e.kind === "food") return e.food?.store ?? e.myStore ?? `${SERVICES[e.service!].name} order`;
    return `${CARRIERS[e.carrier!].name} parcel`;
}
export const sourceOf = (e: Entry) => e.kind === "food" ? SERVICES[e.service!].name : `${CARRIERS[e.carrier!].name} · ${shortNumber(e.number!)}`;

/** The one-line state for lists and chat. */
export function statusLine(e: Entry) {
    if (e.kind === "food") {
        const f = e.food;
        if (!f?.stage) return e.problem ? "Open the page to see it" : "Checking…";
        if (f.stage === "delivered" || f.stage === "cancelled") return FOOD_LABEL[f.stage];
        return f.etaAt ? `${FOOD_LABEL[f.stage]} · arriving ${rangeText(f.etaAt, f.etaTo)}` : FOOD_LABEL[f.stage];
    }
    const p = e.parcel;
    if (!p?.status) return e.problem ? "Open the page to see it" : "Checking…";
    if (p.status === "delivered") return p.deliveredOn ? `Delivered ${dayText(p.deliveredOn)}` : "Delivered";
    return p.expected ? `${PARCEL_LABEL[p.status]} · arrives ${dayText(p.expected)}` : PARCEL_LABEL[p.status];
}

/* ── Adding and changing ── */

let opener: (id?: string) => void = () => { };
export const setOpener = (fn: (id?: string) => void) => { opener = fn; };

export const isTracked = (f: Found) => entries.some(e => f.kind === "food" ? e.url === f.url : e.number === f.number);
export const trackedFor = (f: Found) => entries.find(e => f.kind === "food" ? e.url === f.url : e.number === f.number);

export function addPackage(f: Found, name?: string): Entry {
    const existing = trackedFor(f);
    if (existing) return existing;
    const e: Entry = f.kind === "food"
        ? { id: newId("f"), kind: "food", service: f.service, url: f.url, added: Date.now(), history: [{ at: Date.now(), text: "Added" }] }
        : { id: newId("p"), kind: "parcel", carrier: f.carrier, number: f.number, url: CARRIERS[f.carrier].url(f.number), added: Date.now(), calendar: !!settings.store.calendarByDefault, history: [{ at: Date.now(), text: "Added" }] };
    if (name?.trim()) e.name = name.trim();
    put([e, ...entries]);
    void checkPackage(e.id);
    return e;
}

export const removePackage = (id: string) => put(entries.filter(e => e.id !== id));
export const renamePackage = (id: string, name: string) => patch(id, { name: name.trim() || undefined });
export const setCalendar = (id: string, on: boolean) => patch(id, { calendar: on });
export const setMyStore = (id: string, store: string) => patch(id, { myStore: store.trim() || undefined });
export const setMyItems = (id: string, items: string[]) => patch(id, { myItems: items.length ? items : undefined });

/* ── Checking ── */

const native = () => VencordNative.pluginHelpers.Sonata as any;
const checking = new Set<string>();
export const isChecking = (id: string) => checking.has(id);

function tell(e: Entry, title: string, body: string) {
    showNotification({ title, body, onClick: () => opener(e.id) });
}

export async function checkPackage(id: string) {
    const e = packageById(id);
    if (!e || checking.has(id)) return;
    checking.add(id);
    emit();
    const r: ReadResult | null = await native().trackRead(e.url, e.kind, e.number).catch(() => null);
    checking.delete(id);
    const now = Date.now();
    const cur = packageById(id);
    if (!cur) return;
    if (!r?.ok) {
        patch(id, { checked: now, problem: r?.error ?? "Couldn't check", blocked: !!(r && "blocked" in r && r.blocked) });
        return;
    }
    const history = [...cur.history];
    const p: Partial<Entry> = { checked: now, problem: undefined, blocked: false };

    if (cur.kind === "food" && r.food) {
        const was = cur.food?.stage, is = r.food.stage!;
        // Keep what was read before if this read missed it (the page drops the food list once it's on the way).
        p.food = { ...cur.food, ...Object.fromEntries(Object.entries(r.food).filter(([, v]) => v !== undefined)) };
        if (was !== is) {
            history.push({ at: now, text: FOOD_LABEL[is] });
            if (was && settings.store.foodAlerts) {
                const eta = r.food.etaAt && is !== "delivered" ? ` — arriving around ${timeText(r.food.etaAt)}` : "";
                tell(cur, `${titleOf({ ...cur, ...p })}: ${FOOD_LABEL[is].toLowerCase()}`, `Your ${SERVICES[cur.service!].name} order is ${FOOD_LABEL[is].toLowerCase()}${eta}.`);
            }
        }
        if (is === "delivered" || is === "cancelled") p.done = true;
    }

    if (cur.kind === "parcel" && r.parcel) {
        const before = cur.parcel ?? {};
        p.parcel = { ...before, ...Object.fromEntries(Object.entries(r.parcel).filter(([, v]) => v !== undefined)) };
        const is = r.parcel.status!;
        if (before.status !== is) {
            history.push({ at: now, text: PARCEL_LABEL[is] });
            if (before.status && settings.store.parcelAlerts && (is === "out" || is === "delivered" || is === "exception"))
                tell(cur, `${titleOf(cur)}: ${PARCEL_LABEL[is].toLowerCase()}`, is === "out" ? "It should arrive today." : is === "delivered" ? "Your parcel has been delivered." : "The carrier says it needs a look. Open its page for details.");
        }
        const exp = r.parcel.expected;
        if (exp && !cur.firstExpected) p.firstExpected = exp;
        if (exp && before.expected && exp !== before.expected && is !== "delivered") {
            const later = exp > before.expected;
            history.push({ at: now, text: `Arrival moved to ${dayText(exp)}` });
            if (settings.store.parcelAlerts)
                tell(cur, `${titleOf(cur)} ${later ? "is delayed" : "is coming early"}`, `Now arriving ${longDayText(exp)} (was ${longDayText(before.expected)}).${cur.calendar ? " Moved on your calendar too." : ""}`);
        }
        // The page gave no date, but it was watched arriving: today.
        if (is === "delivered" && before.status && before.status !== "delivered" && !p.parcel!.deliveredOn) { const d = new Date(now); d.setHours(0, 0, 0, 0); p.parcel!.deliveredOn = d.getTime(); }
        if (is === "delivered") p.done = true;
    }
    p.history = history.slice(-40);
    patch(id, p);
}

/* ── Background checks ── */

const MIN = 60_000, HOUR = 60 * MIN;
let timer: ReturnType<typeof setInterval> | undefined;

/** How long to wait between checks: food every minute, parcels every few hours (more often on the day). */
function due(e: Entry, now: number) {
    if (e.done || checking.has(e.id)) return false;
    const since = now - (e.checked ?? 0);
    if (e.blocked) return since > (e.kind === "food" ? 10 * MIN : 12 * HOUR);
    if (e.kind === "food") return since > MIN;
    return since > (e.parcel?.status === "out" ? 30 * MIN : 3 * HOUR);
}

async function tick() {
    await loadPackages();
    const now = Date.now();
    // Tidy up: food is gone a few hours after it's delivered (the link stops working anyway), parcels two weeks after.
    const keep = entries.filter(e => {
        const last = e.checked ?? e.added;
        if (e.kind === "food") return !(e.done && now - last > 4 * HOUR) && now - e.added < 24 * HOUR;
        return !(e.done && now - last > 14 * 24 * HOUR);
    });
    if (keep.length !== entries.length) put(keep);
    // Food that has run for hours without arriving has expired; stop checking it.
    for (const e of entries) if (e.kind === "food" && !e.done && now - e.added > 8 * HOUR) patch(e.id, { done: true, problem: "The link has probably expired" });
    for (const e of entries) if (due(e, now)) await checkPackage(e.id);
}

export function startChecks() {
    stopChecks();
    timer = setInterval(() => void tick(), MIN);
    setTimeout(() => void tick(), 20_000);
}
export function stopChecks() {
    if (timer) clearInterval(timer);
    timer = undefined;
    void native().trackForget?.().catch?.(() => { });
}

/* ── For the Calendar ── */

/** Parcels you've put on the calendar, on the day they should arrive (moving when the carrier changes it). */
export function calendarParcels(from: number, to: number) {
    return entries.filter(e => e.kind === "parcel" && e.calendar).flatMap(e => {
        const p = e.parcel;
        const at = p?.status === "delivered" ? p.deliveredOn : p?.expected;
        if (!at || at < from || at >= to) return [];
        const moved = e.firstExpected && p?.expected && e.firstExpected !== p.expected && p.status !== "delivered" ? `moved from ${dayText(e.firstExpected)}` : null;
        return [{
            id: `pkg-${e.id}`, at, allDay: true,
            title: p?.status === "delivered" ? `${titleOf(e)} delivered` : `${titleOf(e)} arrives`,
            detail: [CARRIERS[e.carrier!].name, p?.status && p.status !== "delivered" ? PARCEL_LABEL[p.status] : null, moved].filter(Boolean).join(" · "),
            ref: { packageId: e.id },
        }];
    });
}

export const openPackage = (id?: string) => opener(id);
