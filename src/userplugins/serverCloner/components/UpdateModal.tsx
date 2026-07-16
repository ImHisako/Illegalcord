import { DataStore } from "@api/index";
import { PLUGIN_VERSION, UPDATES_CHANNEL_ID, SUPPORT_INVITE_CODE } from "../constants";
import { ChannelStore, NavigationRouter, InviteActions } from "@webpack/common";
import { openInviteModal } from "@utils/discord";
import { getPillContainer } from "../utils/notifications";
import { escapeHtml } from "../utils/helpers";

export function showUpdateModal(version: string, releaseNotes: string) {
    const container = getPillContainer();

    const isMandatory = releaseNotes.includes("[MANDATORY]");
    const saferId     = version.replace(/\./g, "");

    const formattedNotes = escapeHtml(
        releaseNotes
            .replace(/\[MANDATORY\]/gi, "")
            .replace(/#{1,6}\s/g, "")
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .substring(0, 150) + "…"
    );

    const accentColor = isMandatory ? "#ed4245" : "#2dc770";

    const pill = document.createElement("div");
    pill.className = "cloner-pill always-expanded";

    pill.style.cssText = "min-width:320px; animation:pillEntry 0.6s cubic-bezier(0.25,1,0.5,1) both;";

    pill.innerHTML = `
        <div class="cloner-pill-compact" style="justify-content:center; position:relative; margin-bottom:12px; width:100%;">
            <span class="cloner-pill-title" style="color:${accentColor}; flex:unset;">ServerCloner Update</span>
            <span class="cloner-pill-percent" style="
                position:absolute; right:0;
                color:#fff;
                background:${accentColor};
                padding:2px 8px; border-radius:12px;
                font-size:11px;
            ">v${escapeHtml(version)}</span>
        </div>
        <div class="cloner-pill-expanded" style="grid-template-rows:1fr; opacity:1; pointer-events:auto;">
            <div class="cloner-pill-expanded-inner">
                <div class="cloner-pill-body" style="text-align:left; line-height:1.5;">
                    <strong style="color:#fff;">Current: v${escapeHtml(PLUGIN_VERSION)}</strong><br/><br/>
                    <span style="opacity:0.8;">${formattedNotes}</span>
                    ${isMandatory ? '<br/><br/><strong style="color:#ed4245;">This is a mandatory update.</strong>' : ""}
                </div>
                <div class="cloner-pill-actions">
                    ${!isMandatory ? `<button class="cloner-btn danger" id="sc-dismiss-${saferId}">Not Now</button>` : ""}
                    <button class="cloner-btn success" id="sc-update-${saferId}">View Update</button>
                </div>
            </div>
        </div>
    `;

    container.insertBefore(pill, container.firstChild);

    function dismiss() {
        DataStore.set("ServerCloner-dismissed-version", version);
        pill.classList.add("hiding");
        setTimeout(() => pill.remove(), 700);
    }

    if (!isMandatory) {
        document.getElementById(`sc-dismiss-${saferId}`)?.addEventListener("click", dismiss);
    }

    document.getElementById(`sc-update-${saferId}`)?.addEventListener("click", async () => {
        dismiss();

        const channel = ChannelStore.getChannel(UPDATES_CHANNEL_ID);
        if (channel?.guild_id) {
            NavigationRouter.transitionTo(`/channels/${channel.guild_id}/${UPDATES_CHANNEL_ID}`);
        } else {
            try {

                const { invite } = await InviteActions.resolveInvite(SUPPORT_INVITE_CODE, "Desktop Modal");
                if (invite?.guild?.id) {


                    NavigationRouter.transitionTo(`/channels/${invite.guild.id}/${UPDATES_CHANNEL_ID}`);
                } else {

                    openInviteModal(SUPPORT_INVITE_CODE);
                }
            } catch (e) {
                console.error("[ServerCloner] Failed to resolve invite for preview mode:", e);
                openInviteModal(SUPPORT_INVITE_CODE);
            }
        }
    });
}
