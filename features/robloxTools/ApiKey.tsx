/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your Roblox API key, for downloading newer items Roblox won't hand out
// anonymously. It can only download items (nothing else on your account),
// stays on this computer, and is only ever sent to Roblox.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { showToast, useState } from "@webpack/common";

import { sources } from "./data";

const rb = classNameFactory("vc-rbx-");
const CREDENTIALS = "https://create.roblox.com/dashboard/credentials?activeTab=ApiKeysTab";

export function ApiKeyBox({ blocked, onSaved }: { blocked: boolean; onSaved(): void; }) {
    const has = !!sources.apiKey;
    const [open, setOpen] = useState(blocked && !has);
    const [key, setKey] = useState("");
    const [show, setShow] = useState(false);

    const save = () => {
        const k = key.trim();
        if (!/^[A-Za-z0-9+/=_.-]{20,4096}$/.test(k)) { showToast("That doesn't look like a Roblox API key — copy the whole key from the Creator Hub", "failure"); return; }
        sources.saveApiKey(k);
        setKey(""); setOpen(false);
        showToast("Key saved — trying again", "success");
        onSaved();
    };

    if (!open) {
        return (
            <div className={classes(rb("key-line"), blocked && !has && rb("key-line-warn"))}>
                <span>🔑 {has ? "Your Roblox API key is set — newer items download in full." : blocked ? "Roblox wants an account for this one. Add a Roblox API key to get the full files." : "Newer items need a Roblox API key to download in full."}</span>
                <span className={rb("spacer")} />
                <button type="button" className={rb("link")} onClick={() => setOpen(true)}>{has ? "Change" : "Set it up"}</button>
                {has && <button type="button" className={rb("link")} onClick={() => { sources.saveApiKey(""); showToast("Removed your API key", "message"); onSaved(); }}>Remove</button>}
            </div>
        );
    }

    return (
        <div className={rb("key")}>
            <div className={rb("key-head")}>
                <b>🔑 Get newer items in full</b>
                <span className={rb("spacer")} />
                <button type="button" className="vc-tool-icon" title="Close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <p className={rb("key-why")}>
                Roblox only gives newer items' files to requests from an account. An <b>API key</b> lets Roblox Tools ask the official way — and it can <b>only download items</b>, nothing else on your account. It stays on this computer and is only sent to Roblox. You can delete it any time.
            </p>
            <ol className={rb("key-steps")}>
                <li>Open the <a className={rb("link")} href={CREDENTIALS} target="_blank" rel="noreferrer">Creator Hub → API keys ↗</a> (signed in to your own account, not a group) and press <b>Create API key</b>.</li>
                <li>Name it something like <code>Sonata</code>.</li>
                <li>Under <b>Access permissions</b>, pick <b>legacy-assets</b> in "Select API System", then in <b>Select Operations to Add</b> choose <b>legacy-asset:manage</b> — that's the download permission. Add nothing else.</li>
                <li>Under <b>Security</b>, you can leave the IP restriction off (or turn it on and add your own IP). Expiry is up to you — Roblox also retires a key after 60 days unused.</li>
                <li>Press <b>Save &amp; generate key</b>, copy it, and paste it below.</li>
            </ol>
            <div className={rb("bar")}>
                <input className="vc-tool-input" type={show ? "text" : "password"} value={key} placeholder="Paste your API key here" autoComplete="off" spellCheck={false}
                    onChange={e => setKey(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
                <button type="button" className="vc-tool-btn" onClick={() => setShow(s => !s)} title={show ? "Hide it" : "Show it"}>{show ? "🙈" : "👁"}</button>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!key.trim()} onClick={save}>Save key</button>
            </div>
            <span className="vc-tool-hint">Never paste your .ROBLOSECURITY cookie anywhere — it gives full control of your account. An API key like this can't.</span>
        </div>
    );
}
