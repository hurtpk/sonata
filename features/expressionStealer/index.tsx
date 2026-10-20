/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "../_shared/tool.css";
import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { PlusIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { getGuildAcronym, hasGuildFeature } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { Guild, GuildSticker, Message } from "@vencord/discord-types";
import { StickerFormatType } from "@vencord/discord-types/enums";
import { findByCodeLazy } from "@webpack";
import { Constants, EmojiStore, FluxDispatcher, GuildStore, IconUtils, Menu, openModalLazy, PermissionsBits, PermissionStore, React, RestAPI, showToast, StickersStore, UserStore } from "@webpack/common";
import { Promisable } from "type-fest";

import { windowAccent } from "../../controller/accent";
import { Window } from "../_shared/Window";

const cl = classNameFactory("vc-steal-");

const uploadEmoji = findByCodeLazy(".GUILD_EMOJIS(", "EMOJI_UPLOAD_START");

interface Sticker extends GuildSticker {
    t: "Sticker";
}

interface Emoji {
    t: "Emoji";
    id: string;
    name: string;
    isAnimated: boolean;
}

type Data = Emoji | Sticker;

const StickerExtMap = {
    [StickerFormatType.PNG]: "png",
    [StickerFormatType.APNG]: "png",
    [StickerFormatType.LOTTIE]: "json",
    [StickerFormatType.GIF]: "gif"
} as const;

const PremiumTierStickerLimitMap = {
    0: 5,
    1: 15,
    2: 30,
    3: 60
} as const;

const MAX_EMOJI_SIZE_BYTES = 256 * 1024;
const MAX_STICKER_SIZE_BYTES = 512 * 1024;

function getGuildMaxStickerSlots(guild: Guild) {
    if (guild.features.has("MORE_STICKERS") && guild.premiumTier === 3)
        return 120;

    return PremiumTierStickerLimitMap[guild.premiumTier] ?? PremiumTierStickerLimitMap[0];
}

function getGuildMaxEmojiSlots(guild: Guild) {
    return Math.max(
        hasGuildFeature(guild, "MORE_EMOJI") ? 200 : 50,
        50 + (guild.premiumFeatures?.additionalEmojiSlots ?? 0)
    );
}

function getUrl(data: Data, size: number) {
    if (data.t === "Emoji")
        return `${location.protocol}//${window.GLOBAL_ENV.CDN_HOST}/emojis/${data.id}.webp?size=${size}&lossless=true&animated=true`;

    return `${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/stickers/${data.id}.${StickerExtMap[data.format_type]}?size=${size}&lossless=true&animated=true`;
}

async function fetchSticker(id: string) {
    const cached = StickersStore.getStickerById(id);
    if (cached) return cached;

    const { body } = await RestAPI.get({
        url: Constants.Endpoints.STICKER(id)
    });

    FluxDispatcher.dispatch({
        type: "STICKER_FETCH_SUCCESS",
        sticker: body
    });

    return body as Sticker;
}

async function cloneSticker(guildId: string, sticker: Sticker) {
    const data = new FormData();
    data.append("name", sticker.name);
    data.append("tags", sticker.tags);
    data.append("description", sticker.description);
    data.append("file", await fetchBlob(sticker));

    const { body } = await RestAPI.post({
        url: Constants.Endpoints.GUILD_STICKER_PACKS(guildId),
        body: data,
    });

    FluxDispatcher.dispatch({
        type: "GUILD_STICKERS_CREATE_SUCCESS",
        guildId,
        sticker: {
            ...body,
            user: UserStore.getCurrentUser()
        }
    });
}

async function cloneEmoji(guildId: string, emoji: Emoji) {
    const data = await fetchBlob(emoji);

    const dataUrl = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(data);
    });

    return uploadEmoji({
        guildId,
        name: emoji.name.split("~")[0],
        image: dataUrl
    });
}

async function fetchBlob(data: Data) {
    const MAX_SIZE = data.t === "Sticker"
        ? MAX_STICKER_SIZE_BYTES
        : MAX_EMOJI_SIZE_BYTES;

    for (let size = 4096; size >= 16; size /= 2) {
        const url = getUrl(data, size);
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Failed to fetch ${url} - ${res.status}`);

        const blob = await res.blob();
        if (blob.size <= MAX_SIZE)
            return blob;
    }

    throw new Error(`Failed to fetch ${data.t} within size limit of ${MAX_SIZE / 1000}kB`);
}

async function doClone(guildId: string, data: Sticker | Emoji): Promise<boolean> {
    try {
        if (data.t === "Sticker")
            await cloneSticker(guildId, data);
        else
            await cloneEmoji(guildId, data);

        showToast(`Added ${data.name} to ${GuildStore.getGuild(guildId)?.name ?? "your server"}!`, "success");
        return true;
    } catch (e: any) {
        let message = "Something went wrong (check console!)";
        try {
            message = JSON.parse(e.text).message;
        } catch { }

        new Logger("ExpressionCloner").error("Failed to clone", data.name, "to", guildId, e);
        showToast("Couldn't add it: " + message, "failure");
        return false;
    }
}

const nameValidator = /^\w+$/i;

interface ServerOption { guild: Guild; used: number; max: number; }

/** Servers where you can add expressions, with how many slots are used. */
export function serverOptions(data: Data): ServerOption[] {
    const meId = UserStore.getCurrentUser().id;
    return Object.values(GuildStore.getGuilds())
        .filter(g => g.ownerId === meId
            || (PermissionStore.getGuildPermissions({ id: g.id }) & PermissionsBits.CREATE_GUILD_EXPRESSIONS) === PermissionsBits.CREATE_GUILD_EXPRESSIONS)
        .map(guild => {
            if (data.t === "Sticker") {
                return { guild, used: StickersStore.getStickersByGuildId(guild.id)?.length ?? 0, max: getGuildMaxStickerSlots(guild) };
            }
            const { isAnimated } = data as Emoji;
            let used = 0;
            for (const e of EmojiStore.getGuildEmoji(guild.id)) if (e.animated === isAnimated && !e.managed) used++;
            return { guild, used, max: getGuildMaxEmojiSlots(guild) };
        })
        .sort((a, b) => Number(a.used >= a.max) - Number(b.used >= b.max) || a.guild.name.localeCompare(b.guild.name));
}

export function nameError(data: Data, name: string) {
    if (data.t === "Emoji") {
        if (name.length < 2 || name.length > 32) return "Emoji names are 2–32 characters.";
        if (!nameValidator.test(name)) return "Emoji names can only use letters, numbers and _.";
        return null;
    }
    return name.length < 2 || name.length > 30 ? "Sticker names are 2–30 characters." : null;
}

function StealModal({ data }: { data: Sticker | Emoji; }) {
    const [name, setName] = React.useState(data.name.split("~")[0]);
    const [busy, setBusy] = React.useState<string | null>(null);
    const [added, setAdded] = React.useState<Record<string, boolean>>({});
    const [query, setQuery] = React.useState("");
    const [tick, refresh] = React.useReducer(x => x + 1, 0);
    const accent = windowAccent("expressionStealer");

    const servers = React.useMemo(() => serverOptions(data), [data.id, tick]);
    const error = nameError(data, name);
    const q = query.trim().toLowerCase();
    const shown = q ? servers.filter(s => s.guild.name.toLowerCase().includes(q)) : servers;
    const kind = data.t === "Sticker" ? "sticker" : (data as Emoji).isAnimated ? "animated emoji" : "emoji";

    const steal = async (g: Guild) => {
        if (busy || error) return;
        setBusy(g.id);
        data.name = name;
        const ok = await doClone(g.id, data);
        setBusy(null);
        if (ok) setAdded(a => ({ ...a, [g.id]: true }));
        refresh();
    };

    return (
        <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
            <div className={cl("top")}>
                <div className={cl("preview")}><img src={getUrl(data, 160)} alt="" /></div>
                <div className={cl("top-text")}>
                    <label className={cl("label")} htmlFor="vc-steal-name">Name</label>
                    <input id="vc-steal-name" className={classes(cl("input"), error && cl("input-bad"))} value={name} spellCheck={false}
                        onChange={e => setName(e.currentTarget.value)} />
                    <div className={error ? cl("error") : cl("hint")}>{error ?? `Adding ${kind === "sticker" ? "a" : "an"} ${kind}. It's resized to fit Discord's size limit automatically.`}</div>
                </div>
            </div>

            {servers.length > 6 && (
                <input className={classes(cl("input"), cl("search"))} placeholder="Search your servers…" value={query} onChange={e => setQuery(e.currentTarget.value)} />
            )}

            <div className={cl("list")}>
                {servers.length === 0 && <div className={cl("empty")}><span className="vc-tool-empty-icon">🔒</span>You don't have permission to add {kind === "sticker" ? "stickers" : "emojis"} in any of your servers.</div>}
                {servers.length > 0 && shown.length === 0 && <div className={cl("empty")}>No servers match.</div>}
                {shown.map(({ guild: g, used, max }) => {
                    const full = used >= max;
                    const done = added[g.id];
                    return (
                        <div key={g.id} className={classes(cl("row"), full && !done && cl("row-full"))}>
                            {g.icon
                                ? <img className={cl("icon")} src={IconUtils.getGuildIconURL({ id: g.id, icon: g.icon, canAnimate: false, size: 64 })} alt="" />
                                : <div className={classes(cl("icon"), cl("icon-text"))}>{getGuildAcronym(g)}</div>}
                            <div className={cl("row-text")}>
                                <div className={cl("row-name")}>{g.name}</div>
                                <div className={cl("row-sub")}>{full ? `No free ${kind} slots (${used}/${max})` : `${max - used} of ${max} ${kind} slots free`}</div>
                            </div>
                            {done
                                ? <span className={cl("done")}>✓ Added</span>
                                : (
                                    <button type="button" className={cl("btn")} disabled={full || !!busy || !!error} onClick={() => steal(g)}>
                                        {busy === g.id ? "Adding…" : "Add"}
                                    </button>
                                )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function buildMenuItem(type: "Emoji" | "Sticker", fetchData: () => Promisable<Omit<Sticker | Emoji, "t">>) {
    return (
        <Menu.MenuItem
            id="emote-cloner"
            key="emote-cloner"
            label={`Steal ${type}`}
            leadingAccessory={{ type: "icon", icon: PlusIcon }}
            action={() =>
                openModalLazy(async () => {
                    const res = await fetchData();
                    const data = { t: type, ...res } as Sticker | Emoji;
                    const url = getUrl(data, 128);

                    return modalProps => (
                        <Window {...modalProps} size="md" title={`Steal ${type === "Emoji" ? "emoji" : "sticker"}`} subtitle="Pick a server to add it to">
                            <StealModal data={data} />
                        </Window>
                    );
                })
            }
        />
    );
}

function isGifUrl(url: string) {
    const u = new URL(url);
    return u.pathname.endsWith(".gif") || u.searchParams.get("animated") === "true";
}

function resolveEmojiName(favoriteableId: string, message: Message) {
    const emoji = EmojiStore.getCustomEmojiById(favoriteableId);
    if (emoji) return emoji.name;

    const reaction = message.reactions.find(reaction => reaction.emoji.id === favoriteableId);
    if (reaction) return reaction.emoji.name;

    const match = message.content.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${favoriteableId}>|https://cdn\\.discordapp\\.com/emojis/${favoriteableId}\\.[\\w?&=%]*`));
    if (!match) return null;

    return match[1]
        ?? URL.parse(match[0])?.searchParams.get("name")
        ?? "FakeNitroEmoji";
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props: Record<"favoriteableId" | "itemHref" | "itemSrc" | "favoriteableType", string> & { message: Message; }) => {
    const { favoriteableId, itemHref, itemSrc, favoriteableType, message } = props ?? {};

    if (!favoriteableId) return;

    const menuItem = (() => {
        switch (favoriteableType) {
            case "emoji":
                const name = resolveEmojiName(favoriteableId, message);
                if (!name) return;

                return buildMenuItem("Emoji", () => ({
                    id: favoriteableId,
                    name,
                    isAnimated: isGifUrl(itemHref ?? itemSrc)
                }));
            case "sticker":
                const sticker = message.stickerItems.find(s => s.id === favoriteableId);
                if (sticker?.format_type === 3 /* LOTTIE */) return;

                return buildMenuItem("Sticker", () => fetchSticker(favoriteableId));
        }
    })();

    if (menuItem)
        findGroupChildrenByChildId("copy-link", children)?.push(menuItem);
};

const expressionPickerPatch: NavContextMenuPatchCallback = (children, props: { target: HTMLElement; }) => {
    const { id, name, type } = props?.target?.dataset ?? {};
    if (!id) return;

    if (type === "emoji" && name) {
        const firstChild = props.target.firstChild as HTMLImageElement;

        children.push(buildMenuItem("Emoji", () => ({
            id,
            name,
            isAnimated: firstChild && isGifUrl(firstChild.src)
        })));
    } else if (type === "sticker" && !props.target.className?.includes("lottieCanvas")) {
        children.push(buildMenuItem("Sticker", () => fetchSticker(id)));
    }
};

export default definePlugin({
    name: "ExpressionCloner",
    description: "Right-click any emoji or sticker → Steal → pick one of your servers to add it to (resized to fit automatically).",
    tags: ["Emotes", "Servers"],
    searchTerms: ["StickerCloner", "EmoteCloner", "EmojiCloner"],
    // Original authors (scattagain only exists on newer Equicord, so only credit them where it does).
    authors: [Devs.Ven, Devs.Nuckyz, ...[(Devs as any).scattagain].filter(Boolean), { name: "aiqen", id: 779172192461783110n }],
    contextMenus: {
        "message": messageContextMenuPatch,
        "expression-picker": expressionPickerPatch
    }
});
