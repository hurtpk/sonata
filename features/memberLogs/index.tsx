/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { chooseFile, saveFile } from "@utils/web";
import type { RenderModalProps, User } from "@vencord/discord-types";
import { GuildStore, IconUtils, MaskedLink, Menu, TextArea, TextInput, useEffect, UserStore,useState } from "@webpack/common";

import { strToU8, zip } from "fflate";

import { Window } from "../_shared/Window";
import { openModeration, registerModerationPart } from "../serverTools/Moderation";
import { Evidence, loadMemberLogs, MemberLog, readEvidence, saveMemberLog } from "./store";

function EvidenceView({ evidence }: { evidence: Evidence; }) {
    const [blob, setBlob] = useState<Blob>();
    const [url, setUrl] = useState("");
    const [error, setError] = useState("");
    useEffect(() => {
        let live = true;
        let objectUrl = "";
        void readEvidence(evidence.id).then(file => {
            if (!live) return;
            if (!file) { setError("The evidence file could not be found in local storage."); return; }
            objectUrl = URL.createObjectURL(file);
            setBlob(file);
            setUrl(objectUrl);
        }).catch(() => { if (live) setError("Couldn't open this evidence file."); });
        return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [evidence.id]);
    return <div className="vc-memberlogs-evidence">
        <b>{evidence.name}</b>
        {error && <span className="vc-tool-error">{error}</span>}
        {url && (evidence.kind === "image" ? <img src={url} alt={evidence.name} /> : <video src={url} controls preload="metadata" />)}
        {blob && <Button size="small" variant="secondary" onClick={() => saveFile(new File([blob], evidence.name, { type: evidence.type }))}>Save original file</Button>}
    </div>;
}

function LogRecord({ entry, edit, selected, select }: { entry: MemberLog; edit(): void; selected: boolean; select(): void; }) {
    const user = UserStore.getUser(entry.userId);
    const [showEvidence, setShowEvidence] = useState(false);
    return <article className="vc-tool-section">
        <div className="vc-tool-row"><label><input type="checkbox" checked={selected} onChange={select} aria-label={"Select " + entry.title + " for export"} /> {entry.title}</label><span className="vc-tool-spacer" /><span className="vc-tool-hint">{entry.status} · {new Date(entry.created).toLocaleString()}</span></div>
        <div className="vc-tool-row">{user && <img className="vc-memberlogs-avatar" src={IconUtils.getUserAvatarURL(user, false, 64)} alt="" width={36} height={36} />}<b>{entry.username ?? user?.username ?? entry.userId}</b><span className="vc-tool-hint">{entry.userId} · {GuildStore.getGuild(entry.guildId)?.name ?? "Personal record"}</span></div>
        <p className="vc-memberlogs-notes">{entry.notes}</p>
        {entry.links.map((link, index) => <MaskedLink key={`${index}:${link}`} href={link}>Evidence link {index + 1}</MaskedLink>)}
        <div className="vc-tool-row"><Button size="small" variant="secondary" onClick={edit}>Edit record</Button>{entry.evidence.length > 0 && <Button size="small" variant="secondary" onClick={() => setShowEvidence(value => !value)}>{showEvidence ? "Hide" : "Show"} {entry.evidence.length} saved file{entry.evidence.length === 1 ? "" : "s"}</Button>}</div>
        {showEvidence && <div className="vc-memberlogs-media">{entry.evidence.map(file => <EvidenceView key={file.id} evidence={file} />)}</div>}
    </article>;
}

export function MemberLogsWindow({ modalProps, userId, guildId, browse = false }: { modalProps: RenderModalProps; userId?: string; guildId?: string; browse?: boolean; }) {
    const [records, setRecords] = useState<MemberLog[]>([]);
    const [query, setQuery] = useState(browse ? userId ?? "" : "");
    const [selected, setSelected] = useState<string[]>([]);
    const [editor, setEditor] = useState<MemberLog | null>(() => userId && !browse ? fresh(userId, guildId ?? "") : null);
    const [files, setFiles] = useState<File[]>([]);
    const [links, setLinks] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => { let live = true; void loadMemberLogs().then(value => { if (live) setRecords(value); }).catch(() => { if (live) setError("Couldn't load your personal member logs."); }); return () => { live = false; }; }, []);
    const patch = (value: Partial<MemberLog>) => setEditor(current => current ? { ...current, ...value } : current);
    const addFiles = (incoming: File[]) => {
        const accepted = incoming.filter(file => file.type.startsWith("image/") || file.type.startsWith("video/") || /\.(png|jpe?g|gif|webp|bmp|avif|mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name));
        if (accepted.length !== incoming.length) setError("Only image and video evidence files are accepted.");
        setFiles(current => [...current, ...accepted]);
    };
    const save = async () => {
        if (!editor || !/^\d{17,20}$/.test(editor.userId) || !editor.title.trim()) { setError("Enter the member's Discord user ID and a title for the record."); return; }
        const urls = links.split(/\r?\n/).map(link => link.trim()).filter(Boolean);
        if (urls.some(link => { try { return new URL(link).protocol !== "https:"; } catch { return true; } })) { setError("Evidence links must be HTTPS URLs, one per line."); return; }
        setBusy(true);
        setError("");
        try {
            const saved = await saveMemberLog({ ...editor, title: editor.title.trim(), links: urls }, files);
            setRecords(current => [saved, ...current.filter(record => record.id !== saved.id)]);
            setEditor(null);
            setFiles([]);
            setLinks("");
        } catch { setError("Couldn't save the record and evidence. Your local storage may be full. Keep the original files and try again."); }
        finally { setBusy(false); }
    };
    const exportSelected = async () => {
        setBusy(true);
        setError("");
        try {
            const entries = records.filter(record => selected.includes(record.id));
            const files: Record<string, Uint8Array> = {};
            let size = 0;
            const manifest: (Omit<MemberLog, "evidence"> & { evidence: (Evidence & { path?: string; missing?: boolean; })[]; })[] = [];
            for (const [index, entry] of entries.entries()) {
                const evidence: (Evidence & { path?: string; missing?: boolean; })[] = [];
                for (const [number, item] of entry.evidence.entries()) {
                    const blob = await readEvidence(item.id);
                    if (!blob) { evidence.push({ ...item, missing: true }); continue; }
                    size += blob.size;
                    if (size > 75 * 1024 * 1024) throw new Error("Select fewer records. One export can contain up to 75 MB of evidence.");
                    const path = "evidence/" + (index + 1) + "/" + (number + 1) + "-" + item.name.replace(/[^a-z0-9_. -]/gi, "_").slice(0, 120);
                    files[path] = new Uint8Array(await blob.arrayBuffer());
                    evidence.push({ ...item, path });
                }
                manifest.push({ ...entry, evidence });
            }
            files["member-logs.json"] = strToU8(JSON.stringify(manifest, null, 2));
            const result = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 0 }, (error, data) => error ? reject(error) : resolve(data)));
            saveFile(new File([new Uint8Array(result)], "sonata-member-logs.zip", { type: "application/zip" }));
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't export your records."); }
        finally { setBusy(false); }
    };
    const search = query.trim().toLowerCase();
    const shown = records.filter(entry => (!browse || !guildId || entry.guildId === guildId) && `${entry.userId} ${entry.username ?? ""} ${UserStore.getUser(entry.userId)?.username ?? ""} ${entry.title} ${entry.notes} ${entry.status} ${GuildStore.getGuild(entry.guildId)?.name ?? ""}`.toLowerCase().includes(search));
    return <Window {...modalProps} size="lg" title="Personal Member Logs" subtitle="Private records and saved evidence for ban appeals">
        <div className="vc-tool-wrap">
            <p className="vc-tool-hint">Only you can see these records. Selected files are copied into local storage for this Discord account; they are not uploaded to Discord. Keep a backup of important evidence before clearing Discord or Sonata data.</p>
            {error && <div className="vc-tool-error">{error}</div>}
            {editor ? <section className="vc-tool-section" onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); if (!busy) addFiles(Array.from(event.dataTransfer.files)); }}>
                <TextInput value={editor.userId} onChange={user => patch({ userId: user.trim(), username: undefined })} placeholder="Member's Discord user ID" aria-label="Member user ID" disabled={busy} />
                <TextInput value={editor.title} onChange={title => patch({ title })} placeholder="Record title, such as ban appeal evidence" aria-label="Record title" disabled={busy} />
                <label className="vc-tool-field"><span>Personal status</span><select className="vc-tool-select vc-merged-select" value={editor.status} disabled={busy} onChange={event => patch({ status: event.currentTarget.value })}>{["Note", "Ban record", "Appeal pending", "Ban upheld", "Appeal accepted", "Closed"].map(status => <option key={status}>{status}</option>)}</select></label>
                <TextArea value={editor.notes} onChange={notes => patch({ notes })} placeholder="What happened, why the action was taken, and anything needed for a later appeal." rows={6} aria-label="Personal moderation notes" disabled={busy} />
                <TextArea value={links} onChange={setLinks} placeholder="Optional evidence links, one HTTPS URL per line" rows={2} aria-label="Evidence links" disabled={busy} />
                <Button variant="secondary" disabled={busy} onClick={() => { void chooseFile("image/*,video/*,.mkv,.avi,.mov").then(file => { if (file) addFiles([file]); }); }}>Add image or video</Button>
                <span className="vc-tool-hint">You can also drop files here. {editor.evidence.length} file{editor.evidence.length === 1 ? "" : "s"} already saved.</span>
                {files.map((file, index) => <div className="vc-tool-row" key={`${index}:${file.name}`}><span>{file.name} · {(file.size / 1048576).toFixed(1)} MB</span><Button size="small" variant="secondary" disabled={busy} onClick={() => setFiles(current => current.filter((_, at) => at !== index))}>Remove</Button></div>)}
                <div className="vc-tool-row"><Button disabled={busy} onClick={() => void save()}>{busy ? "Saving record and files…" : "Save personal record"}</Button><Button variant="secondary" disabled={busy} onClick={() => { setEditor(null); setFiles([]); setLinks(""); }}>Cancel</Button></div>
            </section> : <div className="vc-tool-row"><TextInput value={query} onChange={setQuery} placeholder="Search members, notes, servers or appeal status" aria-label="Search member logs" /><Button onClick={() => { setEditor(fresh(browse ? userId ?? "" : "", browse ? guildId ?? "" : "")); setFiles([]); setLinks(""); }}>New member log</Button>{selected.length > 0 && <Button variant="secondary" disabled={busy} onClick={() => void exportSelected()}>Export {selected.length} selected</Button>}</div>}
            {!shown.length && !editor && <div className="vc-tool-empty">{records.length ? "No records match your search." : "Right-click a member, open Sonata, then choose Personal Member Log."}</div>}
            {!editor && shown.map(entry => <LogRecord key={`${entry.id}:${entry.updated}`} entry={entry} selected={selected.includes(entry.id)} select={() => setSelected(ids => ids.includes(entry.id) ? ids.filter(id => id !== entry.id) : [...ids, entry.id])} edit={() => { setEditor(entry); setFiles([]); setLinks(entry.links.join("\n")); }} />)}
        </div>
    </Window>;
}

function fresh(userId: string, guildId: string): MemberLog {
    return { id: crypto.randomUUID(), userId, guildId, title: "", notes: "", status: "Note", links: [], evidence: [], created: Date.now(), updated: Date.now() };
}

export const openMemberLogs = (userId?: string, guildId?: string, browse = false) => openModeration("memberLogs", props => <MemberLogsWindow modalProps={props} userId={userId} guildId={guildId} browse={browse} />);
registerModerationPart("memberLogs", props => <MemberLogsWindow modalProps={props} />);
export default definePlugin({
    name: "MemberLogs", description: "Keep private member records with your own saved image and video evidence for later ban appeals. Files stay on this computer.", authors: [Devs.Ven],
    openSettingsModal: () => openMemberLogs(),
    contextMenus: { "user-context": (children, { user, guildId }: { user?: User; guildId?: string; }) => { if (user) children.push(<Menu.MenuItem id="sonata-member-log" label="Personal Member Log" action={() => openMemberLogs(user.id, guildId)} />); } },
});
