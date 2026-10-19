/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The "My account" tile at the top of the sidebar.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { showToast, useEffect, useReducer, useState } from "@webpack/common";

import { getLive, onSavedChange, refreshLive } from "./bookmarks";
import { PRESENCE, short } from "./data";
import { change, clearMe, getMe, loadMe, onMeChange, setMe } from "./me";

const rb = classNameFactory("vc-rbx-");

export function useMe() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        const a = onMeChange(bump), b = onSavedChange(bump);
        void loadMe();
        return () => { a(); b(); };
    }, []);
    return getMe();
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${short(Math.abs(n))}`;

function SetForm({ onDone, canRemove }: { onDone(): void; canRemove: boolean; }) {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const go = async () => {
        if (!text.trim()) return;
        setBusy(true); setErr(null);
        const e = await setMe(text);
        setBusy(false);
        if (e) { setErr(e); return; }
        void refreshLive(true);
        showToast("Set — your account is always watched now", "success");
        onDone();
    };
    return (
        <div className={rb("me-form")}>
            <input className="vc-tool-input" autoFocus value={text} placeholder="Your Roblox username or ID" onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") go(); if (e.key === "Escape") onDone(); }} />
            {err && <span className="vc-tool-error">{err}</span>}
            <div className={rb("me-form-row")}>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !text.trim()} onClick={go}>{busy ? "Finding…" : "Set"}</button>
                <button type="button" className="vc-tool-btn" onClick={onDone}>Cancel</button>
                {canRemove && <button type="button" className="vc-tool-btn vc-tool-danger" title="Stop treating any account as yours (it stays on the People watch until you remove it there)" onClick={() => { clearMe(); showToast("Removed your account", "message"); onDone(); }}>Remove</button>}
            </div>
        </div>
    );
}

export function MyAccount({ current, onOpen }: { current: boolean; onOpen(id: string): void; }) {
    const me = useMe();
    const [editing, setEditing] = useState(false);

    if (editing) return <SetForm onDone={() => setEditing(false)} canRemove={!!me} />;
    if (!me) {
        return (
            <button type="button" className={rb("me-empty")} onClick={() => setEditing(true)}>
                <span>👤</span>
                <b>Set your account</b>
                <small>Keep yourself one click away, always watched for changes.</small>
            </button>
        );
    }

    const presence = getLive()?.users[me.id];
    const followers = me.history[me.history.length - 1]?.followers;
    const week = change("followers", 7);
    return (
        <div className={classes(rb("me"), current && rb("side-row-on"))} role="button" tabIndex={0} title="Open your profile"
            onClick={() => onOpen(me.id)} onKeyDown={e => { if (e.key === "Enter") onOpen(me.id); }}>
            {me.avatar ? <img className={rb("me-avatar")} src={me.avatar} alt="" /> : <span className={classes(rb("me-avatar"), rb("img-none"))}>👤</span>}
            <span className={rb("side-text")}>
                <b>{me.displayName} <i className={rb("me-tag")}>You</i></b>
                <span>
                    {presence != null && <><i className={classes(rb("dot"), rb(`dot-${presence}`))} />{PRESENCE[presence] ?? "Offline"} · </>}
                    {followers != null ? `${short(followers)} followers` : `@${me.name}`}
                    {week ? ` · ${signed(week)} this week` : ""}
                </span>
            </span>
            <button type="button" className={rb("side-x")} title="Change or remove your account" onClick={e => { e.stopPropagation(); setEditing(true); }}>✎</button>
        </div>
    );
}
