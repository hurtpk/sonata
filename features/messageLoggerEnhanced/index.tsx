/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const Native = getNative();

import "./styles.css";

import { LogsIcon } from "@components/Icons";
import { Devs, EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, MessageStore, SelectedChannelStore, UserStore } from "@webpack/common";

import { OpenLogsButton } from "./components/LogsButton";
import { openLogModal } from "./components/LogsModal";
import * as idb from "./db";
import * as LoggedMessageManager from "./LoggedMessageManager";
import { addMessage } from "./LoggedMessageManager";
import { withoutStarred } from "./meta";
import { settings } from "./settings";
import { FetchMessagesResponse, LoadMessagePayload, LoggedMessage, LoggedMessageJSON, MessageCreatePayload, MessageDeleteBulkPayload, MessageDeletePayload, MessageUpdatePayload } from "./types";
import { cleanUpCachedMessage, cleanupUserObject, getNative, isGhostPinged, mapTimestamp, messageJsonToMessageClass, reAddDeletedMessages } from "./utils";
import { removeContextMenuBindings, setupContextMenuPatches } from "./utils/contextMenu";
import { shouldIgnore } from "./utils/index";
import { LimitedMap } from "./utils/LimitedMap";
import { doesMatch } from "./utils/parseQuery";
import * as imageUtils from "./utils/saveImage";
import * as ImageManager from "./utils/saveImage/ImageManager";
import { isWatched, watchAlert } from "./watch";
export { settings };

export const Flogger = new Logger("MessageLoggerEnhanced", "#f26c6c");

export const cacheSentMessages = new LimitedMap<string, LoggedMessageJSON>();
export const cl = classNameFactory("vc-msg-logger-enhanced-");

let didClearLogsOnStartup = false;

const cacheThing = findByPropsLazy("commit", "getOrCreate");

let autoCleanupTimer: ReturnType<typeof setTimeout> | undefined;

/** Deletes logs older than the "Delete logs older than" setting (starred ones stay). Returns how many went. */
export async function autoCleanup(days = settings.store.autoDeleteDays): Promise<number> {
    if (!days || days <= 0) return 0;
    await idb.initIDB();
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const old = await withoutStarred(await idb.db.getAllFromIndex("messages", "by_timestamp", IDBKeyRange.upperBound(cutoff)));
    if (!old.length) return 0;
    await idb.deleteMessagesBulkIDB(old.map(r => r.message_id));
    for (const r of old) await imageUtils.deleteMessageImages(r.message).catch(() => { });
    Flogger.info(`Deleted ${old.length} logs older than ${days} days`);
    return old.length;
}

export async function clearLogs(showToast = true) {
    await idb.clearMessagesIDB(showToast);
    cacheSentMessages.clear();
}

let oldGetMessage: typeof MessageStore.getMessage;

const handledMessageIds = new Set();
async function messageDeleteHandler(payload: MessageDeletePayload & { isBulk: boolean; }) {
    if (payload.mlDeleted) return;

    if (handledMessageIds.has(payload.id)) {
        return;
    }

    try {
        handledMessageIds.add(payload.id);

        let message: LoggedMessage | LoggedMessageJSON | null =
            oldGetMessage?.(payload.channelId, payload.id);
        if (message == null) {
            // most likely an edited message
            const cachedMessage = cacheSentMessages.get(`${payload.channelId},${payload.id}`);
            if (!cachedMessage) return; // Flogger.log("no message to save");

            message = { ...cacheSentMessages.get(`${payload.channelId},${payload.id}`), deleted: true } as LoggedMessageJSON;
        }

        const ghostPinged = isGhostPinged(message as any);

        if (
            shouldIgnore({
                channelId: message?.channel_id ?? payload.channelId,
                guildId: payload.guildId ?? (message as any).guildId ?? (message as any).guild_id,
                authorId: message?.author?.id,
                bot: message?.bot || message?.author?.bot,
                flags: message?.flags,
                ghostPinged,
                isCachedByUs: (message as LoggedMessageJSON).ourCache,
                webhookId: message?.webhookId
            })
        ) {
            return FluxDispatcher.dispatch({
                type: "MESSAGE_DELETE",
                channelId: payload.channelId,
                id: payload.id,
                mlDeleted: true
            });
        }

        if (message == null || message.channel_id == null || !message.deleted) return;
        if (payload.isBulk)
            return message;

        const currentChannelId = SelectedChannelStore.getChannelId();
        await addMessage(message, ghostPinged ? idb.DBMessageStatus.GHOST_PINGED : idb.DBMessageStatus.DELETED, currentChannelId);
        watchAlert(message, "deleted");
    }
    finally {
        handledMessageIds.delete(payload.id);
    }
}

async function messageDeleteBulkHandler({ channelId, guildId, ids }: MessageDeleteBulkPayload) {
    // is this bad? idk man
    const messages = [] as LoggedMessageJSON[];
    for (const id of ids) {
        const msg = await messageDeleteHandler({ type: "MESSAGE_DELETE", channelId, guildId, id, isBulk: true });
        if (msg) messages.push(msg as LoggedMessageJSON);
    }

    await idb.addMessagesBulkIDB(messages);

    if (messages.length > 0 && settings.store.timeBasedCleanupMinutes > 0) {
        const currentChannelId = SelectedChannelStore.getChannelId();
        const cutoffTime = new Date(Date.now() - settings.store.timeBasedCleanupMinutes * 60 * 1000).toISOString();
        const oldGuildMessages = await withoutStarred(await idb.getOlderThanTimestampForGuildsIDB(cutoffTime, currentChannelId, settings.store.preserveCurrentChannel));

        if (oldGuildMessages.length > 0) {
            Flogger.info(`Deleting ${oldGuildMessages.length} old server messages older than ${settings.store.timeBasedCleanupMinutes} minutes (bulk cleanup)`);
            await idb.deleteMessagesBulkIDB(oldGuildMessages.map(m => m.message_id));
        }
    }
}

async function messageUpdateHandler(payload: MessageUpdatePayload) {
    const cachedMessage = cacheSentMessages.get(`${payload.message.channel_id},${payload.message.id}`);
    if (
        shouldIgnore({
            channelId: payload.message?.channel_id,
            guildId: payload.guildId ?? (payload as any).guild_id,
            authorId: payload.message?.author?.id,
            bot: (payload.message?.author as any)?.bot,
            flags: payload.message?.flags,
            ghostPinged: isGhostPinged(payload.message as any),
            isCachedByUs: cachedMessage?.ourCache ?? false
        })
    ) {
        const cache = cacheThing.getOrCreate(payload.message.channel_id);
        const message = cache.get(payload.message.id);
        if (message) {
            message.editHistory = [];
            cacheThing.commit(cache);
        }
        return;
    }

    let message = oldGetMessage?.(payload.message.channel_id, payload.message.id) as LoggedMessage | LoggedMessageJSON | null;

    if (message == null) {
        // MESSAGE_UPDATE gets dispatched when emebeds change too and content becomes null
        if (cachedMessage != null && payload.message.content != null && cachedMessage.content !== payload.message.content) {
            message = {
                ...cachedMessage,
                content: payload.message.content,
                editHistory: [
                    ...(cachedMessage.editHistory ?? []),
                    {
                        content: cachedMessage.content,
                        timestamp: (new Date()).toISOString()
                    }
                ]
            };

            cacheSentMessages.set(`${payload.message.channel_id},${payload.message.id}`, message);
        }
    }

    if (message == null || message.channel_id == null || message.editHistory == null || message.editHistory.length === 0) return;

    const currentChannelId = SelectedChannelStore.getChannelId();
    await addMessage(message, idb.DBMessageStatus.EDITED, currentChannelId);
    watchAlert(message, "edited");
}

function messageCreateHandler(payload: MessageCreatePayload) {
    // we do this here because cache is limited and to save memory
    if (!settings.store.cacheMessagesFromServers && payload.guildId != null) {
        const ids = [payload.channelId, payload.message?.author?.id, payload.guildId];
        const isWhitelisted =
            settings.store.whitelistedIds
                .split(",")
                .some(e => ids.includes(e));
        if (!isWhitelisted && !isWatched(payload.message?.author?.id)) {
            return; // dont cache messages from servers when cacheMessagesFromServers is disabled and not whitelisted.
        }
    }

    cacheSentMessages.set(`${payload.message.channel_id},${payload.message.id}`, cleanUpCachedMessage(payload.message));
}

async function processMessageFetch(response: FetchMessagesResponse) {
    try {
        if (!response.ok) {
            Flogger.error("Failed to fetch messages", response);
            return;
        }

        if (!Array.isArray(response.body)) {
            Flogger.error("Failed to fetch messages: response body is not an array", response);
            return;
        }

        if (response.body.length === 0) return;

        const firstMessage = response.body[response.body.length - 1];
        const messages = await idb.getMessagesByChannelAndAfterTimestampIDB(firstMessage.channel_id, firstMessage.timestamp);

        if (!messages.length) return;

        const deletedMessages = messages.filter(m =>
            m.status === idb.DBMessageStatus.DELETED ||
            m.status === idb.DBMessageStatus.GHOST_PINGED
        );

        for (const recivedMessage of response.body) {
            const record = messages.find(m => m.message_id === recivedMessage.id);

            if (record == null) continue;

            if (record.message.editHistory && record.message.editHistory.length > 0) {
                recivedMessage.editHistory = record.message.editHistory;
            }
        }

        const fetchUser = (id: string) => UserStore.getUser(id) || response.body.find(e => e.author.id === id);

        for (let i = 0, len = messages.length; i < len; i++) {
            const record = messages[i];
            if (!record) continue;

            const { message } = record;

            for (let j = 0, len2 = message.mentions.length; j < len2; j++) {
                const user = message.mentions[j];
                const cachedUser = fetchUser((user as any).id || user);
                if (cachedUser) (message.mentions[j] as any) = cleanupUserObject(cachedUser);
            }

            const author = fetchUser(message.author.id);
            if (!author) continue;
            (message.author as any) = cleanupUserObject(author);
        }

        response.body.extra = deletedMessages.map(m => m.message);

    } catch (e) {
        Flogger.error("Failed to fetch messages", e);
    }
}

export default definePlugin({
    name: "MessageLoggerEnhanced",
    authors: [Devs.Aria, EquicordDevs.keircn],
    description: "Improves MessageLogger with edited message history, ghost ping detection and more",
    tags: ["Chat", "Servers"],
    dependencies: ["MessageLogger", "HeaderBarAPI"],

    patches: [
        {
            find: "_tryFetchMessagesCached",
            replacement: [
                // Both also accept the code after the Fake DMs plugin, which patches the same two spots
                // first, has already wrapped them (`async e=>(await …` and `get messages(){return …}`).
                {
                    match: /(?<=\.get\({url.+?then\()(?:async )?(\i)=>\(/,
                    replace: "async $1=>(await $self.processMessageFetch($1),"
                },
                {
                    match: /(?<=type:"LOAD_MESSAGES_SUCCESS",.{1,100})(?:messages:(\i)|get messages\(\) \{return (.+?\(\i, this\));\})/,
                    replace: (_, plain, wrapped) => `get messages() {return $self.coolReAddDeletedMessages(${plain ?? wrapped}, this);}`
                }

            ]
        },
        {
            find: ".PREMIUM_REFERRAL&&(",
            replacement: {
                match: /deleted:\i\.deleted, editHistory:\i\.editHistory,/,
                replace: "deleted:$self.getDeleted(...arguments), editHistory:$self.getEdited(...arguments),"
            }
        },
        // fix vidoes failing because there are no thumbnails
        {
            find: ".handleImageLoad)",
            replacement: {
                match: /(componentDidMount\(\){)(.{1,150}===(.+?)\.LOADING)/,
                replace:
                    "$1if(this.props?.src?.startsWith('blob:') && this.props?.item?.type === 'VIDEO')" +
                    "return this.setState({readyState: $3.READY});$2"
            }
        },

        // dont fetch messages for channels in modal
        {
            find: "Using PollReferenceMessageContext without",
            replacement: {
                match: /(?:\i\.)?\i\.(?:default\.)?focusMessage\(/,
                replace: "!(arguments[0]?.message?.deleted || arguments[0]?.message?.editHistory?.length > 0) && $&"
            }
        },

        // only check for expired attachments if the message is not deleted
        {
            find: ".ATTACHMENTS_REFRESH_URLS,",
            replacement: {
                match: /\i\.attachments\.some\(\i\)\|\|\i\.embeds\.some/,
                replace: "!arguments[0].deleted && $&"
            }
        }
    ],
    settings,

    toolboxActions: {
        "Message Logger"() {
            openLogModal();
        }
    },

    headerBarButton: {
        icon: LogsIcon,
        render() {
            if (!settings.store.ShowLogsButton) return null;
            return OpenLogsButton();
        }
    },

    processMessageFetch,
    openLogModal,
    doesMatch,
    reAddDeletedMessages,
    LoggedMessageManager,
    ImageManager,
    imageUtils,
    idb,

    coolReAddDeletedMessages: (messages: LoggedMessageJSON[] & { extra: LoggedMessageJSON[]; }, payload: LoadMessagePayload) => {
        try {
            if (messages.extra)
                reAddDeletedMessages(messages, messages.extra, !payload.hasMoreAfter && !payload.isBefore, !payload.hasMoreBefore && !payload.isAfter);
        }
        catch (e) {
            Flogger.error("Failed to re-add deleted messages", e);
        }
        finally {
            return messages;
        }
    },

    isDeletedMessage: (id: string) => cacheSentMessages.get(id)?.deleted ?? false,

    getDeleted(m1, m2) {
        const deleted = m2?.deleted;
        if (deleted == null && m1?.deleted != null) return m1.deleted;
        return deleted;
    },

    getEdited(m1, m2) {
        const editHistory = m2?.editHistory;
        if (editHistory == null && m1?.editHistory != null && m1.editHistory.length > 0)
            return m1.editHistory.map(mapTimestamp);
        return editHistory;
    },

    flux: {
        "MESSAGE_DELETE": messageDeleteHandler as any,
        "MESSAGE_DELETE_BULK": messageDeleteBulkHandler,
        "MESSAGE_UPDATE": messageUpdateHandler,
        "MESSAGE_CREATE": messageCreateHandler
    },

    async start() {
        this.oldGetMessage = oldGetMessage = MessageStore.getMessage;

        // we have to do this because the original message logger fetches the message from the store now
        MessageStore.getMessage = (channelId: string, messageId: string) => {
            const MLMessage = idb.cachedMessages.get(messageId);
            if (!MLMessage)
                return this.oldGetMessage(channelId, messageId);

            if (MLMessage.deleted)
                return messageJsonToMessageClass({ message: MLMessage });

            // update the edited message with the latest data
            const latestMessage = this.oldGetMessage(channelId, messageId);
            return messageJsonToMessageClass({
                message: {
                    ...MLMessage,
                    ...(latestMessage ?? {}),
                }
            });
        };

        Native.init();

        if (settings.store.clearLogsOnRestart && !didClearLogsOnStartup) {
            try {
                await clearLogs(false);
                didClearLogsOnStartup = true;
            } catch (e) {
                Flogger.error("Failed to clear logs on restart", e);
            }
        }

        const { imageCacheDir, logsDir, attachmentFileExtensions } = await Native.getSettings();
        settings.store.imageCacheDir = imageCacheDir;
        settings.store.logsDir = logsDir;
        settings.store.attachmentFileExtensions = attachmentFileExtensions ?? "none";

        setupContextMenuPatches();

        // "Delete logs older than…": once shortly after start, then every 6 hours.
        autoCleanupTimer = setTimeout(function run() {
            autoCleanup().catch(e => Flogger.error("Auto cleanup failed", e));
            autoCleanupTimer = setTimeout(run, 6 * 3600_000);
        }, 30_000);
    },

    stop() {
        clearTimeout(autoCleanupTimer);
        removeContextMenuBindings();
        MessageStore.getMessage = this.oldGetMessage;
    }
});
