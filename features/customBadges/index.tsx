/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Custom Badges: badges on your own profile that only you can see — any of
// Discord's badge pictures, a picture of your own, or an emoji, each with your
// own hover text and an optional link. Nothing is sent anywhere: other people
// see your profile exactly as before.

import "../_shared/tool.css";
import "./styles.css";

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

import { openBadges } from "./Panel";
import { arrangeBadges, customKey, loadBadges, myBadges } from "./store";

const isMe = (userId?: string) => !!userId && userId === UserStore.getCurrentUser()?.id;

const badge: ProfileBadge = {
    id: "sonata-custom-badges",
    position: BadgePosition.START,
    // Only on your own profile.
    getBadges: ({ userId }) => isMe(userId)
        ? myBadges().map(b => ({ id: customKey(b.id), description: b.label || " ", iconSrc: b.src, link: b.link, position: BadgePosition.START }))
        : [],
};

export default definePlugin({
    name: "CustomBadges",
    description: "Badges on your own profile that only you can see: Discord's badge pictures, your own pictures or emoji, with your own hover text.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    dependencies: ["BadgeAPI"],

    patches: [
        {
            // Discord's badge list on a profile, before it's split into rows: your order and hidden badges
            // (real ones too) on your own profile. Checked against Discord build 8ca2d16 (Oct 2026).
            find: ".MODAL]:26",
            replacement: {
                match: /(\{displayProfile:(\i),themeType:.{0,1600}?)(if\(0===(\i)\.length&&!\i\)return null;)/,
                replace: "$1$4=$self.arrange($4,$2);$3",
            },
        },
    ],

    /** Your own profile's badges, in your order and without the ones you hid. Everyone else's are left alone. */
    arrange(list: any[], displayProfile: { userId?: string; } | null) {
        try {
            return isMe(displayProfile?.userId) ? arrangeBadges(list) : list;
        } catch {
            return list;
        }
    },

    openSettingsModal: () => openBadges(),

    start() {
        void loadBadges();
        addProfileBadge(badge);
    },
    stop() {
        removeProfileBadge(badge);
    },
});
