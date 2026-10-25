/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { React, showToast, useState } from "@webpack/common";

import { Window } from "../_shared/Window";
import { ActionRow, DetailHead, Facts, FormGroup, FormRow, ListHead, ListRow, Split, Toggle } from "../_shared/WindowParts";
import { Carrier, carrierOf, CARRIERS, clean, serviceOf, SERVICES } from "./detect";
import {
    addPackage, checkPackage, dayText, Entry, FOOD_STEPS, foodStep, isChecking, longDayText, PARCEL_LABEL, PARCEL_STEPS, parcelStep,
    rangeText, removePackage, renamePackage, setCalendar, setMyItems, setMyStore, statusLine, timeText, titleOf, usePackages
} from "./store";

const Bag = ({ size = 18 }: { size?: number; }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 8h14l-1 12H6z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </svg>
);
export const Box = ({ size = 18 }: { size?: number; }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9M8 5.25l8 4.5" />
    </svg>
);
export const KindIcon = ({ e, size }: { e: Pick<Entry, "kind">; size?: number; }) => e.kind === "food" ? <Bag size={size} /> : <Box size={size} />;

/** The dot colour for where something is up to. */
export function dotOf(e: Entry) {
    if (e.problem && !e.food?.stage && !e.parcel?.status) return "#80848e";
    if (e.kind === "food") {
        const s = e.food?.stage;
        return s === "delivered" ? "#23a55a" : s === "cancelled" ? "#f23f43" : s === "onTheWay" ? "var(--sw-accent, var(--brand-500))" : "#f0b232";
    }
    const s = e.parcel?.status;
    return s === "delivered" ? "#23a55a" : s === "delayed" || s === "exception" ? "#f23f43" : s === "out" ? "var(--sw-accent, var(--brand-500))" : "#f0b232";
}

/** The four steps across the top, with where it's up to lit. */
function Steps({ steps, at, warn }: { steps: string[]; at: number; warn?: string; }) {
    return (
        <div className="vc-track-steps" role="list">
            {steps.map((label, i) => (
                <div key={label} role="listitem" className={classes("vc-track-step", i < at && "vc-track-step-done", i === at && "vc-track-step-now", i === at && warn && "vc-track-step-warn")} aria-current={i === at ? "step" : undefined}>
                    <i />
                    <span>{i === at && warn ? warn : label}</span>
                </div>
            ))}
        </div>
    );
}

function History({ e }: { e: Entry; }) {
    if (e.history.length < 2) return null;
    return (
        <FormGroup title="What's happened">
            <div className="vc-track-history">
                {[...e.history].reverse().map((h, i) => (
                    <div key={i}><span>{h.text}</span><small>{dayText(h.at)}, {timeText(h.at)}</small></div>
                ))}
            </div>
        </FormGroup>
    );
}

function Problem({ e }: { e: Entry; }) {
    if (!e.problem) return null;
    const site = e.kind === "food" ? SERVICES[e.service!].name : CARRIERS[e.carrier!].name;
    return (
        <div className="vc-track-note">
            {e.blocked
                ? <>{site}'s page checks for bots, so Package Tracker couldn't read it this time. It'll try again later; <b>Open page</b> always works.</>
                : <>{e.problem}. <b>Open page</b> to see it there.</>}
        </div>
    );
}

/** A line you can type into, saved when you leave it. */
function Typed({ value, placeholder, onSave, label }: { value?: string; placeholder: string; onSave(v: string): void; label: string; }) {
    const [text, setText] = useState(value ?? "");
    return <input className="vc-tool-input" value={text} placeholder={placeholder} aria-label={label} onChange={e => setText(e.currentTarget.value)} onBlur={() => onSave(text)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

function FoodDetail({ e }: { e: Entry; }) {
    const f = e.food ?? {};
    const store = f.store ?? e.myStore;
    const items = f.items ?? e.myItems;
    const arriving = f.stage === "delivered" ? "Delivered" : f.stage === "cancelled" ? "Cancelled" : f.etaAt ? rangeText(f.etaAt, f.etaTo) : "Not shown yet";
    return (
        <>
            <Steps steps={FOOD_STEPS.map(s => s.label)} at={!f.stage ? -1 : f.stage === "delivered" ? 3 : foodStep(f.stage)} warn={f.stage === "cancelled" ? "Cancelled" : f.stage === "pickup" ? "Being picked up" : undefined} />
            <Facts items={[
                ["Store", store ?? "—"],
                ["Order placed", f.placedAt ? timeText(f.placedAt) : "—"],
                [f.stage === "delivered" ? "Status" : "Arriving", arriving],
            ]} />
            <FormGroup title="What you ordered">
                {items?.length
                    ? <ul className="vc-track-items">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
                    : <div className="vc-track-pad">
                        <p className="vc-track-hint">The tracking page didn't list the food. Type it in to keep it with the order.</p>
                        <Typed placeholder="Like: 2 tacos, nachos, a large drink" label="What you ordered" onSave={v => setMyItems(e.id, v.split(/\s*,\s*/).filter(Boolean))} />
                    </div>}
                {!f.store && (
                    <FormRow label="Store or restaurant" help="The page didn't say, so you can.">
                        <Typed value={e.myStore} placeholder="Like: Taco Palace" label="Store or restaurant" onSave={v => setMyStore(e.id, v)} />
                    </FormRow>
                )}
            </FormGroup>
        </>
    );
}

function ParcelDetail({ e }: { e: Entry; }) {
    const p = e.parcel ?? {};
    const moved = !!(e.firstExpected && p.expected && e.firstExpected !== p.expected && p.status !== "delivered");
    return (
        <>
            <Steps steps={PARCEL_STEPS.map(s => s.label)} at={p.status ? parcelStep(p.status) : -1} warn={p.status === "delayed" || p.status === "exception" ? PARCEL_LABEL[p.status] : undefined} />
            <div className={classes("vc-track-day", moved && "vc-track-day-moved")}>
                <div className="vc-track-day-text">
                    <span>{p.status === "delivered" ? "Delivered" : "Arrives"}</span>
                    <b>{p.status === "delivered" ? (p.deliveredOn ? longDayText(p.deliveredOn) : "Delivered") : p.expected ? longDayText(p.expected) : "No day given yet"}</b>
                    {moved && <small>{p.expected! > e.firstExpected! ? "Delayed" : "Earlier"} — first said {longDayText(e.firstExpected!)}</small>}
                </div>
                <label className="vc-track-cal" title="Shows on Sonata's Calendar on the day it arrives, and moves by itself if the carrier changes the day">
                    <span>On my calendar</span>
                    <Toggle value={!!e.calendar} label="On my calendar" onChange={v => setCalendar(e.id, v)} />
                </label>
            </div>
            <Facts items={[
                ["Carrier", CARRIERS[e.carrier!].name],
                ["Tracking number", <button key="n" type="button" className="vc-track-copy" title="Copy" onClick={() => { void navigator.clipboard.writeText(e.number!); showToast("Copied the tracking number", "success"); }}>{e.number}</button>],
            ]} />
        </>
    );
}

function Detail({ e, onRemoved }: { e: Entry; onRemoved(): void; }) {
    const [naming, setNaming] = useState<string | null>(null);
    const busy = isChecking(e.id);
    const placed = e.kind === "food" && e.food?.placedAt ? ` · placed ${timeText(e.food.placedAt)}` : "";
    return (
        <div className="vc-track-detail">
            <DetailHead pic={<KindIcon e={e} size={26} />} dot={dotOf(e)}
                title={naming != null
                    ? <input className="vc-tool-input vc-track-name" autoFocus value={naming} placeholder={titleOf({ ...e, name: undefined })} aria-label="A name for it"
                        onChange={ev => setNaming(ev.currentTarget.value)}
                        onKeyDown={ev => { if (ev.key === "Enter") { renamePackage(e.id, naming); setNaming(null); } if (ev.key === "Escape") { ev.stopPropagation(); setNaming(null); } }}
                        onBlur={() => { renamePackage(e.id, naming); setNaming(null); }} />
                    : titleOf(e)}
                sub={`${e.kind === "food" ? SERVICES[e.service!].name : `${CARRIERS[e.carrier!].name} parcel`}${placed} · ${busy ? "checking…" : e.checked ? `checked ${timeText(e.checked)}` : "not checked yet"}`} />
            <Problem e={e} />
            {e.kind === "food" ? <FoodDetail e={e} /> : <ParcelDetail e={e} />}
            <History e={e} />
            <ActionRow>
                <a className="vc-tool-btn vc-tool-primary" href={e.url} target="_blank" rel="noreferrer">Open page</a>
                <button type="button" className="vc-tool-btn" disabled={busy || e.done} onClick={() => void checkPackage(e.id)}>{busy ? "Checking…" : "Check now"}</button>
                <button type="button" className="vc-tool-btn" onClick={() => setNaming(e.name ?? "")}>Rename</button>
                <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => { removePackage(e.id); onRemoved(); }}>Remove</button>
            </ActionRow>
        </div>
    );
}

/** Paste a tracking number or a delivery link. */
function AddBar({ onAdded }: { onAdded(id: string): void; }) {
    const [text, setText] = useState("");
    const [pick, setPick] = useState<Carrier | null>(null);
    const t = text.trim();
    const service = /^https?:\/\//i.test(t) ? serviceOf(t) : null;
    const guess = !service && t && !/^https?:/i.test(t) ? carrierOf(t) : null;
    const carrier = pick ?? guess;
    const hint = !t ? null
        : /^https?:/i.test(t) ? (service ? `${SERVICES[service].name} order` : "Only DoorDash, Uber Eats and Postmates tracking links for now")
            : carrier ? `${CARRIERS[carrier].name} parcel` : clean(t).length >= 8 ? "Pick the carrier" : "Keep typing…";
    const add = () => {
        if (service) { onAdded(addPackage({ kind: "food", service, url: t }).id); setText(""); setPick(null); return; }
        if (carrier && clean(t).length >= 8) { onAdded(addPackage({ kind: "parcel", carrier, number: clean(t) }).id); setText(""); setPick(null); }
    };
    return (
        <div className="vc-track-add">
            <input className="vc-tool-input" value={text} placeholder="Paste a tracking number or delivery link" aria-label="Tracking number or delivery link"
                onChange={e => { setText(e.currentTarget.value); setPick(null); }} onKeyDown={e => { if (e.key === "Enter") add(); }} />
            {t && (
                <div className="vc-track-add-row">
                    <span className="vc-track-hint">{hint}</span>
                    {!service && !/^https?:/i.test(t) && clean(t).length >= 8 && (
                        <select className="vc-tool-input vc-track-carrier" value={carrier ?? ""} aria-label="Carrier" onChange={e => setPick((e.currentTarget.value || null) as Carrier | null)}>
                            <option value="">Carrier…</option>
                            {(Object.keys(CARRIERS) as Carrier[]).map(c => <option key={c} value={c}>{CARRIERS[c].name}</option>)}
                        </select>
                    )}
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!service && !(carrier && clean(t).length >= 8)} onClick={add}>Track</button>
                </div>
            )}
        </div>
    );
}

function PackagesWindow({ modalProps, start }: { modalProps: RenderModalProps; start?: string; }) {
    const all = usePackages();
    const [picked, setPicked] = useState<string | undefined>(start);
    const food = all.filter(e => e.kind === "food"), parcels = all.filter(e => e.kind === "parcel");
    const cur = all.find(e => e.id === picked) ?? all[0];
    const active = all.filter(e => !e.done).length;

    const row = (e: Entry) => (
        <ListRow key={e.id} pic={<KindIcon e={e} />} title={titleOf(e)} sub={statusLine(e)} dot={dotOf(e)} on={e.id === cur?.id} onClick={() => setPicked(e.id)} />
    );
    return (
        <Window {...modalProps} size="lg" title="Package Tracker" subtitle="Parcels and food orders, without the address or anyone's name" flush
            status={[`${active} active`, `${all.length} tracked`]} statusRight="addresses and names are never read">
            <Split listWidth={290} list={
                <>
                    <AddBar onAdded={setPicked} />
                    {food.length > 0 && <><ListHead right={food.length}>Food</ListHead>{food.map(row)}</>}
                    {parcels.length > 0 && <><ListHead right={parcels.length}>Parcels</ListHead>{parcels.map(row)}</>}
                </>
            }>
                {cur ? <Detail key={cur.id} e={cur} onRemoved={() => setPicked(undefined)} /> : (
                    <div className="vc-track-empty">
                        <Box size={34} />
                        <b>Nothing tracked yet</b>
                        <p>Paste a tracking number (UPS, USPS, FedEx, DHL, Amazon, Royal Mail, Canada Post, OnTrac) or a DoorDash, Uber Eats or Postmates tracking link on the left. You can also press <b>Track</b> under a message that has one.</p>
                        <p>Sonata reads only the progress, the arrival time, the store and the food. Never the address, and never your name or the driver's.</p>
                    </div>
                )}
            </Split>
        </Window>
    );
}

export function openPackages(id?: string) {
    openModal(props => <PackagesWindow modalProps={props} start={id} />);
}
