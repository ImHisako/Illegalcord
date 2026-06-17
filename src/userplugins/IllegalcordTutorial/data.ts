/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const TUTORIAL_SEEN_KEY = "IllegalcordTutorial_seen_v1";
export const TUTORIAL_LANGUAGE_KEY = "IllegalcordTutorial_language";
export const RECOMMENDED_PLUGIN_NAMES = ["Questify", "MessageLogger", "MessageLoggerEnhanced", "BetterScreenshare", "BetterMicrophone"] as const;

export type Language = "en" | "it";
export type RecommendedPluginName = typeof RECOMMENDED_PLUGIN_NAMES[number];
export type LocalizedText = Record<Language, string>;

export interface TutorialStep {
    title: LocalizedText;
    route: LocalizedText;
    body: LocalizedText;
    bullets: Record<Language, string[]>;
    panel?: string;
    actionLabel?: LocalizedText;
    secondaryPanel?: string;
    secondaryActionLabel?: LocalizedText;
    kind?: "recommendations";
}

export const UI_COPY = {
    en: {
        later: "Later",
        neverAgain: "Do not show again",
        done: "Done",
        next: "Next",
        back: "Back",
        whatNext: "What to do now",
        recommendationsTitle: "Recommended plugins",
        enableSelected: "Enable selected",
        selectAvailable: "Select available",
        clearSelection: "Clear",
        languageLabel: "Language",
        english: "English",
        italian: "Italiano",
        reopenHint: "You can reopen this tutorial from the IllegalcordTutorial settings.",
        settingsDescription: "Reopen the guided tutorial, jump to recommended plugins, or show the popup again on the next startup.",
        openTutorial: "Open tutorial",
        openRecommendations: "Recommended plugins",
        showNextStartup: "Show at next startup",
        noSelection: "Select at least one recommended plugin.",
        failed: "Some recommended plugins could not be enabled.",
        missing: "Some recommended plugins are not available in this build.",
        pluginSettings: "Settings",
        stepLabel: "Step",
        progressLabel: "Progress",
        enabled: (count: number) => `${count} recommended plugin${count === 1 ? "" : "s"} enabled.`,
        restart: (count: number) => `${count} selected plugin${count === 1 ? "" : "s"} enabled. Restart to apply patched plugins.`,
        alreadyActive: " already enabled",
        unavailable: " unavailable"
    },
    it: {
        later: "Più tardi",
        neverAgain: "Non mostrare più",
        done: "Finito",
        next: "Avanti",
        back: "Indietro",
        whatNext: "Cosa fare adesso",
        recommendationsTitle: "Plugin consigliati",
        enableSelected: "Attiva selezionati",
        selectAvailable: "Seleziona disponibili",
        clearSelection: "Deseleziona",
        languageLabel: "Lingua",
        english: "English",
        italian: "Italiano",
        reopenHint: "Puoi riaprire questo tutorial dalle impostazioni di IllegalcordTutorial.",
        settingsDescription: "Riapri il tutorial guidato, vai ai plugin consigliati, o fai comparire il popup al prossimo avvio.",
        openTutorial: "Apri tutorial",
        openRecommendations: "Plugin consigliati",
        showNextStartup: "Mostra al prossimo avvio",
        noSelection: "Seleziona almeno un plugin consigliato.",
        failed: "Alcuni plugin consigliati non sono stati attivati.",
        missing: "Alcuni plugin consigliati non sono disponibili in questa build.",
        pluginSettings: "Impostazioni",
        stepLabel: "Step",
        progressLabel: "Progresso",
        enabled: (count: number) => `${count} plugin consigliati attivati.`,
        restart: (count: number) => `${count} plugin selezionati. Riavvia per applicare quelli con patch.`,
        alreadyActive: " già attivo",
        unavailable: " non disponibile"
    }
} satisfies Record<Language, {
    later: string;
    neverAgain: string;
    done: string;
    next: string;
    back: string;
    whatNext: string;
    recommendationsTitle: string;
    enableSelected: string;
    selectAvailable: string;
    clearSelection: string;
    languageLabel: string;
    english: string;
    italian: string;
    reopenHint: string;
    settingsDescription: string;
    openTutorial: string;
    openRecommendations: string;
    showNextStartup: string;
    noSelection: string;
    failed: string;
    missing: string;
    pluginSettings: string;
    stepLabel: string;
    progressLabel: string;
    enabled(count: number): string;
    restart(count: number): string;
    alreadyActive: string;
    unavailable: string;
}>;

export const TUTORIAL_STEPS: TutorialStep[] = [
    {
        title: {
            en: "Welcome to Illegalcord",
            it: "Benvenuta in Illegalcord"
        },
        route: {
            en: "First startup",
            it: "Primo avvio"
        },
        body: {
            en: "This quick tour shows where the important controls live and what to try first.",
            it: "Questo tour veloce ti mostra dove sono i controlli importanti e cosa provare per primo."
        },
        bullets: {
            en: [
                "Open Discord user settings.",
                "Scroll until you find Illegalcord Settings.",
                "Use the buttons in this tutorial to jump straight to the right page."
            ],
            it: [
                "Apri le impostazioni utente di Discord.",
                "Scorri fino a Illegalcord Settings.",
                "Usa i pulsanti del tutorial per aprire direttamente la pagina giusta."
            ]
        }
    },
    {
        title: {
            en: "Illegalcord settings",
            it: "Impostazioni Illegalcord"
        },
        route: {
            en: "Settings > Illegalcord Settings",
            it: "Settings > Illegalcord Settings"
        },
        body: {
            en: "The Illegalcord section is the control room for the client. Start there when you want to change behavior or find a tool.",
            it: "La sezione Illegalcord è la sala comandi del client. Parti da lì quando vuoi cambiare comportamento o trovare uno strumento."
        },
        bullets: {
            en: [
                "Illegalcord contains general client settings.",
                "Plugins lists stock plugins, Equicord plugins, and userplugins.",
                "Themes, Updater, Changelog, and Backup each have their own page."
            ],
            it: [
                "Illegalcord contiene le impostazioni generali del client.",
                "Plugins mostra plugin stock, plugin Equicord e userplugins.",
                "Themes, Updater, Changelog e Backup hanno pagine dedicate."
            ]
        },
        panel: "equicord_main_panel",
        actionLabel: {
            en: "Open Illegalcord",
            it: "Apri Illegalcord"
        }
    },
    {
        title: {
            en: "Recommended plugins",
            it: "Plugin consigliati"
        },
        route: {
            en: "Settings > Illegalcord Settings > Plugins",
            it: "Settings > Illegalcord Settings > Plugins"
        },
        body: {
            en: "Plugins are optional modules. Search by name, open the settings gear, and enable the ones that fit how you use Discord.",
            it: "I plugin sono moduli opzionali. Cercali per nome, apri la rotella delle impostazioni e attiva quelli adatti al tuo uso di Discord."
        },
        bullets: {
            en: [
                "Questify improves Quest handling.",
                "MessageLogger and MessageLoggerEnhanced help track messages.",
                "BetterScreenshare and BetterMicrophone add better media controls."
            ],
            it: [
                "Questify migliora la gestione delle quest.",
                "MessageLogger e MessageLoggerEnhanced aiutano a tenere traccia dei messaggi.",
                "BetterScreenshare e BetterMicrophone aggiungono controlli media migliori."
            ]
        },
        panel: "equicord_plugins_panel",
        actionLabel: {
            en: "Open Plugins",
            it: "Apri Plugins"
        },
        kind: "recommendations"
    },
    {
        title: {
            en: "Client Diagnostics",
            it: "Client Diagnostics"
        },
        route: {
            en: "Settings > Client diagnostics",
            it: "Settings > Client diagnostics"
        },
        body: {
            en: "If Illegalcord lags, freezes, or starts using too much memory, open Client Diagnostics before disabling random plugins.",
            it: "Se Illegalcord lagga, si blocca, o usa troppa memoria, apri Client Diagnostics prima di disattivare plugin a caso."
        },
        bullets: {
            en: [
                "Use Diagnostics to see plugin CPU, memory, slow calls, and active resources.",
                "Use Impact analysis to find plugins that deserve attention.",
                "Use Plugin monitor when one plugin feels suspicious and you want focused numbers."
            ],
            it: [
                "Usa Diagnostics per vedere CPU, memoria, chiamate lente e risorse attive dei plugin.",
                "Usa Impact analysis per trovare i plugin da controllare.",
                "Usa Plugin monitor quando un plugin ti sembra sospetto e vuoi numeri più precisi."
            ]
        },
        panel: "illegalcord_client_diagnostics_panel",
        actionLabel: {
            en: "Open Diagnostics",
            it: "Apri Diagnostics"
        }
    },
    {
        title: {
            en: "Themes",
            it: "Themes"
        },
        route: {
            en: "Settings > Illegalcord Settings > Themes",
            it: "Settings > Illegalcord Settings > Themes"
        },
        body: {
            en: "Themes controls the look of the client. You can enable local themes, online themes, and saved theme links.",
            it: "Themes controlla l'aspetto del client. Puoi attivare temi locali, temi online e link salvati."
        },
        bullets: {
            en: [
                "Local themes come from the themes folder.",
                "Online themes update from their source link.",
                "Disable a theme if Discord updates and the layout looks broken."
            ],
            it: [
                "I temi locali arrivano dalla cartella themes.",
                "I temi online si aggiornano dal link sorgente.",
                "Disattiva un tema se Discord si aggiorna e il layout sembra rotto."
            ]
        },
        panel: "equicord_themes_panel",
        actionLabel: {
            en: "Open Themes",
            it: "Apri Themes"
        }
    },
    {
        title: {
            en: "Kamidere tools",
            it: "Strumenti Kamidere"
        },
        route: {
            en: "Settings > Kamidere",
            it: "Settings > Kamidere"
        },
        body: {
            en: "Kamidere tools are local advanced workflows such as Presence Lab, Mutual Scanner, and Send Trail.",
            it: "Gli strumenti Kamidere sono workflow avanzati locali come Presence Lab, Mutual Scanner e Send Trail."
        },
        bullets: {
            en: [
                "Presence Lab records experimental presence sessions locally.",
                "Mutual Scanner searches selected servers for mutual friend matches.",
                "Send Trail tracks recently sent messages for quick actions."
            ],
            it: [
                "Presence Lab registra sessioni sperimentali di presenza in locale.",
                "Mutual Scanner cerca persone con amicizie in comune nei server selezionati.",
                "Send Trail tiene traccia dei messaggi appena inviati per operazioni rapide."
            ]
        },
        panel: "kamidere_presence_lab_panel",
        actionLabel: {
            en: "Open Presence Lab",
            it: "Apri Presence Lab"
        },
        secondaryPanel: "kamidere_mutual_scanner_panel",
        secondaryActionLabel: {
            en: "Open Mutual Scanner",
            it: "Apri Mutual Scanner"
        }
    },
    {
        title: {
            en: "StereoInstaller",
            it: "StereoInstaller"
        },
        route: {
            en: "Settings > StereoInstaller",
            it: "Settings > StereoInstaller"
        },
        body: {
            en: "StereoInstaller changes local Discord voice files for higher audio quality. Keep one method installed at a time.",
            it: "StereoInstaller modifica i file voice locali per qualità audio più alta. Tieni installato un solo metodo alla volta."
        },
        bullets: {
            en: [
                "Use Revert to restore the original voice files.",
                "Patch again after Discord updates if voice stops working.",
                "Read the warning panel before switching method."
            ],
            it: [
                "Usa Revert per ripristinare i file voice originali.",
                "Rifai la patch dopo gli update di Discord se la voce smette di funzionare.",
                "Leggi il pannello warning prima di cambiare metodo."
            ]
        },
        panel: "illegalcord_stereo_installer_panel",
        actionLabel: {
            en: "Open StereoInstaller",
            it: "Apri StereoInstaller"
        }
    },
    {
        title: {
            en: "Updater",
            it: "Updater"
        },
        route: {
            en: "Settings > Illegalcord Settings > Updater",
            it: "Settings > Illegalcord Settings > Updater"
        },
        body: {
            en: "Updater checks for Illegalcord updates. Use it when a patch breaks, the client crashes, or you want the newest fixes.",
            it: "Updater controlla gli aggiornamenti di Illegalcord. Usalo quando una patch si rompe, il client crasha, o vuoi gli ultimi fix."
        },
        bullets: {
            en: [
                "Check for updates before debugging a broken plugin.",
                "Restart after updating so patched modules reload cleanly.",
                "If automatic update is unavailable, reinstall from the repository."
            ],
            it: [
                "Controlla gli aggiornamenti prima di debuggare un plugin rotto.",
                "Riavvia dopo l'update così i moduli patchati si ricaricano bene.",
                "Se l'update automatico non è disponibile, reinstalla dal repository."
            ]
        },
        panel: "equicord_updater_panel",
        actionLabel: {
            en: "Open Updater",
            it: "Apri Updater"
        }
    },
    {
        title: {
            en: "Changelog",
            it: "Changelog"
        },
        route: {
            en: "Settings > Illegalcord Settings > Changelog",
            it: "Settings > Illegalcord Settings > Changelog"
        },
        body: {
            en: "Changelog explains what changed after updates, including new plugins, changed settings, fixes, and removals.",
            it: "Changelog spiega cosa è cambiato dopo gli update, inclusi nuovi plugin, impostazioni cambiate, fix e rimozioni."
        },
        bullets: {
            en: [
                "Open it after updating to see what is new.",
                "Look for changed settings when a plugin behaves differently.",
                "Use it to discover new tools without reading the whole repository."
            ],
            it: [
                "Aprilo dopo gli update per vedere cosa c'è di nuovo.",
                "Cerca le impostazioni cambiate quando un plugin si comporta diversamente.",
                "Usalo per scoprire strumenti nuovi senza leggere tutto il repository."
            ]
        },
        panel: "equicord_changelog_panel",
        actionLabel: {
            en: "Open Changelog",
            it: "Apri Changelog"
        }
    },
    {
        title: {
            en: "Backup & Restore",
            it: "Backup & Restore"
        },
        route: {
            en: "Settings > Illegalcord Settings > Backup & Restore",
            it: "Settings > Illegalcord Settings > Backup & Restore"
        },
        body: {
            en: "Backup & Restore saves and restores settings, plugins, CSS, and local data. Use it before big experiments.",
            it: "Backup & Restore salva e ripristina impostazioni, plugin, CSS e dati locali. Usalo prima degli esperimenti grossi."
        },
        bullets: {
            en: [
                "Export a backup before large updates.",
                "Import a backup after moving installs or losing settings.",
                "Keep at least one recent backup outside the Discord folder."
            ],
            it: [
                "Esporta un backup prima di aggiornamenti grandi.",
                "Importa un backup dopo aver cambiato installazione o perso impostazioni.",
                "Conserva almeno un backup recente fuori dalla cartella Discord."
            ]
        },
        panel: "equicord_backup_restore_panel",
        actionLabel: {
            en: "Open Backup",
            it: "Apri Backup"
        }
    }
];

export const RECOMMENDED_PLUGIN_COPY: Record<RecommendedPluginName, LocalizedText> = {
    Questify: {
        en: "Quest workflow, sorting, reminders, and completion helpers.",
        it: "Workflow quest, ordinamento, promemoria e aiuti al completamento."
    },
    MessageLogger: {
        en: "Basic message logging for deleted and edited messages.",
        it: "Log base per messaggi eliminati e modificati."
    },
    MessageLoggerEnhanced: {
        en: "Extended logger tools and richer local history.",
        it: "Strumenti logger estesi e cronologia locale più ricca."
    },
    BetterScreenshare: {
        en: "Quick controls for stream quality, presets, and bitrate.",
        it: "Controlli rapidi per qualità stream, preset e bitrate."
    },
    BetterMicrophone: {
        en: "Extra microphone controls from the voice panel.",
        it: "Controlli microfono extra dal pannello voce."
    }
};
