/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, useEffect, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { clearQuotes, formatQuotes, getQuotes, moveQuote, QUOTE_BUDGET, removeQuote, subscribe } from "./basket";

const cl = classNameFactory("vc-mquote-");

interface Options { store: { jumpLinks: boolean; timestamps: boolean; clearAfterInsert: boolean; }; }

function BasketModal({ modalProps, options }: { modalProps: RenderModalProps; options: Options; }) {
    const [, force] = useState(0);
    useEffect(() => subscribe(() => force(n => n + 1)), []);
    const quotes = getQuotes();
    const accent = windowAccent("multiQuote");
    const text = formatQuotes(quotes, options.store);

    const insert = () => {
        insertTextIntoChatInputBox(text);
        if (options.store.clearAfterInsert) clearQuotes();
        modalProps.onClose();
    };

    return (
        <Window {...modalProps} size="lg" title="Multi Quote"
            subtitle={quotes.length ? `${quotes.length} message${quotes.length === 1 ? "" : "s"} quoted` : "Nothing quoted yet"}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="❝" kicker="Multi Quote" title={quotes.length ? `${quotes.length} message${quotes.length === 1 ? "" : "s"} quoted` : "Nothing quoted yet"}
                    sub={quotes.length ? "Put them all in your message at once." : "Collect messages from any channel or DM, then quote them together."}
                    numbers={quotes.length ? [{ value: new Set(quotes.map(q => q.where)).size, label: "chats" }] : []} />
                {quotes.length === 0 ? (
                    <div className={cl("empty")}>
                        Hover a message and press the quote button (or right-click → Add to quote) to collect messages here — from any channel or DM.
                    </div>
                ) : (
                    <>
                        <div className={cl("list")}>
                            {quotes.map((q, i) => (
                                <div key={q.id} className={cl("item")}>
                                    <div className={cl("item-head")}>
                                        <span className={cl("item-author")}>{q.authorName}</span>
                                        <span className={cl("item-where")}>{q.where} · {new Date(q.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                                        <span className={cl("item-tools")}>
                                            <button type="button" className={cl("icon-btn")} disabled={i === 0} onClick={() => moveQuote(q.id, -1)} aria-label="Move up">↑</button>
                                            <button type="button" className={cl("icon-btn")} disabled={i === quotes.length - 1} onClick={() => moveQuote(q.id, 1)} aria-label="Move down">↓</button>
                                            <button type="button" className={classes(cl("icon-btn"), cl("icon-btn-danger"))} onClick={() => removeQuote(q.id)} aria-label="Remove">✕</button>
                                        </span>
                                    </div>
                                    <div className={cl("item-content")}>{q.content || <i>(no text)</i>}{q.attachments ? ` 📎 ${q.attachments}` : ""}</div>
                                </div>
                            ))}
                        </div>

                        <div className={cl("preview-label")}>
                            Will insert <span className={cl("chars")}>{text.length}/{QUOTE_BUDGET} characters</span> — long messages are shortened so you still have room to reply.
                        </div>
                        <pre className={cl("preview")}>{text}</pre>

                        <div className={cl("actions")}>
                            <button type="button" className={cl("btn")} onClick={clearQuotes}>Clear all</button>
                            <button type="button" className={classes(cl("btn"), cl("btn-primary"))} onClick={insert}>Insert into message</button>
                        </div>
                    </>
                )}
            </div>
        </Window>
    );
}

export function openBasket(options: Options) {
    openModal(props => <BasketModal modalProps={props} options={options} />);
}
