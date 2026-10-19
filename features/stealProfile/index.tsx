/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Menu, UserStore } from "@webpack/common";

import { openStealProfile } from "./Panel";

const userMenu: NavContextMenuPatchCallback = (children, props) => {
    const user = props?.user;
    if (!user?.id || user.id === UserStore.getCurrentUser()?.id) return;
    children.push(<Menu.MenuItem id="vc-steal-profile" label="Steal profile…" action={() => openStealProfile(user.id, props.guildId)} />);
};

export default definePlugin({
    name: "StealProfile",
    description: "Copy someone's profile picture, banner, about me, display name, pronouns and colours into a window where you can change anything, then apply it to your main profile or one server's profile. Your old profile is backed up first, so you can put it back.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openStealProfile(),

    contextMenus: {
        "user-context": userMenu,
        "user-profile-actions": userMenu,
    },
});
