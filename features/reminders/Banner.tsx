/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The banner that slides down from the top of Discord when a reminder is
// due, in the reminder's colour — red ones ring twice and give the banner a
// pulse, gray ones are silent and slide away on their own.

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { ChannelStore, createRoot, NavigationRouter, useEffect, useReducer, useState } from "@webpack/common";

import { COLORS, completeReminder, Reminder, snoozeReminder, whenText } from "./store";

const ringing = new Map<string, Reminder>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());

// ─── Sounds, made on the spot (no sound files) ───

let audio: AudioContext | null = null;

function tone(ctx: AudioContext, freq: number, start: number, length: number, volume: number) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + length + 0.05);
}

export function playSound(kind: "urgent" | "chime" | "soft" | "none", volume = 0.6) {
    if (kind === "none" || volume <= 0) return;
    try {
        audio ??= new AudioContext();
        const t = audio.currentTime + 0.02, v = 0.25 * volume;
        if (kind === "soft") { tone(audio, 784, t, 0.5, v * 0.7); tone(audio, 1175, t + 0.12, 0.6, v * 0.5); }
        else if (kind === "chime") { tone(audio, 659, t, 0.45, v); tone(audio, 880, t + 0.14, 0.45, v); tone(audio, 1319, t + 0.28, 0.7, v * 0.8); }
        else for (const o of [0, 0.7]) { tone(audio, 880, t + o, 0.18, v * 1.2); tone(audio, 880, t + o + 0.22, 0.18, v * 1.2); tone(audio, 1175, t + o + 0.44, 0.3, v * 1.2); }
    } catch { }
}

// ─── Ringing ───

interface RingOptions { volume: number; desktop: boolean; }
let options: RingOptions = { volume: 0.6, desktop: true };
export const setRingOptions = (o: RingOptions) => { options = o; };

export function ring(r: Reminder) {
    const fresh = !ringing.has(r.id);
    ringing.set(r.id, r);
    changed();
    if (!fresh) return;
    const c = COLORS[r.color] ?? COLORS.blue;
    playSound(c.sound, options.volume);
    // Discord minimised or in the background: a Windows notification too, so it isn't missed.
    if (options.desktop && (document.hidden || !document.hasFocus()) && "Notification" in window) {
        try {
            const n = new Notification(`⏰ ${r.text || "Reminder"}`, { body: `${c.name} reminder · ${whenText(r.at)}`, silent: true, tag: `sonata-reminder-${r.id}` });
            n.onclick = () => { window.focus(); n.close(); };
        } catch { }
    }
}

export const isRinging = (id: string) => ringing.has(id);

function dismiss(id: string) {
    ringing.delete(id);
    changed();
}

const SNOOZES: { label: string; min: number | "tomorrow"; }[] = [
    { label: "5 min", min: 5 }, { label: "15 min", min: 15 }, { label: "1 hour", min: 60 }, { label: "Tomorrow", min: "tomorrow" },
];

function snoozeUntil(min: number | "tomorrow") {
    if (min !== "tomorrow") return Date.now() + min * 60_000;
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
}

function Card({ r }: { r: Reminder; }) {
    const c = COLORS[r.color] ?? COLORS.blue;
    const [leaving, setLeaving] = useState(false);
    const [snoozing, setSnoozing] = useState(false);
    const close = (then: () => void) => { setLeaving(true); setTimeout(() => { then(); dismiss(r.id); }, 220); };

    // Gray reminders slide away by themselves.
    useEffect(() => {
        if (c.stays) return;
        const t = setTimeout(() => close(() => completeReminder(r.id)), 20_000);
        return () => clearTimeout(t);
    }, []);

    const open = r.link && (() => {
        const ch = ChannelStore.getChannel(r.link!.channelId);
        NavigationRouter.transitionTo(`/channels/${r.link!.guildId ?? ch?.guild_id ?? "@me"}/${r.link!.channelId}/${r.link!.messageId}`);
    });

    return (
        <div className={classes("vc-rem-banner", `vc-rem-${r.color}`, leaving && "vc-rem-leaving")} style={{ "--rem": c.hex } as React.CSSProperties} role="alert">
            <span className="vc-rem-bell" aria-hidden>⏰</span>
            <div className="vc-rem-body">
                <div className="vc-rem-text">{r.text || "Reminder"}</div>
                <div className="vc-rem-meta">
                    {r.link?.author ? `About ${r.link.author}'s message · ` : ""}{r.repeat !== "none" ? "Repeats · " : ""}set for {new Date(r.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </div>
            </div>
            <div className="vc-rem-actions">
                {snoozing ? (
                    <>
                        {SNOOZES.map(s => <button key={s.label} type="button" onClick={() => close(() => snoozeReminder(r.id, snoozeUntil(s.min)))}>{s.label}</button>)}
                        <button type="button" className="vc-rem-quiet" onClick={() => setSnoozing(false)}>✕</button>
                    </>
                ) : (
                    <>
                        {open && <button type="button" onClick={() => close(() => { open(); completeReminder(r.id); })}>Open message</button>}
                        <button type="button" onClick={() => setSnoozing(true)}>Snooze</button>
                        <button type="button" className="vc-rem-done" onClick={() => close(() => completeReminder(r.id))}>Done</button>
                    </>
                )}
            </div>
        </div>
    );
}

function Banners() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { listeners.add(bump); return () => void listeners.delete(bump); }, []);
    const list = [...ringing.values()];
    if (!list.length) return null;
    return <div className="vc-rem-stack">{list.map(r => <Card key={`${r.id}-${r.at}`} r={r} />)}</div>;
}

let host: HTMLDivElement | null = null;
let root: { render(n: React.ReactNode): void; unmount(): void; } | null = null;
const Safe = ErrorBoundary.wrap(Banners, { noop: true });

export function mountBanners() {
    if (host) return;
    host = document.createElement("div");
    host.id = "vc-rem-host";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<Safe />);
}

export function unmountBanners() {
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
    ringing.clear();
}
