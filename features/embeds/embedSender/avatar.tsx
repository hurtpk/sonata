/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The picture a message is sent with. Drop a picture, upload one, paste one,
// or give a link.
//
// Discord only takes a *link* as a one-message picture (avatar_url). A file
// can't ride along like that, so a dropped/uploaded picture becomes the
// webhook's own picture instead (PATCH /webhooks/{id}/{token} with the image
// as a data URL — the webhook's token is enough, no bot needed). That's a
// lasting change for everything the webhook sends, so it asks first.

import { useEffect, useRef, useState } from "@webpack/common";

import { callNative } from "../../_shared/native";
import { forgetHook } from "./extras";

type Toast = (kind: "success" | "error", msg: string) => void;

const HOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d+)\/[\w-]+$/;
const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

/** A square 256×256 PNG from any picture, centred and cropped like Discord does. */
async function squarePng(file: Blob): Promise<string> {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height), size = Math.min(256, side);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    bmp.close();
    return c.toDataURL("image/png");
}

export function AvatarPicker({ webhookUrl, link, onLink, toast }: { webhookUrl: string; link: string; onLink(url: string): void; toast: Toast; }) {
    const hook = webhookUrl.trim().split("?")[0];
    const hookId = HOOK.exec(hook)?.[1];
    const [current, setCurrent] = useState<string | null>(null);
    const [staged, setStaged] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [over, setOver] = useState(false);
    const [badLink, setBadLink] = useState(false);
    const picker = useRef<HTMLInputElement>(null);

    // The webhook's own picture, for the preview.
    useEffect(() => {
        setCurrent(null);
        if (!hookId) return;
        let alive = true;
        void callNative("getWebhookMessage", hook).then((r: any) => {
            if (alive && r?.ok && r.body?.avatar) setCurrent(`https://cdn.discordapp.com/avatars/${hookId}/${r.body.avatar}.png?size=128`);
        });
        return () => { alive = false; };
    }, [hook, hookId]);

    const take = async (file: File | Blob | null | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast("error", "That isn't a picture."); return; }
        if (file.size > 20 * 1048576) { toast("error", "That picture is too big (20 MB at most)."); return; }
        try { setStaged(await squarePng(file)); } catch { toast("error", "Couldn't open that picture."); }
    };

    const fromDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        const file = [...e.dataTransfer.files].find(f => f.type.startsWith("image/"));
        if (file) return void take(file);
        // A picture dragged from a website or from Discord arrives as its address.
        const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).split("\n")[0].trim();
        if (/^https:\/\//i.test(url)) { onLink(url); setStaged(null); }
        else toast("error", "Drop a picture file, or a picture from a website.");
    };

    const apply = async () => {
        if (!staged || !hookId) return;
        setBusy(true);
        const r: any = await callNative("sendWebhook", hook, "PATCH", { avatar: staged });
        setBusy(false);
        if (!r?.ok) { toast("error", `Discord didn't take it: ${r?.body?.message ?? r?.error ?? `error ${r?.status}`}`); return; }
        forgetHook(hook);
        if (r.body?.avatar) setCurrent(`https://cdn.discordapp.com/avatars/${hookId}/${r.body.avatar}.png?size=128&t=${Date.now()}`);
        setStaged(null);
        onLink(""); // the webhook's own picture shows now, so no one-message link is needed
        toast("success", "That's the webhook's picture now.");
    };

    const wanted = staged ?? (link && !badLink ? link : current) ?? DEFAULT_AVATAR;
    const [broken, setBroken] = useState<string | null>(null);
    const shown = broken === wanted ? DEFAULT_AVATAR : wanted;

    return (
        <div
            className={"vc-es2-avatar" + (over ? " vc-es2-avatar-over" : "")}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
            onDrop={fromDrop}
            onPaste={e => {
                const file = [...e.clipboardData.files].find(f => f.type.startsWith("image/"));
                if (file) { e.preventDefault(); void take(file); }
            }}
        >
            <button type="button" className="vc-es2-avatar-pic" title="Upload a picture" onClick={() => picker.current?.click()}>
                <img src={shown} alt="" onError={() => { if (shown === DEFAULT_AVATAR) return; setBroken(shown); if (link && shown === link) setBadLink(true); }} />
                <span>Change</span>
            </button>
            <div className="vc-es2-avatar-main">
                {staged ? (
                    <>
                        <b>Use this as the webhook's picture?</b>
                        <span className="vc-tool-hint">Discord only takes links for a single message, so a picture file becomes the webhook's own picture — for everything it sends from now on.</span>
                        <div className="vc-es2-row">
                            <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !hookId} onClick={apply}>{busy ? "Saving…" : "Set as webhook picture"}</button>
                            <button type="button" className="vc-tool-btn" disabled={busy} onClick={() => setStaged(null)}>Cancel</button>
                        </div>
                        {!hookId && <span className="vc-tool-hint">Add the webhook above first.</span>}
                    </>
                ) : (
                    <>
                        <span className="vc-tool-hint">Drop a picture here, paste one, <button type="button" className="vc-tool-link" onClick={() => picker.current?.click()}>upload a file</button>, or use a link:</span>
                        <div className="vc-es2-row">
                            <input className={"vc-tool-input vc-es2-grow" + (badLink ? " vc-es2-input-bad" : "")} placeholder="https://… (just for this message)"
                                value={link} onChange={e => { setBadLink(false); onLink(e.target.value); }} />
                            {link && <button type="button" className="vc-tool-btn" onClick={() => { setBadLink(false); onLink(""); }}>Clear</button>}
                        </div>
                        {badLink && <span className="vc-tool-hint vc-es2-bad">That link doesn't open as a picture.</span>}
                        {!link && <span className="vc-tool-hint">{current ? "Using the webhook's own picture." : hookId ? "This webhook has no picture yet." : "No picture yet."}</span>}
                    </>
                )}
            </div>
            <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: "none" }}
                onChange={e => { void take(e.target.files?.[0]); e.target.value = ""; }} />
            {over && <div className="vc-es2-avatar-drop">Drop to use this picture</div>}
        </div>
    );
}

/**
 * A picture for an embed — the big image, thumbnail, or an icon. Drop one in,
 * paste it, upload it, or give a link. Files go up with the message and the
 * embed points at them (attachment://name), so nothing is changed anywhere else.
 */
export function PictureInput({ value, onChange, onFile, previewOf, placeholder, toast }: {
    value: string;
    onChange(v: string): void;
    /** Attaches the file to the message and gives back what the embed should point at. */
    onFile(file: File): Promise<string>;
    /** What to show for attachment:// pictures. */
    previewOf(value: string): string | undefined;
    placeholder?: string;
    toast: Toast;
}) {
    const [over, setOver] = useState(false);
    const [broken, setBroken] = useState(false);
    const picker = useRef<HTMLInputElement>(null);
    const attached = value.startsWith("attachment://") ? value.slice(13) : null;
    const preview = attached ? previewOf(value) : /^https?:\/\//i.test(value) ? value : undefined;
    useEffect(() => setBroken(false), [value]);

    const take = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast("error", "That isn't a picture."); return; }
        if (file.size > 25 * 1048576) { toast("error", "That picture is too big (25 MB at most)."); return; }
        onChange(await onFile(file));
    };

    return (
        <div
            className={"vc-es2-pic" + (over ? " vc-es2-pic-over" : "")}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
            onDrop={e => {
                e.preventDefault();
                setOver(false);
                const file = [...e.dataTransfer.files].find(f => f.type.startsWith("image/"));
                if (file) return void take(file);
                const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).split("\n")[0].trim();
                if (/^https:\/\//i.test(url)) onChange(url);
                else toast("error", "Drop a picture file, or a picture from a website.");
            }}
            onPaste={e => {
                const file = [...e.clipboardData.files].find(f => f.type.startsWith("image/"));
                if (file) { e.preventDefault(); void take(file); }
            }}
        >
            <button type="button" className="vc-es2-pic-thumb" title="Upload a picture" onClick={() => picker.current?.click()}>
                {preview && !broken ? <img src={preview} alt="" onError={() => setBroken(true)} /> : <span aria-hidden>🖼️</span>}
            </button>
            {attached ? (
                <div className="vc-es2-pic-file" title={attached}>📎 <span>{attached}</span><small>uploads with the message</small></div>
            ) : (
                <input className={"vc-tool-input vc-es2-grow" + (broken ? " vc-es2-input-bad" : "")} placeholder={placeholder ?? "Drop, paste or upload a picture — or a link"}
                    value={value} onChange={e => onChange(e.target.value)} />
            )}
            {value
                ? <button type="button" className="vc-tool-btn" onClick={() => onChange("")}>Remove</button>
                : <button type="button" className="vc-tool-btn" onClick={() => picker.current?.click()}>Upload</button>}
            <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: "none" }}
                onChange={e => { void take(e.target.files?.[0]); e.target.value = ""; }} />
            {over && <div className="vc-es2-avatar-drop">Drop to use this picture</div>}
        </div>
    );
}
