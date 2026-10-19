/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata Badge: a floating, shining light-blue music note next to the names
// of other people who use Sonata — in chat, the member list and your DMs.
//
// How it knows: if you switch on "Let other Sonata users see I use Sonata",
// an invisible marker is added to the end of your About Me (nothing visible
// changes; switching it off removes it). Sonata only looks for the marker on
// profiles you open or hover yourself — it never looks anyone up on its own —
// and anyone who sends something only Sonata makes counts too.

import "./styles.css";

import { SettingsStore } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { fetchUserProfile } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI, showToast, Tooltip, useEffect, useReducer,UserProfileStore, UserStore } from "@webpack/common";

import { defineFeatureSettings, prefixKey, QOL_NAME } from "../../featureSettings";
import { hasMarker, loadSonataUsers, MARKER, noteProfile, noteSonataMessage, onSonataUsersChange, usesSonata, withoutMarker } from "../_shared/sonataUsers";

/** Codes only Sonata sends (games, shared setups, gifts). */
export const SONATA_CODE = /\|\|(?:sg1|sset1|sgw1)\./;

/** Adds or removes the invisible marker at the end of your own About Me. */
async function setMarker(on: boolean) {
    const me = UserStore.getCurrentUser();
    if (!me) return;
    try {
        const profile: any = await fetchUserProfile(me.id, undefined, false);
        const current: string = profile?.bio ?? "";
        const bio = withoutMarker(current);
        const next = on ? `${bio}${MARKER}` : bio;
        if (next === current) return;
        if (on && [...next].length > 190) {
            showToast("Your About Me is full — make a little room for Sonata's invisible marker", "failure");
            settings.store.showOthers = false;
            return;
        }
        await RestAPI.patch({ url: "/users/@me/profile", body: { bio: next } });
        showToast(on ? "Other Sonata users can now see your ♫" : "Removed Sonata's marker from your About Me", "success");
    } catch {
        showToast("Couldn't update your About Me — try again in a moment", "failure");
    }
}

export const settings = defineFeatureSettings("sonataBadge", {
    showOthers: {
        type: OptionType.BOOLEAN,
        description: "Let other Sonata users see I use Sonata (adds an invisible marker to the end of your About Me — nothing visible changes; turning this off removes it)",
        default: false,
    },
    inChat: { type: OptionType.BOOLEAN, description: "Show the ♫ next to names in chat", default: true },
    inLists: { type: OptionType.BOOLEAN, description: "Show the ♫ in the member list and DM list", default: true },
});

function useSonataUsers() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onSonataUsersChange(bump), []);
}

/** The note: a light-blue to white gradient, floating, with a shine sweeping across. */
export const SonataNote = ErrorBoundary.wrap(({ userId, size = 15 }: { userId: string; size?: number; }) => {
    useSonataUsers();
    if (!userId || !usesSonata(userId)) return null;
    return (
        <Tooltip text="Uses Sonata ♫">
            {props => (
                <span {...props} className="vc-snb-badge" style={{ "--snb-size": `${size}px` } as React.CSSProperties} aria-label="Uses Sonata">
                    <span className="vc-snb-note" />
                </span>
            )}
        </Tooltip>
    );
}, { noop: true });

// Switching "Let other Sonata users see I use Sonata" adds or removes the marker.
const MARKER_PATH = `plugins.${QOL_NAME}.${prefixKey("sonataBadge", "showOthers")}`;
const onSetting = (value: unknown) => {
    void setMarker(!!value);
    const me = UserStore.getCurrentUser()?.id;
    if (me && value) noteSonataMessage(me);
};

const sawCodeFrom = (m: any) => {
    if (m?.author?.id && SONATA_CODE.test(m.content ?? "")) noteSonataMessage(m.author.id);
};

export default definePlugin({
    name: "SonataBadge",
    description: "A floating, shining light-blue ♫ next to the names of other people who use Sonata — in chat, the member list and DMs. Optionally lets other Sonata users see yours, with an invisible marker in your About Me.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    renderMessageDecoration: ({ message }: any) => settings.store.inChat && message?.author?.id ? <SonataNote userId={message.author.id} /> : null,
    renderMemberListDecorator: ({ user }: any) => settings.store.inLists && user?.id ? <SonataNote userId={user.id} size={14} /> : null,

    flux: {
        // Profiles Discord loads because you opened or hovered them are checked for the marker.
        USER_PROFILE_FETCH_SUCCESS({ userProfile }: any) {
            const id = userProfile?.user?.id;
            if (id) noteProfile(id, hasMarker(userProfile?.bio ?? UserProfileStore.getUserProfile(id)?.bio));
        },
        MESSAGE_CREATE({ message }: any) { sawCodeFrom(message); },
        LOAD_MESSAGES_SUCCESS({ messages }: any) { for (const m of messages ?? []) sawCodeFrom(m); },
    },

    async start() {
        await loadSonataUsers();
        // Your own messages show the note while your marker is on.
        const me = UserStore.getCurrentUser()?.id;
        if (me && settings.store.showOthers) noteSonataMessage(me);
        SettingsStore.addChangeListener(MARKER_PATH, onSetting);
    },

    stop() {
        SettingsStore.removeChangeListener(MARKER_PATH, onSetting);
    },
});
