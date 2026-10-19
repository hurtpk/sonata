/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Making your own sound pack: drop in sound files for the keys (several, for
// variety), and optionally Space, Enter and Backspace.

import { useRef, useState } from "@webpack/common";

import { CustomPack, decodeSound, KINDS, MAX_FILE, MAX_KEYS, savePack, SoundFile } from "./custom";
import type { KeyKind } from "./sounds";

const LABEL: Record<KeyKind, [string, string]> = {
    key: ["⌨️ Keys", `Up to ${MAX_KEYS} — each key gets one, so more feels more natural`],
    space: ["␣ Space", "Optional — uses a key sound if empty"],
    enter: ["↵ Enter", "Optional"],
    back: ["⌫ Backspace", "Optional"],
};

let previewCtx: AudioContext | null = null;
async function preview(data: Uint8Array) {
    previewCtx ??= new AudioContext();
    if (previewCtx.state === "suspended") await previewCtx.resume();
    const buf = await decodeSound(previewCtx, data);
    const src = previewCtx.createBufferSource();
    src.buffer = buf;
    src.connect(previewCtx.destination);
    src.start();
}

function Slot({ kind, files, setFiles, toast }: { kind: KeyKind; files: SoundFile[]; setFiles(f: SoundFile[]): void; toast(msg: string): void; }) {
    const [over, setOver] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const max = kind === "key" ? MAX_KEYS : 1;
    const add = async (list: FileList | File[] | null) => {
        const picked = [...(list ?? [])].filter(f => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|webm|opus)$/i.test(f.name));
        if (!picked.length) { toast("Those aren't sound files"); return; }
        const next = [...(max === 1 ? [] : files)];
        for (const f of picked) {
            if (next.length >= max) break;
            if (f.size > MAX_FILE) { toast(`${f.name} is too big — typing sounds should be short (1 MB at most)`); continue; }
            const data = new Uint8Array(await f.arrayBuffer());
            try { await decodeSound(new OfflineAudioContext(1, 1, 44100), data); } catch { toast(`${f.name} can't be played`); continue; }
            next.push({ name: f.name, data });
        }
        setFiles(next);
    };
    return (
        <div className={"vc-ts-slot" + (over ? " vc-ts-slot-over" : "")}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}>
            <div className="vc-ts-slot-head">
                <b>{LABEL[kind][0]}</b>
                <span className="vc-tool-hint">{LABEL[kind][1]}</span>
            </div>
            <div className="vc-ts-slot-files">
                {files.map((f, i) => (
                    <span key={i} className="vc-ts-sound">
                        <button type="button" title="Play it" onClick={() => void preview(f.data).catch(() => toast("Couldn't play that one"))}>▶</button>
                        <span title={f.name}>{f.name}</span>
                        <button type="button" title="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                    </span>
                ))}
                {files.length < max && <button type="button" className="vc-ts-add" onClick={() => input.current?.click()}>{files.length ? "＋ More" : "＋ Drop or choose sounds"}</button>}
            </div>
            <input ref={input} type="file" accept="audio/*" multiple={max > 1} hidden onChange={e => { void add(e.currentTarget.files); e.currentTarget.value = ""; }} />
        </div>
    );
}

export function PackMaker({ editing, onDone, onCancel, toast }: { editing: CustomPack | null; onDone(id: string): void; onCancel(): void; toast(msg: string): void; }) {
    const [name, setName] = useState(editing?.name ?? "");
    const [sounds, setSounds] = useState<Record<KeyKind, SoundFile[]>>(() => editing?.sounds ?? { key: [], space: [], enter: [], back: [] });
    const [busy, setBusy] = useState(false);
    const save = async () => {
        if (!sounds.key.length) { toast("Add at least one key sound"); return; }
        setBusy(true);
        const pack: CustomPack = { id: editing?.id ?? `custom-${Date.now().toString(36)}`, name: name.trim() || "My sounds", sounds };
        try { await savePack(pack); onDone(pack.id); } catch { toast("Couldn't save the pack"); } finally { setBusy(false); }
    };
    return (
        <div className="vc-ts-maker">
            <div className="vc-ts-maker-head">
                <b>{editing ? "Edit your pack" : "Make your own pack"}</b>
                <span className="vc-tool-hint">Short, snappy sounds work best. The quiet start of each one is cut off so it plays the instant you press a key.</span>
            </div>
            <input className="vc-tool-input" maxLength={32} placeholder="Name it — like “My keyboard”" value={name} onChange={e => setName(e.currentTarget.value)} />
            {KINDS.map(k => <Slot key={k} kind={k} files={sounds[k]} setFiles={f => setSounds(s => ({ ...s, [k]: f }))} toast={toast} />)}
            <div className="vc-ts-maker-foot">
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !sounds.key.length} onClick={() => void save()}>{busy ? "Saving…" : editing ? "Save changes" : "Save and use it"}</button>
                <button type="button" className="vc-tool-btn" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}
