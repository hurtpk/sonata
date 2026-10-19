/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Mini Games: tic-tac-toe, Connect Four and Hangman, played right in a DM
// or channel. Each player has one message per game, edited as they move; everyone with Sonata sees a
// playable board under it (see Board), and people without it see a summary.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconProps } from "@utils/types";

import { GameAccessory } from "./Board";
import { openMiniGames } from "./Panel";

export function GamesIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01" />
            <path d="M17.3 5H6.7a4 4 0 0 0-3.95 3.37l-.9 6.15A2.8 2.8 0 0 0 6.6 16.9L9 14.5h6l2.4 2.4a2.8 2.8 0 0 0 4.75-2.38l-.9-6.15A4 4 0 0 0 17.3 5Z" />
        </svg>
    );
}

const GamesChatBarButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton tooltip="Mini Games" onClick={openMiniGames}>
            <GamesIcon />
        </ChatBarButton>
    );
};

const Accessory = ErrorBoundary.wrap(GameAccessory, { noop: true });

export default definePlugin({
    name: "MiniGames",
    description: "Play tic-tac-toe, Connect Four, Hangman, Battleship, Word Duel, Checkers, Ultimate Tic-tac-toe, Dots and Boxes and Rock Paper Scissors with friends right in a DM or channel. Each player has just one message per game, edited with every move, with a playable board under it for everyone who has Sonata; moves out of turn don't count.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    dependencies: ["MessageAccessoriesAPI"],

    openSettingsModal: () => openMiniGames(),

    chatBarButton: {
        icon: GamesIcon,
        render: GamesChatBarButton,
    },

    renderMessageAccessory: ({ message }: Record<string, any>) => /\|\|sg[12]\./.test(message?.content ?? "") ? <Accessory message={message} /> : null,
});
