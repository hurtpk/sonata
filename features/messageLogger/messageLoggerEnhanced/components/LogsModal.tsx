/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyWithToast, openUserProfile } from "@utils/discord";
import { LazyComponent } from "@utils/react";
import { Channel, RenderModalProps, type User } from "@vencord/discord-types";
import { find, findByCodeLazy } from "@webpack";
import { Alerts, ChannelStore, closeAllModals, ContextMenuApi, FluxDispatcher, GuildStore, Menu, NavigationRouter, openModal, React, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../../../controller/accent";
import { Window } from "../../../_shared/Window";
import { DBMessageRecord, deleteMessageIDB, deleteMessagesBulkIDB } from "../db";
import { cl, clearLogs, settings } from "../index";
import { LoggedMessage, LoggedMessageJSON } from "../types";
import { messageJsonToMessageClass } from "../utils";
import { importLogs } from "../utils/settingsUtils";
import { openExplorer } from "./explorer/open";
import { useMessages } from "./hooks";

export interface MessagePreviewProps {
    className: string;
    author: User;
    message: LoggedMessage;
    channel: Channel,
    compact: boolean;
    isGroupStart: boolean;
    hideSimpleEmbedContent: boolean;
}

const PrivateChannelRecord = findByCodeLazy(".is_message_request_timestamp,");
const MessagePreview = LazyComponent<MessagePreviewProps>(() => find(m => m?.type?.toString().includes("previewLinkTarget:") && !m?.type?.toString().includes("HAS_THREAD")));

export enum LogTabs {
    DELETED = "Deleted",
    EDITED = "Edited",
    GHOST_PING = "Ghost Pinged"
}

interface Props {
    modalProps: RenderModalProps;
    initalQuery?: string;
}

export function LogsModal({ modalProps, initalQuery }: Props) {
    const [currentTab, setCurrentTab] = useState(LogTabs.DELETED);
    const [queryEh, setQuery] = useState(initalQuery ?? "");
    const [sortNewest, setSortNewest] = useState(settings.store.sortNewest);
    const [numDisplayedMessages, setNumDisplayedMessages] = useState(settings.store.messagesToDisplayAtOnceInLogs);
    const contentRef = useRef<HTMLDivElement | null>(null);

    const { messages, total, statusTotal, pending, reset } = useMessages(queryEh, currentTab, sortNewest, numDisplayedMessages);

    const accent = windowAccent("messageLoggerEnhanced");
    const pickTab = (t: LogTabs) => {
        setCurrentTab(t);
        setNumDisplayedMessages(settings.store.messagesToDisplayAtOnceInLogs);
        contentRef.current?.firstElementChild?.scrollTo(0, 0);
    };
    const toggleSort = () => {
        setSortNewest(e => { settings.store.sortNewest = !e; return !e; });
        contentRef.current?.firstElementChild?.scrollTo(0, 0);
    };
    const clearVisible = () => Alerts.show({
        title: "Clear these logs?",
        body: `This removes the ${messages.length} logged message${messages.length === 1 ? "" : "s"} you can see right now.`,
        confirmText: "Clear",
        confirmVariant: "critical-primary",
        cancelText: "Cancel",
        onConfirm: async () => { await deleteMessagesBulkIDB(messages.map(e => e.message_id)); reset(); },
    });
    const clearAll = () => Alerts.show({
        title: "Clear every log?",
        body: "This removes everything Message Logger has saved — deleted, edited and ghost pings.",
        confirmText: "Clear all",
        confirmVariant: "critical-primary",
        cancelText: "Cancel",
        onConfirm: async () => { await clearLogs(); reset(); },
    });

    return (
        <Window {...modalProps} size="lg" title="Message Logs" subtitle="Deleted and edited messages, and pings that vanished — saved on this computer">
            <div className={`vc-tool-wrap ${cl("window")}`} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
            <div className="vc-tool-tabs">
                {([[LogTabs.DELETED, "🗑️ Deleted"], [LogTabs.EDITED, "✏️ Edited"], [LogTabs.GHOST_PING, "👻 Ghost pings"]] as const).map(([t, label]) => (
                    <button key={t} type="button" className={`vc-tool-tab${currentTab === t ? " vc-tool-tab-on" : ""}`} onClick={() => pickTab(t)}>{label}</button>
                ))}
            </div>
            <div className={cl("toolbar")}>
                <input className="vc-tool-input" value={queryEh} onChange={e => setQuery(e.currentTarget.value)} placeholder="Search — or try from:sam  in:general  has:image  before:2026-10-01" />
                <button type="button" className="vc-tool-btn" onClick={toggleSort} title="Change the order">{sortNewest ? "↓ Newest first" : "↑ Oldest first"}</button>
            </div>
            <div style={{ opacity: modalProps.transitionState === 1 ? "1" : "0" }} className={`${cl("modal-content-container")} ${cl("modal-root")}`} ref={contentRef}>
                {
                    modalProps.transitionState === 1 &&
                    <div>
                        {pending && (
                            <LoadingLogs tab={currentTab} />
                        )}

                        {!pending && messages != null && total === 0 && (
                            <EmptyLogs
                                hasQuery={queryEh.length !== 0}
                                reset={reset}
                            />
                        )}

                        {!pending && messages != null && (
                            <LogsContentMemo
                                visibleMessages={messages}
                                canLoadMore={messages.length < statusTotal && messages.length >= settings.store.messagesToDisplayAtOnceInLogs}
                                tab={currentTab}
                                sortNewest={sortNewest}
                                reset={reset}
                                handleLoadMore={() => setNumDisplayedMessages(e => e + settings.store.messagesToDisplayAtOnceInLogs)}
                            />
                        )}
                    </div>
                }
            </div>
            <div className="vc-tool-footer">
                <span className="vc-tool-hint">{pending ? "Loading…" : `${messages?.length ?? 0} of ${statusTotal ?? 0} shown`}</span>
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn vc-tool-danger" disabled={!messages?.length} onClick={clearVisible}>Clear these</button>
                <button type="button" className="vc-tool-btn vc-tool-danger" onClick={clearAll}>Clear all logs</button>
            </div>
            </div>
        </Window>
    );
}

interface LogContentProps {
    sortNewest: boolean;
    tab: LogTabs;
    visibleMessages: DBMessageRecord[];
    canLoadMore: boolean;
    reset: () => void;
    handleLoadMore: () => void;
}

function LogsContent({ visibleMessages, canLoadMore, sortNewest, tab, reset, handleLoadMore }: LogContentProps) {
    if (visibleMessages.length === 0)
        return <NoResults tab={tab} />;

    return (
        <div className={cl("modal-content-inner")}>
            {visibleMessages
                .map(({ message }, i) => (
                    <LMessage
                        key={message.id}
                        log={{ message }}
                        reset={reset}
                        isGroupStart={isGroupStart(message, visibleMessages[i - 1]?.message, sortNewest)}
                    />
                ))}
            {
                canLoadMore &&
                <button type="button" className={`vc-tool-btn ${cl("more")}`} onClick={() => handleLoadMore()}>Show more</button>
            }
        </div>
    );
}

const LogsContentMemo = LazyComponent(() => LogsContent);

function NoResults({ tab }: { tab: LogTabs; }) {
    const generateSuggestedTabs = (tab: LogTabs) => {
        switch (tab) {
            case LogTabs.DELETED:
                return { nextTab: LogTabs.EDITED, lastTab: LogTabs.GHOST_PING };
            case LogTabs.EDITED:
                return { nextTab: LogTabs.GHOST_PING, lastTab: LogTabs.DELETED };
            case LogTabs.GHOST_PING:
                return { nextTab: LogTabs.DELETED, lastTab: LogTabs.EDITED };
            default:
                return { nextTab: "", lastTab: "" };
        }
    };

    const { nextTab, lastTab } = generateSuggestedTabs(tab);

    return (
        <div className="vc-tool-empty">
            <span className="vc-tool-empty-icon">🔍</span>
            Nothing matches in <b>{tab}</b>.
            <span>Try <b>{nextTab}</b> or <b>{lastTab}</b>.</span>
        </div>
    );
}

function EmptyLogs({ hasQuery, reset: forceUpdate }: { hasQuery: boolean; reset: () => void; }) {
    return (
        <div className="vc-tool-empty">
            <span className="vc-tool-empty-icon">{hasQuery ? "🔍" : "📭"}</span>
            {hasQuery ? "Nothing matches that search." : "Nothing logged yet — deleted and edited messages will show up here."}
            {!hasQuery && (
                <>
                    <span className="vc-tool-hint">Used an older version? Its logs live in a folder and can be brought in (nothing here gets overwritten).</span>
                    <button type="button" className="vc-tool-btn" onClick={() => importLogs().then(() => forceUpdate())}>Import old logs</button>
                </>
            )}
        </div>
    );
}

function LoadingLogs({ tab }: { tab: LogTabs; }) {
    return <div className="vc-tool-empty"><span className="vc-tool-empty-icon">⏳</span>Loading {tab.toLowerCase()} messages…</div>;
}

interface LMessageProps {
    log: { message: LoggedMessageJSON; };
    isGroupStart: boolean,
    reset: () => void;
}
export function LMessage({ log, isGroupStart, reset, }: LMessageProps) {
    const message = useMemo(() => messageJsonToMessageClass(log), [log]);

    if (!message) return null;

    const channel = ChannelStore.getChannel(message?.channel_id);
    const guild = GuildStore.getGuild(channel?.guild_id);

    return (
        <div
            onContextMenu={e => {
                ContextMenuApi.openContextMenu(e, () =>
                    <Menu.Menu
                        navId="message-logger"
                        onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
                        aria-label="Message Logger"
                    >

                        <Menu.MenuItem
                            key="jump-to-message"
                            id="jump-to-message"
                            label="Jump To Message"
                            action={() => {
                                NavigationRouter.transitionTo(`/channels/${ChannelStore.getChannel(message.channel_id)?.guild_id ?? "@me"}/${message.channel_id}${message.id ? "/" + message.id : ""}`);
                                closeAllModals();
                            }}
                        />
                        <Menu.MenuItem
                            key="open-user-profile"
                            id="open-user-profile"
                            label="Open user profile"
                            action={() => {
                                closeAllModals();
                                openUserProfile(message.author.id);
                            }}
                        />

                        <Menu.MenuItem
                            key="copy-content"
                            id="copy-content"
                            label="Copy Content"
                            action={() => copyWithToast(message.content)}
                        />

                        <Menu.MenuItem
                            key="copy-user-id"
                            id="copy-user-id"
                            label="Copy User ID"
                            action={() => copyWithToast(message.author.id)}
                        />

                        <Menu.MenuItem
                            key="copy-message-id"
                            id="copy-message-id"
                            label="Copy Message ID"
                            action={() => copyWithToast(message.id)}
                        />

                        <Menu.MenuItem
                            key="copy-channel-id"
                            id="copy-channel-id"
                            label="Copy Channel ID"
                            action={() => copyWithToast(message.channel_id)}
                        />

                        {
                            log.message.guildId != null
                            && (
                                <Menu.MenuItem
                                    key="copy-server-id"
                                    id="copy-server-id"
                                    label="Copy Server ID"
                                    action={() => copyWithToast(log.message.guildId!)}
                                />
                            )
                        }

                        <Menu.MenuItem
                            key="delete-log"
                            id="delete-log"
                            label="Delete Log"
                            color="danger"
                            action={() =>
                                deleteMessageIDB(log.message.id).then(() => reset())
                            }
                        />

                    </Menu.Menu>
                );
            }}>
            <MessagePreview
                className={`${cl("modal-msg-preview")} ${message.deleted ? "messagelogger-deleted" : ""}`}
                author={message.author}
                message={message}
                channel={ChannelStore.getChannel(message.channel_id) || new PrivateChannelRecord({ id: "" })}
                compact={false}
                isGroupStart={isGroupStart}
                hideSimpleEmbedContent={false}
            />
            {settings.store.ShowWhereMessageIsFrom && channel?.isDM() && message?.author && (
                <span className={`${cl("modal-from")} ${message.deleted ? cl("modal-from-deleted") : cl("modal-from-edited")}`}>From {message.author.username}'s DMs</span>
            )}
            {settings.store.ShowWhereMessageIsFrom && channel?.isGroupDM() && channel?.name && (
                <span className={`${cl("modal-from")} ${message.deleted ? cl("modal-from-deleted") : cl("modal-from-edited")}`}>From {channel.name} Group DM</span>
            )}
            {settings.store.ShowWhereMessageIsFrom && !channel?.isDM() && !channel?.isGroupDM() && channel?.name && guild?.name && (
                <span className={`${cl("modal-from")} ${message.deleted ? cl("modal-from-deleted") : cl("modal-from-edited")}`}>From {channel.name} in {guild.name}</span>
            )}
        </div>
    );
}

// The full log window (servers, DMs, media, people). The older list is still here as openClassicLogModal.
export const openLogModal = (initalQuery?: string) => openExplorer(initalQuery);
export const openClassicLogModal = (initalQuery?: string) => openModal(modalProps => <LogsModal modalProps={modalProps} initalQuery={initalQuery} />);

function isGroupStart(
    currentMessage: LoggedMessageJSON | undefined,
    previousMessage: LoggedMessageJSON | undefined,
    sortNewest: boolean
) {
    if (!currentMessage || !previousMessage) return true;

    if (currentMessage.id === previousMessage.id) return true;

    const [newestMessage, oldestMessage] = sortNewest
        ? [previousMessage, currentMessage]
        : [currentMessage, previousMessage];

    if (newestMessage.author.id !== oldestMessage.author.id) return true;

    const timeDifferenceInMinutes = Math.abs(
        (new Date(newestMessage.timestamp)?.getTime() - new Date(oldestMessage.timestamp)?.getTime()) / (1000 * 60)
    );

    return timeDifferenceInMinutes >= 5;
}
