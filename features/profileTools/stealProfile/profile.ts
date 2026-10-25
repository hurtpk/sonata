/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reading someone's profile, and writing a profile to your own account
// (your main profile, or your profile in one server).

import * as DataStore from "@api/DataStore";
import { fetchUserProfile } from "@utils/discord";
import { Constants, GuildMemberStore, IconUtils, RestAPI, UserProfileStore, UserStore } from "@webpack/common";

export interface ProfileDraft {
    avatar: string | null;
    banner: string | null;
    displayName: string;
    pronouns: string;
    bio: string;
    /** #rrggbb, or "" for none. */
    accentColor: string;
    /** Profile theme: [primary, accent] as #rrggbb, or null for none. */
    themeColors: [string, string] | null;
}

export type Part = "avatar" | "banner" | "displayName" | "pronouns" | "bio" | "accentColor" | "themeColors";

export const PARTS: { id: Part; name: string; nitro?: boolean; mainOnly?: boolean; }[] = [
    { id: "avatar", name: "Profile picture" },
    { id: "banner", name: "Banner", nitro: true },
    { id: "displayName", name: "Display name" },
    { id: "pronouns", name: "Pronouns" },
    { id: "bio", name: "About me" },
    { id: "accentColor", name: "Banner colour", mainOnly: true },
    { id: "themeColors", name: "Profile theme colours", nitro: true },
];

export type Target = { kind: "main"; } | { kind: "server"; guildId: string; };

const hex = (n: number | null | undefined) => n == null ? "" : `#${n.toString(16).padStart(6, "0")}`;
const num = (h: string) => h ? parseInt(h.slice(1), 16) : null;

/** A picture from Discord's CDN, as a data URL Discord accepts back. */
export async function imageData(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't download the picture (${res.status})`);
    const blob = await res.blob();
    return fileData(blob);
}

export function fileData(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("Couldn't read the picture"));
        r.readAsDataURL(blob);
    });
}

/**
 * Everything copyable from someone's profile — their server profile wins where they have one.
 * With serverOnly, only what's set on the server profile itself (for backing up your own).
 */
export async function readProfile(userId: string, guildId?: string | null, serverOnly = false): Promise<{ draft: ProfileDraft; name: string; }> {
    const user = UserStore.getUser(userId);
    if (!user) throw new Error("Couldn't find that user");
    await fetchUserProfile(userId, guildId ? { guild_id: guildId } as any : undefined, false).catch(() => null);
    const profile: any = UserProfileStore.getUserProfile(userId);
    const guildProfile: any = guildId ? UserProfileStore.getGuildMemberProfile(userId, guildId) : null;
    const member: any = guildId ? GuildMemberStore.getMember(guildId, userId) : null;

    const avatarUrl = member?.avatar
        ? IconUtils.getGuildMemberAvatarURLSimple({ guildId: guildId!, userId, avatar: member.avatar, canAnimate: true, size: 512 })
        : serverOnly ? null : user.getAvatarURL(undefined, 512, true);
    const bannerUrl = guildProfile?.banner
        ? IconUtils.getGuildMemberBannerURL({ id: userId, guildId: guildId!, banner: guildProfile.banner, canAnimate: true, size: 1024 })
        : !serverOnly && profile?.banner ? IconUtils.getUserBannerURL({ id: userId, banner: profile.banner, canAnimate: true, size: 1024 }) : undefined;

    const [avatar, banner] = await Promise.all([
        avatarUrl ? imageData(avatarUrl).catch(() => null) : Promise.resolve(null),
        bannerUrl ? imageData(bannerUrl).catch(() => null) : Promise.resolve(null),
    ]);
    const theme = guildProfile?.themeColors ?? (serverOnly ? null : profile?.themeColors);
    return {
        name: member?.nick || (user as any).globalName || user.username,
        draft: {
            avatar,
            banner,
            displayName: member?.nick || (user as any).globalName || user.username,
            pronouns: guildProfile?.pronouns || (serverOnly ? "" : profile?.pronouns) || "",
            bio: guildProfile?.bio || (serverOnly ? "" : profile?.bio) || "",
            accentColor: hex(profile?.accentColor),
            themeColors: theme?.length === 2 ? [hex(theme[0]), hex(theme[1])] : null,
        },
    };
}

function errorText(e: any) {
    const body = e?.body;
    if (body?.errors) {
        const msgs: string[] = [];
        const walk = (o: any) => { for (const v of Object.values(o ?? {})) { if ((v as any)?._errors) msgs.push(...(v as any)._errors.map((x: any) => x.message)); else if (typeof v === "object") walk(v); } };
        walk(body.errors);
        if (msgs.length) return msgs.join(" ");
    }
    if (body?.captcha_key) return "Discord wants a captcha for this — change it once in Discord's own settings, then try again.";
    return body?.message ?? e?.message ?? String(e);
}

/** Write the chosen parts to your account. Returns what failed, if anything. */
export async function applyProfile(draft: ProfileDraft, parts: Set<Part>, target: Target): Promise<string[]> {
    const failed: string[] = [];
    const send = async (url: string, body: Record<string, unknown>): Promise<any> => {
        if (!Object.keys(body).length) return null;
        try { await RestAPI.patch({ url, body }); return null; } catch (e) { return e ?? new Error("Request failed"); }
    };
    const call = async (label: string, url: string, body: Record<string, unknown>) => {
        const e = await send(url, body);
        if (e) failed.push(`${label}: ${errorText(e)}`);
    };

    if (target.kind === "server") {
        const { guildId } = target;
        const member: Record<string, unknown> = {};
        if (parts.has("displayName")) member.nick = draft.displayName || null;
        if (parts.has("avatar")) member.avatar = draft.avatar;
        await call("Server nickname / picture", `/guilds/${guildId}/members/@me`, member);

        // The rest of a server profile (what Discord's own server profile editor changes) has its own endpoint.
        const profile: Record<string, unknown> = {};
        if (parts.has("banner")) profile.banner = draft.banner;
        if (parts.has("bio")) profile.bio = draft.bio;
        if (parts.has("pronouns")) profile.pronouns = draft.pronouns;
        if (parts.has("themeColors")) profile.theme_colors = draft.themeColors ? draft.themeColors.map(num) : null;
        const url = (Constants.Endpoints as any).GUILD_MEMBER_PROFILE?.(guildId) ?? `/guilds/${guildId}/profile/@me`;
        const e = await send(url, profile);
        if (e?.status === 404) {
            // Without that endpoint, the member itself takes the banner and about me.
            const fallback: Record<string, unknown> = {};
            if ("banner" in profile) fallback.banner = profile.banner;
            if ("bio" in profile) fallback.bio = profile.bio;
            await call("Server profile", `/guilds/${guildId}/members/@me`, fallback);
        } else if (e) failed.push(`Server profile: ${errorText(e)}`);
        return failed;
    }

    const account: Record<string, unknown> = {};
    if (parts.has("avatar")) account.avatar = draft.avatar;
    if (parts.has("displayName")) account.global_name = draft.displayName || null;
    await call("Picture / name", "/users/@me", account);

    const profile: Record<string, unknown> = {};
    if (parts.has("bio")) profile.bio = draft.bio;
    if (parts.has("pronouns")) profile.pronouns = draft.pronouns;
    if (parts.has("banner")) profile.banner = draft.banner;
    if (parts.has("accentColor")) profile.accent_color = num(draft.accentColor);
    if (parts.has("themeColors")) profile.theme_colors = draft.themeColors ? draft.themeColors.map(num) : null;
    await call("Profile", "/users/@me/profile", profile);
    return failed;
}

// ─── A backup of your own profile, taken before each apply ───

const BACKUP_KEY = "Sonata_StealProfile_backup";

export interface Backup { at: number; target: Target; draft: ProfileDraft; parts: Part[]; }

export async function backUp(target: Target, parts: Set<Part>) {
    const me = UserStore.getCurrentUser();
    const { draft } = await readProfile(me.id, target.kind === "server" ? target.guildId : null, target.kind === "server");
    if (target.kind === "main") {
        // Your main profile, not a server one.
        draft.displayName = (me as any).globalName || "";
    } else {
        draft.displayName = (GuildMemberStore.getMember(target.guildId, me.id) as any)?.nick || "";
    }
    const backup: Backup = { at: Date.now(), target, draft, parts: [...parts] };
    await DataStore.set(BACKUP_KEY, backup);
    return backup;
}

export const lastBackup = () => DataStore.get<Backup>(BACKUP_KEY);
