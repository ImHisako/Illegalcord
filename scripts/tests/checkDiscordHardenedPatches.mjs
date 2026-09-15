/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

import ts from "typescript";

const assetPath = process.argv[2];
assert.ok(assetPath, "Pass the path to a downloaded Discord web bundle.");
const asset = await readFile(assetPath, "utf8");
const source = ts.createSourceFile("index.ts", await readFile(new URL("../../src/illegalcordplugins/DiscordHardened/index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
let patches;
function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "patches") patches = node.initializer;
    ts.forEachChild(node, visit);
}
visit(source);
assert.ok(patches && ts.isArrayLiteralExpression(patches));
const starts = [...asset.matchAll(/(?:^|,)(\d+)\(e,t,n\)\{/g)];
const modules = starts.slice(0, -1).map((match, index) => ({
    id: match[1],
    code: asset.slice(match.index + (asset[match.index] === "," ? 1 : 0), starts[index + 1].index),
}));
const property = (object, name) => object.properties.find(node => node.name?.getText(source) === name)?.initializer;
for (const patch of patches.elements) {
    const find = property(patch, "find").text;
    const replacement = property(patch, "replacement");
    const match = property(replacement, "match").getText(source);
    const replace = property(replacement, "replace").text;
    const expression = new RegExp(match.slice(1, match.lastIndexOf("/")).replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), match.slice(match.lastIndexOf("/") + 1));
    const found = modules.filter(module => module.code.includes(find));
    assert.equal(found.length, 1, `Expected one module for ${find}, found ${found.map(module => module.id)}`);
    const [module] = found;
    assert.ok(expression.test(module.code), `Patch does not match module ${module.id}: ${find}`);
    const patched = module.code.replace(expression, replace.replaceAll("$self", "DiscordHardened"));
    assert.notEqual(patched, module.code);
    new Script(`({${patched}})`);
    process.stdout.write(`Verified module ${module.id}: ${find}\n`);
}
