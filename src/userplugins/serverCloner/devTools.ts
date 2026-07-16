import {
    notify,
    createMainProgressNotification,
    updateMainProgress,
    completeMainProgress,
    getPillContainer,
} from "./utils/notifications";
import { showUpdateModal } from "./components/UpdateModal";
import { state } from "./store";
import { sleep } from "./utils/helpers";



function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}



async function demoNotify() {

    notify("Success Example", "Channel cloned successfully!", "success", 4000);
    await sleep(700);
    notify("Info Example", "Roles: 12 • Channels: 83 • Settings: 1s", "info", 5000);
    await sleep(700);
    notify("Error Example", "Rate limited — retrying in 3s…", "error", 6000);
}



async function demoProgressPill() {

    if (state.isCloning) {
        console.warn("[SCDev] A clone is already in progress — aborting demo.");
        return;
    }

    state.isCloning = true;

    const id = createMainProgressNotification(
        "Cloning \"Test Server\"",
        "Starting demo…",
        undefined,
        true,
        false
    );
    state.mainProgressNotificationId = id;

    const steps: Array<[number, string]> = [
        [8, "Extracting emojis…"],
        [20, "Cloning roles (1/5)…"],
        [35, "Cloning roles (3/5)…"],
        [50, "Cloning roles (5/5)…"],
        [60, "Cloning categories (1/4)…"],
        [72, "Cloning channels (10/30)…"],
        [85, "Cloning channels (25/30)…"],
        [93, "Applying settings…"],
        [98, "Cloning onboarding…"],
    ];

    for (const [pct, msg] of steps) {
        if (!state.isCloning) break;
        await sleep(600);
        updateMainProgress(id, msg, pct);
    }

    if (state.isCloning) {
        await sleep(600);
        completeMainProgress(id, "Successfully cloned \"Test Server\"!", true);
    }

    state.isCloning = false;
    state.mainProgressNotificationId = null;
}



function demoUpdateModal(mandatory = false) {
    const notes = mandatory
        ? "[MANDATORY]\n## v2.0.0\n**Critical bug fix** for channel permission cloning."
        : "## v1.9.0\n**New:** Per-phase timing breakdown\n**Fix:** Hidden channel names\n**Perf:** GPU-accelerated animations";
    showUpdateModal("2.0.0", notes);
}



const SCDev = {

    notify: demoNotify,


    pill: demoProgressPill,


    update: (mandatory = false) => demoUpdateModal(mandatory),


    n: (title: string, body: string, type: "success" | "info" | "error" = "info", ms = 4000) =>
        notify(title, body, type, ms),

    help() {
        console.log(`
%cServerCloner DevTools%c
──────────────────────────────
  SCDev.notify()          — show 3 sample notifications
  SCDev.pill()            — animate full progress pill
  SCDev.update()          — update-available pill
  SCDev.update(true)      — mandatory-update pill
  SCDev.n(title, body)    — custom notification (info)
  SCDev.n(t, b, 'error')  — custom error notification
──────────────────────────────
        `, "color:#5865f2; font-weight:700; font-size:14px;", "");
    }
};

export function registerDevTools() {
    (window as any).SCDev = SCDev;
    console.log("%c[ServerCloner] DevTools registered → type SCDev.help()", "color:#43b581; font-weight:600;");
}

export function unregisterDevTools() {
    delete (window as any).SCDev;
}