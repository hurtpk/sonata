/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "That file is too big to upload — shrink it?" When you drop, paste or pick
// a file bigger than you're allowed to send, this steps in before Discord
// says no, and can shrink it to fit, all on this computer.

import "../../_shared/tool.css";

import type { Channel } from "@vencord/discord-types";
import { ChannelStore, DraftType, GuildStore, openModal, SelectedChannelStore, UploadHandler, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { Window } from "../../_shared/Window";
import { shrinkToFit } from "./convert";
import { kindOf, MB, sizeText } from "./formats";
import { openFileConverter } from "./Panel";

/** The biggest file you can send here: your Nitro, or the server's boosts, whichever is more. */
export function uploadLimit(channel?: Channel | null): number {
    const tier = (UserStore.getCurrentUser() as any)?.premiumType ?? 0;
    const mine = tier === 2 ? 500 * MB : tier === 1 || tier === 3 ? 50 * MB : 10 * MB;
    const guild: any = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const server = guild?.premiumTier === 3 ? 100 * MB : guild?.premiumTier === 2 ? 50 * MB : 10 * MB;
    return Math.max(mine, server);
}

const canShrink = (f: File) => ["image", "animated", "video", "audio"].includes(kindOf(f));

let enabled = () => true;
let turnOff = () => { };

function ShrinkPrompt({ modalProps, files, channel, limit }: { modalProps: any; files: File[]; channel: Channel; limit: number; }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const big = files.filter(f => f.size > limit);
    const shrinkable = big.filter(canShrink);
    const stuck = big.filter(f => !canShrink(f));
    const accent = windowAccent("fileConverter");

    const add = (list: File[]) => { UploadHandler.promptToUpload(list, channel, DraftType.ChannelMessage); modalProps.onClose(); };

    const shrink = async () => {
        setError(null);
        const out: File[] = files.filter(f => f.size <= limit);
        try {
            for (const [i, f] of shrinkable.entries()) {
                const r = await shrinkToFit(f, limit - 96 * 1024, (text, p) => { setBusy(`${f.name}${shrinkable.length > 1 ? ` (${i + 1} of ${shrinkable.length})` : ""} — ${text}`); setProgress(p); });
                if (r.blob.size > limit) throw new Error(`Couldn't get ${f.name} small enough`);
                out.push(new File([r.blob], r.name, { type: r.blob.type }));
            }
            add(out);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(null);
        }
    };

    return (
        <Window {...modalProps} size="md" title="Too big to upload" subtitle={`You can send up to ${sizeText(limit)} here`}>
            <div className="vc-tool-wrap" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className="vc-tool-list">
                    {files.map((f, i) => (
                        <div key={i} className="vc-tool-item">
                            <span style={{ fontSize: 20 }}>{f.size > limit ? (canShrink(f) ? "🗜️" : "⛔") : "✅"}</span>
                            <span className="vc-tool-item-main">
                                <span className="vc-tool-item-title">{f.name}</span>
                                <span className="vc-tool-item-sub">{sizeText(f.size)}{f.size > limit ? (canShrink(f) ? " — can be shrunk to fit" : " — this kind of file can't be shrunk") : " — fine"}</span>
                            </span>
                            {f.size > limit && <span className="vc-tool-badge vc-tool-badge-bad">{Math.round(f.size / limit * 100) - 100}% over</span>}
                        </div>
                    ))}
                </div>
                {shrinkable.some(f => kindOf(f) === "video" || kindOf(f) === "audio") && !busy && <span className="vc-tool-hint">Videos and sound are re-encoded on your computer — long ones take a little while (and ffmpeg downloads once, about 31 MB).</span>}
                {stuck.length > 0 && <span className="vc-tool-hint">{stuck.map(f => f.name).join(", ")} can't be shrunk, so {stuck.length === 1 ? "it's" : "they're"} left out.</span>}
                {busy && (
                    <div className="vc-tool-field">
                        <span className="vc-tool-hint">{busy}</span>
                        <div className="vc-tool-bar"><div style={{ width: `${Math.round((progress ?? 0.05) * 100)}%` }} /></div>
                    </div>
                )}
                {error && <div className="vc-tool-error">{error}</div>}
                <div className="vc-tool-footer">
                    <button type="button" className="vc-tool-link" onClick={() => { turnOff(); modalProps.onClose(); add(files); }}>Don't ask again</button>
                    <span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-btn" disabled={!!busy} onClick={() => { modalProps.onClose(); openFileConverter(files); }}>Open in File Converter</button>
                    <button type="button" className="vc-tool-btn" disabled={!!busy} onClick={() => add(files)}>Add anyway</button>
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!!busy || !shrinkable.length} onClick={shrink}>{busy ? "Shrinking…" : `Shrink ${shrinkable.length > 1 ? `${shrinkable.length} files` : "it"} to fit`}</button>
                </div>
            </div>
        </Window>
    );
}

/** Only for files going into a chat — not uploads elsewhere (server icons, Sonata's own windows…). */
function inChat(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    // Not inside any window (File Converter's own drop zone, Sonata's windows, Discord's dialogs).
    if (!el || el.closest("[role='dialog'], .vc-tool-wrap")) return false;
    if (document.querySelector("[class*='layer'] [class*='standardSidebarView']")) return false; // settings open
    return !!el.closest("[class*='chat'], form, [class*='uploadArea'], [class*='chatContent']");
}

function check(files: FileList | File[] | null | undefined, ev: Event, target: EventTarget | null): boolean {
    if (!enabled() || !files?.length) return false;
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (!channel || !inChat(target)) return false;
    const list = Array.from(files);
    const limit = uploadLimit(channel);
    if (!list.some(f => f.size > limit)) return false;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    openModal(props => <ShrinkPrompt modalProps={props} files={list} channel={channel} limit={limit} />);
    return true;
}

const onDrop = (e: DragEvent) => { check(e.dataTransfer?.files, e, e.target); };
const onPaste = (e: ClipboardEvent) => { check(e.clipboardData?.files, e, e.target); };
const onChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input?.type !== "file") return;
    if (check(input.files, e, input)) input.value = "";
};

export function startUploadGuard(isOn: () => boolean, off: () => void) {
    enabled = isOn;
    turnOff = off;
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("paste", onPaste, true);
    window.addEventListener("change", onChange, true);
}

export function stopUploadGuard() {
    window.removeEventListener("drop", onDrop, true);
    window.removeEventListener("paste", onPaste, true);
    window.removeEventListener("change", onChange, true);
}
