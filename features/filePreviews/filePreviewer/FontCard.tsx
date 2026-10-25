/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A font sent in chat shows a little card: its own name and a line written in
// it, so you can see what it looks like without opening anything. It's only
// fetched once the message is on screen, and only for fonts up to 5 MB.

import { useEffect, useRef, useState } from "@webpack/common";

import { getBytes } from "../../_shared/media";
import { readFontInfo } from "./fontInfo";
import { formatSize } from "./formats";
import { FileRef, preview } from "./Viewer";

const MAX = 5 * 1048576;
let seq = 0;

export function FontCard({ file }: { file: FileRef; }) {
    const box = useRef<HTMLButtonElement>(null);
    const [visible, setVisible] = useState(false);
    const [font, setFont] = useState<{ family: string; name?: string; style?: string; } | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: "200px" });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    useEffect(() => {
        if (!visible || file.size > MAX) return;
        let face: FontFace | null = null, alive = true;
        void (async () => {
            try {
                const bytes = await getBytes(file.url, MAX);
                const info = readFontInfo(bytes);
                const family = `vc-fprev-card-${seq++}`;
                face = new FontFace(family, bytes.slice().buffer);
                await face.load();
                if (!alive) return;
                document.fonts.add(face);
                setFont({ family, name: info.family ?? info.fullName, style: info.style });
            } catch { if (alive) setFailed(true); }
        })();
        return () => { alive = false; if (face) document.fonts.delete(face); };
    }, [visible, file.url]);

    const fallbackName = file.filename.replace(/\.[^.]+$/, "");
    return (
        <button ref={box} type="button" className="vc-fprev-fontcard" onClick={() => preview(file)} title={`Preview ${file.filename}`}>
            <span className="vc-fprev-fontcard-sample" style={font ? { fontFamily: `"${font.family}"` } : undefined}>
                {font ? "The quick brown fox jumps over the lazy dog" : failed ? "This font couldn't be read" : file.size > MAX ? "Too big to show here — open it to see" : "Loading the font…"}
            </span>
            <span className="vc-fprev-fontcard-meta">
                <b>{font?.name ?? fallbackName}</b>
                {font?.style && <span>{font.style}</span>}
                <span>{file.filename.split(".").pop()?.toUpperCase()} · {formatSize(file.size)}</span>
                <span className="vc-fprev-fontcard-open">Preview</span>
            </span>
        </button>
    );
}
