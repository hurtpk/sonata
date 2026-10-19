/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A small WebGL viewer: soft two-light shading with a rim light, an orbit
// camera (drag to spin, scroll to zoom, double-click to reset) and a gentle
// turn while you're not touching it.

import type { Mesh } from "./parse";

const VS = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aColor;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vN; varying vec3 vC; varying vec3 vP;
void main() {
    vN = mat3(uModel) * aNormal;
    vC = aColor;
    vP = (uModel * vec4(aPos, 1.0)).xyz;
    gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FS = `
precision mediump float;
varying vec3 vN; varying vec3 vC; varying vec3 vP;
uniform vec3 uEye;
void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(uEye - vP);
    if (dot(n, v) < 0.0) n = -n;
    vec3 key = normalize(vec3(0.5, 0.8, 0.6));
    vec3 fill = normalize(vec3(-0.6, 0.2, -0.4));
    float d = max(dot(n, key), 0.0) * 0.75 + max(dot(n, fill), 0.0) * 0.25;
    float spec = pow(max(dot(n, normalize(key + v)), 0.0), 32.0) * 0.25;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.35;
    vec3 c = vC * (0.28 + d) + spec + rim * vec3(0.55, 0.75, 1.0);
    gl_FragColor = vec4(pow(c, vec3(1.0 / 1.15)), 1.0);
}`;

type M4 = Float32Array;

function perspective(fov: number, aspect: number, near: number, far: number): M4 {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function lookAt(eye: number[], target: number[], up: number[]): M4 {
    const z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

function multiply(a: M4, b: M4): M4 {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
    }
    return o;
}

const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function compile(gl: WebGLRenderingContext, type: number, src: string) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
}

export interface Viewer { reset(): void; setSpin(on: boolean): void; destroy(): void; }

export function mountViewer(canvas: HTMLCanvasElement, mesh: Mesh): Viewer {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error("3D isn't available on this computer (WebGL is off).");
    // Big models need 32-bit indices only if indexed; this list isn't, so no extension is needed.
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Centre the model and scale it to fit.
    const p = mesh.positions;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 1e-6);
    const model = new Float32Array([1 / radius, 0, 0, 0, 0, 1 / radius, 0, 0, 0, 0, 1 / radius, 0, -center[0] / radius, -center[1] / radius, -center[2] / radius, 1]);

    const attr = (name: string, data: Float32Array) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
        return buf;
    };
    const buffers = [attr("aPos", mesh.positions), attr("aNormal", mesh.normals), attr("aColor", mesh.colors)];
    const uMVP = gl.getUniformLocation(prog, "uMVP"), uModel = gl.getUniformLocation(prog, "uModel"), uEye = gl.getUniformLocation(prog, "uEye");
    gl.enable(gl.DEPTH_TEST);

    let yaw = 0.7, pitch = 0.35, dist = 2.6, spin = true, dragging = false, lastX = 0, lastY = 0, idleSince = 0, raf = 0, last = performance.now();

    const draw = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (spin && !dragging && now - idleSince > 1200) yaw += dt * 0.5;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const eye = [Math.cos(pitch) * Math.sin(yaw) * dist, Math.sin(pitch) * dist, Math.cos(pitch) * Math.cos(yaw) * dist];
        const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
        const proj = perspective(0.75, w / Math.max(1, h), 0.01, 50);
        gl.uniformMatrix4fv(uMVP, false, multiply(proj, multiply(view, model)));
        gl.uniformMatrix4fv(uModel, false, model);
        gl.uniform3fv(uEye, eye);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles * 3);
        raf = requestAnimationFrame(draw);
    };

    const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        yaw -= (e.clientX - lastX) * 0.01;
        pitch = Math.max(-1.45, Math.min(1.45, pitch + (e.clientY - lastY) * 0.01));
        lastX = e.clientX; lastY = e.clientY;
    };
    const onUp = () => { dragging = false; idleSince = performance.now(); };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); dist = Math.max(0.8, Math.min(8, dist * (e.deltaY > 0 ? 1.1 : 0.9))); idleSince = performance.now(); };
    const reset = () => { yaw = 0.7; pitch = 0.35; dist = 2.6; };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", reset);
    raf = requestAnimationFrame(draw);

    return {
        reset,
        setSpin: on => { spin = on; },
        destroy() {
            cancelAnimationFrame(raf);
            canvas.removeEventListener("pointerdown", onDown);
            canvas.removeEventListener("pointermove", onMove);
            canvas.removeEventListener("pointerup", onUp);
            canvas.removeEventListener("pointercancel", onUp);
            canvas.removeEventListener("wheel", onWheel);
            canvas.removeEventListener("dblclick", reset);
            buffers.forEach(b => gl.deleteBuffer(b));
            gl.deleteProgram(prog);
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        },
    };
}
