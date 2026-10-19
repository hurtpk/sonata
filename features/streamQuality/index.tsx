/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./style.css";

import { migrateSettingsFromPlugin } from "@api/Settings";
import { debounce } from "@shared/debounce";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { ModalProps, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Modal, React, showToast, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { defineFeatureSettings } from "../../featureSettings";

const MediaEngineStore = findByPropsLazy("getMediaEngine");
const cl = classNameFactory("vc-sq-");
const tl = classNameFactory("vc-tool-");

const MAX_PREVIEW_KB = 200;
const MAX_PREVIEW_BYTES = MAX_PREVIEW_KB * 1024;
const PREVIEW_OUT_W = 1280;
const PREVIEW_OUT_H = 720;
const CROP_STAGE_W = 560;
const CROP_STAGE_H = 360;
const CROP_FRAME_W = 480;
const CROP_FRAME_H = Math.round(CROP_FRAME_W * 9 / 16);
const CROP_FRAME_LEFT = (CROP_STAGE_W - CROP_FRAME_W) / 2;
const CROP_FRAME_TOP = (CROP_STAGE_H - CROP_FRAME_H) / 2;

function applyQualityNow() {
    const engine = MediaEngineStore?.getMediaEngine?.();
    if (!engine?.eachConnection) return false;
    let applied = false;
    engine.eachConnection((conn: any) => {
        if (conn.context === "stream" && conn.hasDesktopSource?.() && conn.setDesktopEncodingOptions) {
            const w = parse(settings.store.resolution) ?? 1080;
            const h = Math.round(w * 16 / 9);
            const f = parse(settings.store.fps) ?? 60;
            conn.setDesktopEncodingOptions(h, w, f);
            applied = true;
        }
    });
    return applied;
}

// Settings only hit the encoder on the next stream start otherwise, so changing FPS/res
// mid-stream looks like nothing happened. Re-push to the live stream on change, debounced
// so typing "240" doesn't briefly drive the encoder through 2 → 24 → 240.
const reapplyLive = debounce(applyQualityNow, 300);

migrateSettingsFromPlugin("StreamQuality", "StreamPreview", "streamPreview", "fakePreview");

export const settings = defineFeatureSettings("streamQuality", {
    openInterface: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <OpenInterfaceButton />,
    },
    active: {
        description: "Stream quality override active.",
        type: OptionType.BOOLEAN,
        default: true,
    },
    resolution: {
        description: "Stream resolution height (0 for default).",
        type: OptionType.STRING,
        default: "0",
        onChange: reapplyLive,
    },
    fps: {
        description: "Stream FPS (0 for default).",
        type: OptionType.STRING,
        default: "0",
        onChange: reapplyLive,
    },
    bitrate: {
        description: "Stream bitrate in kbps (0 for default).",
        type: OptionType.STRING,
        default: "0",
        onChange: reapplyLive,
    },
    spoofResolution: {
        description: "Spoof stream resolution badge (0 to disable).",
        type: OptionType.STRING,
        default: "0",
    },
    spoofFps: {
        description: "Spoof stream FPS badge (0 to disable).",
        type: OptionType.STRING,
        default: "0",
    },
    streamPreview: {
        description: "Replace screenshare thumbnail with a custom image.",
        type: OptionType.BOOLEAN,
        default: false,
    },
    fakePreview: {
        description: "Custom preview image (base64 data URL).",
        type: OptionType.STRING,
        default: "",
        // A multi-KB base64 string isn't editable by hand — set it from the
        // Preview tab of the Stream Quality window instead.
        hidden: true,
    },
});

function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
    });
}

function CropPanel({ srcDataUrl, onSave, onCancel }: { srcDataUrl: string; onSave: (dataUrl: string) => void; onCancel: () => void; }) {
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const [imgSize, setImgSize] = React.useState({ w: 0, h: 0 });
    const [scale, setScale] = React.useState(1);
    const [pos, setPos] = React.useState({ x: 0, y: 0 });
    const minScaleRef = React.useRef(1);
    const dragRef = React.useRef<{ startX: number; startY: number; origX: number; origY: number; } | null>(null);

    React.useEffect(() => {
        const img = new Image();
        img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = srcDataUrl;
    }, [srcDataUrl]);

    React.useEffect(() => {
        if (imgSize.w === 0 || imgSize.h === 0) return;
        const cover = Math.max(CROP_FRAME_W / imgSize.w, CROP_FRAME_H / imgSize.h);
        minScaleRef.current = cover;
        setScale(cover);
        setPos({
            x: (CROP_STAGE_W - imgSize.w * cover) / 2,
            y: (CROP_STAGE_H - imgSize.h * cover) / 2,
        });
    }, [imgSize.w, imgSize.h]);

    const clampPos = (x: number, y: number, s: number) => {
        const iw = imgSize.w * s;
        const ih = imgSize.h * s;
        const maxX = CROP_FRAME_LEFT;
        const minX = CROP_FRAME_LEFT + CROP_FRAME_W - iw;
        const maxY = CROP_FRAME_TOP;
        const minY = CROP_FRAME_TOP + CROP_FRAME_H - ih;
        return {
            x: Math.max(minX, Math.min(maxX, x)),
            y: Math.max(minY, Math.min(maxY, y)),
        };
    };

    const onMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    };
    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        setPos(clampPos(dragRef.current.origX + dx, dragRef.current.origY + dy, scale));
    };
    const endDrag = () => { dragRef.current = null; };

    const onWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const minS = minScaleRef.current;
        const newScale = Math.max(minS, Math.min(minS * 3, scale * factor));
        const dx = (cx - pos.x) / scale;
        const dy = (cy - pos.y) / scale;
        setScale(newScale);
        setPos(clampPos(cx - dx * newScale, cy - dy * newScale, newScale));
    };

    const handleSave = () => {
        if (imgSize.w === 0) return;
        const sx = (CROP_FRAME_LEFT - pos.x) / scale;
        const sy = (CROP_FRAME_TOP - pos.y) / scale;
        const sw = CROP_FRAME_W / scale;
        const sh = CROP_FRAME_H / scale;
        const canvas = document.createElement("canvas");
        canvas.width = PREVIEW_OUT_W;
        canvas.height = PREVIEW_OUT_H;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, PREVIEW_OUT_W, PREVIEW_OUT_H);
            let quality = 0.85;
            let result = canvas.toDataURL("image/jpeg", quality);
            while (result.length > MAX_PREVIEW_BYTES * 1.36 && quality > 0.25) {
                quality -= 0.1;
                result = canvas.toDataURL("image/jpeg", quality);
            }
            onSave(result);
        };
        img.src = srcDataUrl;
    };

    const sliderValue = minScaleRef.current > 0 ? scale / minScaleRef.current : 1;

    return (
        <div className={cl("crop")}>
            <div
                ref={viewportRef}
                className={cl("crop-viewport")}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={endDrag}
                onWheel={onWheel}
                style={{ width: CROP_STAGE_W, height: CROP_STAGE_H }}
            >
                <img
                    className={cl("crop-img")}
                    src={srcDataUrl}
                    draggable={false}
                    style={{
                        transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                        transformOrigin: "0 0",
                        width: imgSize.w || "auto",
                        height: imgSize.h || "auto",
                    }}
                />
                <div
                    className={cl("crop-frame")}
                    style={{
                        left: CROP_FRAME_LEFT,
                        top: CROP_FRAME_TOP,
                        width: CROP_FRAME_W,
                        height: CROP_FRAME_H,
                    }}
                />
            </div>
            <div className={tl("footer")}>
                <span className={tl("hint")}>Drag to move · scroll or slide to zoom</span>
                <input type="range" min={1} max={3} step={0.02} value={sliderValue} className={classes(tl("range"), cl("zoom"))}
                    onChange={e => {
                        const t = parseFloat(e.target.value);
                        const newScale = minScaleRef.current * t;
                        setScale(newScale);
                        setPos(p => clampPos(p.x, p.y, newScale));
                    }} />
            </div>
            <div className={tl("footer")}>
                <span className={tl("spacer")} />
                <button type="button" className={tl("btn")} onClick={onCancel}>Cancel</button>
                <button type="button" className={classes(tl("btn"), tl("primary"))} onClick={handleSave}>Use this crop</button>
            </div>
        </div>
    );
}

/** On / off, as a clear switch at the top of each tab. */
function Status({ on, onText, offText, onToggle }: { on: boolean; onText: string; offText: string; onToggle(): void; }) {
    return (
        <div className={classes(tl("section"), cl("status"), on && cl("status-on"))}>
            <span className={cl("dot")} />
            <span className={cl("status-text")}>{on ? onText : offText}</span>
            <span className={tl("spacer")} />
            <button type="button" className={classes(tl("btn"), !on && tl("primary"))} onClick={onToggle}>{on ? "Turn off" : "Turn on"}</button>
        </div>
    );
}

function Num({ label, value, placeholder, onChange, unit }: { label: string; value: string; placeholder: string; onChange(v: string): void; unit?: string; }) {
    return (
        <label className={tl("field")}>
            <span className={tl("label")}>{label}</span>
            <span className={cl("num")}>
                <input className={tl("input")} inputMode="numeric" value={value} placeholder={placeholder} onChange={e => onChange(e.currentTarget.value)} />
                {unit && <span className={cl("unit")}>{unit}</span>}
            </span>
        </label>
    );
}

const RES = [["0", "Discord's"], ["720", "720p"], ["1080", "1080p"], ["1440", "1440p"], ["2160", "4K"]] as const;
const FPS = [["0", "Discord's"], ["30", "30"], ["60", "60"], ["120", "120"], ["144", "144"]] as const;

function QualityTab({ refresh }: { refresh: () => void; }) {
    const set = (k: "resolution" | "fps" | "bitrate" | "spoofResolution" | "spoofFps", v: string) => { settings.store[k] = v; refresh(); };
    return (
        <>
            <Status on={!!settings.store.active} onText="Quality overrides are on" offText="Quality overrides are off" onToggle={() => { settings.store.active = !settings.store.active; refresh(); }} />

            <section className={tl("section")}>
                <h3 className={tl("section-title")}>🎥 Your stream</h3>
                <span className={tl("label")}>Resolution</span>
                <div className={tl("chips")}>
                    {RES.map(([v, l]) => <button key={v} type="button" className={classes(tl("chip"), (settings.store.resolution || "0") === v && tl("chip-on"))} onClick={() => set("resolution", v)}>{l}</button>)}
                </div>
                <span className={tl("label")}>Frames per second</span>
                <div className={tl("chips")}>
                    {FPS.map(([v, l]) => <button key={v} type="button" className={classes(tl("chip"), (settings.store.fps || "0") === v && tl("chip-on"))} onClick={() => set("fps", v)}>{l}</button>)}
                </div>
                <div className={tl("grid2")}>
                    <Num label="Exact resolution (height)" value={settings.store.resolution} placeholder="1080" onChange={v => set("resolution", v)} unit="p" />
                    <Num label="Exact FPS" value={settings.store.fps} placeholder="60" onChange={v => set("fps", v)} unit="fps" />
                    <Num label="Bitrate" value={settings.store.bitrate} placeholder="8000" onChange={v => set("bitrate", v)} unit="kbps" />
                </div>
                <span className={tl("hint")}>0 means Discord's own setting. Changes apply to a stream that's running, and to the next one you start.</span>
            </section>

            <section className={tl("section")}>
                <h3 className={tl("section-title")}>🏷️ Quality badge others see</h3>
                <div className={tl("grid2")}>
                    <Num label="Show resolution as" value={settings.store.spoofResolution} placeholder="0 = off" onChange={v => set("spoofResolution", v)} unit="p" />
                    <Num label="Show FPS as" value={settings.store.spoofFps} placeholder="0 = off" onChange={v => set("spoofFps", v)} unit="fps" />
                </div>
                <span className={tl("hint")}>Only changes the label on your stream — not its real quality.</span>
            </section>
        </>
    );
}

function PreviewTab({ onPickFile, refresh }: { onPickFile: () => void; refresh: () => void; }) {
    const preview = settings.store.fakePreview;
    const enabled = settings.store.streamPreview;
    return (
        <>
            <Status on={!!enabled} onText="Your own preview picture is on" offText="Using your real stream preview" onToggle={() => { settings.store.streamPreview = !settings.store.streamPreview; refresh(); }} />
            <section className={tl("section")}>
                <h3 className={tl("section-title")}>🖼️ Preview picture</h3>
                {preview ? (
                    <>
                        <div className={classes(tl("stage"), cl("preview"))}><img src={preview} alt="Stream preview" /></div>
                        <div className={tl("footer")}>
                            <span className={tl("spacer")} />
                            <button type="button" className={classes(tl("btn"), tl("danger"))} onClick={() => { settings.store.fakePreview = ""; refresh(); }}>Remove</button>
                            <button type="button" className={tl("btn")} onClick={onPickFile}>Change picture</button>
                        </div>
                    </>
                ) : (
                    <button type="button" className={classes(tl("empty"), cl("drop"))} onClick={onPickFile}>
                        <span className={tl("empty-icon")}>🖼️</span>
                        <b>Choose a picture</b>
                        <span>Cropped to 16:9 · {PREVIEW_OUT_W}×{PREVIEW_OUT_H} · up to {MAX_PREVIEW_KB} KB</span>
                    </button>
                )}
                <span className={tl("hint")}>Shown instead of your screen-share thumbnail.</span>
            </section>
        </>
    );
}

function StreamQualityModal({ modalProps }: { modalProps: ModalProps; }) {
    const [, forceUpdate] = useState(0);
    const refresh = () => forceUpdate(n => n + 1);
    const [tab, setTab] = useState<"quality" | "preview">("quality");
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const startUpload = async (file: File) => {
        if (!file.type.startsWith("image/")) {
            showToast("Please choose an image file", "failure");
            return;
        }
        try {
            const dataUrl = await readFileAsDataURL(file);
            setCropSrc(dataUrl);
        } catch {
            showToast("Failed to read image", "failure");
        }
    };

    const accent = windowAccent("streamQuality");
    return (
        <Modal {...modalProps} size="lg" title="Stream Quality" subtitle="Your screen-share's quality, its badge and its preview picture">
            <div className={classes(tl("wrap"), cl("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={tl("tabs")}>
                    {([["quality", "🎥 Quality"], ["preview", "🖼️ Preview picture"]] as const).map(([id, label]) => (
                        <button key={id} type="button" className={classes(tl("tab"), tab === id && tl("tab-on"))} onClick={() => setTab(id)}>{label}</button>
                    ))}
                </div>
                {tab === "quality" && <QualityTab refresh={refresh} />}
                {tab === "preview" && (
                    cropSrc ? (
                        <CropPanel
                            srcDataUrl={cropSrc}
                            onSave={dataUrl => {
                                settings.store.fakePreview = dataUrl;
                                setCropSrc(null);
                                refresh();
                                showToast("Preview picture set", "success");
                            }}
                            onCancel={() => setCropSrc(null)}
                        />
                    ) : (
                        <PreviewTab onPickFile={() => fileInputRef.current?.click()} refresh={refresh} />
                    )
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                    style={{ display: "none" }}
                    onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) startUpload(file);
                        e.target.value = "";
                    }}
                />
                <div className={tl("footer")}>
                    <span className={tl("spacer")} />
                    {tab === "quality" && (
                        <button type="button" className={tl("btn")} onClick={() => {
                            if (applyQualityNow()) showToast("Applied to your stream", "success");
                            else showToast("You're not streaming right now", "failure");
                        }}>Apply to my stream now</button>
                    )}
                    <button type="button" className={classes(tl("btn"), tl("primary"))} onClick={modalProps.onClose}>Done</button>
                </div>
            </div>
        </Modal>
    );
}

// The Stream Quality window (Quality / Preview tabs). Exposed as
// openSettingsModal, the custom-interface hook ChannelSettings looks for:
// a dock button added from its Dock tab opens this window, and its Plugins
// tab shows an "open" button for it. On/off lives in the window's Quality
// tab (the old dock left-click toggle).
function openStreamQualityModal() {
    openModal(mp => <StreamQualityModal modalProps={mp} />);
}

function OpenInterfaceButton() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <button type="button" className="vc-tool-btn vc-tool-primary" onClick={openStreamQualityModal}>Open Stream Quality</button>
            <span className="vc-tool-hint" style={{ margin: 0 }}>
                Quality overrides, badge spoofing, and the custom preview image.
            </span>
        </div>
    );
}

function parse(val: string) {
    const v = parseInt(val);
    return isFinite(v) && v > 0 ? v : undefined;
}

export default definePlugin({
    name: "StreamQuality",
    description: "Override stream resolution, FPS, and bitrate. Spoof quality badges and screenshare thumbnail.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: openStreamQualityModal,

    get spoofRes() { return parse(settings.store.spoofResolution); },
    get spoofFps() { return parse(settings.store.spoofFps); },

    getActualFps() { return settings.store.active ? parse(settings.store.fps) : undefined; },
    getActualResolution() { return settings.store.active ? parse(settings.store.resolution) : undefined; },
    getActualWidth() { const h = this.getActualResolution(); return h ? Math.round(h * 16 / 9) : undefined; },
    getActualBitrate() { const v = settings.store.active ? parse(settings.store.bitrate) : undefined; return v ? v * 1000 : undefined; },

    getStreamFps() { return this.getActualFps() ?? 60; },
    getStreamWidth() { return this.getActualWidth() ?? 1920; },
    getStreamHeight() { return this.getActualResolution() ?? 1080; },
    getStreamPixelCount() { return this.getStreamWidth() * this.getStreamHeight(); },
    getStreamBitrateTarget() { return this.getActualBitrate() ?? 8000000; },
    getStreamBitrateMin() { const br = this.getActualBitrate(); return br ? Math.round(br * 0.5) : 3500000; },
    getStreamBitrateMax() { return this.getStreamBitrateTarget(); },

    normalizeGoLiveQuality(quality: any) {
        if (!this.getActualFps() && !this.getActualResolution() && !this.getActualBitrate()) return quality;
        const w = this.getStreamWidth(), h = this.getStreamHeight(), f = this.getStreamFps();
        return {
            ...quality,
            bitrateTarget: this.getActualBitrate() ?? quality?.bitrateTarget,
            capture: { ...quality?.capture, width: w, height: h, framerate: f },
            encode: { ...quality?.encode, width: w, height: h, framerate: f, pixelCount: w * h },
        };
    },

    coerceResolution(value: any) {
        if (!this.getActualResolution() || typeof value !== "object" || value == null) return value;
        const next = { ...value };
        if ((next.width ?? 0) <= 0) next.width = this.getStreamWidth();
        if ((next.height ?? 0) <= 0) next.height = this.getStreamHeight();
        return next;
    },

    coerceFrameRate(value: any) {
        if (!this.getActualFps()) return value;
        return (typeof value === "number" && value > 0) ? value : this.getStreamFps();
    },

    makeSelfResolution(settingValue: any) {
        if (!this.getActualResolution()) return { height: settingValue ?? 1080, width: 0, type: 0 };
        return { height: this.getStreamHeight(), width: this.getStreamWidth(), type: 0 };
    },

    getDisplayResolution(value: any) {
        if (typeof value !== "object" || value == null) return 0;
        const h = value.height ?? 0, w = value.width ?? 0;
        return h > 0 && w > 0 ? Math.max(h, Math.round(w * 9 / 16)) : h;
    },

    spoofQuality(real: any) {
        const v = this.spoofRes;
        if (!v) return real;
        return { type: 1, width: Math.round(v * 16 / 9), height: v };
    },

    spoofFpsVal(real: number) { return this.spoofFps ?? real; },

    patchStreamParams(params: any) {
        const res = this.spoofRes, fps = this.spoofFps;
        if (!res && !fps) return params;
        if (!Array.isArray(params)) return params;
        for (const p of params) {
            if (res && p.maxResolution) p.maxResolution = { ...p.maxResolution, width: Math.round(res * 16 / 9), height: res };
            if (fps) p.maxFrameRate = fps;
        }
        return params;
    },

    preview(input: string) {
        if (!settings.store.streamPreview) return input;
        const custom = settings.store.fakePreview?.trim();
        return custom || input;
    },

    patches: [
        {
            find: "setDesktopEncodingOptions(",
            replacement: {
                match: /setDesktopEncodingOptions\((\i),(\i),(\i)\)\{/,
                replace: "setDesktopEncodingOptions($1,$2,$3){if(this.destroyed)return;$1=$self.getStreamWidth();$2=$self.getStreamHeight();$3=$self.getStreamFps();",
            }
        },
        {
            find: "captureVideoFrameRate=n.capture.framerate",
            replacement: {
                match: /remoteSinkWantsMaxFramerate=\i\.encode\.framerate/,
                replace: "remoteSinkWantsMaxFramerate=$self.getStreamFps()",
            }
        },
        {
            find: "updateRemoteWantsFramerate(){",
            replacement: {
                match: /updateRemoteWantsFramerate\(\)\{/,
                replace: "$&this.connection.remoteSinkWantsMaxFramerate=$self.getStreamFps(),",
            }
        },
        {
            find: "setSDP(e){}setRemoteVideoSinkWants(",
            replacement: {
                match: /setRemoteVideoSinkWants\((\i)\)\{.{0,80}updateVideoQuality\((\i)\.(\i)\)\}/,
                replace: "setRemoteVideoSinkWants($1){this.remoteVideoSinkWants=$1,this.remoteSinkWantsMaxFramerate=$self.getStreamFps(),this.updateVideoQuality($2.$3)}",
            }
        },
        {
            find: "videoCapture.width",
            replacement: {
                match: /width:this\.options\.videoCapture\.width,height:this\.options\.videoCapture\.height,framerate:this\.options\.videoCapture\.framerate/,
                replace: "capture:{width:$self.getStreamWidth(),height:$self.getStreamHeight(),framerate:$self.getStreamFps()}",
            }
        },
        {
            find: "setGoliveQuality(",
            replacement: {
                match: /setGoliveQuality\((\i)\)\{/,
                replace: "setGoliveQuality($1){$1=$self.normalizeGoLiveQuality($1);",
            }
        },
        {
            find: "mediaEngineConnectionId=`WebRTC-",
            replacement: {
                match: /maxFrameRate:\i\.capture\?\.framerate,maxResolution:\{type:(\i)\.(\i)\.FIXED[^}]{0,80}\}/,
                replace: "maxFrameRate:$self.getStreamFps(),maxResolution:{type:$1.$2.FIXED,width:$self.getStreamWidth(),height:$self.getStreamHeight()}",
            }
        },
        {
            find: ".encodingVideoMinBitRate=",
            replacement: [
                {
                    match: /(\i)\.remoteSinkWantsPixelCount=\i\.encode\.pixelCount/,
                    replace: "$1.remoteSinkWantsPixelCount=$self.getStreamPixelCount()",
                },
                {
                    match: /null!=\i\.bitrateTarget\?(\i)\.encodingVideoBitRate=\i\.bitrateTarget:\1\.encodingVideoBitRate=\i\.bitrateMax/,
                    replace: "$1.encodingVideoBitRate=$self.getStreamBitrateTarget()",
                },
                {
                    match: /(\i)\.encodingVideoMinBitRate=\i\.bitrateMin/,
                    replace: "$1.encodingVideoMinBitRate=$self.getStreamBitrateMin()",
                },
                {
                    match: /(\i)\.encodingVideoMaxBitRate=\i\.bitrateMax/,
                    replace: "$1.encodingVideoMaxBitRate=$self.getStreamBitrateMax()",
                },
            ],
        },
        {
            find: "canStreamQuality:function",
            replacement: {
                match: /canStreamQuality:function\((\i),(\i)\)\{return"high"===\1\?[^}]{0,60}\}/,
                replace: "canStreamQuality:function($1,$2){return!0}",
            }
        },
        {
            find: "\"canStreamWithSettings\"",
            replacement: {
                match: /\}\)\.allowAutoQuality;/,
                replace: "$&return!0;",
            }
        },
        {
            find: "\"useMaxQuality\"",
            replacement: {
                match: /maxFrameRate:(\i)\.fps,maxResolution:\(0,\i\.\i\)\("useMaxQuality",\i,\{height:\1\.resolution[^}]{0,80}\},\1\.fps\)/,
                replace: "maxFrameRate:$self.getStreamFps(),maxResolution:$self.makeSelfResolution($1.resolution)",
            }
        },
        {
            find: "\"useMaxQuality\"",
            replacement: {
                match: /resolution:(\i)\.height/,
                replace: "resolution:$self.getDisplayResolution($1)",
            }
        },
        {
            find: "ChannelRTCStore\");",
            replacement: {
                match: /updateParticipantQuality\((\i),(\i),(\i)\)/,
                replace: "updateParticipantQuality($1,$self.coerceResolution($2),$self.coerceFrameRate($3))",
            }
        },
        {
            find: "VideoSourceQualityChanged,this.guildId",
            replacement: [
                {
                    match: /this\.sendVideo\((\i)\?\?0,(\i)\?\?0,(\i)\?\?0,(\i)\)/,
                    replace: "this.sendVideo($1??0,$2??0,$3??0,$self.patchStreamParams($4))",
                },
                {
                    match: /(\i)\.maxResolution,(\i)\.maxFrameRate,this\.context\)/,
                    replace: "$self.spoofQuality($1.maxResolution),$self.spoofFpsVal($2.maxFrameRate),this.context)",
                },
            ],
        },
        {
            find: "\"ApplicationStreamPreviewUploadManager\"",
            replacement: {
                match: /thumbnail:([^,}]+)/,
                replace: "thumbnail:$self.preview($1)",
            },
        },
        {
            find: "\"ApplicationStreamPreviewUploadManager\"",
            replacement: {
                // \i, not \w+: Discord's minified names can have a $ in them (it's "Y$" now).
                match: /(let \i=)(\i\.toDataURL\(["']image\/jpeg["']\));/,
                replace: "$1$self.preview($2);",
            },
        },
    ],
});
