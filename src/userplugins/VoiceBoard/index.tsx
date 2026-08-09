/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Aleeeh07 (@febbraio)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { GuildStore } from "@webpack/common";
import type { ReactNode } from "react";

import { ensureAllGuildSounds } from "./guildSounds";
import {
    isInputPlaying,
    mixInput,
    playThroughMic,
    releaseInput,
    setLivePanelVolume,
    shouldEnableInput,
    startRainbowSync,
    stopAllMicAudio,
} from "./micAudio";
import { PluginSettingsButton, settings } from "./settings";
import managedStyle from "./style.css?managed";

const logger = new Logger("VoiceBoard");

export default definePlugin({
    name: "VoiceBoard",
    description: "Force soundboard through your mic: unlock without permission, play while deafened, boost send volume, and browse every server's sounds.",
    authors: [{ name: "febbraio", id: 0n }],
    tags: ["Voice", "Fun"],
    settings,
    managedStyle,

    start() {
        startRainbowSync();
    },

    ensureAllGuildSounds,

    flux: {
        USER_SOUNDBOARD_SET_VOLUME({ volume }: { volume: number; }) {
            setLivePanelVolume(volume);
        },
        USER_SETTINGS_PROTO_UPDATE() {
            setLivePanelVolume(undefined);
        },
    },

    patches: [
        {
            find: "CALLABLE.has(e.type))return!0;let",
            replacement: {
                match: /(?<=return \i\.isGuildVoiceOrThread\(\))&&(\i)&&(\i)/,
                replace: "&&($self.forceMicPlayback()||$1)&&$2",
            },
        },
        {
            find: "isSoundboardButtonDisabled:",
            group: true,
            replacement: [
                {
                    match: /(\i)=(\i)\|\|(\i)\|\|(\i)(?=,\[)/,
                    replace: "$1=$2||$3||($4&&!$self.allowWhileDeafened())",
                },
                {
                    match: /(\i)\?(\i\.intl\.string\(\i\.t\.\w+\)):(?=\i\.intl\.string\(\i\.t\["6EJvHt"\]\))/,
                    replace: "$1&&!$self.allowWhileDeafened()?$2:",
                },
            ],
        },
        {
            find: "soundboard_floating_upsell",
            replacement: {
                match: /(\i)=(\i)\?\.selfDeaf\|\|\2\?\.mute\|\|\2\?\.suppress/,
                replace: "$1=($2?.selfDeaf&&!$self.allowWhileDeafened())||$2?.mute||$2?.suppress",
            },
        },
        {
            find: "isSoundboardButtonDisabled",
            replacement: {
                match: /"aria-label":(\i)\(\),\.\.\.(\i),className:(\i)\(\)\((\i\.\i),(\i\.\i),\{\[(\i\.\i)\]:(\i),\[(\i\.\i)\]:(\i)\}\),wrapperClassName:\4,innerClassName:(\i\.\i),disabled:\9/,
                replace: '"aria-label":$self.buttonLabel($1),...$2,className:$3()($4,$5,{[$6]:$7,[$8]:$9},$self.deniedButtonClass()),wrapperClassName:$4,innerClassName:$10,disabled:$9',
            },
        },
        {
            find: "renderHeaderAccessories:",
            replacement: {
                match: /renderHeaderAccessories:(\i),rowHeight:48/,
                replace: "renderHeaderAccessories:()=>$self.renderHeaderAccessories($1),rowHeight:48",
            },
        },
        {
            find: ".SEND_SOUNDBOARD_SOUND(",
            group: true,
            replacement: [
                {
                    match: /function (\i)\((\i),(\i),(\i),(\i)\)\{(\(0,\i\.\i\)\(\3,\2,\i\.\i\.SOUNDBOARD\)),/,
                    replace: "function $1($2,$3,$4,$5){$self.logSound($2);if($self.shouldBlockSend($3,$2))return void $self.playThroughMic($2);$6,",
                },
                {
                    match: /(\i\.\i\.post\(\{url:\i\.\i\.SEND_SOUNDBOARD_SOUND\((\i)\),body:\i,signal:\i\.signal,onRequestProgress:\i,rejectWithError:!0\}\))/,
                    replace: "$self.shouldBlockSend($2)?Promise.resolve():$1",
                },
            ],
        },
        {
            find: "USE_EXTERNAL_SOUNDS,e));return",
            group: true,
            replacement: [
                {
                    match: /if\((\i\.\i\.canUseSoundboardEverywhere\(\i\)\|\|!\i)&&(\i)\)/,
                    replace: "if($self.showAllServers()||($1&&$2))",
                },
                {
                    match: /return\[(\i)\]\},\[(\i),(\i),\1,(\i),(\i)\]\)/,
                    replace: "return[$1]},[$2,$3,$1,$4,$5,$self.showAllServers()])",
                },
            ],
        },
        {
            find: "guilds:u,currentGuildId",
            replacement: {
                match: /guilds:(\i),currentGuildId:(\i)\?\.id,allSounds:(\i),hasNitro:(\i),sortSoundsFn:(\i)/,
                replace: "guilds:$self.showAllServers()?$self.getAllGuilds($1):$1,currentGuildId:$2?.id,allSounds:$3,hasNitro:$4,sortSoundsFn:$5",
            },
        },
        {
            find: "hasFetchedAllSounds()||(0,",
            replacement: {
                match: /(\i\.A\.isFetching\(\)\|\|\i\.A\.hasFetchedAllSounds\(\)\|\|\(0,\i\.E7\)\(\))/,
                replace: "$1;$self.ensureAllGuildSounds()",
            },
        },
        {
            find: 'canUseSoundboardEverywhere(e)||t.guildId===n?.guild_id||"0"===t.guildId',
            replacement: {
                match: /return\((\i\.\i\.canUseSoundboardEverywhere\(\i\)\|\|\i\.guildId===\i\?\.guild_id\|\|"0"===\i\.guildId)\)&&(\i\(\i,\i\))&&\((!\i\|\|\i\.available)\)/,
                replace: "return($self.showAllServers()||(($1)&&$2))&&($3)",
            },
        },
        {
            find: "isNitroLocked:!a",
            replacement: {
                match: /isNitroLocked:!(\i)/,
                replace: "isNitroLocked:!$self.showAllServers()&&!$1",
            },
        },
        {
            find: "AudioInput: No MediaStream",
            group: true,
            replacement: [
                {
                    match: /(?<=}else this\.stream=\i;)return this\.updateMode\(\)/,
                    replace: "this.stream=$self.mixInput(this,this.stream);return this.updateMode()",
                },
                {
                    match: /release\((\i)\)\{\1\.getTracks\(\)/,
                    replace: "release($1){$self.releaseInput($1);$1.getTracks()",
                },
                {
                    match: /(?<=\.enabled=)!this\._mute/,
                    replace: "$self.shouldEnableInput(this)",
                },
                {
                    match: /set mute\((\i)\)\{this\._mute=\1,this\.updateAudioTracks\(\),this\.setSpeaking\(!1\)/,
                    replace: "set mute($1){this._mute=$1,this.updateAudioTracks(),this.setSpeaking($self.isInputPlaying(this))",
                },
            ],
        },
    ],

    renderHeaderAccessories(original: () => ReactNode) {
        this.ensureAllGuildSounds();

        return (
            <div className="vc-voiceboard-header-accessories">
                <PluginSettingsButton />
                {original()}
            </div>
        );
    },

    allowWhileDeafened() {
        return settings.store.alwaysUsePlugin && settings.store.allowWhileDeafened;
    },

    forceMicPlayback() {
        return settings.store.alwaysUsePlugin;
    },

    showAllServers() {
        return settings.store.alwaysUsePlugin && settings.store.showAllServers;
    },

    getAllGuilds(fallback: any[]) {
        try {
            const currentId = fallback[0]?.id;
            const guilds = Object.values(GuildStore.getGuilds());

            if (guilds.length === 0)
                return fallback;

            if (currentId != null) {
                const current = guilds.find(g => g?.id === currentId);
                const rest = guilds.filter(g => g?.id !== currentId);
                return current != null ? [current, ...rest] : guilds;
            }

            return guilds;
        } catch {
            return fallback;
        }
    },

    shouldBlockSend(_channelId?: string | null, _sound?: { guildId?: string; guild_id?: string; }) {
        return settings.store.alwaysUsePlugin;
    },

    deniedButtonClass() {
        return this.forceMicPlayback() ? "vc-voiceboard-denied" : null;
    },

    buttonLabel(original: () => string) {
        if (this.forceMicPlayback())
            return "VoiceBoard: force mic playback";

        return original();
    },

    logSound(sound: { soundId?: string; }) {
        const soundId = sound?.soundId;
        if (soundId == null) {
            console.log("[VoiceBoard] unknown sound:", sound);
            return;
        }

        const url = `https://${window.GLOBAL_ENV.CDN_HOST}/soundboard-sounds/${soundId}`;
        logger.info(url);
        console.log("[VoiceBoard]", url);
    },

    mixInput,
    releaseInput,
    shouldEnableInput,
    isInputPlaying,
    playThroughMic,

    stop() {
        stopAllMicAudio();
    },
});
