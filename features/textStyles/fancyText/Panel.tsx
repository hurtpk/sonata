/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { showToast, useEffect, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { openSection, registerSection } from "../../_shared/Hub";
import { Window } from "../../_shared/Window";
import { BASES, customConvert, CustomStyle, STYLES, WRAPS } from "./styles";

const cl = classNameFactory("vc-fancy-");
const tl = classNameFactory("vc-tool-");

const SAMPLE = "Sonata";

export interface FancyStore { lastStyle: string; favoritesJson: string; customJson: string; }

const readList = <T,>(raw: string | undefined, fallback: T): T => { try { const v = JSON.parse(raw || ""); return Array.isArray(v) ? v as T : fallback; } catch { return fallback; } };

async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); showToast("Copied", "success"); } catch { showToast("Couldn't copy", "failure"); }
}

interface Shown { id: string; name: string; convert(t: string): string; custom?: CustomStyle; }

function StyleCard({ s, source, typed, last, fav, onFav, onInsert, onEdit, onDelete }: {
    s: Shown; source: string; typed: boolean; last: boolean; fav: boolean; onFav(): void; onInsert(out: string): void; onEdit?(): void; onDelete?(): void;
}) {
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);
    const out = s.convert(source);
    return (
        <div className={classes(cl("card"), !typed && cl("card-sample"), fav && cl("card-fav"))}>
            <button type="button" className={cl("main")} disabled={!typed} title={typed ? "Insert into your message" : "Type something first"} onClick={() => onInsert(out)}>
                <span className={cl("name")}>
                    {s.name}
                    {last && <span className={classes(tl("badge"), tl("badge-accent"))}>Last used</span>}
                    {s.custom && <span className={tl("badge")}>Yours</span>}
                </span>
                <span className={cl("out")}>{out}</span>
            </button>
            <div className={cl("side")}>
                <button type="button" className={classes(cl("star"), fav && cl("star-on"))} title={fav ? "Remove from favourites" : "Add to favourites"} aria-pressed={fav} onClick={onFav}>{fav ? "★" : "☆"}</button>
                {onEdit && <button type="button" className={cl("tool")} title="Edit this style" onClick={onEdit}>✎</button>}
                {onDelete && (sure
                    ? <button type="button" className={classes(cl("tool"), cl("tool-sure"))} onClick={onDelete}>Sure?</button>
                    : <button type="button" className={classes(cl("tool"), cl("tool-x"))} title="Delete this style" onClick={() => setSure(true)}>✕</button>)}
                <button type="button" className={cl("tool")} disabled={!typed} title="Copy" onClick={() => copy(out)}>⧉</button>
            </div>
        </div>
    );
}

function Mixer({ start, source, onSave, onCancel }: { start: CustomStyle; source: string; onSave(c: CustomStyle): void; onCancel(): void; }) {
    const [c, setC] = useState<CustomStyle>(start);
    const set = (p: Partial<CustomStyle>) => setC(x => ({ ...x, ...p }));
    const preview = customConvert(c)(source);
    return (
        <section className={cl("mixer")}>
            <div className={cl("mixer-head")}>
                <b>{start.name ? "Edit your style" : "Make your own style"}</b>
                <span className={tl("spacer")} />
                <input className={classes(tl("input"), cl("mixer-name"))} value={c.name} maxLength={30} placeholder="Name it…" onChange={e => set({ name: e.currentTarget.value })} />
            </div>
            <div className={cl("preview")}>{preview}</div>
            <span className={tl("label")}>Letters</span>
            <div className={tl("chips")}>
                <button type="button" className={classes(tl("chip"), c.base === "plain" && tl("chip-on"))} onClick={() => set({ base: "plain" })}>As typed</button>
                {BASES.map(b => <button key={b.id} type="button" className={classes(tl("chip"), c.base === b.id && tl("chip-on"))} onClick={() => set({ base: b.id })}>{b.convert(b.name)}</button>)}
            </div>
            <div className={cl("mixer-row")}>
                <label className={tl("field")}>
                    <span className={tl("label")}>Between letters</span>
                    <div className={tl("chips")}>
                        {[["", "Nothing"], [" ", "Space"], ["♡", "♡"], ["·", "·"], ["⋆", "⋆"], ["~", "~"]].map(([v, l]) => (
                            <button key={l} type="button" className={classes(tl("chip"), (c.between ?? "") === v && tl("chip-on"))} onClick={() => set({ between: v || undefined })}>{l}</button>
                        ))}
                    </div>
                </label>
                <label className={tl("field")}>
                    <span className={tl("label")}>Extras</span>
                    <div className={tl("chips")}>
                        <button type="button" className={classes(tl("chip"), c.underline && tl("chip-on"))} onClick={() => set({ underline: !c.underline })}>U̲n̲d̲e̲r̲l̲i̲n̲e̲</button>
                        <button type="button" className={classes(tl("chip"), c.strike && tl("chip-on"))} onClick={() => set({ strike: !c.strike })}>S̶t̶r̶i̶k̶e̶</button>
                    </div>
                </label>
            </div>
            <span className={tl("label")}>Wrap it</span>
            <div className={tl("chips")}>
                <button type="button" className={classes(tl("chip"), !c.before && !c.after && tl("chip-on"))} onClick={() => set({ before: undefined, after: undefined })}>None</button>
                {WRAPS.map(([b, a]) => <button key={b} type="button" className={classes(tl("chip"), c.before === b && c.after === a && tl("chip-on"))} onClick={() => set({ before: b, after: a })}>{b}ab{a}</button>)}
            </div>
            <div className={cl("mixer-row")}>
                <input className={tl("input")} value={c.before ?? ""} maxLength={12} placeholder="Your own start" onChange={e => set({ before: e.currentTarget.value || undefined })} />
                <input className={tl("input")} value={c.after ?? ""} maxLength={12} placeholder="Your own end" onChange={e => set({ after: e.currentTarget.value || undefined })} />
            </div>
            <div className={tl("footer")}>
                <span className={tl("spacer")} />
                <button type="button" className={tl("btn")} onClick={onCancel}>Cancel</button>
                <button type="button" className={classes(tl("btn"), tl("primary"))} onClick={() => onSave({ ...c, name: c.name.trim() || "My style" })}>Save style</button>
            </div>
        </section>
    );
}

function FancyModal({ modalProps, store }: { modalProps: RenderModalProps; store: FancyStore; }) {
    const [text, setText] = useState("");
    const [favs, setFavs] = useState<string[]>(() => readList(store.favoritesJson, []));
    const [mine, setMine] = useState<CustomStyle[]>(() => readList(store.customJson, []));
    const [editing, setEditing] = useState<CustomStyle | null>(null);
    const accent = windowAccent("fancyText");
    const source = text || SAMPLE;
    const typed = !!text.trim();

    const saveFavs = (list: string[]) => { setFavs(list); store.favoritesJson = JSON.stringify(list); };
    const saveMine = (list: CustomStyle[]) => { setMine(list); store.customJson = JSON.stringify(list); };
    const toggleFav = (id: string) => saveFavs(favs.includes(id) ? favs.filter(f => f !== id) : [...favs, id]);

    const yours: Shown[] = mine.map(c => ({ id: c.id, name: c.name, convert: customConvert(c), custom: c }));
    const all: Shown[] = [...yours, ...STYLES];
    const favShown = favs.map(id => all.find(s => s.id === id)).filter(Boolean) as Shown[];
    // The style you used last goes first among the rest.
    const rest = STYLES.filter(s => !favs.includes(s.id)).sort((x, y) => Number(y.id === store.lastStyle) - Number(x.id === store.lastStyle));
    const first = favShown[0] ?? yours[0] ?? rest[0];

    const insert = (id: string, out: string) => {
        if (!typed) return;
        insertTextIntoChatInputBox(out);
        store.lastStyle = id;
        modalProps.onClose();
    };

    const card = (s: Shown) => (
        <StyleCard key={s.id} s={s} source={source} typed={typed} last={s.id === store.lastStyle} fav={favs.includes(s.id)}
            onFav={() => toggleFav(s.id)} onInsert={out => insert(s.id, out)}
            onEdit={s.custom ? () => setEditing(s.custom!) : undefined}
            onDelete={s.custom ? () => { saveMine(mine.filter(m => m.id !== s.id)); saveFavs(favs.filter(f => f !== s.id)); } : undefined} />
    );

    return (
        <Window {...modalProps} size="lg" title="Fancy Text" subtitle="Type below, then click a style to put it in your message">
            <div className={classes(tl("wrap"), cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <input className={classes(tl("input"), cl("input"))} autoFocus value={text} placeholder="Type your text…" spellCheck={false}
                    onChange={e => setText(e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === "Enter" && typed && first) { e.preventDefault(); insert(first.id, first.convert(text)); } }} />
                <div className={tl("hint")}>Enter uses your first favourite (or the first style). Fancy letters can't be read by screen readers and don't show up in Discord's search.</div>

                {editing ? (
                    <Mixer start={editing} source={source} onCancel={() => setEditing(null)}
                        onSave={c => { saveMine(mine.some(m => m.id === c.id) ? mine.map(m => m.id === c.id ? c : m) : [c, ...mine]); setEditing(null); showToast(`Saved “${c.name}”`, "success"); }} />
                ) : (
                    <div className={cl("scroll")}>
                        {favShown.length > 0 && <><span className={tl("label")}>★ Favourites</span><div className={cl("grid")}>{favShown.map(card)}</div></>}
                        <div className={cl("section-head")}>
                            <span className={tl("label")}>Your styles</span>
                            <button type="button" className={classes(tl("btn"), tl("primary"), cl("make"))} onClick={() => setEditing({ id: `c${Date.now().toString(36)}`, name: "", base: "bold" })}>＋ Make your own</button>
                        </div>
                        {yours.filter(s => !favs.includes(s.id)).length > 0
                            ? <div className={cl("grid")}>{yours.filter(s => !favs.includes(s.id)).map(card)}</div>
                            : !yours.length && <span className={tl("hint")}>Mix a letter style with extras — like ꧁𝓢𝓸𝓷𝓪𝓽𝓪꧂ or 𝗦·𝗼·𝗻·𝗮·𝘁·𝗮 — and keep it here.</span>}
                        <span className={tl("label")}>All styles</span>
                        <div className={cl("grid")}>{rest.map(card)}</div>
                    </div>
                )}
            </div>
        </Window>
    );
}

export function openFancyText(store: FancyStore) {
    openSection("textStyles", "fancyText", props => <FancyModal modalProps={props} store={store} />);
}
export const fancySection = (store: () => FancyStore) => registerSection("textStyles", { id: "fancyText", feature: "fancyText", name: "Fancy Text", sub: "𝓯𝓪𝓷𝓬𝔂 fonts for your words", render: p => <FancyModal modalProps={p} store={store()} /> });
