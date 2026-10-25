/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { showToast, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { openSection, registerSection } from "../../_shared/Hub";
import { Window } from "../../_shared/Window";
import { ALL_CHARS, CATEGORIES } from "./chars";

const cl = classNameFactory("vc-tool-");
const cp = classNameFactory("vc-chars-");

function CharsModal({ modalProps, recent, onPick, insert, target }: { modalProps: RenderModalProps; recent: string[]; onPick(ch: string): string[]; insert?: (ch: string) => void; target?: string; }) {
    const accent = windowAccent("charactersPicker");
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState(recent.length ? "recent" : CATEGORIES[0].id);
    const [recents, setRecents] = useState(recent);
    const [flash, setFlash] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const q = query.trim().toLowerCase();
    const shown = useMemo(() => {
        if (q) return ALL_CHARS.filter(c => c.ch.includes(q) || c.words.includes(q) || c.words.split(" ").some(w => w.startsWith(q)));
        if (tab === "recent") return recents.map(ch => ALL_CHARS.find(c => c.ch === ch) ?? { ch, words: "", category: "recent", wide: ch.length > 2 });
        return ALL_CHARS.filter(c => c.category === tab);
    }, [q, tab, recents]);

    // Clicking puts it in your message and keeps the window open, so you can add several.
    const pick = (ch: string, close: boolean) => {
        if (insert) insert(ch);
        else insertTextIntoChatInputBox(ch);
        setRecents(onPick(ch));
        setFlash(ch);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setFlash(null), 1200);
        if (close) modalProps.onClose();
    };

    const copy = async (ch: string) => {
        try { await navigator.clipboard.writeText(ch); showToast(`Copied ${ch}`, "success"); } catch { showToast("Couldn't copy", "failure"); }
    };

    const tabs: [string, string][] = [...(recents.length ? [["recent", "Recent"] as [string, string]] : []), ...CATEGORIES.map(c => [c.id, c.name] as [string, string])];

    return (
        <Window {...modalProps} size="lg" title="Characters" subtitle={`Click to add to ${target ?? "your message"} · Shift-click to add and close · Right-click to copy`}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <input className={cl("input")} autoFocus value={query} placeholder="Search — heart, treble clef, chess, circled 3, shrug…" onChange={e => setQuery(e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === "Enter" && shown[0]) { e.preventDefault(); pick(shown[0].ch, true); } }} />
                {!q && (
                    <div className={cl("seg")}>
                        {tabs.map(([id, name]) => (
                            <button key={id} type="button" className={classes(cl("seg-btn"), tab === id && cl("seg-on"))} onClick={() => setTab(id)}>{name}</button>
                        ))}
                    </div>
                )}
                <div className={cp("grid")}>
                    {shown.map(c => (
                        <button key={`${c.category}-${c.ch}`} type="button" title={c.words || c.ch} className={classes(cp("char"), c.wide && cp("wide"), flash === c.ch && cp("flash"))}
                            onClick={e => pick(c.ch, e.shiftKey)} onContextMenu={e => { e.preventDefault(); copy(c.ch); }}>
                            {c.ch}
                        </button>
                    ))}
                    {!shown.length && <div className={cl("empty")}><span className={cl("empty-icon")}>🔍</span>Nothing matches “{query}”.</div>}
                </div>
                <div className={cl("hint")}>{flash ? `Added ${flash}` : q ? `${shown.length} found` : tab === "recent" ? "The ones you picked lately." : ""}</div>
            </div>
        </Window>
    );
}

/** insert: where picked characters go instead of the chat box (e.g. a name field); target names it in the subtitle. */
export function openCharacters(recent: string[], onPick: (ch: string) => string[], insert?: (ch: string) => void, target?: string) {
    openSection("textStyles", "charactersPicker", props => <CharsModal modalProps={props} recent={recent} onPick={onPick} insert={insert} target={target} />);
}
export const charsSection = (recent: () => string[], onPick: (ch: string) => string[]) => registerSection("textStyles", { id: "charactersPicker", feature: "charactersPicker", name: "Characters", sub: "Symbols, arrows, stars and more", render: p => <CharsModal modalProps={p} recent={recent()} onPick={onPick} /> });
