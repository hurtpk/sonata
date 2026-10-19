/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Batch rename: give a pile of files new names from a pattern
// ("photo-{n}", "{date} {name}"), preview every new name, then save them all
// as one ZIP or attach them to your message. The files themselves aren't
// changed — renamed copies are made.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import { ChannelStore, DraftType, SelectedChannelStore, showToast, UploadHandler, useMemo, useState } from "@webpack/common";

import { zipResults } from "./convert";

const cl = classNameFactory("vc-tool-");
const fc = classNameFactory("vc-fconv-");

export interface RenameOptions {
    pattern: string;
    start: number;
    pad: number;
    letterCase: "keep" | "lower" | "upper" | "title";
    find: string;
    replace: string;
    order: "added" | "az" | "oldest";
    keepExt: boolean;
}

export const DEFAULT_RENAME: RenameOptions = { pattern: "{name}", start: 1, pad: 2, letterCase: "keep", find: "", replace: "", order: "added", keepExt: true };

const split = (n: string) => { const i = n.lastIndexOf("."); return i > 0 ? [n.slice(0, i), n.slice(i + 1)] : [n, ""]; };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Characters Windows and macOS won't allow in a file name.
const safe = (n: string) => n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "file";

function applyCase(s: string, c: RenameOptions["letterCase"]) {
    if (c === "lower") return s.toLowerCase();
    if (c === "upper") return s.toUpperCase();
    if (c === "title") return s.toLowerCase().replace(/(^|[\s_-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
    return s;
}

/** The new name for every file, in order, with clashes numbered. */
export function renameAll(files: File[], o: RenameOptions): { file: File; name: string; }[] {
    const sorted = o.order === "az" ? [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        : o.order === "oldest" ? [...files].sort((a, b) => a.lastModified - b.lastModified) : files;
    const used = new Map<string, number>();
    return sorted.map((file, i) => {
        const [base, ext] = split(file.name);
        let name = (o.pattern || "{name}")
            .replace(/\{n\}/gi, String(o.start + i).padStart(o.pad, "0"))
            .replace(/\{name\}/gi, base)
            .replace(/\{date\}/gi, ymd(file.lastModified))
            .replace(/\{ext\}/gi, ext);
        if (o.find) name = name.split(o.find).join(o.replace);
        name = safe(applyCase(name, o.letterCase));
        let full = o.keepExt && ext && !/\{ext\}/i.test(o.pattern) ? `${name}.${ext.toLowerCase()}` : name;
        const key = full.toLowerCase();
        const seen = used.get(key) ?? 0;
        used.set(key, seen + 1);
        if (seen) { const [b, e] = split(full); full = e ? `${b} (${seen + 1}).${e}` : `${b} (${seen + 1})`; }
        return { file, name: full };
    });
}

const TOKENS: [string, string][] = [["{name}", "original name"], ["{n}", "number"], ["{date}", "file date"], ["{ext}", "extension"]];
const PRESETS: [string, string][] = [["photo-{n}", "Numbered"], ["{date} {name}", "Date first"], ["{name}-{n}", "Name + number"], ["{n}. {name}", "List order"]];

export function Renamer({ files }: { files: File[]; }) {
    const [o, setO] = useState<RenameOptions>(DEFAULT_RENAME);
    const [busy, setBusy] = useState(false);
    const set = (p: Partial<RenameOptions>) => setO(x => ({ ...x, ...p }));
    const list = useMemo(() => renameAll(files, o), [files, o]);
    const changed = list.filter(r => r.name !== r.file.name).length;
    const renamed = () => list.map(r => new File([r.file], r.name, { type: r.file.type, lastModified: r.file.lastModified }));

    const zip = async () => {
        setBusy(true);
        try {
            const z = await zipResults(renamed().map(f => ({ name: f.name, blob: f })), "Renamed");
            saveFile(new File([z.blob], z.name, { type: "application/zip" }));
        } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't make the ZIP", "failure"); } finally { setBusy(false); }
    };
    const attach = () => {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        if (!channel) { showToast("Open a chat first", "failure"); return; }
        UploadHandler.promptToUpload(renamed(), channel, DraftType.ChannelMessage);
        showToast(`Added ${list.length} renamed file${list.length === 1 ? "" : "s"} to your message`, "success");
    };

    return (
        <div className={fc("rename")}>
            <div className={fc("rename-grid")}>
                <label className={cl("field")}>
                    <span className={cl("label")}>New name</span>
                    <input className={classes(cl("input"), fc("rename-pattern"))} value={o.pattern} spellCheck={false} placeholder="{name}" onChange={e => set({ pattern: e.currentTarget.value })} />
                    <span className={cl("chips")}>
                        {TOKENS.map(([t, label]) => <button key={t} type="button" className={cl("chip")} title={`Add the ${label}`} onClick={() => set({ pattern: o.pattern + t })}>{t} <small>{label}</small></button>)}
                    </span>
                    <span className={cl("chips")}>
                        {PRESETS.map(([p, label]) => <button key={p} type="button" className={classes(cl("chip"), o.pattern === p && cl("chip-on"))} onClick={() => set({ pattern: p })}>{label}</button>)}
                    </span>
                </label>
                <div className={fc("rename-side")}>
                    <div className={fc("rename-pair")}>
                        <label className={cl("field")}>
                            <span className={cl("label")}>Start at</span>
                            <input className={cl("input")} type="number" min={0} value={o.start} onChange={e => set({ start: Math.max(0, Number(e.currentTarget.value) || 0) })} />
                        </label>
                        <label className={cl("field")}>
                            <span className={cl("label")}>Digits</span>
                            <select className={cl("select")} value={o.pad} onChange={e => set({ pad: Number(e.currentTarget.value) })}>
                                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{String(o.start).padStart(n, "0")}</option>)}
                            </select>
                        </label>
                    </div>
                    <div className={fc("rename-pair")}>
                        <label className={cl("field")}>
                            <span className={cl("label")}>Find</span>
                            <input className={cl("input")} value={o.find} placeholder="e.g. IMG_" onChange={e => set({ find: e.currentTarget.value })} />
                        </label>
                        <label className={cl("field")}>
                            <span className={cl("label")}>Replace with</span>
                            <input className={cl("input")} value={o.replace} placeholder="(nothing)" onChange={e => set({ replace: e.currentTarget.value })} />
                        </label>
                    </div>
                </div>
            </div>

            <div className={fc("rename-opts")}>
                <div className={cl("seg")}>
                    {([["keep", "As is"], ["lower", "lowercase"], ["upper", "UPPERCASE"], ["title", "Title Case"]] as const).map(([v, l]) => (
                        <button key={v} type="button" className={classes(cl("seg-btn"), o.letterCase === v && cl("seg-on"))} onClick={() => set({ letterCase: v })}>{l}</button>
                    ))}
                </div>
                <div className={cl("seg")}>
                    {([["added", "As added"], ["az", "A → Z"], ["oldest", "Oldest first"]] as const).map(([v, l]) => (
                        <button key={v} type="button" className={classes(cl("seg-btn"), o.order === v && cl("seg-on"))} onClick={() => set({ order: v })}>{l}</button>
                    ))}
                </div>
                <label className={cl("check")}><input type="checkbox" checked={o.keepExt} onChange={e => set({ keepExt: e.currentTarget.checked })} /> Keep each file's extension</label>
            </div>

            <div className={fc("rename-list")}>
                {list.slice(0, 100).map(r => (
                    <div key={r.file.name + r.file.lastModified + r.file.size} className={classes(fc("rename-row"), r.name === r.file.name && fc("rename-same"))}>
                        <span className={fc("rename-old")} title={r.file.name}>{r.file.name}</span>
                        <span className={fc("rename-arrow")} aria-hidden>→</span>
                        <span className={fc("rename-new")} title={r.name}>{r.name}</span>
                    </div>
                ))}
                {list.length > 100 && <span className={cl("hint")}>…and {list.length - 100} more</span>}
            </div>

            <div className={cl("footer")}>
                <span className={cl("hint")}>{changed ? `${changed} of ${list.length} get a new name · your files stay as they are; renamed copies are made` : "Nothing would change yet — edit the pattern above."}</span>
                <span className={cl("spacer")} />
                <button type="button" className={cl("btn")} disabled={!changed || list.length > 10} title={list.length > 10 ? "Discord takes up to 10 files per message" : undefined} onClick={attach}>📎 Attach to message</button>
                <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!changed || busy} onClick={() => void zip()}>{busy ? "Zipping…" : "🗜️ Save as ZIP"}</button>
            </div>
        </div>
    );
}
