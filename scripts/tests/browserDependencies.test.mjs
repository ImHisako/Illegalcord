/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";

import { build } from "esbuild";
import puppeteer from "puppeteer-core";

const executablePath = process.env.ILLEGALCORD_TEST_BROWSER;

test("OpenPGP: the browser bundle decrypts saved messages and handles compressed signed messages", { skip: !executablePath, timeout: 30_000 }, async t => {
    const module = await readFile(new URL("../../src/illegalcordplugins/IGP/openpgp.min.mjs", import.meta.url));
    const legacy = JSON.parse(await readFile(new URL("./fixtures/openpgp-6.2.2.json", import.meta.url), "utf8"));
    const server = createServer((request, response) => {
        response.writeHead(200, { "content-type": request.url === "/openpgp.mjs" ? "text/javascript" : "text/html" });
        response.end(request.url === "/openpgp.mjs" ? module : "<!doctype html><title>OpenPGP test</title>");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async legacy => {
        const pgp = await import("/openpgp.mjs");
        const publicKey = await pgp.readKey({ armoredKey: legacy.publicKey });
        const privateKey = await pgp.decryptKey({ privateKey: await pgp.readPrivateKey({ armoredKey: legacy.privateKey }), passphrase: legacy.passphrase });
        const saved = await pgp.decrypt({ message: await pgp.readMessage({ armoredMessage: legacy.encrypted }), decryptionKeys: [privateKey], verificationKeys: [publicKey] });
        await saved.signatures[0].verified;
        const encrypted = await pgp.encrypt({ message: await pgp.createMessage({ text: legacy.text }), encryptionKeys: [publicKey], signingKeys: [privateKey], config: { preferredCompressionAlgorithm: pgp.enums.compression.zlib } });
        const current = await pgp.decrypt({ message: await pgp.readMessage({ armoredMessage: encrypted }), decryptionKeys: [privateKey], verificationKeys: [publicKey] });
        await current.signatures[0].verified;
        return { saved: saved.data, current: current.data };
    }, legacy);
    assert.equal(result.saved, legacy.text);
    assert.equal(result.current, legacy.text);
});

test("TanStack: measured timelines scroll, resize, filter and unmount in a real browser", { skip: !executablePath, timeout: 30_000 }, async t => {
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const { outputFiles } = await build({
        stdin: { contents: "import * as virtual from '@tanstack/virtual-core'; window.virtual = virtual;", resolveDir: process.cwd() },
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife"
    });
    await page.setContent('<div id="scroll" style="height:300px;width:400px;overflow:auto"><div id="rows" style="position:relative"></div></div>');
    await page.addScriptTag({ content: outputFiles[0].text });
    await page.evaluate(() => {
        const { Virtualizer, defaultRangeExtractor, elementScroll, observeElementOffset, observeElementRect } = window.virtual;
        const scroll = document.getElementById("scroll");
        const rows = document.getElementById("rows");
        const render = virtualizer => {
            rows.style.height = `${virtualizer.getTotalSize()}px`;
            rows.replaceChildren(...virtualizer.getVirtualItems().map(item => {
                const row = document.createElement("div");
                row.dataset.index = String(item.index);
                row.style.cssText = `position:absolute;top:0;width:100%;height:100px;transform:translateY(${item.start}px)`;
                row.textContent = `Event ${item.index}`;
                return row;
            }));
            for (const row of rows.children) virtualizer.measureElement(row);
        };
        const options = {
            count: 10_000,
            getScrollElement: () => scroll,
            getItemKey: index => String(index),
            estimateSize: () => 100,
            gap: 8,
            overscan: 4,
            anchorTo: "end",
            rangeExtractor: defaultRangeExtractor,
            observeElementRect,
            observeElementOffset,
            scrollToFn: elementScroll,
            onChange: render
        };
        const virtualizer = new Virtualizer(options);
        const cleanup = virtualizer._didMount();
        virtualizer._willUpdate();
        render(virtualizer);
        window.timeline = {
            virtualizer,
            scroll,
            rows,
            setCount(count) {
                virtualizer.setOptions({ ...options, count });
                virtualizer._willUpdate();
                render(virtualizer);
            },
            cleanup
        };
    });
    await page.waitForFunction(() => window.timeline.rows.children.length > 0);
    assert.ok(await page.evaluate(() => window.timeline.rows.children.length < 30));
    await page.evaluate(() => window.timeline.virtualizer.scrollToIndex(9000, { align: "start" }));
    await page.waitForFunction(() => [...window.timeline.rows.children].some(row => row.dataset.index === "9000"));
    const before = await page.evaluate(() => window.timeline.virtualizer.getTotalSize());
    await page.evaluate(() => {
        const row = [...window.timeline.rows.children].find(row => row.dataset.index === "9000");
        row.style.height = "250px";
        window.timeline.virtualizer.measureElement(row);
    });
    await page.waitForFunction(size => window.timeline.virtualizer.getTotalSize() > size, {}, before);
    await page.evaluate(() => window.timeline.setCount(0));
    assert.equal(await page.evaluate(() => window.timeline.rows.children.length), 0);
    await page.evaluate(() => {
        window.timeline.setCount(120);
        window.timeline.virtualizer.scrollToIndex(119, { align: "end" });
    });
    await page.waitForFunction(() => [...window.timeline.rows.children].some(row => row.dataset.index === "119"));
    assert.ok(await page.evaluate(() => window.timeline.rows.children.length < 30));
    await page.evaluate(() => window.timeline.cleanup());
    assert.equal(await page.evaluate(() => window.timeline.virtualizer.scrollElement), null);
    assert.deepEqual(errors, []);
});
