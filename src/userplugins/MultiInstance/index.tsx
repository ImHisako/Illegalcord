/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React, showToast, TextInput, Toasts, UserStore, useStateFromStores } from "@webpack/common";
import type { SVGProps } from "react";

const Native = VencordNative?.pluginHelpers?.MultiInstance as PluginNative<typeof import("./native")> | undefined;

const ICON_SETTING_KEYS: Array<"showIcon"> = ["showIcon"];
const PROFILE_SETTING_KEYS: Array<"instances"> = ["instances"];
const DOMAINS = ["discord.com", "ptb.discord.com", "canary.discord.com"] as const;
const DOMAIN_LABELS: Record<DiscordDomain, string> = {
    "discord.com": "Discord",
    "ptb.discord.com": "PTB",
    "canary.discord.com": "Canary"
};
const DEFAULT_DOMAIN: DiscordDomain = "discord.com";
const DEFAULT_PROFILES: InstanceProfile[] = [{ id: "secondary", name: "Secondary Discord", domain: DEFAULT_DOMAIN }];
const ALL_INSTANCES_BUSY_ID = "__all__";

type DiscordDomain = typeof DOMAINS[number];

interface InstanceProfile {
    id: string;
    name: string;
    saveSession?: boolean;
    domain?: DiscordDomain;
}

interface PrivateSettings {
    instances?: InstanceProfile[];
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function isDomain(value: unknown): value is DiscordDomain {
    return typeof value === "string" && DOMAINS.includes(value as DiscordDomain);
}

function getDomain(profile: InstanceProfile) {
    return profile.domain ?? DEFAULT_DOMAIN;
}

function isProfile(value: unknown): value is InstanceProfile {
    return typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "name" in value &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        (!("saveSession" in value) || typeof value.saveSession === "boolean") &&
        (!("domain" in value) || isDomain(value.domain)) &&
        /^[a-z0-9_-]{1,32}$/i.test(value.id) &&
        value.name.trim().length > 0;
}

function getProfiles(value: unknown) {
    if (!Array.isArray(value)) return DEFAULT_PROFILES;

    const seen = new Set<string>();
    const profiles = value
        .filter(isProfile)
        .map(profile => ({
            id: profile.id.toLowerCase(),
            name: profile.name.trim(),
            saveSession: profile.saveSession,
            domain: getDomain(profile)
        }))
        .filter(profile => {
            if (seen.has(profile.id)) return false;
            seen.add(profile.id);
            return true;
        });

    return profiles.length ? profiles : DEFAULT_PROFILES;
}

function shouldSaveSession(profile: InstanceProfile) {
    return profile.saveSession ?? settings.store.saveSessionsByDefault;
}

function makeProfileId(name: string, profiles: InstanceProfile[]) {
    const base = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24) || "instance";

    const used = new Set(profiles.map(profile => profile.id));
    let id = base;
    let suffix = 2;

    while (used.has(id)) {
        id = `${base}-${suffix}`.slice(0, 32);
        suffix++;
    }

    return id;
}

export function MultiInstanceIcon({ width = 20, height = 20, className }: SVGProps<SVGSVGElement> & { size?: string; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1h-2V5a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1v2H7a3 3 0 0 1-3-3V5Z" />
            <path d="M10 11a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3v-6Zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-4Z" />
            <path d="M7 18h2v2H7a5 5 0 0 1-5-5v-2h2v2a3 3 0 0 0 3 3ZM20 6h2v2h-2V6Zm0-2V2h-2v2h2Zm-4 0V2h-2v2h2Z" />
        </svg>
    );
}

function saveProfiles(profiles: InstanceProfile[]) {
    settings.store.instances = profiles;
}

function MultiInstanceSettingsButton() {
    return (
        <Button size="small" variant="secondary" onClick={openMultiInstanceModal}>
            Open Multi Instance
        </Button>
    );
}

const settings = definePluginSettings({
    showIcon: {
        type: OptionType.BOOLEAN,
        description: "Show the Multi Instance icon in the header bar.",
        default: true
    },
    saveSessionsByDefault: {
        type: OptionType.BOOLEAN,
        description: "Save sessions for new instances by default.",
        default: true
    },
    openManager: {
        type: OptionType.COMPONENT,
        component: MultiInstanceSettingsButton,
        default: null
    }
}).withPrivateSettings<PrivateSettings>();

function MultiInstanceModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const currentUser = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const profiles = getProfiles(settings.use(PROFILE_SETTING_KEYS).instances);
    const [openIds, setOpenIds] = React.useState<string[]>([]);
    const [busyId, setBusyId] = React.useState<string | null>(null);
    const [newName, setNewName] = React.useState("");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [editingName, setEditingName] = React.useState("");

    const refreshInstances = React.useCallback(async () => {
        if (!Native) {
            setOpenIds([]);
            return;
        }

        const instances: string[] = await Native.getOpenInstances().catch((): string[] => []);
        setOpenIds(instances);
    }, []);

    React.useEffect(() => {
        void refreshInstances();
    }, [refreshInstances]);

    function updateProfile(profileId: string, patch: Partial<Pick<InstanceProfile, "name" | "saveSession" | "domain">>) {
        saveProfiles(profiles.map(profile => profile.id === profileId ? { ...profile, ...patch } : profile));
    }

    async function openInstance(profile: InstanceProfile) {
        if (!Native) {
            showToast("Multi Instance native helper is not available in this build.", Toasts.Type.FAILURE);
            return;
        }

        setBusyId(profile.id);

        const saveSession = shouldSaveSession(profile);
        const result = await Native.openInstance(profile.id, profile.name, saveSession, getDomain(profile))
            .catch(error => ({ ok: false, error: getErrorMessage(error) }));

        if (result.ok) {
            showToast(`${profile.name} opened${saveSession ? "." : " as a temporary session."}`, Toasts.Type.SUCCESS);
        } else {
            showToast(result.error ?? `Could not open ${profile.name}.`, Toasts.Type.FAILURE);
        }

        await refreshInstances();
        setBusyId(null);
    }

    async function closeInstance(profile: InstanceProfile) {
        if (!Native) {
            showToast("Multi Instance native helper is not available in this build.", Toasts.Type.FAILURE);
            return;
        }

        setBusyId(profile.id);

        const result = await Native.closeInstance(profile.id)
            .catch(error => ({ ok: false, error: getErrorMessage(error) }));

        if (result.ok) {
            showToast(`${profile.name} closed.`, Toasts.Type.SUCCESS);
        } else {
            showToast(result.error ?? `Could not close ${profile.name}.`, Toasts.Type.FAILURE);
        }

        await refreshInstances();
        setBusyId(null);
    }

    async function closeAllInstances() {
        if (!Native) {
            showToast("Multi Instance native helper is not available in this build.", Toasts.Type.FAILURE);
            return;
        }

        setBusyId(ALL_INSTANCES_BUSY_ID);

        const result = await Native.closeAllInstances()
            .catch(error => ({ ok: false, error: getErrorMessage(error) }));

        if (result.ok) {
            showToast("All Multi Instance windows closed.", Toasts.Type.SUCCESS);
        } else {
            showToast(result.error ?? "Could not close all Multi Instance windows.", Toasts.Type.FAILURE);
        }

        await refreshInstances();
        setBusyId(null);
    }

    async function clearSavedSession(profile: InstanceProfile) {
        if (!Native) {
            showToast("Multi Instance native helper is not available in this build.", Toasts.Type.FAILURE);
            return;
        }

        if (openIds.includes(profile.id)) {
            showToast("Close this instance before clearing its saved session.", Toasts.Type.FAILURE);
            return;
        }

        setBusyId(profile.id);

        const result = await Native.clearSavedSession(profile.id)
            .catch(error => ({ ok: false, error: getErrorMessage(error) }));

        if (result.ok) {
            showToast(`${profile.name} saved session cleared.`, Toasts.Type.SUCCESS);
        } else {
            showToast(result.error ?? `Could not clear ${profile.name}.`, Toasts.Type.FAILURE);
        }

        setBusyId(null);
    }

    function addInstance() {
        const name = newName.trim() || `Discord Instance ${profiles.length + 1}`;
        const id = makeProfileId(name, profiles);

        saveProfiles([...profiles, { id, name, saveSession: settings.store.saveSessionsByDefault, domain: DEFAULT_DOMAIN }]);
        setNewName("");
    }

    function toggleSessionSaving(profile: InstanceProfile) {
        updateProfile(profile.id, { saveSession: !shouldSaveSession(profile) });
    }

    function cycleDomain(profile: InstanceProfile) {
        const currentIndex = DOMAINS.indexOf(getDomain(profile));
        const domain = DOMAINS[(currentIndex + 1) % DOMAINS.length];
        updateProfile(profile.id, { domain });
    }

    function startRename(profile: InstanceProfile) {
        setEditingId(profile.id);
        setEditingName(profile.name);
    }

    function saveRename(profile: InstanceProfile) {
        const name = editingName.trim();

        if (!name) {
            showToast("Enter an instance name.", Toasts.Type.FAILURE);
            return;
        }

        updateProfile(profile.id, { name });
        setEditingId(null);
        setEditingName("");
    }

    async function removeInstance(profile: InstanceProfile) {
        if (openIds.includes(profile.id)) await closeInstance(profile);

        saveProfiles(profiles.filter(({ id }) => id !== profile.id));
    }

    return (
        <Modal
            {...rootProps}
            size="xl"
            title="Multi Instance"
            subtitle="Open separate Illegalcord windows, each with its own Discord login."
        >
            <div className="vc-multi-instance-body">
                {!Native && (
                    <div className="vc-multi-instance-warning">
                        Multi Instance can be configured here, but opening windows requires the native helper.
                    </div>
                )}

                <div className="vc-multi-instance-explainer">
                    <div>
                        <strong>Saved session</strong>
                        <span>Keeps login, cookies, and local Discord data until you clear it.</span>
                    </div>
                    <div>
                        <strong>Temporary session</strong>
                        <span>Exists only while that instance window is open.</span>
                    </div>
                </div>

                <div className="vc-multi-instance-toolbar">
                    <p className="vc-multi-instance-text">
                        {currentUser
                            ? `This window stays on @${currentUser.username}. Extra instances use their own Electron session.`
                            : "Extra instances use their own Electron session."}
                    </p>
                    <Button
                        size="small"
                        variant="secondary"
                        disabled={!openIds.length || busyId === ALL_INSTANCES_BUSY_ID}
                        onClick={() => void closeAllInstances()}
                    >
                        Close all instances
                    </Button>
                </div>

                <div className="vc-multi-instance-list">
                    {profiles.map(profile => {
                        const isOpen = openIds.includes(profile.id);
                        const isBusy = busyId === profile.id || busyId === ALL_INSTANCES_BUSY_ID;
                        const saveSession = shouldSaveSession(profile);
                        const domain = getDomain(profile);
                        const isEditing = editingId === profile.id;

                        return (
                            <div className="vc-multi-instance-row" key={profile.id}>
                                <div className="vc-multi-instance-row-info">
                                    <span className={classes("vc-multi-instance-dot", isOpen && "vc-multi-instance-dot-open")} />
                                    <div className="vc-multi-instance-profile">
                                        {isEditing ? (
                                            <div className="vc-multi-instance-rename">
                                                <TextInput
                                                    value={editingName}
                                                    placeholder="Instance name"
                                                    onChange={setEditingName}
                                                />
                                                <Button size="small" disabled={isBusy} onClick={() => saveRename(profile)}>
                                                    Save
                                                </Button>
                                                <Button size="small" variant="secondary" disabled={isBusy} onClick={() => setEditingId(null)}>
                                                    Cancel
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="vc-multi-instance-name">{profile.name}</div>
                                        )}
                                        <div className="vc-multi-instance-id">
                                            {profile.id} · {DOMAIN_LABELS[domain]} · {saveSession ? "Saved session" : "Temporary session"}
                                        </div>
                                    </div>
                                </div>
                                <div className="vc-multi-instance-actions">
                                    <Button size="small" variant="secondary" disabled={isBusy || isEditing} onClick={() => startRename(profile)}>
                                        Rename
                                    </Button>
                                    <Button size="small" variant="secondary" disabled={isBusy || isOpen} onClick={() => cycleDomain(profile)}>
                                        {DOMAIN_LABELS[domain]}
                                    </Button>
                                    <Button size="small" variant="secondary" disabled={isBusy || isOpen} onClick={() => toggleSessionSaving(profile)}>
                                        {saveSession ? "Use once" : "Save"}
                                    </Button>
                                    <Button size="small" disabled={isBusy || isEditing} onClick={() => void openInstance(profile)}>
                                        {isOpen ? "Focus" : "Open"}
                                    </Button>
                                    <Button size="small" variant="secondary" disabled={isBusy || !isOpen} onClick={() => void closeInstance(profile)}>
                                        Close
                                    </Button>
                                    <Button size="small" variant="dangerSecondary" disabled={isBusy || isOpen} onClick={() => void clearSavedSession(profile)}>
                                        Clear saved session
                                    </Button>
                                    <Button size="small" variant="dangerSecondary" disabled={isBusy || profiles.length === 1} onClick={() => void removeInstance(profile)}>
                                        Remove
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="vc-multi-instance-add">
                    <TextInput
                        value={newName}
                        placeholder="New instance name"
                        onChange={setNewName}
                    />
                    <Button size="small" variant="secondary" onClick={addInstance}>
                        Add instance
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

export function openMultiInstanceModal() {
    openModal(props => <MultiInstanceModal rootProps={props} />);
}

function MultiInstanceButton() {
    const { showIcon } = settings.use(ICON_SETTING_KEYS);
    if (!showIcon) return null;

    return (
        <HeaderBarButton
            icon={MultiInstanceIcon}
            tooltip="Multi Instance"
            onClick={openMultiInstanceModal}
        />
    );
}

const MultiInstanceButtonWithBoundary = ErrorBoundary.wrap(MultiInstanceButton, { noop: true });

export default definePlugin({
    name: "MultiInstance",
    description: "Opens extra Illegalcord windows with separate Discord sessions.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    dependencies: ["HeaderBarAPI"],
    enabledByDefault: true,
    settings,
    headerBarButton: {
        icon: MultiInstanceIcon,
        render: () => <MultiInstanceButtonWithBoundary />,
        priority: 9
    },
    toolboxActions: {
        "Open Multi Instance"() { openMultiInstanceModal(); }
    }
});
