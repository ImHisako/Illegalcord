import { state } from "../store";
import { escapeHtml } from "./helpers";
import { NotificationAction } from "../types";
import { RestAPI } from "@webpack/common";

export function cleanupContainer() {
    document.getElementById("cloner-pill-container")?.remove();
}

export function getPillContainer(): HTMLElement {
    if (!state.pillContainer || !document.body.contains(state.pillContainer)) {
        state.pillContainer = document.createElement("div");
        state.pillContainer.id = "cloner-pill-container";
        state.pillContainer.className = "cloner-pill-container";
        document.body.appendChild(state.pillContainer);
    }
    return state.pillContainer;
}

export function closePill(id: string) {
    const pill = document.getElementById(id);
    if (pill && !pill.classList.contains("hiding")) {
        pill.classList.add("hiding");
        setTimeout(() => pill.remove(), 900);
    }
}

export function notify(
    title: string,
    body: string,
    type: "success" | "info" | "error" = "info",
    duration = 3000,
    actions: NotificationAction[] = []
): string {
    const container = getPillContainer();
    const actualDuration = type === "error" ? 8000 : duration;
    const notificationId = `sub-pill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (duration !== 0) {
        const existingNotifications = container.querySelectorAll(".cloner-sub-pill:not(.hiding)");
        if (existingNotifications.length > 4) {
            const oldest = existingNotifications[0];
            oldest.classList.add("hiding");
            setTimeout(() => oldest.remove(), 500);
        }
    }

    const notification = document.createElement("div");
    notification.className = `cloner-sub-pill ${type}`;
    notification.id = notificationId;

    const icons: Record<string, string> = { success: "✓", error: "✕", info: "⚡" };
    const actionButtons = actions.map((action, index) => {
        const safeId = `btn-${index}-${action.label.replace(/\\s+/g, '-')}`;
        return `<button id="${safeId}" class="cloner-btn ${action.type || 'default'}" style="padding: 4px 10px; font-size: 11px;">${action.label}</button>`;
    }).join("");

    notification.innerHTML = `
        <div class="cloner-sub-pill-icon ${type}">${icons[type]}</div>
        <div class="cloner-sub-pill-content">
            <div class="cloner-sub-pill-title">${escapeHtml(title)}</div>
            ${body ? `<div class="cloner-sub-pill-body">${escapeHtml(body)}</div>` : ''}
            ${actions.length > 0 ? `<div style="display:flex; gap: 6px; margin-top: 6px;">${actionButtons}</div>` : ''}
        </div>
    `;

    container.appendChild(notification);

    actions.forEach((action, index) => {
        const safeId = `btn-${index}-${action.label.replace(/\\s+/g, '-')}`;
        const btn = notification.querySelector(`#${safeId}`);
        if (btn) {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                action.onClick(notificationId);
            });
        }
    });

    if (duration !== 0) {
        setTimeout(() => {
            closePill(notificationId);
        }, actualDuration);
    }

    return notificationId;
}

export function createMainProgressNotification(title: string, initialBody: string, onSkipRoles?: () => void, isExistingServer: boolean = false, showSkipRoles: boolean = true): string {
    state.skipRolesCallback = onSkipRoles || null;
    const container = getPillContainer();
    const notificationId = `main-pill-${Date.now()}`;

    const pill = document.createElement("div");
    pill.className = `cloner-pill`;
    pill.id = notificationId;

    const cancelBtnText = isExistingServer ? "Cancel" : "Cancel & Delete";
    const cancelBtnClass = isExistingServer ? "cloner-btn" : "cloner-btn danger";
    const skipRolesBtnHtml = showSkipRoles ? `<button class="cloner-btn cloner-skip-roles-btn" style="display:none">Skip Roles</button>` : '';

    pill.innerHTML = `
        <div class="cloner-pill-compact">
            <div class="cloner-pill-spinner"></div>
            <span class="cloner-pill-title">${escapeHtml(title)}</span>
            <span class="cloner-pill-percent">0%</span>
        </div>
        <div class="cloner-pill-expanded">
            <div class="cloner-pill-expanded-inner">
                <div class="cloner-pill-body">${escapeHtml(initialBody)}</div>
                <div class="cloner-pill-progress-bar">
                    <div class="cloner-pill-progress-fill"></div>
                </div>
                <div class="cloner-pill-actions">
                    ${skipRolesBtnHtml}
                    <button class="${cancelBtnClass} cloner-cancel-btn">${cancelBtnText}</button>
                </div>
            </div>
        </div>
    `;

    container.insertBefore(pill, container.firstChild);

    const skipRolesBtn = pill.querySelector(".cloner-skip-roles-btn");
    if (skipRolesBtn) {
        skipRolesBtn.addEventListener("click", () => {
            if (state.skipRolesCallback) state.skipRolesCallback();
            (skipRolesBtn as HTMLButtonElement).disabled = true;
            (skipRolesBtn as HTMLButtonElement).textContent = "Skipped";
        });
    }

    const cancelBtn = pill.querySelector(".cloner-cancel-btn");
    if (cancelBtn) {
        cancelBtn.addEventListener("click", async () => {
            state.isCloning = false;
            if (state.abortController) {
                state.abortController.abort();
                state.abortController = null;
            }

            // Mark completed IMMEDIATELY to lock hover
            pill.classList.add("completed");

            if (!isExistingServer && state.currentCloneGuildId) {
                try {
                    await RestAPI.del({ url: `/guilds/${state.currentCloneGuildId}` });
                    completeMainProgress(notificationId, "Server deleted", false, "Cancelled");
                } catch (e) {
                    completeMainProgress(notificationId, "Could not delete server", false, "Cancelled");
                }
                state.currentCloneGuildId = null;
            } else {
                completeMainProgress(notificationId, "Clone Cancelled", false, "Cancelled");
            }
        });
    }

    return notificationId;
}

export function updateMainProgress(id: string, body: string, percent: number) {
    const safePercent = isNaN(percent) ? 0 : Math.min(100, Math.max(0, Math.round(percent)));
    const pill = document.getElementById(id);
    if (!pill || pill.classList.contains("completed")) return;

    const bodyEl = pill.querySelector(".cloner-pill-body");
    if (bodyEl) bodyEl.textContent = body;

    const percentEl = pill.querySelector(".cloner-pill-percent");
    if (percentEl) percentEl.textContent = `${safePercent}%`;

    const progressBar = pill.querySelector(".cloner-pill-progress-fill") as HTMLElement;
    if (progressBar) {
        progressBar.style.width = `${safePercent}%`;
    }
}

export function completeMainProgress(id: string, body: string, success: boolean, customPercentText?: string) {
    const pill = document.getElementById(id);
    if (!pill) return;

    // Lock hover expansion
    pill.classList.add("completed");

    const titleEl = pill.querySelector(".cloner-pill-title");
    if (titleEl) titleEl.textContent = body;

    const percentEl = pill.querySelector(".cloner-pill-percent");
    if (percentEl) percentEl.textContent = customPercentText || (success ? "Done" : "Error");

    const progressBar = pill.querySelector(".cloner-pill-progress-fill") as HTMLElement;
    if (progressBar) {
        progressBar.style.width = "100%";
    }

    pill.classList.add(success ? 'success' : 'error');

    // Single close timer (3s for cancel, 6s for success/error)
    const delay = customPercentText === "Cancelled" ? 3000 : 6000;
    setTimeout(() => closePill(id), delay);
}

export function updateProgress(percent: number, message?: string) {
    if (state.mainProgressNotificationId) {
        updateMainProgress(state.mainProgressNotificationId, message || `Progress: ${Math.round(percent)}%`, percent);
    }
}

export const updateWithTime = (msg: string, percent: number) => {
    if (!state.mainProgressNotificationId) return;
    updateMainProgress(state.mainProgressNotificationId, msg, percent);
};
