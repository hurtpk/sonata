/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Saved embed templates: keep a message you send often (rules, an
// announcement, a giveaway) and load it back into the editor in one click.

import { React, useMemo, useState } from "@webpack/common";

export interface TemplateData {
    content: string;
    embeds: any[];
    buttons: any[];
    layout?: "container" | "classic";
    username?: string;
    avatarUrl?: string;
    webhookUrl?: string;
}

export interface Template { id: string; name: string; saved: number; used?: number; data: TemplateData; }

interface Props {
    read(): string;
    write(json: string): void;
    current(): TemplateData;
    apply(data: TemplateData): void;
    blankEmbed(): any;
    /** Turns pasted Discohook / Discord API JSON into editor data. */
    fromApi(json: any): TemplateData | null;
    toast(kind: "success" | "error", text: string): void;
}

export function loadTemplates(raw: string): Template[] {
    try {
        const list = JSON.parse(raw || "[]");
        return Array.isArray(list) ? list.filter(t => t?.id && t?.data) : [];
    } catch { return []; }
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function summary(d: TemplateData): string {
    const e = d.embeds?.filter(x => x && Object.entries(x).some(([k, v]) => k !== "color" && k !== "fields" && v) || x?.fields?.length).length ?? 0;
    const parts = [
        e ? `${e} embed${e === 1 ? "" : "s"}` : d.content ? "Text only" : "Empty",
        d.buttons?.length ? `${d.buttons.length} button${d.buttons.length === 1 ? "" : "s"}` : "",
        d.layout === "classic" ? "Classic" : "Container",
        d.webhookUrl ? "with webhook" : "",
    ];
    return parts.filter(Boolean).join(" · ");
}

const colorOf = (d: TemplateData) => {
    const c = d.embeds?.find(x => /^[0-9a-f]{6}$/i.test(x?.color ?? ""))?.color;
    return c ? `#${c}` : "var(--tl-accent)";
};

// Ready-made starting points.
function starters(blank: () => any): { icon: string; name: string; data: TemplateData; }[] {
    const e = (patch: object) => ({ ...blank(), ...patch });
    return [
        { icon: "📢", name: "Announcement", data: { content: "@everyone", layout: "container", buttons: [], embeds: [e({ title: "📢 Big news", description: "Write the announcement here.\n\n**What's new**\n• First thing\n• Second thing", color: "5865F2", footerText: "Posted by the team" })] } },
        { icon: "📜", name: "Rules", data: { content: "", layout: "classic", buttons: [], embeds: [e({ title: "📜 Server rules", color: "ED4245", description: "Please read these before chatting.", fields: [{ name: "1. Be kind", value: "No harassment, hate or slurs.", inline: false }, { name: "2. No spam", value: "Keep it on topic, no self-promo.", inline: false }, { name: "3. Keep it safe", value: "No NSFW or personal info.", inline: false }], footerText: "Breaking the rules can get you removed." })] } },
        { icon: "🎉", name: "Giveaway", data: { content: "", layout: "container", buttons: [], embeds: [e({ title: "🎉 Giveaway!", color: "FEE75C", description: "**Prize:** something great\n**Ends:** <t:1767225600:R>\n\nReact with 🎉 to enter!", footerText: "Good luck" })] } },
        { icon: "👋", name: "Welcome", data: { content: "", layout: "container", buttons: [{ label: "Read the rules", url: "https://discord.com", placement: "inside" }], embeds: [e({ title: "👋 Welcome!", color: "57F287", description: "Glad you're here. Grab some roles, say hi, and have fun." })] } },
    ];
}

export function TemplatesSection({ read, write, current, apply, blankEmbed, fromApi, toast }: Props) {
    const [list, setList] = useState<Template[]>(() => loadTemplates(read()));
    const [name, setName] = useState("");
    const [withHook, setWithHook] = useState(false);
    const [find, setFind] = useState("");
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameTo, setRenameTo] = useState("");
    const [importing, setImporting] = useState(false);
    const [importText, setImportText] = useState("");
    const [undo, setUndo] = useState<{ name: string; data: TemplateData; } | null>(null);

    const store = (next: Template[]) => { setList(next); write(JSON.stringify(next)); };
    const sorted = useMemo(() => {
        const q = find.trim().toLowerCase();
        return list.filter(t => !q || t.name.toLowerCase().includes(q)).sort((a, b) => (b.used ?? b.saved) - (a.used ?? a.saved));
    }, [list, find]);

    const snapshot = (): TemplateData => {
        const d = clone(current());
        if (!withHook) delete d.webhookUrl;
        return d;
    };

    const save = () => {
        const n = name.trim() || `Template ${list.length + 1}`;
        const existing = list.find(t => t.name.toLowerCase() === n.toLowerCase());
        if (existing) {
            store(list.map(t => t === existing ? { ...t, data: snapshot(), saved: Date.now() } : t));
            toast("success", `Updated “${existing.name}”.`);
        } else {
            store([{ id: newId(), name: n, saved: Date.now(), data: snapshot() }, ...list]);
            toast("success", `Saved “${n}”.`);
        }
        setName("");
    };

    const use = (label: string, data: TemplateData, id?: string) => {
        setUndo({ name: label, data: clone(current()) });
        apply(clone(data));
        if (id) store(list.map(t => t.id === id ? { ...t, used: Date.now() } : t));
    };

    const doImport = () => {
        try {
            const json = JSON.parse(importText);
            const items: Template[] = [];
            const one = (x: any, fallback: string) => {
                if (x?.data?.embeds) items.push({ id: newId(), name: x.name ?? fallback, saved: Date.now(), data: x.data });
                else { const d = fromApi(x); if (d) items.push({ id: newId(), name: x.name ?? fallback, saved: Date.now(), data: d }); }
            };
            if (Array.isArray(json)) json.forEach((x, i) => one(x, `Imported ${i + 1}`));
            else if (Array.isArray(json?.messages)) json.messages.forEach((m: any, i: number) => one(m.data ?? m, `Imported ${i + 1}`)); // Discohook share format
            else one(json, "Imported");
            if (!items.length) throw new Error();
            store([...items, ...list]);
            toast("success", `Added ${items.length} template${items.length === 1 ? "" : "s"}.`);
            setImporting(false); setImportText("");
        } catch {
            toast("error", "That isn't a template, Discohook or embed JSON.");
        }
    };

    return (
        <div className="vc-embedsender-tpl">
            {undo && (
                <div className="vc-embedsender-tpl-undo">
                    <span>Loaded “{undo.name}” into the editor.</span>
                    <button type="button" className="vc-tool-link" onClick={() => { apply(undo.data); setUndo(null); }}>↶ Undo</button>
                    <button type="button" className="vc-tool-icon" onClick={() => setUndo(null)} title="Dismiss">✕</button>
                </div>
            )}

            <div className="vc-embedsender-tpl-save">
                <input className="vc-tool-input" placeholder="Name this message, e.g. Weekly update" value={name} maxLength={60}
                    onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={save}>{list.some(t => t.name.toLowerCase() === name.trim().toLowerCase() && name.trim()) ? "Update" : "Save template"}</button>
            </div>
            <label className="vc-tool-check"><input type="checkbox" checked={withHook} onChange={e => setWithHook(e.target.checked)} /> Also remember the webhook (so it sends to the same place)</label>

            {list.length > 5 && <input className="vc-tool-input" placeholder={`Find among ${list.length} templates`} value={find} onChange={e => setFind(e.target.value)} />}

            {sorted.length > 0 ? (
                <div className="vc-tool-list vc-embedsender-tpl-list">
                    {sorted.map(t => (
                        <div key={t.id} className="vc-tool-item">
                            <span className="vc-embedsender-tpl-dot" style={{ background: colorOf(t.data) }} />
                            <div className="vc-tool-item-main">
                                {renaming === t.id ? (
                                    <input className="vc-tool-input" autoFocus value={renameTo} onChange={e => setRenameTo(e.target.value)}
                                        onBlur={() => { if (renameTo.trim()) store(list.map(x => x.id === t.id ? { ...x, name: renameTo.trim() } : x)); setRenaming(null); }}
                                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }} />
                                ) : <span className="vc-tool-item-title">{t.name}</span>}
                                <span className="vc-tool-item-sub">{summary(t.data)} · saved {new Date(t.saved).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                            </div>
                            <div className="vc-tool-item-tools">
                                <button type="button" className="vc-tool-icon" title="Rename" onClick={() => { setRenaming(t.id); setRenameTo(t.name); }}>✎</button>
                                <button type="button" className="vc-tool-icon" title="Replace with what's in the editor now" onClick={() => { store(list.map(x => x.id === t.id ? { ...x, data: snapshot(), saved: Date.now() } : x)); toast("success", `Updated “${t.name}”.`); }}>⟳</button>
                                <button type="button" className="vc-tool-icon" title="Copy as JSON to share" onClick={() => { navigator.clipboard.writeText(JSON.stringify({ name: t.name, data: t.data }, null, 2)); toast("success", "Copied — paste it into Import on another account."); }}>⧉</button>
                                <button type="button" className="vc-tool-icon" title="Delete" onClick={() => { store(list.filter(x => x.id !== t.id)); toast("success", `Deleted “${t.name}”.`); }}>✕</button>
                            </div>
                            <button type="button" className="vc-tool-btn" onClick={() => use(t.name, t.data, t.id)}>Use</button>
                        </div>
                    ))}
                </div>
            ) : (
                <span className="vc-tool-hint">{find ? "No template by that name." : "No templates yet — build a message, name it above, and save it to use again later."}</span>
            )}

            <div className="vc-embedsender-tpl-starters">
                <span className="vc-tool-hint">Start from:</span>
                {starters(blankEmbed).map(s => (
                    <button key={s.name} type="button" className="vc-tool-chip" onClick={() => use(s.name, s.data)}>{s.icon} {s.name}</button>
                ))}
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-link" onClick={() => setImporting(i => !i)}>{importing ? "Cancel import" : "Import…"}</button>
            </div>
            {importing && (
                <>
                    <textarea className="vc-tool-area vc-tool-mono" placeholder="Paste a template you copied, or Discohook / embed JSON" value={importText} onChange={e => setImportText(e.target.value)} />
                    <div className="vc-tool-footer"><span className="vc-tool-spacer" /><button type="button" className="vc-tool-btn vc-tool-primary" disabled={!importText.trim()} onClick={doImport}>Add as template</button></div>
                </>
            )}
        </div>
    );
}
