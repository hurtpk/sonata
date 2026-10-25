/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { InfoIcon } from "@components/Icons";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Guild } from "@vencord/discord-types";

import { defineFeatureSettings } from "../../../featureSettings";
import { addInsightsItem } from "../Insights";

const makePatch: (showIcon: boolean) => NavContextMenuPatchCallback = showIcon => (children, { guild }: { guild: Guild; }) => {
    const group = findGroupChildrenByChildId("privacy", children);
    // One "Server Insights" item for Server Info, permissions and member lookup.
    if (group) addInsightsItem(group, guild, showIcon ? InfoIcon : undefined);
};

export const settings = defineFeatureSettings("serverInfo", {
    sorting: {
        type: OptionType.SELECT,
        description: "Username or if applicable Display Name",
        options: [
            {
                label: "Username",
                value: "username"
            },
            {
                label: "Display Name",
                value: "displayname",
                default: true
            },
            {
                label: "Dont Sort",
                value: "none",
            }
        ]
    }
});

export default definePlugin({
    name: "ServerInfo",
    description: "Allows you to view info about a server",
    tags: ["Servers", "Utility"],
    authors: [Devs.Ven, Devs.Nuckyz, EquicordDevs.Z1xus],
    dependencies: ["DynamicImageModalAPI"],
    searchTerms: ["guild", "info", "ServerProfile"],
    isModified: true,
    settings,
    contextMenus: {
        "guild-context": makePatch(false),
        "guild-header-popout": makePatch(true)
    }
});
