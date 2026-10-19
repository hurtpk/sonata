/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";

import { classNameFactory } from "@utils/css";
import { copyWithToast, sendMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, SelectedChannelStore, showToast, useEffect, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { SetupCard } from "./Card";
import { collect, decode, describe, encode, Part, Setup, summaryLine } from "./setup";

const cl = classNameFactory("vc-tool-");
const ss = classNameFactory("vc-sset-");

/** Discord's message limit, with room to spare. */
const LIMIT = 1950;

const PARTS: { id: Part; emoji: string; name: string; }[] = [
    { id: "look", emoji: "🎨", name: "Design & accent" },
    { id: "dock", emoji: "🧩", name: "Dock buttons" },
    { id: "features", emoji: "⚙️", name: "Which features are on" },
];

const myName = () => { const u: any = UserStore.getCurrentUser(); return u?.globalName || u?.username || "Someone"; };

export async function setupMessage(setup: Setup) {
    const code = await encode(setup);
    return `🎁 **${setup.from ?? "My"}'s Sonata setup** — ${summaryLine(setup)}\n-# Apply it with Sonata · ||sset1.${code}||`;
}

function ShareModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("shareSetup");
    const [tab, setTab] = useState<"send" | "import">("send");
    const [parts, setParts] = useState<Part[]>(["look", "dock"]);
    const [text, setText] = useState("");
    const [pasted, setPasted] = useState("");
    const [imported, setImported] = useState<Setup | null | undefined>(undefined);
    const setup = collect(parts, myName());
    const d = describe(setup);

    useEffect(() => {
        let alive = true;
        void setupMessage(setup).then(t => { if (alive) setText(t); });
        return () => { alive = false; };
    }, [parts.join()]);

    useEffect(() => {
        let alive = true;
        if (!pasted.trim()) { setImported(undefined); return; }
        void decode(pasted.match(/sset1\.[A-Za-z0-9_-]+/)?.[0] ?? pasted).then(s => { if (alive) setImported(s); });
        return () => { alive = false; };
    }, [pasted]);

    const tooLong = text.length > LIMIT;
    const channelId = SelectedChannelStore.getChannelId();
    const send = () => {
        if (!channelId) return showToast("Open a chat first", "failure");
        sendMessage(channelId, { content: text });
        showToast("Setup shared 🎁", "success");
        modalProps.onClose();
    };

    return (
        <Modal {...modalProps} size="lg" title="Share My Setup" subtitle="Send your Sonata look to a friend, or try theirs">
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon={tab === "send" ? "🎁" : "📥"} kicker="Share My Setup"
                    title={tab === "send" ? "Send your Sonata look" : "Try a friend's look"}
                    sub={tab === "send" ? `${parts.length} thing${parts.length === 1 ? "" : "s"} picked — your friend sees a card they can try with one click.` : "Paste the code they sent you — you can see it before anything changes."} />
                <div className={cl("seg")}>
                    <button type="button" className={classes(cl("seg-btn"), tab === "send" && cl("seg-on"))} onClick={() => setTab("send")}>🎁 Share mine</button>
                    <button type="button" className={classes(cl("seg-btn"), tab === "import" && cl("seg-on"))} onClick={() => setTab("import")}>📥 Use a code</button>
                </div>

                {tab === "send" ? (
                    <>
                        <div className={cl("card")}>
                            <span className={cl("label")}>What to include</span>
                            {PARTS.map(p => (
                                <label key={p.id} className={classes(ss("part"), parts.includes(p.id) && ss("part-on"))}>
                                    <input type="checkbox" checked={parts.includes(p.id)} onChange={e => { const on = e.currentTarget.checked; setParts(c => on ? [...c, p.id] : c.filter(x => x !== p.id)); }} />
                                    <span className={ss("part-emoji")}>{p.emoji}</span>
                                    <span className={ss("part-text")}>
                                        <span className={ss("part-name")}>{p.name}</span>
                                        <span className={ss("sub")}>{p.id === "look" ? [d.look, d.accent].filter(Boolean).join(" · ") : p.id === "dock" ? d.dock : d.features}</span>
                                    </span>
                                </label>
                            ))}
                            <span className={cl("hint")}>Nothing personal is included — no chats, channels, webhooks or accounts. Plugins in your dock that your friend doesn't have are skipped on their side.</span>
                        </div>
                        {tooLong && <div className={cl("error")}>That's too much for one message — leave something out (features usually take the most room).</div>}
                        <div className={cl("footer")}>
                            <button type="button" className={cl("btn")} disabled={!parts.length} onClick={() => copyWithToast(text.match(/sset1\.[A-Za-z0-9_-]+/)?.[0] ?? "", "Setup code copied")}>Copy code</button>
                            <span className={cl("spacer")} />
                            <button type="button" className={cl("btn")} onClick={modalProps.onClose}>Cancel</button>
                            <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!parts.length || tooLong || !channelId} onClick={send}>Send to this chat</button>
                        </div>
                    </>
                ) : (
                    <>
                        <textarea className={cl("area")} rows={3} value={pasted} placeholder="Paste a setup code (sset1.…) or a whole shared-setup message" onChange={e => setPasted(e.currentTarget.value)} />
                        {imported === null && <div className={cl("error")}>That doesn't look like a Sonata setup code.</div>}
                        {imported && <SetupCard setup={imported} compact />}
                    </>
                )}
            </div>
        </Modal>
    );
}

export function openShareSetup() {
    openModal(props => <ShareModal modalProps={props} />);
}
