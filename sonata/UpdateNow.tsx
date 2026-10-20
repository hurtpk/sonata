/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Update button's window: updates Sonata right inside Discord — download,
// match Equicord, new parts, rebuild — with each step ticking off, then a
// Restart Discord button. If it can't, the installer is one click away.

import "../features/_shared/tool.css";
import "./updateNow.css";

import { classes } from "@utils/misc";
import { relaunch } from "@utils/native";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, useEffect, useState } from "@webpack/common";

import { windowAccent } from "../controller/accent";
import { Window } from "../features/_shared/Window";

const native = () => VencordNative.pluginHelpers.Sonata as any;

type Step = "download" | "equicord" | "parts" | "build" | "done" | "error";
interface Job { step: Step; startedAt: number; error?: string; failedStep?: Step; log: string; equicordChanged: boolean; from?: string; to?: string; }

const STEPS: [Step, string, string][] = [
    ["download", "Downloading the new Sonata", "From GitHub"],
    ["equicord", "Matching Equicord", "Keeps it on the version Sonata is made for"],
    ["parts", "Adding new parts", "Only if this version needs any"],
    ["build", "Rebuilding", "About a minute"],
];

function UpdateModal({ modalProps, version }: { modalProps: RenderModalProps; version: string; }) {
    const [job, setJob] = useState<Job | null>(null);
    const [startError, setStartError] = useState<string | null>(null);
    const [showLog, setShowLog] = useState(false);
    const accent = windowAccent("sonata");

    useEffect(() => {
        let stop = false;
        void (async () => {
            const r = await native().sonataUpdateStart?.().catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
            if (!r?.ok) { setStartError(r?.error ?? "This Sonata can't update itself yet — fully restart Discord once, then try again."); return; }
            while (!stop) {
                const j: Job | null = await native().sonataUpdateStatus().catch(() => null);
                if (j) setJob(j);
                if (!j || j.step === "done" || j.step === "error") break;
                await new Promise(res => setTimeout(res, 700));
            }
        })();
        return () => { stop = true; };
    }, []);

    const at = job ? STEPS.findIndex(s => s[0] === job.step) : 0;
    const done = job?.step === "done";
    const failed = job?.step === "error" || !!startError;
    // Where it stopped, when it failed: the step it was on.
    const failedAt = failed && job ? Math.max(0, STEPS.findIndex(s => s[0] === job.failedStep)) : -1;

    return (
        <Window {...modalProps} size="sm" title={done ? "Sonata is updated" : failed ? "The update didn't finish" : `Updating to Sonata ${version}`}
            subtitle={done ? "Restart Discord to start using it" : failed ? "Nothing is broken — your current Sonata still works" : "You can keep chatting while it works"}>
            <div className="vc-tool-wrap vc-sonata-upd" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ol className="vc-sonata-upd-steps">
                    {STEPS.map(([id, label, hint], i) => {
                        const state = done || (!failed && i < at) ? "done" : !failed && i === at ? "now" : failed && i === (failedAt >= 0 ? failedAt : at) ? "bad" : "todo";
                        return (
                            <li key={id} className={classes("vc-sonata-upd-step", `vc-sonata-upd-${state}`)}>
                                <span className="vc-sonata-upd-dot">{state === "done" ? "✓" : state === "bad" ? "!" : state === "now" ? "" : i + 1}</span>
                                <span className="vc-sonata-upd-text"><b>{label}</b><small>{hint}</small></span>
                            </li>
                        );
                    })}
                </ol>

                {failed && <div className="vc-sonata-upd-error">{startError ?? job?.error}</div>}
                {failed && job?.log && (
                    <>
                        <button type="button" className="vc-tool-link" onClick={() => setShowLog(v => !v)}>{showLog ? "Hide details" : "Show details"}</button>
                        {showLog && <pre className="vc-sonata-upd-log">{job.log}</pre>}
                    </>
                )}

                <div className="vc-tool-row">
                    <span className="vc-tool-spacer" />
                    {done && <button type="button" className="vc-tool-btn" onClick={modalProps.onClose}>Later</button>}
                    {done && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => relaunch()}>Restart Discord</button>}
                    {failed && <button type="button" className="vc-tool-btn" onClick={modalProps.onClose}>Close</button>}
                    {failed && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => { void native().sonataRunUpdater?.(); modalProps.onClose(); }}>Use the installer</button>}
                    {!done && !failed && <button type="button" className="vc-tool-btn" onClick={modalProps.onClose}>Hide</button>}
                </div>
                {!done && !failed && <span className="vc-tool-hint">Hiding this doesn't stop it — press Update again to see how it's going.</span>}
            </div>
        </Window>
    );
}

export function openUpdateNow(version: string) {
    openModal(props => <UpdateModal modalProps={props} version={version} />);
}
