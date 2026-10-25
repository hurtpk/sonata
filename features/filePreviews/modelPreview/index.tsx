/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// 3D Model Preview: GLB / glTF, OBJ and STL attachments get a "View in 3D"
// card in chat — press it and the model appears, spinning gently; drag to
// turn it, scroll to zoom, double-click to reset. Nothing downloads until you
// ask (and never more than 50 MB).

import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { PluginNative } from "@utils/types";
import { useEffect, useRef, useState } from "@webpack/common";

import { MODEL_EXT, parseModel } from "./parse";
import { mountViewer, Viewer } from "./viewer";

const Native = VencordNative?.pluginHelpers?.Sonata as PluginNative<typeof import("../zipPreview/native")> | undefined;

const ATTACHMENTS = "https://cdn.discordapp.com/attachments/";

async function download(url: string): Promise<ArrayBuffer> {
    const clean = url.replace("media.discordapp.net/attachments/", "cdn.discordapp.com/attachments/");
    if (!clean.startsWith(ATTACHMENTS) || !Native?.fetchDiscordAttachment) throw new Error("This file can't be downloaded for a preview.");
    const res = await Native.fetchDiscordAttachment(clean.slice(ATTACHMENTS.length));
    if (!res.success || !res.data) throw new Error(res.error?.includes("too large") ? "This model is over 50 MB — too big to preview." : res.error ?? "Couldn't download it.");
    return res.data;
}

const sizeText = (b: number) => b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;

function ModelCard({ attachment }: { attachment: any; }) {
    const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [error, setError] = useState("");
    const [info, setInfo] = useState("");
    const [spin, setSpin] = useState(true);
    const canvas = useRef<HTMLCanvasElement>(null);
    const viewer = useRef<Viewer | null>(null);
    const [data, setData] = useState<{ buf: ArrayBuffer; } | null>(null);

    const load = async () => {
        setState("loading");
        try {
            setData({ buf: await download(attachment.url) });
        } catch (e: any) {
            setError(e?.message ?? String(e));
            setState("error");
        }
    };

    // Once downloaded and the canvas exists: read the model and show it.
    useEffect(() => {
        if (!data || !canvas.current) return;
        try {
            const mesh = parseModel(attachment.filename, data.buf);
            viewer.current = mountViewer(canvas.current, mesh);
            setInfo(`${mesh.triangles.toLocaleString()} triangles`);
            setState("ready");
        } catch (e: any) {
            setError(e?.message ?? String(e));
            setState("error");
        }
        return () => { viewer.current?.destroy(); viewer.current = null; };
    }, [data]);

    useEffect(() => { viewer.current?.setSpin(spin); }, [spin]);

    const ext = attachment.filename.match(MODEL_EXT)?.[1]?.toUpperCase();
    return (
        <div className="vc-m3d-card">
            <div className="vc-m3d-head">
                <span className="vc-m3d-badge">3D</span>
                <span className="vc-m3d-name" title={attachment.filename}>{attachment.filename}</span>
                <span className="vc-m3d-meta">{ext} · {sizeText(attachment.size ?? 0)}{info ? ` · ${info}` : ""}</span>
            </div>
            {state === "idle" && <button type="button" className="vc-m3d-open" onClick={load}>🧊 View in 3D</button>}
            {state === "loading" && !data && <div className="vc-m3d-status">Downloading…</div>}
            {state === "error" && <div className="vc-m3d-status vc-m3d-error">{error}</div>}
            {data && state !== "error" && (
                <>
                    <canvas ref={canvas} className="vc-m3d-canvas" />
                    <div className="vc-m3d-tools">
                        <span className="vc-m3d-hint">Drag to turn · scroll to zoom · double-click to reset</span>
                        <button type="button" onClick={() => setSpin(s => !s)}>{spin ? "⏸ Stop turning" : "▶ Turn"}</button>
                        <button type="button" onClick={() => viewer.current?.reset()}>↺ Reset</button>
                    </div>
                </>
            )}
        </div>
    );
}

const Card = ErrorBoundary.wrap(ModelCard, { noop: true });

export default definePlugin({
    name: "ModelPreview",
    description: "GLB / glTF, OBJ and STL attachments get a \"View in 3D\" card in chat — the model spins gently; drag to turn, scroll to zoom, double-click to reset. Nothing downloads until you press it.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    renderMessageAccessory: ({ message }: Record<string, any>) => {
        const models = [...(message?.attachments ?? [])].filter((a: any) => MODEL_EXT.test(a.filename ?? ""));
        if (!models.length) return null;
        return <>{models.slice(0, 4).map((a: any) => <Card key={a.id} attachment={a} />)}</>;
    },
});
