/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { ChannelStore, NavigationRouter } from "@webpack/common";

import { PLUGIN_VERSION } from "../constants";

export function showUpdateModal(version: string, releaseNotes: string) {
    if (typeof document !== "undefined" && !document.getElementById("update-pill-styles")) {
        const style = document.createElement("style");
        style.id = "update-pill-styles";
        style.textContent = `
            @keyframes updatePillEntry {
                0% { opacity: 0; transform: translateY(-20px); scale: 0.95; }
                100% { opacity: 1; transform: translateY(0); scale: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    let container = document.getElementById("vc-pill-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "vc-pill-container";
        container.className = "vc-pill-container";
        document.body.appendChild(container);
    }

    const pillRow = document.createElement("div");
    pillRow.className = "cloner-pill-row";

    const pill = document.createElement("div");
    pill.className = "cloner-pill";
    pill.style.minWidth = "320px";
    pill.style.animation = "updatePillEntry 0.6s cubic-bezier(0.25, 1, 0.5, 1) forwards";

    const isMandatory = releaseNotes.includes("[MANDATORY]");

    const formattedNotes = releaseNotes
        .replace(/\[MANDATORY\]/gi, "")
        .replace(/#{1,6}\s/g, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .substring(0, 150) + "...";

    pill.innerHTML = `
        <div class="cloner-pill-compact" style="justify-content: center; position: relative; margin-bottom: 12px; width: 100%;">
            <span class="cloner-pill-title" style="color: ${isMandatory ? "#ed4245" : "#2dc770"}; font-size: 14px; flex: unset;">ServerCloner Update</span>
            <span class="cloner-pill-percent" style="position: absolute; right: 0; color: white; background: ${isMandatory ? "#ed4245" : "#2dc770"}; padding: 2px 8px; border-radius: 12px; font-size: 11px; min-width: unset;">v${version}</span>
        </div>
        <div class="cloner-pill-expanded" style="grid-template-rows: 1fr; opacity: 1; pointer-events: auto;">
            <div class="cloner-pill-expanded-inner">
                <div class="cloner-pill-body" style="text-align: left; line-height: 1.4; margin-bottom: 4px;">
                    <strong style="color: #fff">Current: v${PLUGIN_VERSION}</strong><br/><br/>
                    <span style="opacity: 0.8">${formattedNotes}</span>
                    ${isMandatory ? '<br/><br/><strong style="color: #ed4245;">This is a mandatory update.</strong>' : ""}
                </div>
                <div class="cloner-pill-actions" style="margin-top: 8px;">
                    ${!isMandatory ? `<button class="cloner-btn danger" id="sc-update-dismiss-${version.replace(/\./g, "")}">Not Now</button>` : ""}
                    <button class="cloner-btn success" id="sc-update-now-${version.replace(/\./g, "")}">View Update</button>
                </div>
            </div>
        </div>
    `;

    pillRow.appendChild(pill);
    container.insertBefore(pillRow, container.firstChild);

    if (!isMandatory) {
        pill.querySelector("#sc-update-dismiss-" + version.replace(/\./g, ""))?.addEventListener("click", () => {
            DataStore.set("ServerCloner-dismissed-version", version);
            pill.style.animation = "none";
            pill.classList.add("hiding");
            setTimeout(() => pillRow.remove(), 500);
        });
    }

    pill.querySelector("#sc-update-now-" + version.replace(/\./g, ""))?.addEventListener("click", () => {
        const channelId = "1475959035298840576";
        const channel = ChannelStore.getChannel(channelId);
        if (channel && channel.guild_id) {
            NavigationRouter.transitionTo(`/channels/${channel.guild_id}/${channelId}`);
        } else {
            const { openInviteModal } = require("@utils/discord");
            openInviteModal("9ra6MwHTHy");
        }
        DataStore.set("ServerCloner-dismissed-version", version);
        pill.style.animation = "none";
        pill.classList.add("hiding");
        setTimeout(() => pillRow.remove(), 500);
    });
}
