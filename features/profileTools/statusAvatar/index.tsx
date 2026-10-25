/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getUserSettingLazy } from "@api/UserSettings";
import definePlugin, { OptionType, PluginSettingComponentProps } from "@utils/types";
import { chooseFile } from "@utils/web";
import { Menu, RestAPI, showToast, UserSettingsProtoStore, UserStore,useState } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";

const StatusSetting = getUserSettingLazy<string>("status", "status")!;

type AvatarSettingKey = "onlineAvatar" | "idleAvatar" | "dndAvatar" | "invisibleAvatar";

/** The crescent moon used elsewhere in Equicord to represent the Idle/Away status. */
function MoonIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
            <path fill="currentColor" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
    );
}

function ReapplyButton() {
    return (
        <button type="button" className="vc-tool-btn" onClick={() => {
                applyAvatarForStatus(StatusSetting.getSetting());
                showToast("Reapplying your avatar for the current status…");
            }}>
            Reapply Avatar Now
        </button>
    );
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/** Builds a settings component with an "Upload Image" button for one status slot. */
function makeAvatarUploadSetting(key: AvatarSettingKey, label: string) {
    return function AvatarUploadSetting({ setValue }: PluginSettingComponentProps) {
        const [preview, setPreview] = useState<string>(settings.store[key] ?? "");

        async function pickFile() {
            const file = await chooseFile("image/png,image/jpeg,image/gif,image/webp");
            if (!file) return;

            try {
                const base64 = await blobToBase64(file);
                setPreview(base64);
                setValue(base64);
            } catch (e) {
                console.error("[StatusAvatar] Failed to read image file:", e);
            }
        }

        function clear() {
            setPreview("");
            setValue("");
        }

        return (
            <div style={{ margin: "12px 0" }}>
                <div style={{ fontWeight: 600, marginBottom: "6px", color: "var(--header-primary)" }}>
                    {label}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {preview ? (
                        <img
                            src={preview}
                            alt={label}
                            style={{ width: "48px", height: "48px", borderRadius: "50%", objectFit: "cover" }}
                        />
                    ) : (
                        <div
                            style={{
                                width: "48px",
                                height: "48px",
                                borderRadius: "50%",
                                background: "var(--background-modifier-accent)",
                            }}
                        />
                    )}
                    <button type="button" className="vc-tool-btn" onClick={pickFile}>
                        {preview ? "Change Image" : "Upload Image"}
                    </button>
                    {preview && (
                        <button type="button" className="vc-tool-btn vc-tool-danger" onClick={clear}>
                            Remove
                        </button>
                    )}
                </div>
            </div>
        );
    };
}

const settings = defineFeatureSettings("statusAvatar", {
    onlineAvatar: {
        type: OptionType.COMPONENT,
        description: "Avatar to use while your status is Online",
        component: makeAvatarUploadSetting("onlineAvatar", "Online"),
        default: "",
    },
    idleAvatar: {
        type: OptionType.COMPONENT,
        description: "Avatar to use while your status is Idle/Away",
        component: makeAvatarUploadSetting("idleAvatar", "Idle / Away"),
        default: "",
    },
    dndAvatar: {
        type: OptionType.COMPONENT,
        description: "Avatar to use while your status is Do Not Disturb",
        component: makeAvatarUploadSetting("dndAvatar", "Do Not Disturb"),
        default: "",
    },
    invisibleAvatar: {
        type: OptionType.COMPONENT,
        description: "Avatar to use while your status is Invisible",
        component: makeAvatarUploadSetting("invisibleAvatar", "Invisible"),
        default: "",
    },
    revertOnStop: {
        type: OptionType.BOOLEAN,
        description: "Restore your original avatar when this plugin is disabled",
        default: true,
    },
    reapplyNow: {
        type: OptionType.COMPONENT,
        description: "Manually reapply the avatar for your current status right now (e.g. if a change got dropped by Discord's rate limit)",
        component: ReapplyButton,
    },
    // Was hidden and only reachable from the dock icon's left-click (or the
    // Equicord Toolbox). Now a normal setting, so it can also be bound to a
    // key from ChannelSettings' Keybinds tab.
    paused: {
        type: OptionType.BOOLEAN,
        description: "Pause automatic avatar switching (controllable from the Equicord Toolbox too)",
        default: false,
        onChange(paused: boolean) {
            // Status changes are skipped while paused, so catch up on unpause.
            // Only while the plugin is running — the settings page can be
            // edited with the plugin disabled, and that shouldn't touch your avatar.
            if (!paused && running) applyAvatarForStatus(StatusSetting.getSetting());
        },
    },
});

let lastStatus: string | null = null;
let originalAvatarBase64: string | null = null;
let applying = false;
let running = false;

function getConfiguredAvatarFor(status: string): string {
    switch (status) {
        case "online": return settings.store.onlineAvatar;
        case "idle": return settings.store.idleAvatar;
        case "dnd": return settings.store.dndAvatar;
        case "invisible":
        case "offline": return settings.store.invisibleAvatar;
        default: return "";
    }
}

async function setAvatarBase64(base64: string) {
    try {
        await RestAPI.patch({
            url: "/users/@me",
            body: { avatar: base64 },
        });
    } catch (e) {
        console.error("[StatusAvatar] Failed to update avatar:", e);
    }
}

async function applyAvatarForStatus(status: string) {
    const base64 = getConfiguredAvatarFor(status);
    if (!base64 || applying) return;

    applying = true;
    try {
        await setAvatarBase64(base64);
    } finally {
        applying = false;
    }
}

function handleStatusChange() {
    const status = StatusSetting.getSetting();
    if (status === lastStatus) return;
    lastStatus = status;

    if (settings.store.paused) return;
    applyAvatarForStatus(status);
}

export default definePlugin({
    name: "StatusAvatar",
    description: "Automatically swaps your profile picture based on your online status (online, idle, dnd, invisible). Just upload an image for each status.",
    tags: ["Avatar", "Status", "Utility"],
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    async start() {
        lastStatus = StatusSetting.getSetting();

        if (settings.store.revertOnStop) {
            try {
                const me = UserStore.getCurrentUser();
                const res = await fetch(me.getAvatarURL(void 0, 1024, true));
                const blob = await res.blob();
                originalAvatarBase64 = await blobToBase64(blob);
            } catch (e) {
                console.error("[StatusAvatar] Failed to snapshot your current avatar:", e);
                originalAvatarBase64 = null;
            }
        }

        UserSettingsProtoStore.addChangeListener(handleStatusChange);
        running = true;

        // Apply immediately for whatever status you're already in
        if (!settings.store.paused) {
            await applyAvatarForStatus(lastStatus);
        }
    },

    async stop() {
        UserSettingsProtoStore.removeChangeListener(handleStatusChange);
        running = false;

        if (settings.store.revertOnStop && originalAvatarBase64) {
            await setAvatarBase64(originalAvatarBase64);
        }
    },

    // Adds quick actions to the Equicord Toolbox (the button in the channel header, if you have that plugin enabled)
    toolboxActions() {
        const { paused } = settings.use(["paused"]);

        return (
            <>
                <Menu.MenuCheckboxItem
                    id="vc-status-avatar-toggle"
                    label="Auto-Switch Avatar"
                    checked={!paused}
                    icon={MoonIcon}
                    leadingAccessory={{ type: "icon", icon: MoonIcon }}
                    action={() => {
                        settings.store.paused = !settings.store.paused;
                    }}
                />
                <Menu.MenuItem
                    id="vc-status-avatar-reapply"
                    label="Reapply Avatar Now"
                    icon={MoonIcon}
                    leadingAccessory={{ type: "icon", icon: MoonIcon }}
                    action={() => applyAvatarForStatus(StatusSetting.getSetting())}
                />
            </>
        );
    },
});
