/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { build } from "esbuild";
import { parseGIF } from "gifuct-js";
import puppeteer from "puppeteer-core";
import ts from "typescript";

const executablePath = process.env.ILLEGALCORD_TEST_BROWSER;
const coreDirectory = process.env.ILLEGALCORD_TEST_FFMPEG_CORE;
const require = createRequire(import.meta.url);

test("FFmpeg: all three plugin loaders convert animated images and preserve video audio", { skip: !executablePath || !coreDirectory, timeout: 90_000 }, async t => {
    const assets = new Map(await Promise.all(["ffmpeg-core.js", "ffmpeg-core.wasm"].map(async name => [`/core/${name}`, await readFile(join(coreDirectory, name))])));
    const server = createServer((request, response) => {
        const data = assets.get(request.url);
        if (!data) return response.writeHead(404).end();
        response.writeHead(200, { "content-type": request.url.endsWith(".wasm") ? "application/wasm" : "text/javascript", "access-control-allow-origin": "*" });
        response.end(data);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/core/ffmpeg-core.js`);

    const uploadSource = await readFile(new URL("../../src/equicordplugins/moreStickers.desktop/upload.ts", import.meta.url), "utf8");
    const uploadAst = ts.createSourceFile("upload.ts", uploadSource, ts.ScriptTarget.Latest, true);
    const toGIF = uploadAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === "toGIF").getText(uploadAst);
    const browserEntry = join(dirname(require.resolve("@ffmpeg/ffmpeg/worker")), "index.js");
    const { outputFiles } = await build({
        stdin: {
            contents: `import { convertApngToGif } from './src/equicordplugins/fileUpload/utils/apngToGif';
                import { convertClipToMp4 } from './src/equicordplugins/clipUpload.desktop/ffmpeg';
                import { loadFFmpeg, nativeFetch } from './src/equicordplugins/moreStickers.desktop/utils';
                import { FFmpeg } from '@ffmpeg/ffmpeg';
                ${toGIF}
                window.media = { convertApngToGif, convertClipToMp4, loadFFmpeg, FFmpeg, toGIF };`,
            loader: "ts",
            resolveDir: process.cwd()
        },
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        logLevel: "silent",
        plugins: [{
            name: "discord-test-bindings",
            setup(builder) {
                builder.onResolve({ filter: /^(@ffmpeg\/ffmpeg|@utils\/(Logger|css)|@webpack(\/common)?)$/ }, args => ({ path: args.path, namespace: "test-bindings" }));
                builder.onLoad({ filter: /.*/, namespace: "test-bindings" }, args => ({
                    contents: args.path === "@ffmpeg/ffmpeg"
                        ? `import { FFmpeg as Base } from ${JSON.stringify(browserEntry)}; export class FFmpeg extends Base { constructor() { super(); (window.mediaInstances ??= []).push(this); } }`
                        : args.path === "@utils/Logger" ? "export class Logger { info() {} error() {} warn() {} }"
                            : args.path === "@utils/css" ? "export const classNameFactory = () => () => '';"
                                : args.path === "@webpack" ? "export const waitFor = (_, callback) => callback();"
                                    : "export const React = { createContext: () => ({}) };",
                    resolveDir: process.cwd()
                }));
            }
        }]
    });
    await page.evaluate(() => {
        window.VencordNative = { pluginHelpers: { MoreStickers: { fetchLine: async () => ({ status: 200, type: "image/png", data: window.animatedPng }) } } };
    });
    await page.addScriptTag({ content: outputFiles[0].text.replaceAll("https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm", `${origin}/core`) });
    const result = await page.evaluate(async () => {
        const ff = new window.media.FFmpeg();
        const logs = [];
        ff.on("log", ({ message }) => logs.push(message));
        let loaded = false;
        await window.media.loadFFmpeg(ff, () => loaded = true);
        const run = async args => {
            if (await ff.exec(args) !== 0) throw new Error(logs.slice(-15).join("\n"));
        };
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        for (let i = 0; i < 2; i++) {
            const context = canvas.getContext("2d");
            context.fillStyle = i ? "blue" : "red";
            context.fillRect(0, 0, 32, 32);
            const blob = await new Promise(resolve => canvas.toBlob(resolve));
            await ff.writeFile(`frame${i}.png`, new Uint8Array(await blob.arrayBuffer()));
        }
        await run(["-framerate", "2", "-i", "frame%d.png", "-plays", "0", "fixture.apng"]);
        window.animatedPng = await ff.readFile("fixture.apng");
        const waveform = new Uint8Array(44 + 16_000);
        const header = new DataView(waveform.buffer);
        for (const [offset, text] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]]) waveform.set(new TextEncoder().encode(text), offset);
        for (const [offset, value] of [[4, waveform.length - 8], [16, 16], [24, 8000], [28, 16_000], [40, 16_000]]) header.setUint32(offset, value, true);
        for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) header.setUint16(offset, value, true);
        for (let i = 0; i < 8000; i++) header.setInt16(44 + i * 2, Math.sin(i * Math.PI * 2 * 440 / 8000) * 10_000, true);
        await ff.writeFile("tone.wav", waveform);
        await run(["-framerate", "2", "-i", "frame%d.png", "-i", "tone.wav", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-c:a", "libopus", "-shortest", "fixture.webm"]);
        const video = await ff.readFile("fixture.webm");
        const image = new Blob([window.animatedPng], { type: "image/apng" });
        const gif = await window.media.convertApngToGif(image);
        if (!gif) throw new Error("FileUpload did not return a GIF.");
        const sticker = await window.media.toGIF("https://example.invalid/sticker.png", ff);
        const mp4 = await window.media.convertClipToMp4(new File([video], "fixture.webm", { type: "video/webm" }), "fixture.mp4");
        const decode = async (file, name, audio = false) => {
            await ff.writeFile(name, new Uint8Array(await file.arrayBuffer()));
            logs.length = 0;
            await run(["-i", name, "-map", "0:v:0", ...(audio ? ["-map", "0:a:0"] : []), "-f", "null", "-"]);
            const output = logs.join("\n");
            await ff.deleteFile(name);
            return output;
        };
        const converted = { gif: await decode(gif, "check.gif"), sticker: await decode(sticker, "check-sticker.gif"), mp4: await decode(mp4, "check.mp4", true) };
        const frames = { gif: Array.from(new Uint8Array(await gif.arrayBuffer())), sticker: Array.from(new Uint8Array(await sticker.arrayBuffer())) };
        const remaining = await Promise.all(window.mediaInstances.map(async instance => (await instance.listDir("/")).map(entry => entry.name).filter(name => /^(input_|output_|output\.gif|sticker\.png)/.test(name))));
        for (const instance of window.mediaInstances) instance.terminate();
        return { loaded, converted, frames, remaining };
    });
    assert.equal(result.loaded, true);
    for (const key of ["gif", "sticker"]) {
        assert.match(result.converted[key], /Video: gif/);
        assert.equal(parseGIF(new Uint8Array(result.frames[key]).buffer).frames.filter(frame => frame.image).length, 2);
    }
    assert.match(result.converted.mp4, /Video: h264/);
    assert.match(result.converted.mp4, /Audio: aac/);
    assert.ok(result.remaining.every(files => files.length === 0));
    assert.deepEqual(errors, []);
});
