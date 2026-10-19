/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { TooltipContainer } from "@components/TooltipContainer";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { RenderModalProps } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Modal, openModal, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { parseEditContent, settings } from ".";

const CodeContainerClasses = findCssClassesLazy("markup", "codeContainer");
const MiscClasses = findCssClassesLazy("messageContent", "markupRtl");

const cl = classNameFactory("vc-ml-modal-");

export function openHistoryModal(message: any) {
    openModal(props =>
        <ErrorBoundary>
            <HistoryModal
                modalProps={props}
                message={message}
            />
        </ErrorBoundary>
    );
}

export function HistoryModal({ modalProps, message }: { modalProps: RenderModalProps; message: any; }) {
    const [currentTab, setCurrentTab] = useState(message.editHistory.length);
    const [showDiff, setShowDiff] = useState(settings.store.showEditDiffs);
    const timestamps = [message.firstEditTimestamp, ...message.editHistory.map(m => m.timestamp)];
    const contents = [...message.editHistory.map(m => m.content), message.content];

    const unlogged = message.firstEditTimestamp.getTime() !== message.timestamp.getTime();
    const accent = windowAccent("messageLogger");
    const when = (t: Date) => t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

    return (
        <Modal {...modalProps} size="lg" title="Edit history" subtitle={`${contents.length} versions of this message`}>
            <div className={classes("vc-tool-wrap", cl("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className="vc-tool-chips">
                    {unlogged && (
                        <TooltipContainer text="This version wasn't logged, so it can't be shown.">
                            <button type="button" className="vc-tool-chip" disabled>Original · {when(message.timestamp)}</button>
                        </TooltipContainer>
                    )}
                    {timestamps.map((timestamp, index) => (
                        <button key={index} type="button" className={classes("vc-tool-chip", currentTab === index && "vc-tool-chip-on")} onClick={() => setCurrentTab(index)}>
                            {index === 0 ? (unlogged ? "First logged" : "Original") : index === timestamps.length - 1 ? "Now" : `Edit ${index}`} · {when(timestamp)}
                        </button>
                    ))}
                </div>

                <section className="vc-tool-section">
                    <div className={classes(CodeContainerClasses.markup, MiscClasses.messageContent)}>
                        {parseEditContent(contents[currentTab], message, showDiff ? currentTab === contents.length - 1 ? undefined : contents[contents.length - 1] : undefined)}
                    </div>
                </section>

                <div className="vc-tool-footer">
                    <label className="vc-tool-check"><input type="checkbox" checked={showDiff} onChange={e => setShowDiff(e.currentTarget.checked)} /> Show what changed compared to now</label>
                    <span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-btn vc-tool-primary" onClick={modalProps.onClose}>Done</button>
                </div>
            </div>
        </Modal>
    );
}
