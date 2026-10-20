/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Antiquest: Discord's Quests, gone. The promo card above your profile (quests,
// "Watch the video to win Orbs", sponsored ads), the Quests tab above your DMs
// and in Discovery, the quest icons in member lists, the "Active Now" quest
// promos, and Discord fetching quests at all. It only hides things: it never
// starts, plays or completes a quest.
// Patches based on Equicord's Questify (by its authors), checked against
// Discord build 8ca2d16 (Oct 2026).

import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";

export const settings = defineFeatureSettings("antiquest", {
    accountPanel: {
        type: OptionType.BOOLEAN,
        description: "Hide the promo card above your profile: quests, Orbs videos and sponsored ads.",
        default: true,
        restartNeeded: true,
    },
    questsTab: {
        type: OptionType.BOOLEAN,
        description: "Hide the Quests tab above your DMs and in Discovery.",
        default: true,
        restartNeeded: true,
    },
    promos: {
        type: OptionType.BOOLEAN,
        description: "Hide quest icons in member lists and quest promos in your friends list's Active Now.",
        default: true,
        restartNeeded: true,
    },
    noFetch: {
        type: OptionType.BOOLEAN,
        description: "Stop Discord loading quests at all — nothing quest-related can show up anywhere.",
        default: true,
        restartNeeded: true,
    },
});

export default definePlugin({
    name: "Antiquest",
    description: "Gets rid of Discord's Quests: the promo card above your profile, the Quests tab, quest promos, and quests loading at all.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    patches: [
        {
            // The promo area above your profile: a quest, a bounty or a sponsored ad. Draws nothing.
            find: "collapsed-with-rewards\":\"collapsed-without-rewards",
            predicate: () => settings.store.accountPanel,
            replacement: {
                match: /(?<=function\(\)\{)(let (\i)=\(0,\i\.\i\)\(\),\i=\(0,\i\.\i\)\(.{0,55}?\);)(?=switch\(\2\.type\)\{case \i\.\i\.QUEST:)/,
                replace: "return null;$1",
            },
        },
        {
            // The Quests tab above your DMs.
            find: '.QUEST_HOME)},"quests")',
            predicate: () => settings.store.questsTab,
            replacement: {
                match: /(?<="family-center"\)(?:&&undefined)?:null,)/,
                replace: "null&&",
            },
        },
        {
            // The Quests tab in Discovery: Discord already has a switch that leaves it out, so turn that on.
            find: 'location:"GlobalDiscoverySidebar"}).enabled?',
            predicate: () => settings.store.questsTab,
            replacement: {
                match: /(?<=location:"GlobalDiscoverySidebar"\}\)\.enabled)(?=\?)/,
                replace: "||true",
            },
        },
        {
            // The quest icon on people in member lists.
            find: '("ActivityStatus"),',
            predicate: () => settings.store.promos,
            replacement: {
                match: /,hasQuest:(?=\i=!1)/,
                replace: ",antiquestHasQuest:",
            },
        },
        {
            // Quest promos in the friends list's Active Now.
            find: "`application-stream-",
            predicate: () => settings.store.promos,
            replacement: {
                match: /(?<=let\{party:\i,onChannelContextMenu:\i,)quest:(\i)/,
                replace: "antiquestQuest:$1=null",
            },
        },
        {
            // Discord never loads quests, so there's nothing to show anywhere.
            find: 'type:"QUESTS_FETCH_CURRENT_QUESTS_BEGIN"',
            predicate: () => settings.store.noFetch,
            replacement: [
                {
                    match: /(?<=if\(\i.\i.isFetchingCurrentQuests)/,
                    replace: "||true",
                },
                {
                    match: /(?=let \i=Date.now\(\);\i.recordQuestRequestAttempt.{0,50}QUESTS_FETCH_QUEST_TO_DELIVER_BEGIN)/,
                    replace: "return;",
                },
            ],
        },
    ],
});
