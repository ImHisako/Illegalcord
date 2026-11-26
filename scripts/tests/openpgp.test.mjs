/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import * as pgp from "../../src/illegalcordplugins/IGP/openpgp.min.mjs";

const legacy = JSON.parse(await readFile(new URL("./fixtures/openpgp-6.2.2.json", import.meta.url), "utf8"));

test("OpenPGP: saved 6.2.2 keys, encrypted messages and cleartext signatures remain readable", async () => {
    const publicKey = await pgp.readKey({ armoredKey: legacy.publicKey });
    const locked = await pgp.readPrivateKey({ armoredKey: legacy.privateKey });
    assert.equal(locked.isDecrypted(), false);
    await assert.rejects(pgp.decryptKey({ privateKey: locked, passphrase: "incorrect" }));
    const privateKey = await pgp.decryptKey({ privateKey: locked, passphrase: legacy.passphrase });
    const decrypted = await pgp.decrypt({
        message: await pgp.readMessage({ armoredMessage: legacy.encrypted }),
        decryptionKeys: [privateKey],
        verificationKeys: [publicKey],
        expectSigned: false
    });
    assert.equal(decrypted.data, legacy.text);
    await decrypted.signatures[0].verified;
    const verified = await pgp.verify({
        message: await pgp.readCleartextMessage({ cleartextMessage: legacy.signed }),
        verificationKeys: [publicKey]
    });
    assert.equal(verified.data, legacy.text);
    await verified.signatures[0].verified;
});

for (const type of ["ecc", "rsa"]) {
    test(`OpenPGP: IGP ${type} keys support passphrases, encryption and signatures`, { timeout: 60_000 }, async () => {
        const passphrase = "dependency-compatibility-test";
        const keys = await pgp.generateKey({
            type,
            ...(type === "ecc" ? { curve: "curve25519" } : { rsaBits: 4096 }),
            userIDs: [{ name: "Dependency test", email: "compatibility@example.invalid" }],
            passphrase,
            format: "armored"
        });
        const publicKey = await pgp.readKey({ armoredKey: keys.publicKey });
        const privateKey = await pgp.decryptKey({ privateKey: await pgp.readPrivateKey({ armoredKey: keys.privateKey }), passphrase });
        const text = "Messaggio di prova è 🔐";
        const encrypted = await pgp.encrypt({
            message: await pgp.createMessage({ text }),
            encryptionKeys: [publicKey],
            signingKeys: [privateKey]
        });
        const decrypted = await pgp.decrypt({
            message: await pgp.readMessage({ armoredMessage: encrypted }),
            decryptionKeys: [privateKey],
            verificationKeys: [publicKey],
            expectSigned: false
        });
        assert.equal(decrypted.data, text);
        await decrypted.signatures[0].verified;
        const signed = await pgp.sign({ message: await pgp.createCleartextMessage({ text }), signingKeys: privateKey, format: "armored" });
        const verified = await pgp.verify({ message: await pgp.readCleartextMessage({ cleartextMessage: signed }), verificationKeys: [publicKey] });
        assert.equal(verified.data, text);
        await verified.signatures[0].verified;
    });
}
