/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Full-screen effects drawn on a see-through canvas over Discord that ignores
// the mouse. Only ever shown on this computer. Shared by Birthday Reminders
// (confetti on the day) and Chat Effects.
//
// The first eight follow Apple's iMessage screen effects: the screen dims for
// Fireworks, Lasers and Spotlight, light is drawn additively so it glows, and
// balloons and the heart are drawn shapes rather than emoji.

export interface EffectInfo {
    id: string;
    name: string;
    /** Shown next to the name in lists. */
    icon: string;
    /** Trigger words suggested for Chat Effects (iMessage's own where it has them). */
    words: string[];
    /** One of Apple's iMessage screen effects. */
    apple?: boolean;
}

export const EFFECTS: EffectInfo[] = [
    { id: "echo", name: "Echo", icon: "🔁", words: [], apple: true },
    { id: "spotlight", name: "Spotlight", icon: "🔦", words: [], apple: true },
    { id: "balloons", name: "Balloons", icon: "🎈", words: ["happy birthday"], apple: true },
    { id: "confetti", name: "Confetti", icon: "🎊", words: ["congratulations", "congrats"], apple: true },
    { id: "love", name: "Love", icon: "❤️", words: ["love you", "i love you"], apple: true },
    { id: "lasers", name: "Lasers", icon: "✨", words: ["pew pew"], apple: true },
    { id: "fireworks", name: "Fireworks", icon: "🎆", words: ["happy new year"], apple: true },
    { id: "celebration", name: "Celebration", icon: "🎇", words: ["happy lunar new year", "happy chinese new year", "celebrate"], apple: true },
    { id: "party", name: "Party cannons", icon: "🎉", words: ["party", "🎉"] },
    { id: "snow", name: "Snow", icon: "❄️", words: ["merry christmas", "let it snow", "❄️"] },
    { id: "rain", name: "Rain", icon: "🌧️", words: ["rainy", "raining", "🌧️"] },
    { id: "hearts", name: "Floating hearts", icon: "💖", words: ["ily", "<3"] },
    { id: "bubbles", name: "Bubbles", icon: "🫧", words: ["bubbles", "🫧"] },
    { id: "stars", name: "Shooting stars", icon: "🌠", words: ["make a wish", "🌠"] },
    { id: "money", name: "Money rain", icon: "💸", words: ["payday", "make it rain", "💸"] },
    { id: "leaves", name: "Falling leaves", icon: "🍂", words: ["autumn", "fall vibes", "🍂"] },
    { id: "shake", name: "Screen shake", icon: "🫨", words: ["earthquake", "shake"] },
    { id: "rainbow", name: "Rainbow", icon: "🌈", words: ["rainbow", "🌈"] },
    { id: "barrelRoll", name: "Barrel roll", icon: "🌀", words: ["do a barrel roll"] },
];

export interface EffectOptions {
    /** The message text (Echo repeats it). */
    text?: string;
    /** Where the message is on screen (Spotlight lights it, Love grows from it). */
    anchor?: () => DOMRect | null;
}

// ─── Engine ───

interface Particle {
    x: number; y: number;
    vx: number; vy: number;
    rot: number; vr: number;
    size: number;
    age: number; life: number;
    color: string;
    /** Second colour, for confetti's back side. */
    back?: string;
    char?: string;
    shape: "rect" | "circle" | "line" | "ring" | "spark" | "char" | "star";
    gravity: number;
    drag: number;
    sway: number;
    phase: number;
    /** Drawn additively, so overlapping light adds up and glows. */
    glow?: boolean;
    /** Previous position, for light trails. */
    px?: number; py?: number;
    /** Twinkles (flickers) towards the end. */
    twinkle?: boolean;
}

/** A self-drawing part of an effect (a balloon, the heart, the laser rig…). Returns false when done. */
interface Actor { update(dt: number, ctx: CanvasRenderingContext2D): boolean; }

interface Dim { amount: number; start: number; end: number; fade: number; }

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let actors: Actor[] = [];
let dims: Dim[] = [];
let spawners: { until: number; every: number; next: number; spawn(): void; }[] = [];
let raf = 0;
let last = 0;
let clock = 0;
const charCache = new Map<string, HTMLCanvasElement>();

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const W = () => innerWidth, H = () => innerHeight;

function ensureCanvas() {
    if (canvas?.isConnected) return;
    canvas = document.createElement("canvas");
    canvas.className = "vc-opticord-effects";
    Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "100000" });
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    addEventListener("resize", resize);
}

function resize() {
    if (!canvas || !ctx) return;
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function teardown() {
    cancelAnimationFrame(raf);
    raf = 0;
    removeEventListener("resize", resize);
    canvas?.remove();
    canvas = ctx = null;
    particles = [];
    actors = [];
    dims = [];
    spawners = [];
}

function charImage(char: string, size: number) {
    const px = Math.max(8, Math.round(size / 4) * 4);
    const key = `${char}@${px}`;
    let img = charCache.get(key);
    if (!img) {
        img = document.createElement("canvas");
        img.width = img.height = px * 1.4;
        const c = img.getContext("2d")!;
        c.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(char, img.width / 2, img.height / 2);
        charCache.set(key, img);
    }
    return img;
}

function add(p: Partial<Particle> & Pick<Particle, "x" | "y">) {
    particles.push({
        vx: 0, vy: 0, rot: 0, vr: 0, size: 8, age: 0, life: 4, color: "#fff",
        shape: "rect", gravity: 0, drag: 0, sway: 0, phase: Math.random() * Math.PI * 2, ...p,
    });
}

function stream(seconds: number, every: number, spawn: () => void) {
    spawners.push({ until: clock + seconds, every, next: clock, spawn });
}

/** Darken the screen behind an effect, fading in and out. */
function dim(amount: number, seconds: number, fade = 0.45) {
    dims.push({ amount, start: clock, end: clock + seconds, fade });
}

function dimLevel() {
    let level = 0;
    for (const d of dims) {
        const inT = clamp01((clock - d.start) / d.fade), outT = clamp01((d.end - clock) / d.fade);
        level = Math.max(level, d.amount * Math.min(inT, outT));
    }
    return level;
}

/** The message's spot on screen, or the bottom of the chat if it can't be found. */
function anchorRect(o: EffectOptions): { x: number; y: number; w: number; h: number; } {
    const r = o.anchor?.();
    if (r && r.width > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
    return { x: W() * 0.3, y: H() - 140, w: W() * 0.4, h: 40 };
}

function animateApp(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    document.getElementById("app-mount")?.animate(keyframes, options);
}

// ─── Apple-style effects ───

const RAINBOW = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#30b0ff", "#5856d6", "#af52de", "#ff2d55"];
const CONFETTI = [
    ["#ff3b30", "#c22a22"], ["#ff9500", "#c47200"], ["#ffcc00", "#c79f00"], ["#34c759", "#24913f"],
    ["#30b0ff", "#1f7fc0"], ["#5856d6", "#3d3ba0"], ["#af52de", "#8038a6"], ["#ff2d55", "#c21e3f"], ["#ffffff", "#d6d6d6"],
];

/** iMessage confetti: a dense shower of two-sided strips that tumble and flutter down from the top. */
function confetti() {
    stream(1.6, 0.006, () => {
        const [front, back] = pick(CONFETTI);
        add({
            x: rand(-20, W() + 20), y: rand(-60, -10), vx: rand(-30, 30), vy: rand(80, 200),
            rot: rand(0, 6.3), vr: rand(-6, 6), size: rand(7, 13), color: front, back,
            shape: Math.random() < 0.12 ? "circle" : "rect", gravity: 140, drag: 1.1, sway: rand(25, 70), life: 7,
        });
    });
}

/** A glossy rubber balloon on a curly string, drifting up. */
function balloon(delay: number) {
    const color = pick(["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#30b0ff", "#5856d6", "#af52de", "#ff2d55", "#ff6b9d"]);
    const r = rand(34, 56);
    const x = rand(r, W() - r);
    let y = H() + r * 2.5 + rand(0, 200);
    const speed = rand(150, 230), swayAmp = rand(14, 32), phase = rand(0, 6.3);
    let t = -delay;
    return {
        update(dt: number, c: CanvasRenderingContext2D) {
            t += dt;
            if (t < 0) return true;
            y -= speed * dt;
            const bx = x + Math.sin(t * 1.4 + phase) * swayAmp, tilt = Math.cos(t * 1.4 + phase) * 0.12;
            c.save();
            c.translate(bx, y);
            c.rotate(tilt);
            // String: a soft curl trailing below the knot.
            c.strokeStyle = "rgba(255,255,255,0.55)";
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(0, r * 1.18);
            for (let i = 1; i <= 12; i++) c.lineTo(Math.sin(t * 3 + i * 0.9) * 5, r * 1.18 + i * r * 0.16);
            c.stroke();
            // Body: slightly egg-shaped, lit from the top left.
            const g = c.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.1, 0, 0, r * 1.2);
            g.addColorStop(0, "rgba(255,255,255,0.95)");
            g.addColorStop(0.18, color);
            g.addColorStop(1, shade(color, -0.45));
            c.fillStyle = g;
            c.beginPath();
            c.ellipse(0, 0, r * 0.86, r, 0, 0, Math.PI * 2);
            c.fill();
            // Knot.
            c.fillStyle = shade(color, -0.3);
            c.beginPath();
            c.moveTo(-r * 0.1, r * 0.98); c.lineTo(r * 0.1, r * 0.98); c.lineTo(0, r * 1.18); c.closePath();
            c.fill();
            // Shine.
            c.fillStyle = "rgba(255,255,255,0.45)";
            c.beginPath();
            c.ellipse(-r * 0.36, -r * 0.42, r * 0.14, r * 0.26, -0.5, 0, Math.PI * 2);
            c.fill();
            c.restore();
            return y > -r * 3.5;
        },
    };
}

function shade(hex: string, amount: number) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v: number) => Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function balloons() {
    for (let i = 0; i < 22; i++) actors.push(balloon(i * 0.09 + rand(0, 0.3)));
}

/** Heart path centred on 0,0, about 2 units wide. */
function heartPath(c: CanvasRenderingContext2D, s: number) {
    c.beginPath();
    c.moveTo(0, s * 0.75);
    c.bezierCurveTo(-s * 1.15, -s * 0.05, -s * 0.75, -s * 1.05, 0, -s * 0.45);
    c.bezierCurveTo(s * 0.75, -s * 1.05, s * 1.15, -s * 0.05, 0, s * 0.75);
    c.closePath();
}

/** iMessage Love: one big glossy heart swells up from the message, beats twice, then floats away. */
function love(o: EffectOptions) {
    const a = anchorRect(o);
    const fromX = a.x + a.w / 2, fromY = a.y + a.h / 2;
    const toX = W() / 2, toY = H() * 0.45, full = Math.min(W(), H()) * 0.26;
    let t = 0;
    actors.push({
        update(dt, c) {
            t += dt;
            const grow = easeOut(clamp01(t / 0.7));
            const beat = t > 0.7 && t < 2.1 ? 1 + 0.09 * Math.max(0, Math.sin((t - 0.7) * Math.PI * 2.2)) : 1;
            const leave = clamp01((t - 2.2) / 0.9);
            const x = fromX + (toX - fromX) * grow, y = fromY + (toY - fromY) * grow - leave * H() * 0.35;
            const s = full * (0.15 + 0.85 * grow) * beat * (1 + leave * 0.25);
            c.save();
            c.globalAlpha = 1 - leave;
            c.translate(x, y);
            c.shadowColor = "rgba(255,40,80,0.55)";
            c.shadowBlur = s * 0.35;
            const g = c.createLinearGradient(0, -s, 0, s);
            g.addColorStop(0, "#ff6b8a");
            g.addColorStop(0.55, "#ff2d55");
            g.addColorStop(1, "#c4103a");
            c.fillStyle = g;
            heartPath(c, s);
            c.fill();
            c.shadowBlur = 0;
            // Glossy highlight on the upper left lobe.
            c.fillStyle = "rgba(255,255,255,0.35)";
            c.beginPath();
            c.ellipse(-s * 0.42, -s * 0.48, s * 0.18, s * 0.11, -0.6, 0, Math.PI * 2);
            c.fill();
            c.restore();
            return t < 3.1;
        },
    });
}

/** iMessage Lasers: a dark room and a disco rig sweeping coloured beams from the centre. */
function lasers() {
    dim(0.82, 3.6, 0.35);
    const beams = 12;
    let t = 0;
    actors.push({
        update(dt, c) {
            t += dt;
            const fade = Math.min(clamp01(t / 0.35), clamp01((3.6 - t) / 0.4));
            const cx = W() / 2, cy = H() * 0.42, len = Math.hypot(W(), H());
            c.save();
            c.globalCompositeOperation = "lighter";
            for (let i = 0; i < beams; i++) {
                const angle = t * (i % 2 ? 1.1 : -0.8) + (i / beams) * Math.PI * 2 + Math.sin(t * 2 + i) * 0.25;
                const hue = (t * 120 + i * 30) % 360;
                const ex = cx + Math.cos(angle) * len, ey = cy + Math.sin(angle) * len;
                const flicker = 0.75 + 0.25 * Math.sin(t * 18 + i * 3);
                for (const [width, alpha] of [[14, 0.12], [5, 0.35], [1.6, 0.95]] as const) {
                    const g = c.createLinearGradient(cx, cy, ex, ey);
                    g.addColorStop(0, `hsla(${hue},100%,65%,${alpha * fade * flicker})`);
                    g.addColorStop(1, `hsla(${hue},100%,65%,0)`);
                    c.strokeStyle = g;
                    c.lineWidth = width;
                    c.beginPath();
                    c.moveTo(cx, cy);
                    c.lineTo(ex, ey);
                    c.stroke();
                }
            }
            // The glowing source.
            const core = c.createRadialGradient(cx, cy, 0, cx, cy, 34);
            core.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
            core.addColorStop(1, "rgba(255,255,255,0)");
            c.fillStyle = core;
            c.beginPath();
            c.arc(cx, cy, 34, 0, Math.PI * 2);
            c.fill();
            c.restore();
            return t < 3.6;
        },
    });
}

/** A firework bursting: a ring of glowing sparks with trails, drooping and twinkling out. */
function burst(x: number, y: number, palette: string[], count = 90, speed = 330) {
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand(-0.05, 0.05), s = speed * rand(0.55, 1);
        add({ x, y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, shape: "spark", color: pick(palette), size: rand(1.8, 3), life: rand(1.4, 2.1), gravity: 80, drag: 1.3, glow: true, twinkle: true });
    }
    // The bright flash at its heart.
    add({ x, y, shape: "circle", color: "rgba(255,255,240,0.9)", size: 34, life: 0.3, glow: true });
}

const FIREWORK_PALETTES = [
    ["#ffd76a", "#ffb340", "#fff3c4"], ["#ff5e8a", "#ff9ec0", "#ffffff"], ["#5ec8ff", "#a9e4ff", "#ffffff"],
    ["#7dff8a", "#c8ffcc", "#ffffff"], ["#c58bff", "#e6ccff", "#ffffff"], ["#ff7a45", "#ffd0b3", "#ffe9a0"],
];

/** iMessage Fireworks: the screen goes dark and bursts go off one after another. */
function fireworks() {
    dim(0.72, 4.2);
    const spots = 9;
    for (let i = 0; i < spots; i++) {
        const at = clock + 0.25 + i * 0.38 + rand(0, 0.15);
        spawners.push({
            until: at, every: 1, next: at,
            spawn: () => burst(rand(W() * 0.15, W() * 0.85), rand(H() * 0.12, H() * 0.55), pick(FIREWORK_PALETTES), Math.round(rand(70, 110)), rand(260, 380)),
        });
    }
}

/** iMessage Celebration: golden glitter showering out from the top-right corner. */
function celebration() {
    dim(0.35, 3.4);
    stream(2.2, 0.008, () => {
        const a = rand(Math.PI * 0.55, Math.PI * 0.95), s = rand(250, 750);
        add({
            x: W() + 10, y: -10, px: W() + 10, py: -10, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            shape: Math.random() < 0.25 ? "star" : "spark", color: pick(["#ffd76a", "#ffe9a8", "#fff6d8", "#ffc14d", "#ffffff"]),
            size: rand(1.2, 3.2), life: rand(1.8, 3), gravity: 70, drag: 0.9, glow: true, twinkle: true,
        });
    });
}

/** iMessage Spotlight: everything goes dark except a soft light that finds the message. */
function spotlight(o: EffectOptions) {
    let t = 0;
    const startX = rand(W() * 0.2, W() * 0.8), startY = H() * 0.2;
    actors.push({
        update(dt, c) {
            t += dt;
            const a = anchorRect(o);
            const tx = a.x + a.w / 2, ty = a.y + a.h / 2;
            const settle = easeOut(clamp01((t - 0.2) / 1));
            const x = startX + (tx - startX) * settle, y = startY + (ty - startY) * settle;
            const radius = Math.max(90, Math.min(a.w * 0.65, 320));
            const alpha = 0.78 * Math.min(clamp01(t / 0.35), clamp01((3.4 - t) / 0.5));
            c.save();
            const g = c.createRadialGradient(x, y, radius * 0.55, x, y, radius * 1.15);
            g.addColorStop(0, "rgba(0,0,0,0)");
            g.addColorStop(1, `rgba(0,0,0,${alpha})`);
            c.fillStyle = g;
            c.fillRect(0, 0, W(), H());
            // A warm wash inside the light.
            c.globalCompositeOperation = "lighter";
            const warm = c.createRadialGradient(x, y, 0, x, y, radius);
            warm.addColorStop(0, `rgba(255,248,225,${0.1 * alpha})`);
            warm.addColorStop(1, "rgba(255,248,225,0)");
            c.fillStyle = warm;
            c.beginPath();
            c.arc(x, y, radius, 0, Math.PI * 2);
            c.fill();
            c.restore();
            return t < 3.4;
        },
    });
}

/** iMessage Echo: copies of the message burst out of it and fly off across the screen. */
function echo(o: EffectOptions) {
    const text = (o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "👋";
    const a = anchorRect(o);
    const ox = a.x + Math.min(a.w, 300) / 2, oy = a.y + a.h / 2;
    const reach = Math.hypot(W(), H()) * 0.75;
    for (let i = 0; i < 32; i++) {
        let t = -i * 0.035;
        const angle = rand(0, Math.PI * 2), dist = reach * rand(0.6, 1.1);
        const x1 = ox + Math.cos(angle) * dist, y1 = oy + Math.sin(angle) * dist * 0.8;
        const dur = rand(1.3, 2), scale = rand(0.7, 1.7);
        const blue = Math.random() < 0.7;
        actors.push({
            update(dt, c) {
                t += dt;
                if (t < 0) return true;
                const k = clamp01(t / dur), e = easeOut(k);
                const x = ox + (x1 - ox) * e, y = oy + (y1 - oy) * e;
                c.save();
                c.translate(x, y);
                c.scale(scale * (0.4 + 0.6 * e), scale * (0.4 + 0.6 * e));
                c.globalAlpha = Math.min(1, (1 - k) * 2.5, k * 10);
                c.font = '15px -apple-system,"SF Pro Text","gg sans","Segoe UI",sans-serif';
                const w = Math.min(c.measureText(text).width, 360) + 26, h = 32;
                c.fillStyle = blue ? "#0a84ff" : "#3a3a3c";
                c.beginPath();
                c.roundRect(-w / 2, -h / 2, w, h, 16);
                c.fill();
                c.fillStyle = "#fff";
                c.textAlign = "center";
                c.textBaseline = "middle";
                c.fillText(text, 0, 1, 360);
                c.restore();
                return k < 1;
            },
        });
    }
}

// ─── The extras ───

const fallingChars = (chars: string[], seconds: number, every: number, opts: () => Partial<Particle> = () => ({})) =>
    stream(seconds, every, () => add({ x: rand(0, W()), y: -40, vy: rand(90, 160), vx: rand(-20, 20), shape: "char", char: pick(chars), size: rand(22, 38), vr: rand(-1.5, 1.5), sway: rand(20, 50), life: 12, ...opts() }));

const risingChars = (chars: string[], seconds: number, every: number, opts: () => Partial<Particle> = () => ({})) =>
    stream(seconds, every, () => add({ x: rand(0, W()), y: H() + 40, vy: rand(-170, -110), shape: "char", char: pick(chars), size: rand(30, 48), sway: rand(15, 35), life: 12, ...opts() }));

const STARTERS: Record<string, (o: EffectOptions) => void> = {
    echo, spotlight, balloons, confetti, love, lasers, fireworks, celebration,
    party: () => {
        for (const side of [0, 1]) {
            for (let i = 0; i < 110; i++) {
                const a = side === 0 ? rand(-1.35, -0.75) : rand(-2.4, -1.8), s = rand(650, 1150);
                const [front, back] = pick(CONFETTI);
                add({
                    x: side === 0 ? 0 : W(), y: H(), vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: rand(0, 6), vr: rand(-10, 10),
                    size: rand(6, 11), color: front, back, gravity: 520, drag: 1.6, sway: rand(10, 40), life: 6,
                });
            }
        }
    },
    snow: () => stream(4.5, 0.03, () => add({
        x: rand(-20, W() + 20), y: -10, vy: rand(30, 80), vx: rand(-15, 15), shape: "circle", size: rand(1.5, 4.5),
        color: "rgba(255,255,255,0.9)", sway: rand(15, 40), life: 18,
    })),
    rain: () => stream(3.5, 0.006, () => add({
        x: rand(0, W() + 200), y: -30, vy: rand(900, 1300), vx: -200, shape: "line", size: rand(12, 22),
        color: "rgba(160,190,255,0.55)", life: 2,
    })),
    hearts: () => risingChars(["💖", "💗", "💕", "❤️", "💘"], 3, 0.07),
    bubbles: () => stream(3.5, 0.05, () => add({
        x: rand(0, W()), y: H() + 20, vy: rand(-150, -70), shape: "ring", size: rand(6, 20), color: "rgba(170,220,255,0.7)", sway: rand(15, 35), life: 14,
    })),
    stars: () => stream(3, 0.18, () => {
        add({ x: rand(W() * 0.2, W() * 1.1), y: rand(-40, H() * 0.3), vx: rand(-900, -650), vy: rand(250, 420), shape: "line", size: rand(60, 110), color: "rgba(255,245,200,0.95)", life: 1.6, glow: true });
    }),
    money: () => fallingChars(["💸", "💵", "💰", "🪙"], 3, 0.05),
    leaves: () => fallingChars(["🍂", "🍁", "🍃"], 4, 0.09, () => ({ vy: rand(60, 110), sway: rand(50, 90), vr: rand(-2, 2) })),
    shake: () => {
        if (reducedMotion()) return;
        animateApp(Array.from({ length: 12 }, (_, i) => ({ transform: i === 11 ? "none" : `translate(${rand(-12, 12)}px, ${rand(-9, 9)}px) rotate(${rand(-0.8, 0.8)}deg)` })), { duration: 650, easing: "linear" });
    },
    rainbow: () => animateApp([{ filter: "hue-rotate(0deg) saturate(1.6)" }, { filter: "hue-rotate(360deg) saturate(1.6)" }, { filter: "none" }], { duration: 2400, easing: "linear" }),
    barrelRoll: () => {
        if (reducedMotion()) return;
        animateApp([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 1400, easing: "cubic-bezier(.45,.05,.55,.95)" });
    },
};

function starPath(c: CanvasRenderingContext2D, s: number) {
    c.beginPath();
    for (let i = 0; i < 8; i++) {
        const r = i % 2 ? s * 0.35 : s * 1.6, a = (i / 8) * Math.PI * 2;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
}

function drawParticle(c: CanvasRenderingContext2D, p: Particle) {
    const fade = Math.min(1, (p.life - p.age) / 0.6);
    let alpha = Math.max(0, fade);
    if (p.twinkle && p.age > p.life * 0.55) alpha *= 0.45 + 0.55 * Math.abs(Math.sin(p.age * 28 + p.phase));
    c.globalAlpha = alpha;
    c.globalCompositeOperation = p.glow ? "lighter" : "source-over";

    if (p.shape === "spark" && p.px != null) {
        // A light streak as long as it is fast, so bursts read as bright rays that slow and droop.
        c.strokeStyle = p.color;
        c.lineWidth = p.size;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
        c.lineTo(p.x, p.y);
        c.stroke();
        c.fillStyle = "#fff";
        c.beginPath();
        c.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
        c.fill();
        return;
    }

    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    switch (p.shape) {
        case "rect": {
            // Tumbling: squash one side and show the darker back when it flips over.
            const flip = Math.cos(p.age * 7 + p.phase);
            c.fillStyle = flip < 0 && p.back ? p.back : p.color;
            c.scale(1, Math.max(0.08, Math.abs(flip)));
            c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            break;
        }
        case "circle":
        case "spark":
            c.fillStyle = p.color;
            c.beginPath();
            c.arc(0, 0, p.size, 0, Math.PI * 2);
            c.fill();
            break;
        case "star":
            c.fillStyle = p.color;
            starPath(c, p.size * 1.6);
            c.fill();
            break;
        case "ring":
            c.strokeStyle = p.color;
            c.lineWidth = 1.5;
            c.beginPath();
            c.arc(0, 0, p.size, 0, Math.PI * 2);
            c.stroke();
            break;
        case "line": {
            const len = Math.hypot(p.vx, p.vy) || 1;
            c.strokeStyle = p.color;
            c.lineWidth = 2;
            c.lineCap = "round";
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(-p.vx / len * p.size, -p.vy / len * p.size);
            c.stroke();
            break;
        }
        case "char": {
            const img = charImage(p.char!, p.size);
            c.drawImage(img, -img.width / 2, -img.height / 2);
            break;
        }
    }
    c.restore();
}

function step(t: number) {
    if (!ctx) return;
    const now = t / 1000;
    const dt = Math.min(0.05, now - (last || now));
    last = now;
    clock += dt;

    for (const s of spawners) {
        while (s.next <= clock && s.next <= s.until) { s.spawn(); s.next += s.every; }
    }
    spawners = spawners.filter(s => s.next <= s.until);

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W(), H());

    const level = dimLevel();
    if (level > 0) {
        ctx.fillStyle = `rgba(0,0,0,${level})`;
        ctx.fillRect(0, 0, W(), H());
    }
    dims = dims.filter(d => clock < d.end);

    const next: Particle[] = [];
    for (const p of particles) {
        p.age += dt;
        p.px = p.x; p.py = p.y;
        p.vy += p.gravity * dt;
        if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
        p.x += (p.vx + Math.sin(p.phase + p.age * 3) * p.sway) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const offscreen = p.y > H() + 80 || p.y < -200 || p.x < -300 || p.x > W() + 300;
        if (p.age >= p.life || (offscreen && p.age > 0.3)) continue;
        next.push(p);
        drawParticle(ctx, p);
    }
    particles = next;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    actors = actors.filter(a => {
        ctx!.save();
        const alive = a.update(dt, ctx!);
        ctx!.restore();
        return alive;
    });

    if (particles.length || spawners.length || actors.length || dims.length) raf = requestAnimationFrame(step);
    else teardown();
}

/** Play an effect by id. Several can overlap. */
export function playEffect(id: string, options: EffectOptions = {}) {
    const start = STARTERS[id];
    if (!start) return;
    // Shake / rainbow / roll animate the window itself, no canvas needed.
    if (["shake", "rainbow", "barrelRoll"].includes(id)) return start(options);
    ensureCanvas();
    start(options);
    // Keep it bounded however many triggers arrive at once.
    if (particles.length > 2500) particles.splice(0, particles.length - 2500);
    if (!raf) { last = 0; raf = requestAnimationFrame(step); }
}

export function stopEffects() {
    teardown();
}
