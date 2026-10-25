/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../_shared/tool.css";
import "./styles.css";

import { Settings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore } from "@webpack/common";

import { defineFeatureSettings, QOL_NAME } from "../../../featureSettings";
import { refreshDock } from "../../../utilities/dock";
import { registerCustomDockButton } from "../../../utilities/shared";
import { openInviteManager } from "./Panel";
import { forgetInvite, loadInvites, rememberInvite } from "./store";

export const settings = defineFeatureSettings("inviteManager", {
    everyone: {
        type: OptionType.BOOLEAN,
        description: "In servers you manage, also list invites other people made",
        default: false,
    },
    addedToDock: {
        type: OptionType.BOOLEAN,
        description: "Internal: the dock button was added once (removing it from the dock keeps it removed).",
        default: false,
        hidden: true,
    },
});

const open = () => openInviteManager(settings.store.everyone, v => { settings.store.everyone = v; });

/** Put an Invite Manager button on the dock the first time, like adding it from Plugin Utilities → Dock. */
function addDockButtonOnce() {
    if (settings.store.addedToDock) return;
    settings.store.addedToDock = true;
    const store = Settings.plugins[QOL_NAME];
    let custom: Record<string, string> = {};
    try { custom = JSON.parse(store.customDock || "{}") ?? {}; } catch { }
    const id = "opticord:inviteManager";
    if (custom[id]) return;
    store.customDock = JSON.stringify({ ...custom, [id]: "link" });
    registerCustomDockButton(id, "link");
    refreshDock();
}

export default definePlugin({
    name: "InviteManager",
    description: "Every invite you've made across your servers in one list — uses, expiry and a note on who it's for. Copy or revoke any in one click, and spot old never-expiring invites still floating around.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: open,

    flux: {
        // Remember invites you make, so they show up even where you can't list a server's invites.
        INSTANT_INVITE_CREATE_SUCCESS({ channelId, invite }: any) {
            if (!invite?.code) return;
            rememberInvite({
                code: invite.code,
                guildId: invite.guild?.id ?? ChannelStore.getChannel(channelId)?.guild_id ?? null,
                channelId: invite.channel?.id ?? channelId ?? null,
                createdAt: invite.created_at ? Date.parse(invite.created_at) : Date.now(),
                maxAge: invite.max_age ?? 0,
                maxUses: invite.max_uses ?? 0,
            });
        },
        INSTANT_INVITE_REVOKE_SUCCESS({ code }: any) {
            if (code) forgetInvite(code);
        },
    },

    async start() {
        await loadInvites();
        addDockButtonOnce();
    },
});
