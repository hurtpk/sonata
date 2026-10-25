/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * QOL — native (Electron main process) helpers.
 *
 * Equicord gives each plugin folder exactly one native module, exposed as
 * VencordNative.pluginHelpers.<PluginName>. Translate, VoiceMessages,
 * MessageLoggerEnhanced and ZipPreview each had their own; now that they live
 * inside QOL, their helpers are re-exported from here
 * (VencordNative.pluginHelpers.Sonata). GifMaker's is intentionally not: its
 * lookup never matched even as a built-in, see features/mediaTools/gifMaker/native.ts.
 */

export { makeDeeplTranslateRequest, makeKagiTranslateRequest } from "./features/translate/native";
export { readRecording } from "./features/voiceMessages/voiceMessages/native";
// MessageLoggerEnhanced finds its helpers by a marker export it contains, so
// all of them are re-exported as-is.
export { fetchCrypto, fetchExchangeRates, fetchStock } from "./features/currencyConverter/native";
export { deleteWebhookMessage, fetchImageBytes, getWebhookMessage, privateRepliesApi, sendWebhook } from "./features/embeds/embedSender/native";
export { fetchDiscordFile } from "./features/filePreviews/filePreviewer/native";
export { clearPreviewCache, extractFromArchive, openArchive, openPdfWindow } from "./features/filePreviews/filePreviewer/previewCache";
export { fetchDiscordAttachment } from "./features/filePreviews/zipPreview/native";
export { gamesDealGame, gamesDealSearch, gamesDealStores, gamesDealTop, gamesEpicFree, gamesFortniteShop, gamesGamePass, gamesMcPlayer, gamesMcServer, gamesMoreFree, gamesTwitchDrops } from "./features/games/native";
export { rbxAssetFile, rbxAssetInfo, rbxCdnImage, rbxGame, rbxGroup, rbxHistory, rbxInventoryAt, rbxItem, rbxItemHistory, rbxJoin, rbxLimiteds, rbxNameCheck, rbxOutfit, rbxOwnedGames, rbxPlayerHistory, rbxSavedLive, rbxServers, rbxShop, rbxThumbs, rbxUser, rbxUserGroups, rbxWearing } from "./features/games/roblox/native";
export { steamAchievements, steamAppDetails, steamFriends, steamItems, steamNews, steamNoteImage, steamProfile, steamReviews, steamSearch, steamWishlist } from "./features/games/steam/native";
export { recognizeText } from "./features/images/imageToText/native";
export { expandLink } from "./features/linkCleaner/native";
export { dlCancel, dlCheck, dlInfo, dlOpen, dlPickFolder, dlPlaylist, dlProgress, dlReadFile, dlReveal, dlStart } from "./features/mediaTools/mediaDownloader/native";
export * from "./features/messageLogger/messageLoggerEnhanced/native";
export { musicCover, musicKnown, musicPick, radioBase, radioClicked, radioStations, radioStopAll, radioTools, scCovers, scLikes, scPrepare } from "./features/musicAudio/radio/native";
export { trackForget, trackRead } from "./features/packageTracker/native";
export { showsRefresh, showsSearch } from "./features/showTracker/native";
export { statusSummary } from "./features/sonataInsights/discordStatus/native";
export { robloxUser, tiktokProfile, tiktokRecent, tiktokVideo } from "./features/tiktokTracker/native";
export { walletBalance, walletPrices } from "./features/wallet/native";
export { weatherFind, weatherForecast } from "./features/weather/native";
export { clearCaches, deepMemory, getCacheSizes, getLeftovers, getMemory, getOldVersions, openFolder } from "./sonata/cacheNative";
export { sonataLatest, sonataRunUpdater, sonataUpdateStart, sonataUpdateStatus } from "./sonata/updateNative";
