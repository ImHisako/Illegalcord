/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Aleeeh07 (@febbraio)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { CogWheel } from "@components/Icons";
import { debounce } from "@shared/debounce";
import { Devs } from "@utils/constants";
import { openUserProfile } from "@utils/discord";
import { makeRange, OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { Avatar, Menu, Popout, UserStore, UserUtils, useEffect, useRef, useState } from "@webpack/common";

export const MIC_SEND_DB_MIN = 0;
export const MIC_SEND_DB_MAX = 200;

export const settings = definePluginSettings({
    alwaysUsePlugin: {
        type: OptionType.BOOLEAN,
        description: "Always use mic playback (even when soundboard is allowed)",
        default: false,
        hidden: true,
    },
    allowWhileDeafened: {
        type: OptionType.BOOLEAN,
        description: "Allow opening the soundboard while deafened (requires Force mic playback)",
        default: true,
        hidden: true,
    },
    playLocally: {
        type: OptionType.BOOLEAN,
        description: "Play sounds locally for yourself when using mic playback",
        default: true,
        hidden: true,
    },
    showAllServers: {
        type: OptionType.BOOLEAN,
        description: "Show every server's soundboard in the picker (requires Force mic playback)",
        default: true,
        hidden: true,
    },
    micSendDb: {
        type: OptionType.SLIDER,
        description: "Extra loudness sent to others (+dB)",
        markers: makeRange(MIC_SEND_DB_MIN, MIC_SEND_DB_MAX, 25),
        default: 0,
        stickToMarkers: false,
        hidden: true,
    },
});

const setMicSendDb = debounce((value: number) => {
    settings.store.micSendDb = Math.round(value);
}, 100);

const AUTHOR_ID = String(Devs.febbraio.id);

function SettingsMenu({ closePopout }: { closePopout(): void; }) {
    const { alwaysUsePlugin, allowWhileDeafened, playLocally, showAllServers, micSendDb } = settings.use([
        "alwaysUsePlugin",
        "allowWhileDeafened",
        "playLocally",
        "showAllServers",
        "micSendDb",
    ]);
    const [author, setAuthor] = useState<User | null>(() => UserStore.getUser(AUTHOR_ID) ?? null);

    useEffect(() => {
        if (author != null)
            return;

        UserUtils.getUser(AUTHOR_ID).then(setAuthor).catch(() => null);
    }, [author]);

    const authorName = author?.username ?? Devs.febbraio.name;

    return (
        <Menu.Menu
            navId="vc-voiceboard-settings"
            onClose={closePopout}
            className="vc-voiceboard-menu"
        >
            <Menu.MenuGroup>
                <Menu.MenuCheckboxItem
                    id="vc-voiceboard-always-use"
                    label="Force mic playback"
                    checked={alwaysUsePlugin}
                    action={() => { settings.store.alwaysUsePlugin = !alwaysUsePlugin; }}
                />
                <Menu.MenuCheckboxItem
                    id="vc-voiceboard-while-deaf"
                    label="Allow while deafened"
                    checked={allowWhileDeafened}
                    disabled={!alwaysUsePlugin}
                    action={() => { settings.store.allowWhileDeafened = !allowWhileDeafened; }}
                />
                <Menu.MenuCheckboxItem
                    id="vc-voiceboard-play-locally"
                    label="Play locally"
                    checked={playLocally}
                    action={() => { settings.store.playLocally = !playLocally; }}
                />
                <Menu.MenuCheckboxItem
                    id="vc-voiceboard-show-all-servers"
                    label="Show all servers"
                    checked={showAllServers}
                    disabled={!alwaysUsePlugin}
                    action={() => {
                        const next = !showAllServers;
                        settings.store.showAllServers = next;
                        void import("./guildSounds").then(m => {
                            m.resetGuildSoundFetch();
                            if (next)
                                m.ensureAllGuildSounds();
                        });
                    }}
                />
                <Menu.MenuControlItem
                    id="vc-voiceboard-mic-send"
                    label="Mic send boost"
                    control={(props, ref) => (
                        <Menu.MenuSliderControl
                            {...props}
                            ref={ref}
                            minValue={MIC_SEND_DB_MIN}
                            maxValue={MIC_SEND_DB_MAX}
                            value={micSendDb}
                            onChange={setMicSendDb}
                            renderValue={(v: number) => `+${Math.round(v)} dB`}
                        />
                    )}
                />
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="vc-voiceboard-credit"
                    label={`Created by @${authorName}`}
                    icon={author != null
                        ? () => (
                            <Avatar
                                className="vc-voiceboard-credit-avatar"
                                size="SIZE_16"
                                src={author.getAvatarURL(undefined, 32)}
                            />
                        )
                        : undefined}
                    action={() => openUserProfile(AUTHOR_ID)}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

export function PluginSettingsButton() {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [show, setShow] = useState(false);

    return (
        <Popout
            position="bottom"
            align="right"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={({ closePopout }) => (
                <ErrorBoundary>
                    <div className="vc-voiceboard-menu">
                        <SettingsMenu closePopout={closePopout} />
                    </div>
                </ErrorBoundary>
            )}
        >
            {() => (
                <button
                    ref={buttonRef}
                    type="button"
                    className="vc-voiceboard-settings-btn"
                    aria-label="VoiceBoard settings"
                    onClick={() => setShow(v => !v)}
                >
                    <CogWheel width={20} height={20} />
                </button>
            )}
        </Popout>
    );
}
