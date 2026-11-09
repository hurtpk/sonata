/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fail } from "./discord.mjs";

const types = [
    { label: "Video edit", value: "video" },
    { label: "Graphic design", value: "design" },
    { label: "Motion graphic or GIF", value: "motion" },
    { label: "Other", value: "other" },
];
const questions = [
    { id: "brief", label: "What do you want made?", max: 550, required: true, placeholder: "Describe the idea, deliverables, and where they'll be used." },
    { id: "references", label: "Do you have references or assets?", max: 200, required: false, placeholder: "Share links here or attach files in the ticket." },
    { id: "deadline", label: "When do you need it?", max: 100, required: true, placeholder: "A date or flexible" },
];

export const commissionFields = [
    { type: 18, label: "What are you commissioning?", component: { type: 3, custom_id: "commission-type", options: types, required: true, min_values: 1, max_values: 1 } },
    ...questions.map(({ id, label, max, required, placeholder }) => ({
        type: 18,
        label,
        component: { type: 4, custom_id: id, style: id === "deadline" ? 1 : 2, required, max_length: max, placeholder },
    })),
];

export function readCommissionFields(kind, details, fields) {
    if (kind !== "ticket" || details.intake !== "commission") return;
    const selection = fields.find(field => field.custom_id === "commission-type")?.values;
    const type = selection?.length === 1 && types.find(entry => entry.value === selection[0]);
    if (!type) fail("Choose a commission type.");
    const answers = questions.map(({ id, label, max, required }) => {
        const raw = fields.find(field => field.custom_id === id)?.value;
        const value = typeof raw === "string" ? raw.trim() : "";
        if ((required && !value) || value.length > max) fail("Complete the commission form and check the field lengths.");
        return `**${label}**\n${value || "None provided"}`;
    });
    return [`**Commission type**\n${type.label}`, ...answers].join("\n\n");
}
