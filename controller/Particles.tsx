/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The drifting dust / star background, shared by the QOL page and the
// Message Purger window. The caller positions the canvas (absolute, behind
// its content) via the class it passes in.

import { useEffect, useRef } from "@webpack/common";

interface Mote { x: number; y: number; r: number; vx: number; vy: number; a: number; tw: number; ph: number; star: boolean; }

/**
 * Sparse drifting dust with the odd brighter star. Kept deliberately light:
 * roughly one mote per 16k px² (capped at 70), drawn on a single canvas,
 * paused while Discord's window is hidden, and frozen for reduced motion.
 */
export function Particles({ className }: { className: string; }) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const motes: Mote[] = [];
        let w = 0, h = 0, raf = 0, last = performance.now();

        const spawn = (anywhere: boolean): Mote => {
            const star = Math.random() < 0.12;
            return {
                x: Math.random() * w,
                y: anywhere ? Math.random() * h : h + 4,
                r: star ? 1.1 + Math.random() * 0.9 : 0.4 + Math.random() * 0.8,
                vx: (Math.random() - 0.5) * 6,
                vy: -(3 + Math.random() * 9),
                a: star ? 0.55 + Math.random() * 0.35 : 0.18 + Math.random() * 0.3,
                tw: 0.4 + Math.random() * 1.2,
                ph: Math.random() * Math.PI * 2,
                star,
            };
        };

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const rect = canvas.getBoundingClientRect();
            w = rect.width; h = rect.height;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const target = Math.min(70, Math.round((w * h) / 16000));
            while (motes.length < target) motes.push(spawn(true));
            motes.length = target;
            if (reduced) draw(0);
        };

        const draw = (t: number) => {
            ctx.clearRect(0, 0, w, h);
            for (const m of motes) {
                const twinkle = reduced ? 1 : 0.6 + 0.4 * Math.sin(t / 1000 * m.tw + m.ph);
                ctx.globalAlpha = m.a * twinkle;
                if (m.star) {
                    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 4);
                    g.addColorStop(0, "rgba(255,255,255,0.9)");
                    g.addColorStop(1, "rgba(255,255,255,0)");
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(m.x, m.y, m.r * 4, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.fillStyle = "#fff";
                ctx.beginPath();
                ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        };

        const step = (t: number) => {
            const dt = Math.min((t - last) / 1000, 0.05);
            last = t;
            for (let i = 0; i < motes.length; i++) {
                const m = motes[i];
                m.x += m.vx * dt;
                m.y += m.vy * dt;
                if (m.y < -6 || m.x < -6 || m.x > w + 6) motes[i] = spawn(false);
            }
            draw(t);
            raf = requestAnimationFrame(step);
        };

        const ro = new ResizeObserver(resize);
        ro.observe(canvas);
        resize();

        const onVisibility = () => {
            cancelAnimationFrame(raf);
            if (!document.hidden && !reduced) {
                last = performance.now();
                raf = requestAnimationFrame(step);
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        if (!reduced) raf = requestAnimationFrame(step);

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, []);

    return <canvas ref={ref} className={className} aria-hidden />;
}
