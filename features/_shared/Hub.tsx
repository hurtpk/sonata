/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Group windows: Sonata features that were merged into one (Music & Audio,
// Media Tools, Text Styles, Safety, Profile Tools) share one window, with their
// parts listed down the left. Each part keeps its own window code: inside a
// group, <Window> takes the group's name, size and list of parts, and doesn't
// replay its opening animation when you switch parts, so nothing flashes.

import { Settings } from "@api/Settings";
import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { React, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { featureIconKey } from "../../sonata/featureIcons";
import { DOCK_ICON_MAP } from "../../utilities/icons";

/** What a part gets when it's opened with something (a picture pasted in chat, a file). */
export interface HubInput { file?: File; }

export interface Section {
    id: string;
    /** The feature it belongs to (its switch decides whether it's listed). */
    feature: string;
    name: string;
    sub: string;
    render(props: RenderModalProps, input?: HubInput): ReactNode;
}

interface GroupInfo { title: string; size: "lg" | "xl" | "xxl"; }
const GROUPS: Record<string, GroupInfo> = {
    musicAudio: { title: "Music & Audio", size: "lg" },
    mediaTools: { title: "Media Tools", size: "xxl" },
    textStyles: { title: "Text Styles", size: "lg" },
    safety: { title: "Safety", size: "lg" },
    profileTools: { title: "Profile Tools", size: "xl" },
};

const sections = new Map<string, Section[]>();

/** Adds a part to a group (from that part's own file; nothing runs until it's opened). */
export function registerSection(group: string, s: Section) {
    const list = (sections.get(group) ?? []).filter(x => x.id !== s.id);
    sections.set(group, [...list, s]);
}

const isOn = (feature: string) => (Settings.plugins as any)?.Sonata?.[`on_${feature}`] !== false;
export const groupSections = (group: string) => (sections.get(group) ?? []).filter(s => isOn(s.feature));

export interface HubInfo { title: string; size: string; rail: ReactNode; still: boolean; }
// Made the first time it's needed: React isn't there yet when Equicord first loads this file.
let ctx: React.Context<HubInfo | null> | null = null;
export const hubContext = () => ctx ??= React.createContext<HubInfo | null>(null);

const last: Record<string, string> = {};

function Rail({ list, current, pick }: { list: Section[]; current: string; pick(id: string): void; }) {
    const store = Settings.plugins.Sonata;
    return (
        <>
            {list.map(s => {
                const { Icon } = DOCK_ICON_MAP[featureIconKey(store, s.feature)] ?? DOCK_ICON_MAP.puzzle;
                return (
                    <button key={s.id} type="button" className={classes("vc-sw-row", s.id === current && "vc-sw-row-on")} aria-pressed={s.id === current} onClick={() => pick(s.id)}>
                        <span className="vc-sw-pic" aria-hidden><Icon width={18} height={18} /></span>
                        <span className="vc-sw-row-text"><span className="vc-sw-row-title">{s.name}</span><span className="vc-sw-row-sub">{s.sub}</span></span>
                    </button>
                );
            })}
        </>
    );
}

/** Each group's open window: opening a part of it switches that window rather than opening another. */
const live: Record<string, ((id: string, render?: (p: RenderModalProps) => ReactNode, input?: HubInput) => void) | undefined> = {};

function HubWindow({ modalProps, group, start, input: startInput, first }: { modalProps: RenderModalProps; group: string; start?: string; input?: HubInput; first?: (p: RenderModalProps) => ReactNode; }) {
    const list = groupSections(group);
    const [cur, setCur] = useState<{ id: string; render?: (p: RenderModalProps) => ReactNode; n: number; }>(() => ({ id: start ?? last[group] ?? list[0]?.id ?? "", render: first, n: 0 }));
    const [input, setInput] = useState<HubInput | undefined>(startInput);
    const closing = React.useRef(false);
    React.useEffect(() => {
        const go = (id: string, render?: (p: RenderModalProps) => ReactNode, next?: HubInput) => {
            closing.current = false;
            last[group] = id;
            if (next) setInput(next);
            setCur(c => ({ id, render, n: c.n + 1 }));
        };
        live[group] = go;
        // Closing the window forgets which attachment it was opened from, so a later send never removes one.
        return () => { if (live[group] === go) delete live[group]; original = null; };
    }, []);
    // A part that closes itself and opens another part (GIF Maker's start page opening the editor)
    // switches in place: the close waits a moment, and opening the next part cancels it.
    const props = React.useMemo<RenderModalProps>(() => ({
        ...modalProps,
        onClose: () => { closing.current = true; setTimeout(() => { if (closing.current) modalProps.onClose(); }, 0); },
    }), [modalProps]);
    const s = list.find(x => x.id === cur.id) ?? list[0];
    const info = GROUPS[group] ?? { title: group, size: "xl" };
    const pick = (id: string) => { last[group] = id; setCur(c => ({ id, n: c.n + 1 })); };
    const { Provider } = hubContext();
    if (!s && !cur.render) return null;
    return (
        <Provider value={{ title: info.title, size: info.size, rail: list.length > 1 ? <Rail list={list} current={s?.id ?? cur.id} pick={pick} /> : null, still: cur.n > 0 }}>
            <React.Fragment key={`${cur.id}:${cur.n}`}>{cur.render ? cur.render(props) : s.render(props, input)}</React.Fragment>
        </Provider>
    );
}

/**
 * Opens a group's window on one of its parts. `render` shows that part with
 * something to start from (a file, a person…); without it, the part opens as
 * normal. `input` is shared with every part you switch to (Media Tools: the
 * picture you're editing).
 */
export function openSection(group: string, id: string, render?: (p: RenderModalProps) => ReactNode, input?: HubInput) {
    last[group] = id;
    const open = live[group];
    if (open) { open(id, render, input); return; }
    openModal(props => <HubWindow modalProps={props} group={group} start={id} first={render} input={input} />);
}

/** Opens a group's window where you were last (Features page, dock). */
export function openGroup(group: string) {
    const list = groupSections(group);
    const id = last[group] && list.some(s => s.id === last[group]) ? last[group] : list[0]?.id;
    if (!id) return false;
    openSection(group, id);
    return true;
}

/* ── Media Tools: replacing the attachment it was opened from ── */

let original: { channelId: string; id: string; draftType: number; } | null = null;
let dispatcher: { dispatch(e: any): void; } | null = null;
export const setOriginal = (o: typeof original, fd?: { dispatch(e: any): void; }) => { original = o; if (fd) dispatcher = fd; };
/** When an edited copy goes into your message, the attachment it came from leaves it. */
export function replaceOriginal() {
    if (!original || !dispatcher) return;
    dispatcher.dispatch({ type: "UPLOAD_ATTACHMENT_REMOVE_FILE", channelId: original.channelId, id: original.id, draftType: original.draftType });
    original = null;
}
