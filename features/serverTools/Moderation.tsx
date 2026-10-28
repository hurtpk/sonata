/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import type { RenderModalProps } from "@vencord/discord-types";
import { React, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { openSection, registerSection } from "../_shared/Hub";
import { embeddedContext, Window } from "../_shared/Window";

const TOOLS = [
    { id: "memberLogs", name: "Member Logs" },
    { id: "activeTimeouts", name: "Timeouts" },
    { id: "autoModRegex", name: "AutoMod Regex" },
] as const;
type ToolId = typeof TOOLS[number]["id"];
type RenderTool = (props: RenderModalProps) => ReactNode;
const renderers = new Map<ToolId, RenderTool>();
const KEYS = ["plugins.Sonata.on_memberLogs", "plugins.Sonata.on_activeTimeouts", "plugins.Sonata.on_autoModRegex"] satisfies Parameters<typeof useSettings>[0];
let last: ToolId = "memberLogs";

export const registerModerationPart = (id: ToolId, render: RenderTool) => renderers.set(id, render);

export function ModerationWindow({ modalProps, start, first }: { modalProps: RenderModalProps; start?: ToolId; first?: RenderTool; }) {
    const store = useSettings(KEYS).plugins.Sonata;
    const tools = TOOLS.filter(tool => store[`on_${tool.id}`] !== false && renderers.has(tool.id));
    const [selected, setSelected] = useState<{ id: ToolId; render?: RenderTool; }>(() => ({ id: start ?? last, render: first }));
    const active = tools.find(tool => tool.id === selected.id) ?? tools[0];
    const render = active?.id === selected.id && selected.render ? selected.render : active && renderers.get(active.id);
    const Embedded = embeddedContext().Provider;
    return <Window {...modalProps} title="Moderation" size="xl" subtitle={active?.name ?? "Your moderation tools"}
        tabs={tools.map(tool => [tool.id, tool.name] as const)} tab={active?.id} onTab={id => {
            const tool = tools.find(entry => entry.id === id);
            if (tool) { last = tool.id; setSelected({ id: tool.id }); }
        }}>
        <Embedded value><ErrorBoundary key={active?.id}>{render ? render(modalProps) : <div className="vc-tool-empty">Switch on a moderation tool in Server Tools' options.</div>}</ErrorBoundary></Embedded>
    </Window>;
}

export const openModeration = (id: ToolId, render?: RenderTool) => { last = id; return openSection("serverTools", "moderation", props => <ModerationWindow modalProps={props} start={id} first={render} />); };
registerSection("serverTools", { id: "moderation", feature: "memberLogs", features: TOOLS.map(tool => tool.id), icon: "shield", order: 1, name: "Moderation", sub: "Cases, timeouts and AutoMod", render: props => <ModerationWindow modalProps={props} /> });
