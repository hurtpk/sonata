/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The tags window: make, rename, recolour and reorder tags, and see who has
// each one — with a click to message them.

import ErrorBoundary from "@components/ErrorBoundary";
import { openPrivateChannel } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { IconUtils, openModal, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { openSection } from "../_shared/Hub";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { LookPicker, TagChip } from "./LookPicker";
import { allTags, COLORS, createTag, deleteTag, isGradient, Look, lookStyle, moveTag, peopleWith, setTagged, STARTERS, Tag, updateTag, useTags } from "./store";

/** Ideas shown before "More ideas". */
const FIRST_IDEAS = 8;

function NewTagForm({ onMade }: { onMade(t: Tag): void; }) {
    const [name, setName] = useState("");
    const [look, setLook] = useState<Look>({ color: COLORS[(allTags().length * 5) % COLORS.length] });
    const [more, setMore] = useState(false);
    const make = (n = name, l = look) => { if (!n.trim()) return; onMade(createTag(n, l)); setName(""); };
    const unused = STARTERS.filter(([n]) => !allTags().some(t => t.name.toLowerCase() === n.toLowerCase()));
    const ideas = more ? unused : unused.slice(0, FIRST_IDEAS);
    return (
        <div className="vc-ptag-new">
            <div className="vc-ptag-new-row">
                <input className="vc-tool-input" value={name} maxLength={24} placeholder="New tag, like “School”" autoFocus
                    onChange={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") make(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!name.trim()} onClick={() => make()}>Add</button>
            </div>
            <LookPicker value={look} onChange={setLook} />
            <div className="vc-ptag-preview">
                <span className="vc-tool-hint">Preview</span>
                <TagChip look={look} name={name.trim() || "Your tag"} />
            </div>
            {unused.length > 0 && (
                <div className="vc-tool-chips vc-ptag-ideas">
                    <span className="vc-tool-hint">Ideas:</span>
                    {ideas.map(([n, l]) => <button key={n} type="button" className="vc-tool-chip" title={`Add “${n}”`} onClick={() => make(n, l)}><TagChip look={l} name={n} /></button>)}
                    {unused.length > FIRST_IDEAS && <button type="button" className="vc-tool-link" onClick={() => setMore(v => !v)}>{more ? "Fewer ideas" : `${unused.length - FIRST_IDEAS} more ideas`}</button>}
                </div>
            )}
        </div>
    );
}

function TagRow({ tag, on, count, onSelect, first, last }: { tag: Tag; on: boolean; count: number; onSelect(): void; first: boolean; last: boolean; }) {
    const [name, setName] = useState(tag.name);
    const [colors, setColors] = useState(false);
    const dot = isGradient(tag) ? { background: lookStyle(tag)["--ptag-line"] } : { background: tag.color };
    return (
        <div className={classes("vc-ptag-row", on && "vc-ptag-row-on")} onClick={onSelect}>
            <div className="vc-ptag-row-main">
                <button type="button" className="vc-ptag-dot" style={dot} title="Change how it looks" onClick={e => { e.stopPropagation(); setColors(v => !v); }} />
                <input className="vc-ptag-name" value={name} maxLength={24} onClick={e => e.stopPropagation()}
                    onChange={e => setName(e.currentTarget.value)} onBlur={() => { if (name.trim() && name !== tag.name) updateTag(tag.id, { name: name.trim() }); else setName(tag.name); }}
                    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                <TagChip look={tag} name={tag.name} />
                <span className="vc-tool-hint vc-ptag-count">{count} {count === 1 ? "person" : "people"}</span>
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-icon" title="Move up" disabled={first} onClick={e => { e.stopPropagation(); moveTag(tag.id, -1); }}>↑</button>
                <button type="button" className="vc-tool-icon" title="Move down" disabled={last} onClick={e => { e.stopPropagation(); moveTag(tag.id, 1); }}>↓</button>
                <button type="button" className="vc-tool-icon" title="Delete this tag" onClick={e => { e.stopPropagation(); deleteTag(tag.id); }}>🗑️</button>
            </div>
            {colors && (
                <div className="vc-ptag-row-look" onClick={e => e.stopPropagation()}>
                    <LookPicker value={tag} onChange={l => updateTag(tag.id, { color: l.color, gradient: l.gradient })} />
                    <div className="vc-tool-footer"><span className="vc-tool-spacer" /><button type="button" className="vc-tool-btn" onClick={() => setColors(false)}>Done</button></div>
                </div>
            )}
        </div>
    );
}

function People({ tag }: { tag: Tag; }) {
    const people = peopleWith(tag.id).map(p => {
        const u: any = UserStore.getUser(p.id);
        return { id: p.id, name: u?.globalName ?? u?.username ?? p.name ?? p.id, sub: u?.username ? `@${u.username}` : p.id, avatar: u ? IconUtils.getUserAvatarURL(u, false, 64) : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
    if (!people.length) return <div className="vc-tool-empty">Nobody has this tag yet. Right-click someone → Tags → <b>{tag.name}</b>.</div>;
    return (
        <div className="vc-tool-list">
            {people.map(p => (
                <div key={p.id} className="vc-tool-item">
                    {p.avatar ? <img className="vc-ptag-avatar" src={p.avatar} alt="" /> : <span className="vc-ptag-avatar" />}
                    <span className="vc-tool-item-main"><span className="vc-tool-item-title">{p.name}</span><span className="vc-tool-item-sub">{p.sub}</span></span>
                    <button type="button" className="vc-tool-btn" onClick={() => openPrivateChannel(p.id)}>Message</button>
                    <button type="button" className="vc-tool-icon" title="Take this tag off them" onClick={() => setTagged(p.id, tag.id, false)}>✕</button>
                </div>
            ))}
        </div>
    );
}

function ManagerModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const data = useTags();
    const [sel, setSel] = useState<string | null>(data.tags[0]?.id ?? null);
    const tag = data.tags.find(t => t.id === sel) ?? null;
    const accent = windowAccent("personTags");
    return (
        <Window {...modalProps} size="lg" title="Person tags" subtitle="Only you can see these — right-click anyone → Tags to tag them">
            <div className="vc-tool-wrap vc-ptag-manager" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🏷️" kicker="Only you see these" title={`${data.tags.length} tag${data.tags.length === 1 ? "" : "s"}`}
                    sub="Right-click anyone → Tags to give them one. Tags show next to their name everywhere."
                    numbers={[{ value: new Set(data.tags.flatMap(t => peopleWith(t.id))).size, label: "people tagged" }]} />
                <section className="vc-tool-section">
                    <span className="vc-tool-label">Your tags · {data.tags.length}</span>
                    {data.tags.map((t, i) => (
                        <TagRow key={t.id} tag={t} on={t.id === sel} count={peopleWith(t.id).length} onSelect={() => setSel(t.id)} first={i === 0} last={i === data.tags.length - 1} />
                    ))}
                    <NewTagForm onMade={t => setSel(t.id)} />
                </section>
                {tag && (
                    <section className="vc-tool-section">
                        <span className="vc-tool-label">Tagged <TagChip look={tag} name={tag.name} /></span>
                        <People tag={tag} />
                    </section>
                )}
            </div>
        </Window>
    );
}

export const openTagManager = () => openSection("people", "personTags", props => renderTagManager(props));

function NewTagModal({ modalProps, onMade }: { modalProps: RenderModalProps; onMade(t: Tag): void; }) {
    return (
        <Window {...modalProps} size="sm" title="New tag" subtitle="Only you can see it">
            <div className="vc-tool-wrap"><NewTagForm onMade={t => { onMade(t); modalProps.onClose(); }} /></div>
        </Window>
    );
}

export const openNewTag = (onMade: (t: Tag) => void) => openModal(props => <ErrorBoundary><NewTagModal modalProps={props} onMade={onMade} /></ErrorBoundary>);

export function renderTagManager(props: RenderModalProps) { return (<ErrorBoundary><ManagerModal modalProps={props} /></ErrorBoundary>); }
