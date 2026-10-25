/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Weather: your city's forecast (now, the next 24 hours and the week) in a
// small window, and a weather card under messages like "weather in Tokyo".
// From Open-Meteo, which needs no account or key.

import "../_shared/tool.css";
import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";

import { ChatCard, openWeather } from "./Panel";
import { settings, weatherQuery } from "./store";

const SafeCard = ErrorBoundary.wrap(ChatCard, { noop: true });

export default definePlugin({
    name: "Weather",
    description: "Your city's forecast in a small window, and a weather card under messages like \"weather in Tokyo\". No account needed.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: () => openWeather(),
    renderMessageAccessory: ({ message }: Record<string, any>) => {
        if (!settings.store.chatCards) return null;
        const content: string = message?.content ?? "";
        if (content.length > 300 || !/weather/i.test(content)) return null;
        const q = weatherQuery(content);
        return q ? <SafeCard query={q} /> : null;
    },
});
