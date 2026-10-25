/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The card at the top of a role in the permissions window: its ID, its
// colour (or gradient) as hex codes, and its icon to save — each a click away.

import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { saveFile } from "@utils/web";
import type { Guild, Role } from "@vencord/discord-types";
import { showToast } from "@webpack/common";

const cl = classNameFactory("vc-permviewer-");

const hex = (n: number | undefined | null) => !n ? null : "#" + n.toString(16).padStart(6, "0").toUpperCase();

/** A role's colours: one, two (a gradient) or three (holographic). */
export function roleColors(role: Role): string[] {
    const c: any = (role as any).colors ?? {};
    const s: any = (role as any).colorStrings ?? {};
    const list = [s.primaryColor ?? hex(c.primary_color) ?? role.colorString ?? hex(role.color || null), s.secondaryColor ?? hex(c.secondary_color), s.tertiaryColor ?? hex(c.tertiary_color)]
        .filter((x): x is string => !!x)
        .map(x => x.toUpperCase());
    return list;
}

/** The CSS for a role's colour, for swatches and dots. */
export function roleFill(role: Role | undefined) {
    if (!role) return "var(--primary-300)";
    const colors = roleColors(role);
    if (!colors.length) return "var(--primary-300)";
    return colors.length > 1 ? `linear-gradient(135deg, ${colors.join(", ")})` : colors[0];
}

const createdAt = (id: string) => new Date(Number((BigInt(id) >> 22n) + 1420070400000n));

function iconUrl(role: Role, size = 512) {
    if (!role.icon) return null;
    return `https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.png?size=${size}`;
}

async function download(url: string, name: string) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const ext = blob.type.includes("svg") ? "svg" : blob.type.includes("gif") ? "gif" : blob.type.includes("webp") ? "webp" : "png";
        saveFile(new File([blob], `${name}.${ext}`, { type: blob.type }));
    } catch {
        VencordNative.native.openExternal(url);
    }
}

const copy = (text: string, what: string) => { copyToClipboard(text); showToast(`Copied ${what}`, "success"); };
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 60) || "role";

export function RoleInfo({ role, guild, iconSrc }: { role: Role; guild: Guild; iconSrc?: string; }) {
    const colors = roleColors(role);
    const kind = colors.length >= 3 ? "Holographic" : colors.length === 2 ? "Gradient" : colors.length ? "Colour" : "No colour";
    const big = iconUrl(role);
    const emoji = (role as any).unicodeEmoji as string | undefined;
    const iconToSave = big ?? (emoji ? iconSrc : null);
    const facts = [
        role.id === guild.id ? "Everyone has it" : null,
        role.hoist ? "Shown separately" : null,
        role.mentionable ? "Anyone can @mention it" : null,
        role.managed ? (role.tags?.bot_id ? "Made by a bot" : "Managed by an app") : null,
        role.tags?.premium_subscriber !== undefined ? "Server Booster role" : null,
        `Made ${createdAt(role.id).toLocaleDateString([], { dateStyle: "medium" })}`,
    ].filter(Boolean);

    return (
        <div className={cl("role-info")}>
            <div className={cl("role-info-head")}>
                <span className={cl("role-info-swatch")} style={{ background: roleFill(role) }}>
                    {iconSrc && <img src={iconSrc} alt="" />}
                </span>
                <div className={cl("role-info-title")}>
                    <b>{role.name}</b>
                    <span>{facts.join(" · ")}</span>
                </div>
            </div>

            <div className={cl("role-info-rows")}>
                <div className={cl("role-info-row")}>
                    <span className={cl("role-info-label")}>Role ID</span>
                    <code>{role.id}</code>
                    <button type="button" className="vc-tool-btn" onClick={() => copy(role.id, "role ID")}>Copy</button>
                    <button type="button" className="vc-tool-link" title="Copy it as a mention, for messages" onClick={() => copy(`<@&${role.id}>`, "mention")}>Copy mention</button>
                </div>

                <div className={cl("role-info-row")}>
                    <span className={cl("role-info-label")}>{kind}</span>
                    {colors.length ? (
                        <>
                            {colors.map((c, i) => (
                                <button key={i} type="button" className={cl("role-info-hex")} title={`Copy ${c}`} onClick={() => copy(c, c)}>
                                    <i style={{ background: c }} />{c}
                                </button>
                            ))}
                            {colors.length > 1 && <button type="button" className="vc-tool-link" onClick={() => copy(colors.join(", "), "all colours")}>Copy all</button>}
                        </>
                    ) : <span className="vc-tool-hint">This role has no colour, so names keep their normal colour.</span>}
                </div>

                <div className={cl("role-info-row")}>
                    <span className={cl("role-info-label")}>Icon</span>
                    {iconSrc ? (
                        <>
                            <img className={cl("role-info-icon")} src={iconSrc} alt="" />
                            {iconToSave && <button type="button" className="vc-tool-btn" onClick={() => void download(iconToSave, safeName(role.name))}>Download</button>}
                            {big && <button type="button" className="vc-tool-link" onClick={() => copy(big, "icon link")}>Copy link</button>}
                            {emoji && !big && <span className="vc-tool-hint">An emoji: {emoji}</span>}
                        </>
                    ) : <span className="vc-tool-hint">No icon.</span>}
                </div>
            </div>
        </div>
    );
}
