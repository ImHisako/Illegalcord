/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useSettings } from "@api/Settings";
import { CodeBlock } from "@components/CodeBlock";
import { FormSwitch } from "@components/FormSwitch";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { Button, lodash, React, TextArea, TextInput, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { type ActionProps, applyConfig, snapshot, validateConfig } from "./utils";

interface EditorProps extends ActionProps { visible: boolean; }

export function Editor({ busy, run, canApply, visible }: EditorProps) {
    useSettings();
    const source = snapshot();
    const [draft, setDraft] = useState(() => ({ text: source, base: source, dirty: false }));
    const [automatic, setAutomatic] = useState(true);
    const [search, setSearch] = useState("");
    const [preview, setPreview] = useState(false);
    const input = useRef<HTMLTextAreaElement>(null);
    const conflict = draft.dirty && draft.base !== source;
    const validation = useMemo(() => {
        try {
            validateConfig(draft.text);
            return "";
        } catch (error) {
            return error instanceof Error ? error.message : "Could not validate this configuration.";
        }
    }, [draft.text, source]);

    useEffect(() => {
        if (!draft.dirty) setDraft({ text: source, base: source, dirty: false });
    }, [source]);

    async function apply() {
        const success = await run(async () => {
            const { restart } = await applyConfig(draft.text, draft.base, "Before live edit", canApply);
            const current = snapshot();
            setDraft({ text: current, base: current, dirty: false });
            return restart.length ? `Saved to settings.json. Restart to apply changes to: ${restart.join(", ")}.` : "Saved to settings.json. Dynamic settings are now applied.";
        });
        if (!success) setAutomatic(false);
    }

    useEffect(() => {
        if (!visible || !automatic || !draft.dirty || conflict || validation || busy) return;
        const save = lodash.debounce(() => { void apply(); }, 1200);
        save();
        return () => save.cancel();
    }, [draft, automatic, conflict, validation, visible]);

    const matches = search ? draft.text.toLowerCase().split(search.toLowerCase()).length - 1 : 0;

    function findNext() {
        const element = input.current;
        if (!element || !search) return;
        const text = draft.text.toLowerCase();
        const query = search.toLowerCase();
        let index = text.indexOf(query, element.selectionEnd);
        if (index < 0) index = text.indexOf(query);
        if (index < 0) return;
        element.focus();
        element.setSelectionRange(index, index + search.length);
    }

    return <div className="vc-config-editor-stack">
        <FormSwitch title="Apply valid changes automatically" description="Save after a short pause in typing. A recovery backup is created before each application." value={automatic} onChange={setAutomatic} disabled={busy} />
        <Notice.Info>Plugin activation changes and startup options require a restart. Other settings notify their normal change listeners immediately. Config Editor stays enabled so you can recover your configuration. The cloud sync timestamp is managed by the client.</Notice.Info>
        {conflict ? <Notice.Warning>Settings changed elsewhere while you were editing. Copy any draft changes you want to keep, then reload the current configuration.</Notice.Warning> : null}
        <div className="vc-config-editor-toolbar">
            <TextInput value={search} onChange={setSearch} placeholder="Find a setting or value..." aria-label="Search configuration" />
            <Button size={Button.Sizes.SMALL} disabled={!matches} onClick={findNext}>Find next</Button>
            <Paragraph>{matches} matches</Paragraph>
        </div>
        <TextArea
            className="vc-config-editor-input"
            inputRef={input}
            value={draft.text}
            onChange={(text: string) => setDraft({ ...draft, text, dirty: true })}
            spellCheck={false}
            readOnly={busy}
            autosize={false}
            aria-label="settings.json editor"
            aria-invalid={Boolean(validation)}
            aria-describedby="vc-config-editor-validation"
        />
        <Paragraph id="vc-config-editor-validation" role="status">{validation || (draft.dirty ? "Valid JSON. Changes are pending." : "In sync with the client configuration.")}</Paragraph>
        <div className="vc-config-editor-toolbar">
            <Button onClick={() => void apply()} disabled={busy || !draft.dirty || conflict || Boolean(validation)}>Apply now</Button>
            <Button color={Button.Colors.PRIMARY} disabled={busy} onClick={() => setDraft({ text: source, base: source, dirty: false })}>Reload current configuration</Button>
            <Button color={Button.Colors.PRIMARY} onClick={() => setPreview(!preview)}>{preview ? "Hide highlighted preview" : "Show highlighted preview"}</Button>
        </div>
        {preview ? <div className="vc-config-editor-preview"><CodeBlock lang="json" content={draft.text} /></div> : null}
    </div>;
}
