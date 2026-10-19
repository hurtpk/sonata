/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { fetchUserProfile, openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import { findStoreLazy } from "@webpack";
import { IconUtils, SnowflakeUtils, useEffect, useMemo, UserStore,useState } from "@webpack/common";

import { cl, getEnabledPlugins, getKeybindSettings, MY_DISCORD_ID, parseStringMap } from "./shared";

interface AboutTabProps {
    /** Custom sitewide accent color (hex), or null to use the default accent. */
    accentColor: string | null;
    onAccentColorChange: (hex: string | null) => void;
}

const DEFAULT_ACCENT_HEX = "#5865F2";

const UserProfileStore = findStoreLazy("UserProfileStore") as {
    getUserProfile(id: string): {
        banner?: string;
        accentColor?: number;
        themeColors?: [number, number]; // [primary, secondary]
        bio?: string;
        profileEffectId?: string;
    } | undefined;
};

export function AboutTab({ accentColor, onAccentColorChange }: AboutTabProps) {
    const [user, setUser] = useState(() => UserStore.getCurrentUser() ?? null);
    const myId = user?.id ?? "";

    const stats = useMemo(() => {
        const enabledCount = getEnabledPlugins().length;

        // Only count plugin-owned keybind settings that currently hold a value
        // (not every settable slot), plus central "Toggle: X" bindings - the
        // keybindMap only ever stores an entry once a bind is actually set.
        let keybinds = 0;
        for (const entries of getKeybindSettings().values()) {
            for (const e of entries) {
                const value = (Settings.plugins[e.plugin.name]?.[e.key] as string) ?? e.default;
                if (value) keybinds++;
            }
        }
        keybinds += Object.keys(parseStringMap(Settings.plugins.Sonata?.keybindMap)).length;

        const joinDate = myId
            ? new Date(SnowflakeUtils.extractTimestamp(myId)).toLocaleDateString(undefined, { year: "numeric", month: "short" })
            : "—";

        return { enabledCount, keybinds, joinDate };
    }, [myId]);

    const [profile, setProfile] = useState(() => (myId ? UserProfileStore.getUserProfile?.(myId) : undefined));

    useEffect(() => {
        if (!user) {
            const current = UserStore.getCurrentUser();
            if (current) setUser(current);
        }
        if (myId && !profile?.banner) {
            fetchUserProfile(myId).then(() => {
                setProfile(UserProfileStore.getUserProfile?.(myId));
            }).catch(() => { });
        }
    }, [myId]);

    const avatar = user?.getAvatarURL?.(undefined, 256, true) ?? (myId ? IconUtils.getDefaultAvatarURL(myId) : undefined);
    const banner = profile?.banner
        ? IconUtils.getUserBannerURL?.({ id: myId, banner: profile.banner, canAnimate: true, size: 600 })
        : null;
    const displayName = (user as any)?.globalName || user?.username || "You";
    const username = user?.username ? `@${user.username}` : "@you";
    const themeColors = profile?.themeColors;
    const profileAccentHex = profile?.accentColor != null
        ? "#" + profile.accentColor.toString(16).padStart(6, "0")
        : ((user as any)?.accentColor != null
            ? "#" + (user as any).accentColor.toString(16).padStart(6, "0")
            : null);

    return (
        <div className={cl("about-wrap")}>
            <div
                className={cl("about-profile")}
                style={(() => {
                    const s: Record<string, string> = {};
                    if (profileAccentHex) s["--vc-profile-accent"] = profileAccentHex;
                    if (themeColors) {
                        s["--vc-profile-theme-1"] = "#" + themeColors[0].toString(16).padStart(6, "0");
                        s["--vc-profile-theme-2"] = "#" + themeColors[1].toString(16).padStart(6, "0");
                    }
                    return s;
                })() as any}
                onClick={() => myId && openUserProfile(myId)}
                role="button"
                tabIndex={0}
            >
                <div
                    className={cl("about-profile-banner") + (banner ? " " + cl("about-profile-banner-img") : "")}
                    style={banner ? { backgroundImage: `url(${banner})` } : undefined}
                />
                <div className={cl("about-profile-body")}>
                    <div className={cl("about-profile-avatar-ring")}>
                        <img className={cl("about-profile-avatar")} src={avatar} alt="" />
                    </div>
                    <div className={cl("about-profile-text")}>
                        <div className={cl("about-profile-name")}>{displayName}</div>
                        <div className={cl("about-profile-handle")}>{username}</div>
                    </div>
                    <div className={cl("about-profile-cta")}>View profile →</div>
                </div>
            </div>

            <div className={cl("about-stats")}>
                <div className={cl("about-stat")}>
                    <div className={cl("about-stat-value")}>{stats.enabledCount}</div>
                    <div className={cl("about-stat-label")}>Plugins</div>
                </div>
                <div className={cl("about-stat")}>
                    <div className={classes(cl("about-stat-value"), cl("about-stat-value-compact"))}>{stats.joinDate}</div>
                    <div className={cl("about-stat-label")}>Joined Discord</div>
                </div>
                <div className={cl("about-stat")}>
                    <div className={cl("about-stat-value")}>{stats.keybinds}</div>
                    <div className={cl("about-stat-label")}>Keybinds</div>
                </div>
            </div>
            <div
                className={cl("about-credit")}
                onClick={() => openUserProfile(MY_DISCORD_ID)}
                role="button"
                tabIndex={0}
            >
                plugin by <span className={cl("about-credit-handle")}>@aiqen</span>
            </div>

            <div className={cl("about-ambient")}>
                <div className={cl("about-ambient-label")}>Accent color</div>
                <div className={cl("about-ambient-controls")}>
                    <button
                        type="button"
                        className={classes(
                            cl("about-ambient-reset"),
                            !accentColor && cl("about-ambient-reset-active"),
                        )}
                        onClick={() => onAccentColorChange(null)}
                    >
                        Auto
                    </button>
                    <label
                        className={cl("about-ambient-swatch")}
                        style={{ background: accentColor ?? "var(--brand-500)" }}
                        title="Pick a custom accent color"
                    >
                        <input
                            type="color"
                            className={cl("about-ambient-input")}
                            value={accentColor ?? DEFAULT_ACCENT_HEX}
                            onChange={e => onAccentColorChange(e.target.value)}
                            aria-label="Pick a custom accent color"
                        />
                    </label>
                </div>
            </div>
        </div>
    );
}
