/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Alerts, showToast, useState } from "@webpack/common";

import { clearMessagesIDB } from "../db";
import { Flogger } from "../index";

interface ClearLogsButtonProps {
    label?: string;
    onCleared?: () => void;
}

export function ClearLogsButton({ label = "Clear Logs", onCleared }: ClearLogsButtonProps) {
    const [loading, setLoading] = useState(false);
    return (
        <button type="button" className="vc-tool-btn vc-tool-danger vc-tool-primary" disabled={loading} onClick={() => Alerts.show({
                title: "Clear Logs",
                body: "Are you sure you want to clear all logs?",
                // @ts-ignore
                confirmVariant: "critical-primary",
                confirmText: "Clear",
                cancelText: "Cancel",
                onConfirm: async () => {
                    setLoading(true);
                    try {
                        await clearMessagesIDB();
                        onCleared?.();
                        showToast("Cleared Logs", "success");
                    } catch (err) {
                        Flogger.error("Failed to clear logs", err);
                        showToast("Failed to clear logs", "failure");
                    } finally {
                        setLoading(false);
                    }
                },
            })}>
            {loading ? "Clearing Logs..." : label}
        </button>
    );
}
