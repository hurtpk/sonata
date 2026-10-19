/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Auto-Correct Lite: just before a message is sent, common slips are fixed —
// teh → the, recieve → receive, dont → don't, i → I — plus your own list
// (brb = be right back). Code, links, mentions, emoji and slash commands are
// never touched, and nothing is sent anywhere: it all happens on your computer.
// It also learns: fix the same typo a few times (by editing, or with a
// "*word" message) and it offers to add it to your list.

import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { MessageStore, showToast, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { correctText, parseCustom } from "./correct";
import { count, fixesInEdit, readLearned, starFix } from "./learn";

/** Fixes of the same typo before Auto-Correct offers to take over. */
const OFFER_AT = 3;

const saveLearned = (l: ReturnType<typeof readLearned>) => { settings.store.learnedJson = JSON.stringify(l); };

function addWord(wrong: string, right: string) {
    const raw = settings.store.customWords ?? "";
    if (!(wrong in parseCustom(raw))) settings.store.customWords = `${raw.trimEnd()}${raw.trim() ? "\n" : ""}${wrong} = ${right}`;
    const l = readLearned(settings.store.learnedJson);
    delete l.seen[wrong];
    saveLearned(l);
}

function ignoreWord(wrong: string) {
    const l = readLearned(settings.store.learnedJson);
    delete l.seen[wrong];
    l.ignored = [...new Set([...l.ignored, wrong])];
    saveLearned(l);
}

function learn(wrong: string, right: string) {
    if (settings.store.learn === false || wrong in parseCustom(settings.store.customWords ?? "")) return;
    const l = readLearned(settings.store.learnedJson);
    const n = count(l, wrong, right);
    saveLearned(l);
    if (n !== OFFER_AT) return;
    showNotification({
        title: "✏️ Auto-Correct spotted a typo you make",
        body: `You've fixed “${wrong}” → “${right}” ${n} times. Click to fix it for you from now on.`,
        onClick: () => { addWord(wrong, right); showToast(`Added: ${wrong} → ${right}`, "success"); },
    });
}

/** What you last sent in each channel (for "*word" fixes). */
const lastSent = new Map<string, string>();

function Suggestions({ onAdd }: { onAdd(): void; }) {
    const [l, setL] = useState(() => readLearned(settings.store.learnedJson));
    const custom = parseCustom(settings.store.customWords ?? "");
    const list = Object.entries(l.seen).filter(([w, v]) => v.n >= 2 && !(w in custom)).sort((a, b) => b[1].n - a[1].n);
    if (settings.store.learn === false || !list.length) return null;
    const refresh = () => setL(readLearned(settings.store.learnedJson));
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            <b style={{ color: "var(--header-primary)", fontSize: 14 }}>Typos you keep fixing</b>
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Learned from messages you edited, or fixed with a “*word” message.</span>
            {list.map(([w, v]) => (
                <div key={w} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: "var(--background-secondary)" }}>
                    <code style={{ flex: 1, fontSize: 13 }}>{w} → {v.right}</code>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>fixed {v.n}×</span>
                    <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => { addWord(w, v.right); refresh(); onAdd(); }}>Add</button>
                    <button type="button" className="vc-tool-btn" onClick={() => { ignoreWord(w); refresh(); }}>Not a typo</button>
                </div>
            ))}
        </div>
    );
}

function CustomWords() {
    const [raw, setRaw] = useState(settings.store.customWords ?? "");
    const count = Object.keys(parseCustom(raw)).length;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <b style={{ color: "var(--header-primary)", fontSize: 14 }}>Your own words</b>
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                One per line, like <code>brb = be right back</code> or <code>sonata → Sonata</code>. These are used exactly as you write them.
            </span>
            <textarea
                className="vc-tool-input"
                style={{ minHeight: 90, fontFamily: "var(--font-code)", resize: "vertical" }}
                placeholder={"brb = be right back\nomw = on my way\nsonata = Sonata"}
                value={raw}
                onChange={e => { setRaw(e.target.value); settings.store.customWords = e.target.value; }}
            />
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{count ? `${count} word${count === 1 ? "" : "s"} saved.` : "Nothing added yet."}</span>
            <Suggestions onAdd={() => setRaw(settings.store.customWords ?? "")} />
        </div>
    );
}

const settings = defineFeatureSettings("autoCorrect", {
    typos: {
        type: OptionType.BOOLEAN,
        description: "Fix common typos (teh → the, recieve → receive, wierd → weird…)",
        default: true,
    },
    capitalI: {
        type: OptionType.BOOLEAN,
        description: "Capitalise “i” on its own (i → I, i'm → I'm)",
        default: true,
    },
    apostrophes: {
        type: OptionType.BOOLEAN,
        description: "Add missing apostrophes (dont → don't, im → I'm, thats → that's)",
        default: true,
    },
    sentenceCase: {
        type: OptionType.BOOLEAN,
        description: "Start every sentence with a capital letter",
        default: false,
    },
    edits: {
        type: OptionType.BOOLEAN,
        description: "Correct messages you edit too",
        default: false,
    },
    toast: {
        type: OptionType.BOOLEAN,
        description: "Show a little note saying how many words were fixed",
        default: false,
    },
    learn: {
        type: OptionType.BOOLEAN,
        description: `Learn from your fixes — when you fix the same typo ${OFFER_AT} times (by editing, or with a “*word” message), offer to add it to your list`,
        default: true,
    },
    customPanel: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <CustomWords />,
    },
    customWords: {
        type: OptionType.STRING,
        description: "Your own words (wrong = right, one per line).",
        default: "",
        hidden: true,
    },
    learnedJson: {
        type: OptionType.STRING,
        description: "Internal: typos you've fixed yourself, and how often.",
        default: "",
        hidden: true,
    },
});

function correct(msg: { content: string; }) {
    if (!msg?.content) return;
    const s = settings.store;
    const { text, changes } = correctText(msg.content, {
        typos: s.typos !== false,
        capitalI: s.capitalI !== false,
        apostrophes: s.apostrophes !== false,
        sentenceCase: !!s.sentenceCase,
        custom: parseCustom(s.customWords ?? ""),
    });
    if (!changes || text === msg.content) return;
    msg.content = text;
    if (s.toast) showToast(`Fixed ${changes} word${changes === 1 ? "" : "s"} ✏️`, "success");
}

export default definePlugin({
    name: "AutoCorrectLite",
    description: "Fixes common typos as you send — teh → the, dont → don't, i → I — plus your own list of words. Never touches code, links, mentions or emoji.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    onBeforeMessageSend(channelId: string, msg: { content: string; }) {
        const fix = starFix(lastSent.get(channelId) ?? "", msg?.content ?? "");
        if (fix) learn(...fix);
        correct(msg);
        if (msg?.content) lastSent.set(channelId, msg.content);
    },

    onBeforeMessageEdit(channelId: string, messageId: string, msg: { content: string; }) {
        const before: string = MessageStore.getMessage(channelId, messageId)?.content ?? "";
        for (const [w, r] of fixesInEdit(before, msg?.content ?? "")) learn(w, r);
        if (settings.store.edits) correct(msg);
    },

    stop() {
        lastSent.clear();
    },
});
