/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The first time someone opens Sonata: a short tour and a choice of accent. Plus
// "What's new" for when Sonata gets updated.

import { classes } from "@utils/misc";
import { React, useState } from "@webpack/common";

import type { QolApi } from "../controller/ControlCenter";
import { ChangeEntry } from "./changelog";

export function Welcome({ api, store, accents, onDone }: { api: QolApi; store: any; accents: { name: string; hex: string; }[]; onDone(): void; }) {
    const [step, setStep] = useState(0);
    const finish = () => { store.sonataWelcomed = true; onDone(); };
    const pending = api.pendingCount();

    return (
        <div className="sonata-welcome" role="dialog" aria-label="Welcome to Sonata">
            <div className="sonata-welcome-card">
                <div className="sonata-welcome-dots">{[0, 1, 2, 3].map(i => <i key={i} className={classes(i === step && "on", i < step && "done")} />)}</div>

                {step === 0 && (
                    <>
                        <div className="sonata-welcome-icon">♫</div>
                        <h2>Welcome to <em>Sonata</em></h2>
                        <p>Sonata adds {api.keys.length} features to Discord — from a GIF editor and screenshot styler to a Spotify player, message logger and embed sender — all in one place, with one look.</p>
                        <p className="sonata-welcome-small">This takes about 30 seconds. You can change everything later.</p>
                        <div className="sonata-welcome-actions">
                            <button type="button" className="sonata-btn" onClick={finish}>Skip</button>
                            <button type="button" className="sonata-btn sonata-btn-light" onClick={() => setStep(1)}>Let's go →</button>
                        </div>
                    </>
                )}

                {step === 1 && (
                    <>
                        <h2>Choose your <em>features</em></h2>
                        <p>Optional features start off. Turn on the ones you want from the Features page.</p>
                        <div className="sonata-welcome-actions">
                            <button type="button" className="sonata-btn" onClick={() => setStep(0)}>← Back</button>
                            <button type="button" className="sonata-btn sonata-btn-light" onClick={() => setStep(2)}>Next →</button>
                        </div>
                    </>
                )}

                {step === 2 && (
                    <>
                        <h2>Pick a <em>colour</em></h2>
                        <p>The colour Sonata uses everywhere — this page, its windows and every highlight.</p>
                        <div className="sonata-swatches sonata-welcome-swatches">
                            {accents.map(a => (
                                <button key={a.hex} type="button" title={a.name} aria-label={a.name}
                                    className={classes("sonata-swatch", (store.aboutAmbientColor ?? "").toLowerCase() === a.hex && "sonata-swatch-on")}
                                    style={{ "--sw": a.hex } as React.CSSProperties} onClick={() => { store.aboutAmbientColor = a.hex; store.sonataAccentMode = "solid"; }} />
                            ))}
                        </div>
                        <p className="sonata-welcome-small">More under Appearance: gradients, seasons and holidays, album colours and the background.</p>
                        <div className="sonata-welcome-actions">
                            <button type="button" className="sonata-btn" onClick={() => setStep(1)}>← Back</button>
                            <button type="button" className="sonata-btn sonata-btn-light" onClick={() => setStep(3)}>Next →</button>
                        </div>
                    </>
                )}

                {step === 3 && (
                    <>
                        <h2>You're <em>all set</em></h2>
                        <ul className="sonata-welcome-tips">
                            <li><b>♫ in the chat bar</b> — every feature's chat buttons, tucked behind one note.</li>
                            <li><b>The dock</b> under your profile — Sonata's button, and any features you pin there.</li>
                            <li><b>Ctrl+F</b> on this page searches every feature and option.</li>
                            <li><b>Sonata Insights</b> finds and fixes problems; <b>Performance</b> (at the bottom) makes Discord faster.</li>
                            <li><b>Right-click</b> almost anything — Sonata's extras are in the <b>Sonata ›</b> submenu.</li>
                        </ul>
                        {pending > 0 && <p className="sonata-welcome-small">{pending} feature{pending === 1 ? "" : "s"} need Discord to reload to finish switching.</p>}
                        <div className="sonata-welcome-actions">
                            <button type="button" className="sonata-btn" onClick={() => setStep(2)}>← Back</button>
                            {pending > 0
                                ? <button type="button" className="sonata-btn sonata-btn-light" onClick={() => { finish(); api.apply(); }}>Reload & start</button>
                                : <button type="button" className="sonata-btn sonata-btn-light" onClick={finish}>Start using Sonata</button>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export function WhatsNew({ entries, onClose }: { entries: ChangeEntry[]; onClose(): void; }) {
    return (
        <div className="sonata-welcome" role="dialog" aria-label="What's new in Sonata" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="sonata-welcome-card sonata-news">
                <h2>What's <em>new</em></h2>
                <div className="sonata-news-list">
                    {entries.map(e => (
                        <section key={e.version}>
                            <div className="sonata-news-head"><b>{e.title}</b><span>{e.date}</span></div>
                            <ul>{e.items.map((it, i) => <li key={i}><span aria-hidden>{it.icon}</span>{it.text}</li>)}</ul>
                        </section>
                    ))}
                </div>
                <div className="sonata-welcome-actions">
                    <button type="button" className="sonata-btn sonata-btn-light" onClick={onClose}>Got it</button>
                </div>
            </div>
        </div>
    );
}
