/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Package Tracker in chat: a Track bar under messages with a tracking number or
// delivery link, blurring delivery links (they show an address and name to
// whoever opens them), and a warning before you send one yourself.

import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { showToast, useEffect, useMemo, useRef } from "@webpack/common";

import { Window } from "../_shared/Window";
import { FormGroup } from "../_shared/WindowParts";
import { CARRIERS, findInText, Found, serviceOf, SERVICES, shortNumber } from "./detect";
import { KindIcon, openPackages } from "./Panel";
import { addPackage, settings, statusLine, trackedFor, usePackages } from "./store";

const COVERED = "vc-track-covered";

/** Blur this message's delivery links and their link previews. */
function cover(el: HTMLElement | null) {
    const msg = el?.closest("li") ?? el?.closest('[class*="messageListItem"]');
    if (!msg) return;
    for (const a of msg.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (a.closest(".vc-track-bar") || !serviceOf(a.href)) continue;
        a.classList.add(COVERED);
        a.title = "A delivery tracking link: it shows an address and name. Hover to see it.";
        a.closest("article")?.classList.add(COVERED);
    }
}

function Chip({ f }: { f: Found; }) {
    usePackages();
    const tracked = trackedFor(f);
    const name = f.kind === "food" ? `${SERVICES[f.service].name} order` : `${CARRIERS[f.carrier].name} parcel`;
    const sub = tracked ? statusLine(tracked) : f.kind === "food" ? (settings.store.hideLinks ? "link hidden" : "delivery link") : shortNumber(f.number);
    return (
        <div className={classes("vc-track-chip", tracked && "vc-track-chip-on")}>
            <span className="vc-track-chip-icon"><KindIcon e={f} size={16} /></span>
            <span className="vc-track-chip-text"><b>{name}</b><small>{sub}</small></span>
            <button type="button" className="vc-track-chip-btn" onClick={() => openPackages((tracked ?? addPackage(f)).id)}>{tracked ? "Open" : "Track"}</button>
        </div>
    );
}

export function Accessory({ message }: { message: any; }) {
    const ref = useRef<HTMLSpanElement & HTMLDivElement>(null);
    const found = useMemo(() => findInText(message?.content ?? "").slice(0, 4), [message?.content]);
    const hasFood = found.some(f => f.kind === "food");
    useEffect(() => {
        if (!hasFood || !settings.store.hideLinks) return;
        cover(ref.current);
        // Link previews show up a moment after the message.
        const t = setTimeout(() => cover(ref.current), 1500);
        return () => clearTimeout(t);
    }, [hasFood, message?.content, message?.embeds?.length]);
    if (!found.length) return null;
    // Hiding links without the Track bar: just a place to start looking from.
    if (!settings.store.showInChat) return <span ref={ref} hidden />;
    return <div ref={ref} className="vc-track-bar">{found.map(f => <Chip key={f.kind === "food" ? f.url : f.number} f={f} />)}</div>;
}

/* ── Before sending ── */

type Choice = "send" | "track" | "cancel";

function WarnWindow({ modalProps, service, done }: { modalProps: RenderModalProps; service: string; done(c: Choice): void; }) {
    const answered = useRef(false);
    const pick = (c: Choice) => { answered.current = true; done(c); modalProps.onClose(); };
    // Closing it any other way (Escape, the X) doesn't send.
    useEffect(() => () => { if (!answered.current) done("cancel"); }, []);
    return (
        <Window {...modalProps} size="sm" title="Package Tracker" subtitle="Before you send that" role="alertdialog"
            actions={[
                { text: "Cancel", variant: "secondary", onClick: () => pick("cancel") },
                { text: "Just track it", variant: "secondary", onClick: () => pick("track") },
                { text: "Send anyway", variant: "primary", onClick: () => pick("send") },
            ]}
            status={["nothing has been sent"]}>
            <FormGroup>
                <div className="vc-track-warn">
                    <b>This {service} link shows your address and name</b>
                    <p>Anyone who opens it can see where the order is going, your name and the driver's, and follow it on a map until it arrives.</p>
                    <p><b>Just track it</b> keeps it in Package Tracker for you instead, without sending it.</p>
                </div>
            </FormGroup>
        </Window>
    );
}

export async function beforeSend(_channelId: string, msg: { content: string; }) {
    if (!settings.store.warnBeforeSending) return;
    const food = findInText(msg.content ?? "").filter(f => f.kind === "food");
    if (!food.length) return;
    const choice = await new Promise<Choice>(resolve => {
        let settled = false;
        const done = (c: Choice) => { if (!settled) { settled = true; resolve(c); } };
        openModal(props => <WarnWindow modalProps={props} service={SERVICES[(food[0] as any).service as keyof typeof SERVICES].name} done={done} />);
    });
    if (choice === "send") return;
    if (choice === "track") {
        for (const f of food) addPackage(f);
        showToast("Tracking it in Package Tracker. Nothing was sent.", "success");
    }
    return { cancel: true };
}
