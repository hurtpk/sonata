/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Typing Sounds: keyboard sounds while you type, from a choice of sound
// packs. Only you hear them.

import "./styles.css";

import definePlugin, { OptionType } from "@utils/types";
import { React, showToast, useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { CustomPack, deletePack, knownPacks, loadPacks, onPacksChange } from "./custom";
import { PackMaker } from "./Maker";
import { closeAudio, DEFAULT_PACK, demo, KeyKind, PACKS, playKey, warm } from "./sounds";

const GROUPS = ["Keyboards", "Calm", "Fun"] as const;

function PackPicker() {
    const s = settings.use(["pack", "volume", "vary", "stereo"]);
    const [, bump] = useState(0);
    const [making, setMaking] = useState<CustomPack | "new" | null>(null);
    const [mine, setMine] = useState<CustomPack[]>(knownPacks);
    useEffect(() => { void loadPacks().then(p => setMine([...p])); return onPacksChange(() => setMine([...knownPacks()])); }, []);
    const current = s.pack ?? DEFAULT_PACK;
    const pick = (id: string) => {
        settings.store.pack = id;
        bump(n => n + 1);
        demo(id, { volume: (s.volume ?? 40) / 100, vary: s.vary !== false, stereo: s.stereo !== false });
    };
    return (
        <div className="vc-ts-picker">
            {GROUPS.map(g => (
                <div key={g} className="vc-ts-group">
                    <span className="vc-tool-label">{g}</span>
                    <div className="vc-tool-tiles">
                        {PACKS.filter(p => p.group === g).map(p => (
                            <button key={p.id} type="button" className={"vc-tool-tile" + (current === p.id ? " vc-tool-tile-on" : "")} onClick={() => pick(p.id)} title="Click to choose it and hear a sample">
                                <b>{current === p.id ? "🔊 " : ""}{p.name}</b>
                                <span>{p.blurb}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ))}
            <div className="vc-ts-group">
                <span className="vc-tool-label">Yours</span>
                {making ? (
                    <PackMaker editing={making === "new" ? null : making} toast={m => showToast(m)} onCancel={() => setMaking(null)}
                        onDone={id => { setMaking(null); pick(id); }} />
                ) : (
                    <div className="vc-tool-tiles">
                        {mine.map(p => (
                            <div key={p.id} className={"vc-tool-tile vc-ts-mine" + (current === p.id ? " vc-tool-tile-on" : "")}>
                                <button type="button" className="vc-ts-mine-main" onClick={() => pick(p.id)} title="Click to choose it and hear a sample">
                                    <b>{current === p.id ? "🔊 " : ""}{p.name}</b>
                                    <span>{p.sounds.key.length} key sound{p.sounds.key.length === 1 ? "" : "s"}{["space", "enter", "back"].filter(k => (p.sounds as any)[k]?.length).length ? " + extras" : ""}</span>
                                </button>
                                <div className="vc-ts-mine-tools">
                                    <button type="button" title="Edit" onClick={() => setMaking(p)}>✎</button>
                                    <button type="button" title="Delete" onClick={() => { void deletePack(p.id); if (current === p.id) { settings.store.pack = DEFAULT_PACK; bump(n => n + 1); } }}>✕</button>
                                </div>
                            </div>
                        ))}
                        <button type="button" className="vc-tool-tile vc-ts-new" onClick={() => setMaking("new")}>
                            <b>＋ Make your own</b>
                            <span>Drop in your own sound files</span>
                        </button>
                    </div>
                )}
            </div>
            <span className="vc-tool-hint">Click a sound to choose it and hear a sample.</span>
        </div>
    );
}

function TryIt() {
    return (
        <input
            className="vc-tool-input"
            data-ts-try=""
            style={{ width: "100%", boxSizing: "border-box" }}
            placeholder="Type here to try your sound…"
            onKeyDown={e => onKey(e.nativeEvent, true)}
        />
    );
}

export const settings = defineFeatureSettings("typingSounds", {
    picker: {
        type: OptionType.COMPONENT,
        component: PackPicker,
    },
    pack: {
        type: OptionType.SELECT,
        description: "Sound pack",
        options: PACKS.map(p => ({ label: p.name, value: p.id, default: p.id === DEFAULT_PACK })),
        hidden: true,
        onChange: (v: string) => warm(v),
    },
    volume: {
        type: OptionType.SLIDER,
        description: "Volume",
        markers: [0, 25, 50, 75, 100],
        default: 40,
        stickToMarkers: false,
    },
    vary: {
        type: OptionType.BOOLEAN,
        description: "Make each key sound slightly different, like a real keyboard",
        default: true,
    },
    stereo: {
        type: OptionType.BOOLEAN,
        description: "Place sounds left and right by where the key is (best with headphones)",
        default: true,
    },
    where: {
        type: OptionType.SELECT,
        description: "Play sounds when typing in",
        options: [
            { label: "The message box only", value: "chat", default: true },
            { label: "Any text box in Discord", value: "any" },
        ],
    },
    tryIt: {
        type: OptionType.COMPONENT,
        component: TryIt,
    },
});

const SILENT = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab", "Escape", "ContextMenu", "Fn", "OS"]);

function kindOf(e: KeyboardEvent): KeyKind | null {
    if (SILENT.has(e.key) || /^F\d+$/.test(e.key)) return null;
    // Shortcuts (Ctrl+C and so on) aren't typing.
    if ((e.ctrlKey || e.metaKey) && e.key.length === 1) return null;
    if (e.key === " ") return "space";
    if (e.key === "Enter") return "enter";
    if (e.key === "Backspace" || e.key === "Delete") return "back";
    return "key";
}

function isTypingTarget(el: EventTarget | null, chatOnly: boolean) {
    if (!(el instanceof HTMLElement) || el.closest("[data-ts-try]")) return false;
    if (chatOnly) return !!el.closest('[data-slate-editor="true"], [class*="channelTextArea"] [role="textbox"]');
    return el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|email|url|)$/.test(el.type));
}

function onKey(e: KeyboardEvent, preview = false) {
    const { pack, volume, vary, stereo, where } = settings.store;
    if (!preview && !isTypingTarget(e.target, where !== "any")) return;
    // Holding a key down repeats only for Backspace, like the real thing.
    if (e.repeat && e.key !== "Backspace") return;
    const kind = kindOf(e);
    if (kind) playKey(pack ?? DEFAULT_PACK, kind, { volume: (volume ?? 40) / 100, vary: vary !== false, stereo: stereo !== false, key: e.key, code: e.code });
}

const listener = (e: KeyboardEvent) => {
    try { onKey(e); } catch { }
};

export default definePlugin({
    name: "TypingSounds",
    description: "Keyboard sounds while you type — creamy and tactile switches, deep thock, clicky blues, box jades, Topre, vintage Model M and Alps, laptop, office, silent, typewriter, plus calm kalimba, marimba, chimes and raindrops. Only you hear them.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    start() {
        document.addEventListener("keydown", listener, true);
        // Rendered a moment after start, so the first key press doesn't wait.
        setTimeout(() => warm(settings.store.pack ?? DEFAULT_PACK), 3000);
    },

    stop() {
        document.removeEventListener("keydown", listener, true);
        closeAudio();
    },
});
