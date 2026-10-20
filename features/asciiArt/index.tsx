/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Text to ASCII Art: type something, pick a style, and send it as big
// lettering — compact half-blocks, solid blocks, 3D shadow, #, dots, any
// character, or emoji squares. Sent in a code block so it lines up for
// everyone (emoji art is sent as is). Also /ascii.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { classNameFactory } from "@utils/css";
import { copyWithToast, insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, React, SelectedChannelStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { defineFeatureSettings } from "../../featureSettings";
import { Window } from "../_shared/Window";
import { asMessage, Options, render, Style, STYLES, supported, widthOf } from "./font";

const cl = classNameFactory("vc-ascii-");
const tl = classNameFactory("vc-tool-");

const settings = defineFeatureSettings("asciiArt", {
    style: { type: OptionType.STRING, default: "compact", hidden: true, description: "" },
    char: { type: OptionType.STRING, default: "@", hidden: true, description: "" },
    fg: { type: OptionType.STRING, default: "🟪", hidden: true, description: "" },
    bg: { type: OptionType.STRING, default: "⬛", hidden: true, description: "" },
});

const EMOJI_SQUARES = ["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫", "⬛", "⬜", "❤️", "⭐", "🔥", "💀", "✨"];
/** Roughly how wide a code block gets before Discord wraps it (on a normal desktop window). */
const WIDE = 80;

function AsciiWindow({ modalProps }: { modalProps: RenderModalProps; }) {
    const [text, setText] = useState("Hello");
    const [opts, setOpts] = useState<Options>(() => ({
        style: (settings.store.style as Style) || "compact",
        char: settings.store.char || "@",
        fg: settings.store.fg || "🟪",
        bg: settings.store.bg || "⬛",
    }));
    const set = (p: Partial<Options>) => setOpts(o => { const n = { ...o, ...p }; Object.assign(settings.store, n); return n; });
    const art = text.trim() ? render(text, opts) : "";
    const message = art ? asMessage(art, opts) : "";
    const width = widthOf(art);
    const unknown = [...new Set([...text].filter(c => !supported(c)))];
    const tooLong = message.length > 2000;
    const channelId = SelectedChannelStore.getChannelId();
    const accent = windowAccent("asciiArt");

    return (
        <Window {...modalProps} size="lg" title="ASCII Art" subtitle="Type something, pick a style, send it as big letters">
            <div className={classes(tl("wrap"), cl("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <textarea className={classes(tl("area"), cl("input"))} rows={2} value={text} autoFocus maxLength={80} placeholder="Your text (Enter for a new line)" onChange={e => setText(e.currentTarget.value)} />
                <div className={tl("seg")}>
                    {STYLES.map(s => (
                        <button key={s.id} type="button" className={classes(tl("seg-btn"), opts.style === s.id && tl("seg-on"))} onClick={() => set({ style: s.id })}>{s.name}</button>
                    ))}
                </div>
                {opts.style === "custom" && (
                    <label className={cl("row")}>
                        <span>Character</span>
                        <input className={classes(tl("input"), cl("char"))} value={opts.char} maxLength={2} onChange={e => set({ char: [...e.currentTarget.value].slice(0, 1).join("") || "#" })} />
                    </label>
                )}
                {opts.style === "emoji" && (
                    <div className={cl("emoji-pick")}>
                        {(["fg", "bg"] as const).map(k => (
                            <div key={k} className={cl("row")}>
                                <span>{k === "fg" ? "Letters" : "Background"}</span>
                                {EMOJI_SQUARES.map(e => <button key={e} type="button" className={cl("emoji", opts[k] === e && "emoji-on")} onClick={() => set({ [k]: e })}>{e}</button>)}
                            </div>
                        ))}
                    </div>
                )}
                <div className={classes(tl("stage"), cl("preview"), opts.style === "emoji" && cl("preview-emoji"))}>
                    {art ? <pre>{art}</pre> : <span className={tl("hint")}>Type something above</span>}
                </div>
                <div className={cl("notes")}>
                    {unknown.length > 0 && <span>Left out (no letter for it): {unknown.join(" ")}</span>}
                    {opts.style !== "emoji" && width > WIDE && <span>⚠ {width} characters wide — it may wrap on smaller windows and phones. Try fewer letters per line, or Compact.</span>}
                    {tooLong && <span>⚠ Too long for one message ({message.length}/2000) — use fewer letters.</span>}
                </div>
                <div className={tl("footer")}>
                    <span className={tl("hint")}>{art ? `${message.length}/2000 characters` : ""}</span>
                    <span className={tl("spacer")} />
                    <button type="button" className={tl("btn")} disabled={!art} onClick={() => copyWithToast(message, "Copied")}>Copy</button>
                    <button type="button" className={tl("btn")} disabled={!art} onClick={() => { insertTextIntoChatInputBox(message); modalProps.onClose(); }}>Put in chat box</button>
                    <button type="button" className={classes(tl("btn"), tl("primary"))} disabled={!art || tooLong || !channelId} onClick={() => { sendMessage(channelId!, { content: message }); modalProps.onClose(); }}>Send</button>
                </div>
            </div>
        </Window>
    );
}

const openAscii = () => openModal(props => <AsciiWindow modalProps={props} />);

function AsciiIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="currentColor" aria-hidden>
            {[[3, 5], [6, 5], [9, 5], [3, 8], [9, 8], [3, 11], [6, 11], [9, 11], [3, 14], [9, 14], [3, 17], [9, 17], [14, 5], [17, 5], [20, 5], [14, 8], [14, 11], [17, 11], [14, 14], [14, 17], [17, 17], [20, 17]].map(([x, y], i) => <rect key={i} x={x - 1.2} y={y - 1.2} width={2.4} height={2.4} rx={0.5} />)}
        </svg>
    );
}

const AsciiButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="ASCII art" onClick={openAscii}><AsciiIcon /></ChatBarButton>
    : null;

export default definePlugin({
    name: "AsciiArt",
    description: "Turn text into big ASCII-art letters — compact, blocks, 3D shadow, #, dots, any character or emoji — and send it so it lines up for everyone. Also /ascii.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    chatBarButton: { icon: AsciiIcon, render: AsciiButton },
    openSettingsModal: openAscii,

    commands: [{
        name: "ascii",
        description: "Send text as big ASCII-art letters",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "text", description: "What to write", type: ApplicationCommandOptionType.STRING, required: true },
            {
                name: "style", description: "How it looks", type: ApplicationCommandOptionType.STRING, required: false,
                choices: STYLES.filter(s => s.id !== "custom").map(s => ({ name: s.name, label: s.name, value: s.id })),
            },
        ],
        execute: (args, ctx) => {
            const o: Options = { style: findOption(args, "style", settings.store.style || "compact") as Style, char: settings.store.char || "@", fg: settings.store.fg || "🟪", bg: settings.store.bg || "⬛" };
            const text = findOption(args, "text", "").slice(0, 60);
            const message = asMessage(render(text, o), o);
            if (!text.trim() || message.length > 2000) { sendBotMessage(ctx.channel.id, { content: message.length > 2000 ? "That's too long for one message — try fewer letters." : "Give me some text to draw." }); return; }
            return { content: message };
        },
    }],
});
