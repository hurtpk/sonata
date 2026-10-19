/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { imageFromMenu, linkFromMenu, messageLink } from "../_shared/media";
import { AutoQr } from "./AutoQr";
import { openQrMaker, openQrScan } from "./Panel";

const settings = defineFeatureSettings("qrCodes", {
    autoScan: {
        type: OptionType.BOOLEAN,
        description: "Find QR codes in chat images by themselves, and show where they lead under the message (checked once each, only when on screen)",
        default: true,
    },
});

const Auto = ErrorBoundary.wrap(AutoQr, { noop: true });

function items(props: any) {
    const out: React.ReactNode[] = [];
    const image = imageFromMenu(props);
    const link = linkFromMenu(props);
    if (image) out.push(<Menu.MenuItem key="scan" id="vc-qr-scan" label="Scan QR code" action={() => openQrScan(image)} />);
    if (link) out.push(<Menu.MenuItem key="link" id="vc-qr-link" label="QR code for this link" action={() => openQrMaker(link)} />);
    if (props?.message?.id) {
        const guildId = (ChannelStore.getChannel(props.message.channel_id) as any)?.guild_id;
        out.push(<Menu.MenuItem key="msg" id="vc-qr-msg" label="QR code for message link" action={() => openQrMaker(messageLink(props.message, guildId))} />);
    }
    return out;
}

const messageMenu: NavContextMenuPatchCallback = (children, props) => {
    const list = items(props);
    if (!list.length) return;
    children.push(<Menu.MenuItem id="vc-qr" label="QR code">{list}</Menu.MenuItem>);
};

const imageMenu: NavContextMenuPatchCallback = (children, props) => {
    const image = imageFromMenu(props);
    if (image) children.push(<Menu.MenuItem id="vc-qr-scan-image" label="Scan QR code" action={() => openQrScan(image)} />);
};

export default definePlugin({
    name: "QRCodes",
    description: "Turn any message link, invite or text into a QR code, and scan QR codes in images — by themselves as they show up in chat, or with a right-click — with a safety check of where links really lead.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    renderMessageAccessory: ({ message }: Record<string, any>) => {
        if (!settings.store.autoScan || !(message?.attachments?.length || message?.embeds?.length)) return null;
        return <Auto message={message} />;
    },

    openSettingsModal: () => openQrMaker(),

    contextMenus: {
        "message": messageMenu,
        "image-context": imageMenu,
    },
});
