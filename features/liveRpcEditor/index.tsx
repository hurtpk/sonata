/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./style.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { getCurrentChannel } from "@utils/discord";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { extractAndLoadChunksLazy, findByCodeLazy, findComponentByCodeLazy, findStoreLazy } from "@webpack";

import { Window } from "../_shared/Window";
// Fetches activity metadata (e.g. button_urls) when Discord doesn't include it in presence
const getMetadataFromApi = findByCodeLazy("null/undefined") as ((activity: Activity, userId: string) => Promise<{ button_urls?: string[] } | null>) | undefined;
import { ModalProps, openModal } from "@utils/modal";
import type { Activity } from "@vencord/discord-types";
import { ApplicationAssetUtils, FluxDispatcher, Menu, React, ScrollerThin, showToast, useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { defineFeatureSettings } from "../../featureSettings";

const SOCKET_ID = "LiveRpcEditor";
const ACTIVITY_TYPES = [
    { label: "Playing", value: 0 },
    { label: "Streaming", value: 1 },
    { label: "Listening", value: 2 },
    { label: "Watching", value: 3 },
    { label: "Custom", value: 4 },
    { label: "Competing", value: 5 },
];
const SKIP_ACTIVITY_NAMES = ["Custom Status", "Spotify", "Hang Status"];

const useProfileThemeStyle = findByCodeLazy("profileThemeStyle:", "--profile-gradient-primary-color");
const ActivityView = findComponentByCodeLazy(".party?(0", "USER_PROFILE_ACTIVITY");
const UserProfilePopout = findComponentByCodeLazy("disableUserProfileLink", "disableAutoFocus");
// The full profile popout lives in a lazy chunk. Force-load it so the preview can render it
// immediately, instead of waiting for the user to open someone's profile first.
const requireProfilePopout = extractAndLoadChunksLazy(
    ["isNonUserBot()", "renderLoader:"],
    /Promise\.all\((\[[^\]]+?\])\)\.then\(\i\.bind\(\i,(\d+)\)\),webpackId:\d+,renderLoader:\i\.\i\}\);function/
);
const PresenceStore = findStoreLazy("PresenceStore") as { getActivities(userId: string): Activity[] };

const cl = classNameFactory("vc-liverpc-");
const tl = classNameFactory("vc-tool-");

function matchKb(e: KeyboardEvent, str: string): boolean {
    if (!str) return false;
    let ctrl = false, alt = false, shift = false, meta = false, key = "";
    for (const p of str.split("+").map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (p === "ctrl" || p === "control") ctrl = true;
        else if (p === "alt") alt = true;
        else if (p === "shift") shift = true;
        else if (p === "meta" || p === "cmd" || p === "super") meta = true;
        else key = p;
    }
    return !!key && ctrl === e.ctrlKey && alt === e.altKey && shift === e.shiftKey && meta === e.metaKey && e.key.toLowerCase() === key;
}

function TextInput({ value, onChange, placeholder, style }: { value: string; onChange(v: string): void; placeholder?: string; style?: React.CSSProperties; }) {
    return <input className={tl("input")} value={value} placeholder={placeholder} style={style} onChange={e => onChange(e.currentTarget.value)} />;
}

type BtnProps = { children: React.ReactNode; onClick?(): void; disabled?: boolean; color?: string; look?: string; size?: string; style?: React.CSSProperties; };
const Button = Object.assign(({ children, onClick, disabled, color, look, style }: BtnProps) => (
    <button type="button" disabled={disabled} onClick={onClick} style={style}
        className={look === "link" ? tl("icon") : classes(tl("btn"), color === "brand" && tl("primary"), color === "danger" && tl("danger"))}>
        {children}
    </button>
), {
    Sizes: { SMALL: "small", MEDIUM: "medium" },
    Looks: { FILLED: "filled", OUTLINED: "outlined", LINK: "link" },
    Colors: { BRAND: "brand", PRIMARY: "primary", DANGER: "danger", RED: "danger", GREEN: "brand" },
});

export const settings = defineFeatureSettings("liveRpcEditor", {
    // The editor used to open from the dock icon's right-click; without a
    // keybind set, this button is how you get to it from the settings page.
    openEditor: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <OpenEditorButton />,
    },
    previewSize: {
        type: OptionType.SELECT,
        description: "Size of the live preview panel in the editor modal.",
        options: [
            { label: "Small", value: "small", default: false },
            { label: "Medium", value: "medium", default: true },
            { label: "Large", value: "large", default: false },
        ],
    },
    // On/off for your custom presence. Also toggled from the pill in the
    // editor's header. Off means nothing is shown — edits in the editor are
    // still saved, just not pushed live — and it stays off across restarts.
    rpcActive: {
        type: OptionType.BOOLEAN,
        description: "RPC presence active.",
        default: true,
        onChange: (on: boolean) => applyRpcActive(on),
    },
    keybind: {
        type: OptionType.STRING,
        description: "Keybind to open the Live RPC Editor.",
        default: "",
    },
}).withPrivateSettings<{
    savedFormState: Record<string, unknown> | null;
    presets: Record<string, Record<string, unknown>>;
}>();

function emptyActivity(): Record<string, unknown> {
    return {
        name: "",
        application_id: "",
        state: "",
        state_url: "",
        details: "",
        details_url: "",
        type: 0,
        flags: 1,
        url: "",
        timestamps: undefined,
        assets: {},
        buttons: [],
        metadata: { button_urls: [] },
        status_display_type: undefined,
        party: undefined,
    };
}

function activityToFormState(act: Activity | Record<string, unknown>): Record<string, unknown> {
    const a = act as Record<string, unknown>;
    const rawButtons = Array.isArray(a.buttons) ? a.buttons : [];
    let buttons: string[] = [];
    let button_urls: string[] = Array.isArray((a.metadata as { button_urls?: string[] } | undefined)?.button_urls)
        ? [...(a.metadata as { button_urls: string[] }).button_urls]
        : [];
    if (rawButtons.length > 0) {
        if (typeof rawButtons[0] === "string") {
            buttons = [...(rawButtons as string[])];
        } else {
            const fromObjs: string[] = [];
            (rawButtons as { label?: string; url?: string }[]).forEach(b => {
                if (b?.label != null) buttons.push(String(b.label));
                if (b?.url != null) fromObjs.push(String(b.url));
            });

            if (fromObjs.length > 0) button_urls = fromObjs;
        }
    }
    // Streaming (type 1): Watch button uses the same URL as activity.url (Twitch/YouTube). Put it where it belongs.
    const streamUrl = (a as any).url?.trim?.();
    if (Number(a.type) === 1 && streamUrl) {
        if (button_urls.length === 0 && buttons.length > 0) button_urls = [streamUrl];
        else if (buttons.length === 0) {
            buttons = ["Watch"];
            button_urls = [streamUrl];
        }
    }
    const rawAssets = a.assets as Record<string, string> | undefined;
    const assets = rawAssets ? { ...rawAssets } : {};
    const explicit: Record<string, unknown> = {
        name: a.name ?? "",
        application_id: String(a.application_id ?? (act as any).applicationId ?? ""),
        state: a.state ?? "",
        state_url: (a as any).state_url ?? "",
        details: a.details ?? "",
        details_url: (a as any).details_url ?? "",
        type: a.type ?? 0,
        flags: a.flags ?? 1,
        url: (a as any).url ?? "",
        timestamps: a.timestamps ? { ...(a.timestamps as object) } : undefined,
        assets,
        buttons,
        metadata: { button_urls },
        status_display_type: (a as any).status_display_type ?? undefined,
        party: a.party ? { ...(a.party as object) } : undefined,
    };
    const passthroughKeys = ["id", "created_at", "session_id", "sync_id", "platform", "emoji"];
    for (const k of passthroughKeys) {
        if (a[k] !== undefined && a[k] !== null) explicit[k] = a[k];
    }
    return explicit;
}

function formStateToActivity(state: Record<string, unknown>): Activity | null {
    const name = String(state.name ?? "").trim();
    if (!name) return null;
    const activity: Activity = {
        name,
        type: Number(state.type) ?? 0,
        flags: Number(state.flags) ?? 1,
    };
    const appId = String(state.application_id ?? "").trim();
    if (appId) activity.application_id = appId;
    const stateStr = String(state.state ?? "").trim();
    if (stateStr) activity.state = stateStr;
    const stateUrl = String((state as any).state_url ?? "").trim();
    if (stateUrl) (activity as any).state_url = stateUrl;
    const details = String(state.details ?? "").trim();
    if (details) activity.details = details;
    const detailsUrl = String((state as any).details_url ?? "").trim();
    if (detailsUrl) (activity as any).details_url = detailsUrl;
    const streamUrl = (state.type as number) === 1 && (state as any).url ? String((state as any).url).trim() : "";
    if (streamUrl) activity.url = streamUrl;
    const ts = state.timestamps as { start?: number; end?: number } | undefined;
    if (ts && (ts.start != null || ts.end != null)) {
        activity.timestamps = {};
        if (ts.start != null) activity.timestamps.start = ts.start;
        if (ts.end != null) activity.timestamps.end = ts.end;
    }
    const assets = state.assets as Record<string, string> | undefined;
    if (assets && (assets.large_image || assets.small_image || assets.large_text || assets.small_text || assets.large_url || assets.small_url)) {
        activity.assets = {};
        if (assets.large_image) activity.assets.large_image = assets.large_image;
        if (assets.large_text) activity.assets.large_text = assets.large_text;
        if (assets.large_url) activity.assets.large_url = assets.large_url;
        if (assets.small_image) activity.assets.small_image = assets.small_image;
        if (assets.small_text) activity.assets.small_text = assets.small_text;
        if (assets.small_url) activity.assets.small_url = assets.small_url;
    }
    let buttons = (state.buttons as string[] | undefined)?.filter(Boolean) ?? [];
    let buttonUrls = ((state.metadata as any)?.button_urls as string[] | undefined)?.filter(Boolean) ?? [];
    if ((state.type as number) === 1 && streamUrl) {
        if (buttonUrls[0] !== streamUrl) {
            buttons = ["Watch", ...buttons.filter((_, i) => i > 0)];
            buttonUrls = [streamUrl, ...buttonUrls.filter((_, i) => i > 0)];
        }
    }
    if (buttons.length || buttonUrls.length) {
        activity.buttons = buttons.slice(0, 2);
        activity.metadata = { button_urls: buttonUrls.slice(0, 2) };
    }
    const statusDisplayType = (state as any).status_display_type;
    if (statusDisplayType != null) (activity as any).status_display_type = statusDisplayType;
    const party = state.party as { id?: string; size?: [number, number] } | undefined;
    if (party && (party.id || (Array.isArray(party.size) && party.size.length >= 2))) {
        activity.party = {};
        if (party.id) activity.party.id = party.id;
        if (Array.isArray(party.size) && party.size.length >= 2) activity.party.size = [Number(party.size[0]), Number(party.size[1])];
    }
    const passthroughKeys = ["id", "created_at", "session_id", "sync_id", "platform", "emoji"];
    for (const k of passthroughKeys) {
        const v = (state as Record<string, unknown>)[k];
        if (v !== undefined && v !== null) (activity as Record<string, unknown>)[k] = v;
    }
    return activity;
}

async function resolveAssetIds(activity: Activity): Promise<Activity> {
    const clone = JSON.parse(JSON.stringify(activity)) as Activity;
    const appId = clone.application_id;
    if (!appId || !clone.assets) return clone;
    try {
        if (clone.assets.large_image && !/^\d+$/.test(clone.assets.large_image) && !clone.assets.large_image.startsWith("mp:")) {
            const keys = await ApplicationAssetUtils.fetchAssetIds(appId, [clone.assets.large_image]);
            if (keys[0]) clone.assets.large_image = keys[0];
        }
        if (clone.assets.small_image && !/^\d+$/.test(clone.assets.small_image) && !clone.assets.small_image.startsWith("mp:")) {
            const keys = await ApplicationAssetUtils.fetchAssetIds(appId, [clone.assets.small_image]);
            if (keys[0]) clone.assets.small_image = keys[0];
        }
    } catch (_) {}
    return clone;
}

function dispatchActivity(activity: Activity | null) {
    const payload: any = { type: "LOCAL_ACTIVITY_UPDATE", socketId: SOCKET_ID };
    if (activity) {
        const clone = JSON.parse(JSON.stringify(activity)) as Activity;
        clone.id = clone.id ?? Array(18).fill(0).map(() => Math.floor(Math.random() * 10)).join("");
        if (!clone.metadata) clone.metadata = {};
        (clone.metadata as any).socketId = SOCKET_ID;
        payload.activity = clone;
    } else {
        payload.activity = null;
    }
    FluxDispatcher.dispatch(payload);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h3 className={tl("section-title")}>{children}</h3>;
}

function ProfilePreview({ activity }: { activity: Activity | null }) {
    const user = UserStore.getCurrentUser();
    const channel = getCurrentChannel();
    const [ready, setReady] = useState(false);

    // Force-load the lazy popout chunk on open, then render the real popout once it's available.
    useEffect(() => {
        let alive = true;
        requireProfilePopout().then(() => { if (alive) setReady(true); }).catch(() => { });
        return () => { alive = false; };
    }, []);

    const fallback = activity
        ? (
            <div className={cl("preview-fallback")}>
                <ActivityView user={user} currentUser={user} activity={activity} application={null} />
            </div>
        )
        : <div className={cl("preview-empty")}>Loading preview…</div>;

    if (!ready) return fallback;

    return (
        <ErrorBoundary fallback={() => fallback}>
            <UserProfilePopout
                user={user}
                currentUser={user}
                guildId={channel?.getGuildId()}
                channelId={channel?.id}
                openedAt={Date.now()}
                closePopout={() => { }}
                setPopoutRef={() => { }}
                disableUserProfileLink={true}
                disableAutoFocus={true}
            />
        </ErrorBoundary>
    );
}

function LiveRpcEditorModal({ modalProps }: { modalProps: ModalProps }) {
    const pendingMetadataRef = useRef<{ activity: Activity; userId: string } | null>(null);
    const [formState, setFormState] = useState<Record<string, unknown>>(() => {
        const p = pendingInitialActivity;
        const u = pendingInitialUserId;
        pendingInitialActivity = null;
        pendingInitialUserId = null;
        if (p && u) pendingMetadataRef.current = { activity: p, userId: u };
        if (p) return activityToFormState(p);
        const saved = settings.store.savedFormState;
        if (saved && typeof saved === "object" && typeof (saved as any).name === "string" && (saved as any).name.trim())
            return { ...saved };
        return emptyActivity();
    });
    const [cloneUserId, setCloneUserId] = useState("");
    const [cloneActivities, setCloneActivities] = useState<Activity[]>([]);
    const [cloneLoading, setCloneLoading] = useState(false);
    const [presetName, setPresetName] = useState("");
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { profileThemeStyle } = useProfileThemeStyle?.({}) ?? {};

    const activity = useMemo(() => formStateToActivity(formState), [formState]);
    const [active, setActive] = useState(!!settings.store.rpcActive);

    const saveFormNow = (state: Record<string, unknown>) => {
        try { settings.store.savedFormState = JSON.parse(JSON.stringify(state)); } catch { }
    };

    // Edits are always saved; they're only pushed to your live presence
    // while RPC is on. (Before, every edit went live regardless, so there
    // was no real way to keep it off while the editor was open.)
    useEffect(() => {
        if (!activity) {
            dispatchActivity(null);
            settings.store.savedFormState = null;
            return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            saveFormNow(formState);
            if (settings.store.rpcActive) resolveAssetIds(activity).then(dispatchActivity);
            debounceRef.current = null;
        }, 400);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [activity, formState]);

    const toggleActive = () => {
        const next = !settings.store.rpcActive;
        // Save the current form first, so turning on shows exactly what's in
        // the editor rather than the last debounced save.
        if (activity) {
            if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
            saveFormNow(formState);
        }
        settings.store.rpcActive = next;
        applyRpcActive(next);
        setActive(next);
    };

    // When opened from user context menu with an activity that has buttons but no URLs, fetch metadata from API
    useEffect(() => {
        const pending = pendingMetadataRef.current;
        if (!pending || !getMetadataFromApi) return;
        const buttons = (formState.buttons as string[]) ?? [];
        const urls = (formState.metadata as { button_urls?: string[] })?.button_urls ?? [];
        if (buttons.length === 0 || urls.length > 0) {
            pendingMetadataRef.current = null;
            return;
        }
        const applyUrls = (urls: string[]) => {
            if (urls?.length) {
                setFormState(prev => ({
                    ...prev,
                    metadata: { ...(prev.metadata as object), button_urls: urls },
                }));
            }
        };
        Promise.resolve()
            .then(async () => {
                if (getMetadataFromApi) {
                    const meta = await getMetadataFromApi(pending.activity, pending.userId);
                    if (meta?.button_urls?.length) return meta.button_urls;
                }
                if (typeof PresenceStore.getActivityMetadata === "function") {
                    const cached = PresenceStore.getActivityMetadata(pending.userId);
                    return cached?.button_urls ?? (pending.activity.id && cached?.[pending.activity.id]?.button_urls);
                }
                return null;
            })
            .then(urls => Array.isArray(urls) && urls.length > 0 && applyUrls(urls))
            .catch(() => {})
            .finally(() => { pendingMetadataRef.current = null; });
    }, []);

    useEffect(() => {
        if ((formState.type as number) !== 1) return;
        const url = String((formState as any).url ?? "").trim();
        if (!url) return;
        const buttons = (formState.buttons as string[]) ?? [];
        const urls = ((formState.metadata as any)?.button_urls as string[]) ?? [];
        if (buttons[0] || urls[0]) return;
        setFormState(prev => {
            const next = { ...prev };
            const prevButtons = [...((prev.buttons as string[]) ?? [])];
            const prevUrls = [...(((prev.metadata as any)?.button_urls as string[]) ?? [])];
            prevButtons[0] = "Watch";
            prevUrls[0] = url;
            (next as any).buttons = prevButtons;
            (next as any).metadata = { ...(prev.metadata as object), button_urls: prevUrls };
            return next;
        });
    }, [formState.type, (formState as any).url]);

    // Do NOT clear activity on modal close - only "Clear presence" or plugin stop clears it

    function updateField(path: string[], value: unknown) {
        setFormState(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            let cur: any = next;
            for (let i = 0; i < path.length - 1; i++) {
                const k = path[i];
                if (cur[k] == null) cur[k] = {};
                cur = cur[k];
            }
            cur[path[path.length - 1]] = value;
            return next;
        });
    }

    function loadUserActivities() {
        const uid = cloneUserId.trim();
        if (!uid) return;
        setCloneLoading(true);
        try {
            const activities = PresenceStore.getActivities(uid) ?? [];
            const filtered = activities.filter((a: Activity) => !SKIP_ACTIVITY_NAMES.includes(a.name));
            setCloneActivities(filtered);
        } finally {
            setCloneLoading(false);
        }
    }

    async function cloneActivity(act: Activity, sourceUserId?: string) {
        const state = activityToFormState(act);
        state.application_id = state.application_id || (act as any).application_id;
        const buttons = (state.buttons as string[]) ?? [];
        const urls = (state.metadata as { button_urls?: string[] })?.button_urls ?? [];
        if (buttons.length > 0 && urls.length === 0 && sourceUserId) {
            try {
                if (getMetadataFromApi) {
                    const meta = await getMetadataFromApi(act, sourceUserId);
                    if (meta?.button_urls?.length) {
                        state.metadata = { button_urls: meta.button_urls };
                    }
                }
                if (!(state.metadata as { button_urls?: string[] }).button_urls?.length && typeof PresenceStore.getActivityMetadata === "function") {
                    const cached = PresenceStore.getActivityMetadata(sourceUserId);
                    const resolved = cached?.button_urls ?? (act.id && cached?.[act.id]?.button_urls);
                    if (Array.isArray(resolved) && resolved.length > 0) {
                        state.metadata = { button_urls: resolved };
                    }
                }
            } catch (_) {}
        }
        setFormState(state);
        setCloneActivities([]);
    }

    const assets = (formState.assets as Record<string, string>) ?? {};
    const accent = windowAccent("liveRpcEditor");

    return (
        <Window {...modalProps} size="lg" title="Live RPC Editor" subtitle="Show any game or app as your activity — with images, buttons and timers">
            <div className={classes(tl("wrap"), cl("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
            <div className={tl("head")}>
                <span className={tl("label")}>Your custom activity</span>
                <button
                    type="button"
                    className={cl("status-toggle") + (active ? " " + cl("status-toggle-on") : "")}
                    onClick={toggleActive}
                    title={active ? "Click to disable your custom presence" : "Click to enable your custom presence"}
                    aria-pressed={active}
                >
                    <span className={cl("status-toggle-dot")} />
                    {active ? "Showing" : "Off"}
                </button>
            </div>
                <div className={cl("wrap")}>
                    <ScrollerThin className={cl("form-scroll")} orientation="vertical">
                        <div className={cl("form-inner")}>

                            {/* Two columns, both starting at the same level */}
                            <div className={cl("form-columns")}>
                                <div className={cl("form-col")}>
                                    <SectionTitle>Basic info</SectionTitle>
                                    <span className={classes(tl("label"), cl("label"))}>Application ID</span>
                                    <TextInput value={String(formState.application_id ?? "")} onChange={v => updateField(["application_id"], v)} placeholder="e.g. 123456789" />
                                    <span className={classes(tl("label"), cl("label"))}>Name *</span>
                                    <TextInput value={String(formState.name ?? "")} onChange={v => updateField(["name"], v)} placeholder="Game or app name" />
                                    <span className={classes(tl("label"), cl("label"))}>Type</span>
                                    <select className={tl("select")} value={String(formState.type ?? 0)} onChange={e => updateField(["type"], Number(e.currentTarget.value))}>
                                        {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                    <span className={classes(tl("label"), cl("label"))}>State</span>
                                    <TextInput value={String(formState.state ?? "")} onChange={v => updateField(["state"], v)} placeholder="e.g. In menu" />
                                    <span className={classes(tl("label"), cl("label"))}>State URL (clickable)</span>
                                    <TextInput value={String((formState as any).state_url ?? "")} onChange={v => updateField(["state_url"], v)} placeholder="https://..." />
                                    <span className={classes(tl("label"), cl("label"))}>Details</span>
                                    <TextInput value={String(formState.details ?? "")} onChange={v => updateField(["details"], v)} placeholder="e.g. Level 42" />
                                    <span className={classes(tl("label"), cl("label"))}>Details URL (clickable)</span>
                                    <TextInput value={String((formState as any).details_url ?? "")} onChange={v => updateField(["details_url"], v)} placeholder="https://..." />
                                    {(formState.type as number) === 1 && (
                                        <>
                                            <span className={classes(tl("label"), cl("label"))}>Stream URL</span>
                                            <TextInput value={String((formState as any).url ?? "")} onChange={v => updateField(["url"], v)} placeholder="https://twitch.tv/..." />
                                        </>
                                    )}

                                    <hr className={cl("divider")} />

                                    <SectionTitle>Timestamps</SectionTitle>
                                    <div className={cl("field-row")}>
                                        <div>
                                            <span className={classes(tl("label"), cl("label"))}>Start (ms)</span>
                                            <TextInput
                                                value={String((formState.timestamps as any)?.start ?? "")}
                                                onChange={v => updateField(["timestamps", "start"], v ? Number(v) : undefined)}
                                                placeholder="e.g. 1713200000000"
                                            />
                                        </div>
                                        <div>
                                            <span className={classes(tl("label"), cl("label"))}>End (ms)</span>
                                            <TextInput
                                                value={String((formState.timestamps as any)?.end ?? "")}
                                                onChange={v => updateField(["timestamps", "end"], v ? Number(v) : undefined)}
                                                placeholder="e.g. 1713203600000"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className={cl("form-col")}>
                                    <SectionTitle>Images & assets</SectionTitle>
                                    <span className={classes(tl("label"), cl("label"))}>Large image key</span>
                                    <TextInput value={String(assets.large_image ?? "")} onChange={v => updateField(["assets", "large_image"], v)} placeholder="Image key or URL" />
                                    <span className={classes(tl("label"), cl("label"))}>Large image text</span>
                                    <TextInput value={String(assets.large_text ?? "")} onChange={v => updateField(["assets", "large_text"], v)} placeholder="Tooltip" />
                                    <span className={classes(tl("label"), cl("label"))}>Large image URL (clickable)</span>
                                    <TextInput value={String(assets.large_url ?? "")} onChange={v => updateField(["assets", "large_url"], v)} placeholder="https://..." />
                                    <span className={classes(tl("label"), cl("label"))}>Small image key</span>
                                    <TextInput value={String(assets.small_image ?? "")} onChange={v => updateField(["assets", "small_image"], v)} placeholder="Image key or URL" />
                                    <span className={classes(tl("label"), cl("label"))}>Small image text</span>
                                    <TextInput value={String(assets.small_text ?? "")} onChange={v => updateField(["assets", "small_text"], v)} placeholder="Tooltip" />
                                    <span className={classes(tl("label"), cl("label"))}>Small image URL (clickable)</span>
                                    <TextInput value={String(assets.small_url ?? "")} onChange={v => updateField(["assets", "small_url"], v)} placeholder="https://..." />

                                    <hr className={cl("divider")} />

                                    <SectionTitle>Buttons</SectionTitle>
                                    <span className={classes(tl("label"), cl("label"))}>Button 1</span>
                                    <div className={cl("field-row")}>
                                        <TextInput
                                            value={String(((formState.buttons as string[]) ?? [])[0] ?? "")}
                                            onChange={v => {
                                                const arr = [...((formState.buttons as string[]) ?? [])];
                                                arr[0] = v;
                                                updateField(["buttons"], arr);
                                            }}
                                            placeholder="Label"
                                        />
                                        <TextInput
                                            value={String(((formState.metadata as any)?.button_urls ?? [])[0] ?? "")}
                                            onChange={v => {
                                                const arr = [...(((formState.metadata as any)?.button_urls as string[]) ?? [])];
                                                arr[0] = v;
                                                updateField(["metadata", "button_urls"], arr);
                                            }}
                                            placeholder="URL"
                                        />
                                    </div>
                                    <span className={classes(tl("label"), cl("label"))}>Button 2</span>
                                    <div className={cl("field-row")}>
                                        <TextInput
                                            value={String(((formState.buttons as string[]) ?? [])[1] ?? "")}
                                            onChange={v => {
                                                const arr = [...((formState.buttons as string[]) ?? [])];
                                                while (arr.length < 2) arr.push("");
                                                arr[1] = v;
                                                updateField(["buttons"], arr);
                                            }}
                                            placeholder="Label"
                                        />
                                        <TextInput
                                            value={String(((formState.metadata as any)?.button_urls ?? [])[1] ?? "")}
                                            onChange={v => {
                                                const arr = [...(((formState.metadata as any)?.button_urls as string[]) ?? [])];
                                                while (arr.length < 2) arr.push("");
                                                arr[1] = v;
                                                updateField(["metadata", "button_urls"], arr);
                                            }}
                                            placeholder="URL"
                                        />
                                    </div>
                                </div>
                            </div>

                            <hr className={cl("divider")} />

                            {/* Top bar: Clone + Presets side by side */}
                            <div className={cl("top-bar")}>
                                <div>
                                    <SectionTitle>Clone from user</SectionTitle>
                                    <Flex style={{ gap: "8px", alignItems: "center", marginTop: "8px" }}>
                                        <TextInput
                                            value={cloneUserId}
                                            onChange={setCloneUserId}
                                            placeholder="User ID"
                                            style={{ flex: 1 }}
                                        />
                                        <Button size={Button.Sizes.SMALL} onClick={loadUserActivities} disabled={cloneLoading}>
                                            {cloneLoading ? "Loading..." : "Load activities"}
                                        </Button>
                                    </Flex>
                                    {cloneActivities.length > 0 && (
                                        <div className={cl("clone-buttons")} style={{ marginTop: "8px" }}>
                                            {cloneActivities.map((act, i) => (
                                                <Button
                                                    key={act.id ?? i}
                                                    size={Button.Sizes.SMALL}
                                                    look={Button.Looks.OUTLINED}
                                                    color={Button.Colors.PRIMARY}
                                                    onClick={() => cloneActivity(act, cloneUserId.trim() || undefined)}
                                                >
                                                    {act.name}
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <SectionTitle>Presets</SectionTitle>
                                    <Flex style={{ gap: "8px", alignItems: "center", marginTop: "8px" }}>
                                        <TextInput
                                            value={presetName}
                                            onChange={setPresetName}
                                            placeholder="Preset name"
                                            style={{ flex: 1 }}
                                        />
                                        <Button
                                            size={Button.Sizes.SMALL}
                                            disabled={!presetName.trim() || !String(formState.name ?? "").trim()}
                                            onClick={() => {
                                                const name = presetName.trim();
                                                if (!name) return;
                                                try {
                                                    const clean = JSON.parse(JSON.stringify(formState));
                                                    const existing = JSON.parse(JSON.stringify(settings.store.presets ?? {}));
                                                    existing[name] = clean;
                                                    settings.store.presets = existing;
                                                    setPresetName("");
                                                    showToast(`Saved preset "${name}"`, "success");
                                                } catch {
                                                    showToast("Failed to save preset", "failure");
                                                }
                                            }}
                                        >
                                            Save
                                        </Button>
                                    </Flex>
                                    {Object.keys(settings.store.presets ?? {}).length > 0 && (
                                        <div className={cl("clone-buttons")} style={{ marginTop: "8px" }}>
                                            {Object.entries(settings.store.presets ?? {}).map(([name, state]) => (
                                                <div key={name} className={cl("preset-chip")}>
                                                    <Button
                                                        size={Button.Sizes.SMALL}
                                                        look={Button.Looks.OUTLINED}
                                                        color={Button.Colors.PRIMARY}
                                                        onClick={() => setFormState({ ...state })}
                                                    >
                                                        {name}
                                                    </Button>
                                                    <Button
                                                        size={Button.Sizes.SMALL}
                                                        look={Button.Looks.LINK}
                                                        color={Button.Colors.PRIMARY}
                                                        onClick={() => {
                                                            try {
                                                                const presets = JSON.parse(JSON.stringify(settings.store.presets ?? {}));
                                                                delete presets[name];
                                                                settings.store.presets = presets;
                                                                showToast(`Deleted "${name}"`, "success");
                                                            } catch { }
                                                        }}
                                                    >
                                                        ✕
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <hr className={cl("divider")} />
                        </div>
                    </ScrollerThin>

                    <div
                        className={cl("preview-panel")}
                        style={{
                            ...profileThemeStyle,
                            width: 340,
                        }}
                    >
                        <div className={cl("preview-popout")}>
                            <ProfilePreview activity={activity} />
                        </div>

                        <div className={cl("actions")}>
                            <Button
                                look={Button.Looks.OUTLINED}
                                color={Button.Colors.DANGER}
                                onClick={() => {
                                    setFormState(emptyActivity());
                                    dispatchActivity(null);
                                    settings.store.savedFormState = null;
                                }}
                            >
                                Clear presence
                            </Button>
                        </div>
                    </div>
                </div>
            <div className={tl("footer")}>
                <span className={tl("spacer")} />
                <Button color={Button.Colors.BRAND} onClick={modalProps.onClose}>Done</Button>
            </div>
            </div>
        </Window>
    );
}

let pendingInitialActivity: Activity | null = null;
let pendingInitialUserId: string | null = null;

function openLiveRpcEditor(initialActivity?: Activity | null, sourceUserId?: string | null) {
    pendingInitialActivity = initialActivity ?? null;
    pendingInitialUserId = sourceUserId ?? null;
    openModal(modalProps => <LiveRpcEditorModal modalProps={modalProps} />);
}

function buildUserContextMenu(children: React.ReactElement[], props: { user?: { id: string } }) {
    const userId = props?.user?.id;
    if (!userId || userId === UserStore.getCurrentUser()?.id) return;
    const activities = (PresenceStore.getActivities(userId) ?? []).filter(
        (a: Activity) => !SKIP_ACTIVITY_NAMES.includes(a.name)
    );
    if (activities.length === 0) return;
    const streamingWithUrl = activities.filter((a: Activity) => a.type === 1 && (a as any).url?.trim?.());
    children.push(
        <Menu.MenuGroup key="live-rpc-editor">
            {streamingWithUrl.length > 0 && (
                <>
                    <Menu.MenuItem
                        id="live-rpc-copy-stream-url"
                        label="Copy stream URL"
                        action={() => {
                            const url = (streamingWithUrl[0] as any).url?.trim?.();
                            if (url) {
                                copyToClipboard(url);
                                showToast("Copied stream URL", "success");
                            }
                        }}
                    />
                    {streamingWithUrl.length > 1 && streamingWithUrl.slice(1).map((act, i) => (
                        <Menu.MenuItem
                            key={i}
                            id={`live-rpc-copy-stream-${i}`}
                            label={act.name ? `Copy stream: ${act.name}` : "Copy stream URL"}
                            action={() => {
                                const url = (act as any).url?.trim?.();
                                if (url) {
                                    copyToClipboard(url);
                                    showToast("Copied stream URL", "success");
                                }
                            }}
                        />
                    ))}
                </>
            )}
            <Menu.MenuItem
                id="clone-to-live-rpc-editor"
                label="Clone to Live RPC Editor"
            >
                {activities.map((act, i) => (
                    <Menu.MenuItem
                        key={act.id ?? i}
                        id={`live-rpc-clone-${act.id ?? i}`}
                        label={act.name}
                        action={() => openLiveRpcEditor(act, userId)}
                    />
                ))}
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
}

/** Shows your saved presence (on) or clears it (off). Was the dock's left-click. */
function applyRpcActive(on: boolean) {
    if (on) {
        const saved = settings.store.savedFormState;
        if (saved && typeof saved === "object" && typeof (saved as any).name === "string" && (saved as any).name.trim()) {
            const act = formStateToActivity(saved as Record<string, unknown>);
            if (act) resolveAssetIds(act).then(dispatchActivity);
        }
    } else {
        dispatchActivity(null);
    }
}

function OpenEditorButton() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <Button color={Button.Colors.BRAND} onClick={() => openLiveRpcEditor()}>Open Live RPC Editor</Button>
            <span className="vc-tool-hint">Edit your presence with a live preview.</span>
        </div>
    );
}

export default definePlugin({
    name: "Live RPC Editor",
    openSettingsModal: () => openLiveRpcEditor(),
    description: "Edit custom presence with live preview. Alt+R to open. Clone any user's activities. Right-click user: Copy stream URL or Clone to Live RPC Editor. Presence persists across restarts.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    contextMenus: { "user-context": buildUserContextMenu },
    patches: [
        {
            find: ".USER_PROFILE_ACTIVITY_BUTTONS),",
            replacement: {
                match: /.getId\(\)===\i\.id/,
                replace: "$& && false"
            }
        },
        {
            find: ".getAnyDiscoverableStreamForUser(e):null;return",
            replacement: {
                match: /return (\i)===(\i)\.(\i)\.BLOCKED\|\|null==(\i)\?null:(\i)\}/,
                replace: "return $1===$2.$3.BLOCKED||null==$4||$self.shouldHideStream($4)?null:$5}",
            }
        },
        {
            // Discord now has two stream-request cards; only the game one has the "Game not running" check.
            find: '["43zohO"]',
            replacement: {
                match: /null==(\i)&&\((\i)=.{0,60}"43zohO".{0,10},(\i)=!0\)/,
                replace: "false"
            }
        },
        {
            find: "CUSTOM_STATUS:return 4",
            replacement: {
                // Puts this editor's activity first. Matches both `let x=e=>{switch…` and `function x(e){switch…`.
                match: /\{switch\((\i)\.type\)\{(?=case \i\.\i\.CUSTOM_STATUS:return 4)/,
                replace: '{if($1.metadata?.socketId==="LiveRpcEditor")return 5;switch($1.type){',
            }
        },
    ],
    start() {
        if (!settings.store.presets) settings.store.presets = {};
        const saved = settings.store.savedFormState;
        // Restores your presence on startup only if RPC was left on. (It used
        // to force it back on every restart, undoing a disable.)
        if (settings.store.rpcActive && saved && typeof saved === "object" && typeof (saved as any).name === "string" && (saved as any).name.trim()) {
            const act = formStateToActivity(saved as Record<string, unknown>);
            if (act) {
                resolveAssetIds(act).then(dispatchActivity);
            }
        }
        const handler = (e: KeyboardEvent) => {
            if (matchKb(e, settings.store.keybind)) {
                e.preventDefault();
                openLiveRpcEditor();
            }
        };
        document.addEventListener("keydown", handler, true);
        this._keyHandler = handler;
    },
    stop() {
        if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler, true);
        dispatchActivity(null);
    },

    shouldHideStream(userId: string) {
        if (!settings.store.rpcActive || userId !== UserStore.getCurrentUser()?.id) return false;
        const saved = settings.store.savedFormState;
        return saved && typeof saved === "object" && typeof (saved as any).name === "string" && !!(saved as any).name.trim();
    },
});
