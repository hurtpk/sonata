/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useRef, useState } from "@webpack/common";

import { Window } from "../_shared/Window";
import { FormGroup, FormRow, ListHead, ListRow, Split, Toggle } from "../_shared/WindowParts";
import { addBadge, allBadges, customKey, DISCORD_BADGES, discordBadgeSrc, emojiToBadge, isHidden, moveKey, MyBadge, pictureToBadge, removeBadge, resetArrangement, SeenBadge, setHidden, updateBadge, useBadges } from "./store";

const FROM: Record<MyBadge["from"], string> = { discord: "Discord badge", picture: "Your picture", emoji: "Emoji" };

/** A badge's picture, or its first letter when it has none (badges some plugins draw themselves). */
const Pic = ({ s }: { s: SeenBadge; }) => s.src ? <img src={s.src} alt="" /> : <span className="vc-cbadge-letter">{(s.label || "?").slice(0, 1).toUpperCase()}</span>;

/** Every badge on your profile in a row, the way it shows: hidden ones left out. */
function Row({ picked }: { picked?: string; }) {
    const shown = allBadges().filter(s => !isHidden(s.key));
    return (
        <div className="vc-cbadge-row" aria-label="How your badges look">
            {shown.length ? shown.map(s => <span key={s.key} title={s.label} className={s.key === picked ? "vc-cbadge-row-on" : undefined}><Pic s={s} /></span>) : <small>No badges showing</small>}
        </div>
    );
}

const SOURCE: Record<SeenBadge["source"], string> = { discord: "Discord badge", plugin: "From a plugin", custom: "Yours" };

/** Every badge on your profile, real ones too: put them in order and hide any of them. */
function Arrange() {
    useBadges();
    const list = allBadges();
    const anyReal = list.some(s => s.source !== "custom");
    return (
        <>
            <div className="vc-cbadge-head">
                <b>Arrange your badges</b>
                <span>Put every badge on your profile in order, and hide any of them, your real ones too. Only you see the change.</span>
            </div>
            <FormGroup title="On your profile">
                <div className="vc-cbadge-preview"><Row /></div>
            </FormGroup>
            <FormGroup title={`All badges · ${list.length}`}>
                {list.map((s, i) => (
                    <div key={s.key} className={"vc-cbadge-line" + (isHidden(s.key) ? " vc-cbadge-line-off" : "")}>
                        <span className="vc-sw-pic"><Pic s={s} /></span>
                        <span className="vc-cbadge-line-text"><b>{s.label}</b><small>{SOURCE[s.source]}</small></span>
                        <button type="button" className="vc-tool-icon" aria-label="Earlier" title="Earlier" disabled={i === 0} onClick={() => moveKey(s.key, -1)}>←</button>
                        <button type="button" className="vc-tool-icon" aria-label="Later" title="Later" disabled={i === list.length - 1} onClick={() => moveKey(s.key, 1)}>→</button>
                        <Toggle value={!isHidden(s.key)} label={`Show ${s.label}`} onChange={v => setHidden(s.key, !v)} />
                    </div>
                ))}
            </FormGroup>
            {!anyReal && <span className="vc-tool-hint">Your real badges show up here once you've opened your own profile (click your name) with Custom Badges on.</span>}
            <div><button type="button" className="vc-tool-btn" onClick={resetArrangement}>Back to Discord's order, nothing hidden</button></div>
        </>
    );
}

function AddBadge({ onAdded }: { onAdded(b: MyBadge): void; }) {
    const file = useRef<HTMLInputElement>(null);
    const [emoji, setEmoji] = useState("");
    const add = (b: Omit<MyBadge, "id">) => onAdded(addBadge(b));
    return (
        <>
            <div className="vc-cbadge-head">
                <b>Add a badge</b>
                <span>It shows on your profile, before your real badges. Only you can see it.</span>
            </div>
            <FormGroup title="Discord's badges">
                <div className="vc-cbadge-grid">
                    {DISCORD_BADGES.map(d => (
                        <button key={d.hash} type="button" className="vc-cbadge-tile" title={d.name}
                            onClick={() => add({ src: discordBadgeSrc(d.hash), label: d.name, from: "discord" })}>
                            <img src={discordBadgeSrc(d.hash)} alt="" />
                            <span>{d.name}</span>
                        </button>
                    ))}
                </div>
            </FormGroup>
            <FormGroup title="Your own">
                <FormRow label="A picture" help="PNG, JPG or WebP, or a GIF that moves. It's shrunk to badge size.">
                    <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
                        onChange={async e => {
                            const f = e.currentTarget.files?.[0];
                            e.currentTarget.value = "";
                            if (!f) return;
                            try { add({ src: await pictureToBadge(f), label: f.name.replace(/\.[^.]+$/, ""), from: "picture" }); } catch { showToast("Couldn't read that picture", "failure"); }
                        }} />
                    <button type="button" className="vc-tool-btn" onClick={() => file.current?.click()}>Choose a picture…</button>
                </FormRow>
                <FormRow label="An emoji" help="Type or paste one emoji.">
                    <input className="vc-tool-input vc-cbadge-emoji" value={emoji} placeholder="🎧" maxLength={16} aria-label="Emoji" onChange={e => setEmoji(e.currentTarget.value)} />
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!emoji.trim()}
                        onClick={() => { const e = emoji.trim(); add({ src: emojiToBadge(e), label: e, from: "emoji" }); setEmoji(""); }}>Add</button>
                </FormRow>
            </FormGroup>
        </>
    );
}

function EditBadge({ b }: { b: MyBadge; }) {
    const key = customKey(b.id);
    const all = allBadges();
    const at = all.findIndex(s => s.key === key);
    return (
        <>
            <div className="vc-cbadge-hero">
                <img src={b.src} alt="" />
                <div><b>{b.label || "No hover text"}</b><span>{FROM[b.from]}</span></div>
            </div>
            <FormGroup title="On your profile">
                <div className="vc-cbadge-preview"><Row picked={customKey(b.id)} /></div>
            </FormGroup>
            <FormGroup title="This badge">
                <FormRow label="Hover text" help="What you see when you hover it.">
                    <input className="vc-tool-input" value={b.label} maxLength={80} aria-label="Hover text" onChange={e => updateBadge(b.id, { label: e.currentTarget.value })} />
                </FormRow>
                <FormRow label="Link" help="Opens when you click it. Leave it empty for none.">
                    <input className="vc-tool-input" value={b.link ?? ""} placeholder="https://…" aria-label="Link" onChange={e => updateBadge(b.id, { link: e.currentTarget.value.trim() || undefined })} />
                </FormRow>
                <FormRow label="Show it" help="Hide it without removing it.">
                    <Toggle value={!isHidden(key)} label="Show it" onChange={v => setHidden(key, !v)} />
                </FormRow>
                <FormRow label="Order" help={`${at + 1} of ${all.length}, left to right, with your real badges.`}>
                    <button type="button" className="vc-tool-btn" disabled={at <= 0} onClick={() => moveKey(key, -1)}>← Earlier</button>
                    <button type="button" className="vc-tool-btn" disabled={at < 0 || at === all.length - 1} onClick={() => moveKey(key, 1)}>Later →</button>
                </FormRow>
                <FormRow label="Remove" help="Takes it off your profile.">
                    <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => removeBadge(b.id)}>Remove badge</button>
                </FormRow>
            </FormGroup>
        </>
    );
}

function BadgesWindow({ modalProps }: { modalProps: RenderModalProps; }) {
    const badges = useBadges();
    const [picked, setPicked] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [arranging, setArranging] = useState(false);
    const sel = badges.find(b => b.id === picked) ?? null;
    const showAdd = !arranging && (adding || !sel);
    return (
        <Window {...modalProps} size="lg" title="Custom Badges" subtitle="Badges on your own profile that only you can see" flush
            tools={<button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => { setAdding(true); setPicked(null); setArranging(false); }}>Add a badge</button>}
            status={[`${badges.length} badge${badges.length === 1 ? "" : "s"}`, "only you can see them"]}>
            <div className="vc-tool-wrap vc-cbadge">
                <Split list={<>
                    <ListRow on={arranging} onClick={() => { setArranging(true); setAdding(false); }} pic={<span aria-hidden>⇄</span>} title="Arrange all badges" sub="Order and hide, real ones too" />
                    <ListHead>Your badges · {badges.length}</ListHead>
                    {badges.map(b => (
                        <ListRow key={b.id} on={!arranging && !showAdd && b.id === sel?.id} onClick={() => { setPicked(b.id); setAdding(false); setArranging(false); }}
                            pic={<img src={b.src} alt="" />} title={b.label || "No hover text"} sub={isHidden(customKey(b.id)) ? `${FROM[b.from]} · hidden` : FROM[b.from]} />
                    ))}
                    {!badges.length && <span className="vc-tool-hint vc-cbadge-none">No badges yet. Pick one on the right.</span>}
                </>}>
                    {arranging ? <Arrange /> : showAdd
                        ? <AddBadge onAdded={b => { setPicked(b.id); setAdding(false); }} />
                        : <EditBadge b={sel!} />}
                </Split>
            </div>
        </Window>
    );
}

export function openBadges() {
    openModal(props => <BadgesWindow modalProps={props} />);
}
