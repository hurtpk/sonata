/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { React, UserStore, useState } from "@webpack/common";

import { Window } from "../../features/_shared/Window";
import { accessSnapshot, checkAccess, openAccessDashboard, subscribeAccess } from "./session";

let open = false;

function AccessPanel({ modalProps }: { modalProps: RenderModalProps; }) {
    const result = React.useSyncExternalStore(subscribeAccess, accessSnapshot);
    const [busy, setBusy] = useState(false);
    const run = async (action: Parameters<typeof checkAccess>[0]) => { setBusy(true); try { await checkAccess(action); } finally { setBusy(false); } };
    const title = result.status === "allowed" ? "Sonata is activated" : result.status === "blocked" ? "This account cannot use Sonata" : result.status === "waiting" ? "Finish activation in your browser" : "Activate Sonata";
    return <Window {...modalProps} title="Sonata Account" size="md" subtitle="Your activation and access">
        <div className="vc-tool-wrap">
            <h2 className="vc-tool-section-title">{title}</h2>
            <p className="vc-tool-hint">Discord account: {UserStore.getCurrentUser()?.username} · {UserStore.getCurrentUser()?.id}</p>
            <p className="vc-tool-hint">No messages, friend lists or server lists are collected.</p>
            {result.status === "blocked" && <p className="vc-tool-error">Sonata's owner has restricted this Discord account. Contact the owner if you believe this is a mistake. Your saved local files and settings are kept.</p>}
            {result.message && <p className="vc-tool-hint">{result.message}</p>}
            {result.status === "waiting" && <p>Sign into this same Discord account in your browser, then press Finish activation. Sonata reloads once to apply your access.</p>}
            <div className="vc-tool-row">
                {!["allowed", "blocked", "waiting"].includes(result.status) && <Button disabled={busy} onClick={() => void run("begin")}>Activate with Discord</Button>}
                {result.status === "waiting" && <Button disabled={busy} onClick={() => void run("finish")}>Finish activation</Button>}
                <Button disabled={busy} variant="secondary" onClick={() => void run("check")}>Check access again</Button>
                {result.status === "allowed" && <Button disabled={busy} variant="secondary" onClick={() => void run("disconnect")}>Disconnect this device</Button>}
                {result.admin && <Button variant="secondary" onClick={() => void openAccessDashboard()}>Open admin panel ↗</Button>}
            </div>
            {result.status !== "allowed" && <p className="vc-tool-hint">You can close this window without activating. Sonata's features remain off until access is verified.</p>}
        </div>
    </Window>;
}

export function openAccessPanel() {
    if (open) return;
    open = true;
    openModal(props => <AccessPanel modalProps={props} />, { onCloseCallback: () => { open = false; } });
}
