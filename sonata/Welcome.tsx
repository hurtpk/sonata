/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The first time someone opens Sonata: a short tour that picks a starting
// set of features (so they don't get everything at once) and a look. Plus
// "What's new" for when Sonata gets updated.

import { classes } from "@utils/misc";
import { React, useState } from "@webpack/common";

import type { QolApi } from "../controller/ControlCenter";
import { ChangeEntry } from "./changelog";

/** Everyday features that are light and useful to almost everyone. */
const MINIMAL = [
    "imageZoom", "viewIcons", "permissionsViewer", "voiceDownload", "translate", "readAllNotificationsButton",
    "linkCleaner", "videoSpeed", "waveformPlayer", "spotifyControls", "brokenPatchFinder", "crashHandler",
];

/** Minimal, plus the fun and handy things — but none of the sneaky or experimental ones. */
const BALANCED = [
    ...MINIMAL,
    "gifMaker", "screenshotStyler", "messageLogger", "pinDms", "callTimer", "betterInvites", "fancyText", "charactersPicker",
    "calculator", "qrCodes", "imageToText", "filePreviewer", "zipPreview", "birthdayReminders", "onThisDay", "scheduledMessages",
    "multiQuote", "messagePreview", "longMessageCollapser", "linkEmbedFixer", "smoothChat", "currencyConverter", "stickyMessage",
    "splitView", "modelPreview", "streaks", "sonataBadge", "shareSetup", "mutualGroupDMs", "serverInfo", "roleColorEverywhere",
    "showRolesInChat", "autoVolume", "soundStudio", "asciiArt", "giftWrap", "miniGames", "calendar", "inviteManager",
    "embedCopier", "declutter", "imageLink", "imageFilename", "reverseImageSearch", "expressionStealer", "voiceMessages",
    "splitLargeMessages", "onePingPerDM", "noUnblockToJump", "disableCallIdle", "showTimeoutDuration", "platformIndicators",
];

type Pick = "minimal" | "balanced" | "everything" | "keep";

const PICKS: { id: Pick; icon: string; name: string; blurb: string; }[] = [
    { id: "minimal", icon: "🌱", name: "Minimal", blurb: "A dozen everyday helpers — zoom, translate, clean links, the Spotify player. Light and simple." },
    { id: "balanced", icon: "⚖️", name: "Balanced", blurb: "Most of Sonata: GIF Maker, screenshots, message logger, pins, tools and fun extras. Recommended." },
    { id: "everything", icon: "🚀", name: "Everything", blurb: "Every feature on, including the experimental ones. You can switch any of them off later." },
    { id: "keep", icon: "✋", name: "Keep what I have", blurb: "Don't change anything — I'll pick features myself." },
];

export function Welcome({ api, store, accents, onDone }: { api: QolApi; store: any; accents: { name: string; hex: string; }[]; onDone(): void; }) {
    const [step, setStep] = useState(0);
    const [pick, setPick] = useState<Pick>("balanced");

    const applyPick = () => {
        if (pick === "keep") return;
        const wanted = new Set(pick === "everything" ? api.keys : pick === "minimal" ? MINIMAL : BALANCED);
        api.setManyOn(api.keys.filter(k => wanted.has(k) && !api.isOn(k)), true);
        api.setManyOn(api.keys.filter(k => !wanted.has(k) && api.isOn(k)), false);
    };
    const finish = () => { store.sonataWelcomed = true; onDone(); };
    const pending = api.pendingCount();
    const count = pick === "everything" ? api.keys.length : pick === "minimal" ? MINIMAL.filter(k => api.keys.includes(k)).length : BALANCED.filter(k => api.keys.includes(k)).length;

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
                        <h2>Pick a <em>starting set</em></h2>
                        <p>Turning everything on at once can be a lot. Start with a set — you can switch any feature on or off from the Features list.</p>
                        <div className="sonata-welcome-picks">
                            {PICKS.map(p => (
                                <button key={p.id} type="button" className={classes("sonata-welcome-pick", pick === p.id && "on")} onClick={() => setPick(p.id)}>
                                    <span className="sonata-welcome-pick-icon">{p.icon}</span>
                                    <span className="sonata-welcome-pick-name">{p.name}{p.id === "balanced" && <i>Recommended</i>}</span>
                                    <span className="sonata-welcome-small">{p.blurb}</span>
                                </button>
                            ))}
                        </div>
                        <div className="sonata-welcome-actions">
                            <button type="button" className="sonata-btn" onClick={() => setStep(0)}>← Back</button>
                            <button type="button" className="sonata-btn sonata-btn-light" onClick={() => { applyPick(); setStep(2); }}>{pick === "keep" ? "Next →" : `Use ${count} features →`}</button>
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
