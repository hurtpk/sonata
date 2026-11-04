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
    const title = result.status === "allowed" ? "Sonata is activated" : result.status === "blocked" ? "This account cannot use Sonata" : "Activate Sonata";
    return <Window {...modalProps} title="Sonata Account" size="md" subtitle="Your activation and access">
        <div className="vc-tool-wrap">
            <h2 className="vc-tool-section-title">{title}</h2>
            <p className="vc-tool-hint">Discord account: {UserStore.getCurrentUser()?.username} · {UserStore.getCurrentUser()?.id}</p>
            <p className="vc-tool-hint">Activation registers your Discord ID, profile name, Sonata version and access check-ins with Sonata's owner.</p>
            <p className="vc-tool-hint">No messages, friend lists or server lists are collected.</p>
            {result.status === "blocked" && <p className="vc-tool-error">Sonata's owner has restricted this Discord account. Contact the owner if you believe this is a mistake. Your saved local files and settings are kept.</p>}
            {result.message && <p className="vc-tool-hint">{result.message}</p>}
            <div className="vc-tool-row">
                {!["allowed", "blocked"].includes(result.status) && <Button disabled={busy} onClick={() => void run("begin")}>{busy ? "Activating…" : "Activate"}</Button>}
                {result.status === "blocked" && <Button disabled={busy} variant="secondary" onClick={() => void run("check")}>Check access again</Button>}
                {result.status === "allowed" && <Button disabled={busy} variant="secondary" onClick={() => void run("disconnect")}>Disconnect this device</Button>}
                {result.admin && <Button variant="secondary" onClick={() => void openAccessDashboard()}>Open admin panel ↗</Button>}
            </div>
            <details className="vc-tool-hint"><summary>Terms of Service</summary><p>The Terms of Service will be published when Sonata's new domain is ready.</p></details>
            {result.status !== "allowed" && <p className="vc-tool-hint">Sonata's features remain off until activation is complete.</p>}
        </div>
    </Window>;
}

export function openAccessPanel() {
    if (open) return;
    open = true;
    openModal(props => <AccessPanel modalProps={props} />, { onCloseCallback: () => { open = false; } });
}
