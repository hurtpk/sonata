/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
if (window.parent !== window && new URLSearchParams(location.search).get("embed") === "1") {
    document.documentElement.classList.add("embedded");
    const sendSize = () => window.parent.postMessage({ type: "sonata-frame-size", height: Math.ceil(document.body.getBoundingClientRect().height) + 16 }, location.origin);
    new ResizeObserver(sendSize).observe(document.body); sendSize();
    document.addEventListener("click", event => {
        const anchor = event.target.closest("a"); if (!anchor || anchor.target || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const url = new URL(anchor.href, location.href);
        if (url.origin === location.origin && url.pathname === "/dashboard") {
            event.preventDefault(); window.parent.postMessage({ type: "sonata-open-dashboard", guild: url.searchParams.get("guild"), owner: url.searchParams.get("owner") === "1" }, location.origin);
        } else anchor.target = "_top";
    });
}
