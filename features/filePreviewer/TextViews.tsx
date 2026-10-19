/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useMemo } from "@webpack/common";

import { guessDelimiter, parseCsv } from "./formats";
import { highlight } from "./highlight";

const cl = classNameFactory("vc-fprev-");
const MAX_ROWS = 2000;

export function TableView({ text, filename }: { text: string; filename: string; }) {
    const { rows, truncated } = useMemo(() => parseCsv(text, guessDelimiter(text, filename), MAX_ROWS + 1), [text, filename]);
    const [header, ...body] = rows;
    const width = Math.max(...rows.map(r => r.length));
    return (
        <>
            <div className={cl("table-wrap")}>
                <table className={cl("table")}>
                    <thead><tr><th className={cl("rownum")}>#</th>{Array.from({ length: width }, (_, i) => <th key={i}>{header?.[i] ?? ""}</th>)}</tr></thead>
                    <tbody>
                        {body.slice(0, MAX_ROWS).map((r, i) => (
                            <tr key={i}><td className={cl("rownum")}>{i + 1}</td>{Array.from({ length: width }, (_, j) => <td key={j}>{r[j] ?? ""}</td>)}</tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className={cl("meta")}>{Math.min(body.length, MAX_ROWS)} rows × {width} columns{truncated || body.length > MAX_ROWS ? ` · showing the first ${MAX_ROWS} rows` : ""}</div>
        </>
    );
}

/** Text with line numbers — and colours for code, when `ext` is a language Discord's highlighter knows. */
export function TextView({ text, wrap, ext, colours = true }: { text: string; wrap: boolean; ext?: string; colours?: boolean; }) {
    const lines = useMemo(() => text.split("\n").length, [text]);
    const html = useMemo(() => colours && ext ? highlight(text, ext) : null, [text, ext, colours]);
    return (
        <div className={classes(cl("code"), wrap && cl("code-wrap"))}>
            <div className={cl("gutter")} aria-hidden>{Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}</div>
            {html != null
                ? <pre className={classes(cl("lines"), cl("hl"))} dangerouslySetInnerHTML={{ __html: html }} />
                : <pre className={cl("lines")}>{text}</pre>}
        </div>
    );
}
