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

import "./style.css";

import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs, EquicordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { ActiveJoinedThreadsStore, FluxDispatcher, GuildChannelStore, GuildStore, React, ReadStateStore } from "@webpack/common";

function onClick() {
    const channels: Array<any> = [];

    Object.values(GuildStore.getGuilds()).forEach(guild => {
        GuildChannelStore.getChannels(guild.id).SELECTABLE
            .concat(GuildChannelStore.getChannels(guild.id).VOCAL)
            .concat(
                Object.values(ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guild.id))
                    .flatMap(threadChannels => Object.values(threadChannels))
            )
            .forEach((c: { channel: { id: string; }; }) => {
                if (!ReadStateStore.hasUnread(c.channel.id)) return;

                channels.push({
                    channelId: c.channel.id,
                    messageId: ReadStateStore.lastMessageId(c.channel.id),
                    readStateType: 0
                });
            });
    });

    FluxDispatcher.dispatch({
        type: "BULK_ACK",
        context: "APP",
        channels: channels
    });
}

function CheckIcon() {
    return (
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
            <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
    );
}

// A small framed button (instead of the plain underlined text link) that
// lifts on hover, presses in on click, then briefly turns green with a
// ripple and a check so it's clear the read-all went through.
function ReadAllButton() {
    const [done, setDone] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    React.useEffect(() => () => clearTimeout(timer.current), []);

    const handleClick = () => {
        onClick();
        setDone(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1400);
    };

    return (
        <div className="vc-ranb-wrap">
            <button
                type="button"
                className={classes("vc-ranb-button", done && "vc-ranb-done")}
                onClick={handleClick}
                aria-label="Mark all servers as read"
                title="Mark all servers as read"
            >
                <span key={done ? "done" : "idle"} className="vc-ranb-label">
                    {done ? <><CheckIcon /> Done</> : "Read All"}
                </span>
            </button>
        </div>
    );
}

export default definePlugin({
    name: "ReadAllNotificationsButton",
    description: "Read all server notifications with a single button click!",
    tags: ["Notifications", "Shortcuts"],
    authors: [Devs.kemo, EquicordDevs.KrystalSkull],
    dependencies: ["ServerListAPI"],

    renderReadAllButton: ErrorBoundary.wrap(ReadAllButton, { noop: true }),

    start() {
        addServerListElement(ServerListRenderPosition.Above, this.renderReadAllButton);
    },

    stop() {
        removeServerListElement(ServerListRenderPosition.Above, this.renderReadAllButton);
    }
});
