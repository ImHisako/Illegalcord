import definePlugin from "@utils/types"; // Standard Vencord plugin wrapper
import { FluxDispatcher } from "@webpack/common"; // Event dispatcher used to simulate presence events

export default definePlugin({
    name: "AlwaysPush",
    description: "Force Discord to always mark you as AFK to receive push notifications — without changing your DND or Online status.",
    authors: [{ name: "zerpoak", id: 0 }],

    // --- Patch internal AFK state handling ---
    patches: [
        {
            // Look for code where Discord dispatches AFK changes (e.g. AFK: false)
            find: 'type:"AFK",afk:',
            replacement: [
                {
                    // Intercept attempts to mark the user as AFK: false
                    match: /\i\.\i\.dispatch\({type:"AFK",afk:!1}\)/,
                            replace: "$self.enforceAfk()" // Replace with our own override method
                }
            ]
        },
        {
            // Also patch the AFK_SET event
            find: 'type:"AFK_SET",afk:',
            replacement: [
                {
                    // Same logic for the AFK_SET false event
                    match: /\i\.\i\.dispatch\({type:"AFK_SET",afk:!1}\)/,
                            replace: "$self.enforceAfkSet()" // Override with our enforced version
                }
            ]
        }
    ],

    // Called when the plugin is turned on
    start() {
        console.log("[AlwaysPush] Plugin started. Dispatching AFK and AFK_SET.");

        // Immediately dispatch AFK true so the user appears inactive
        FluxDispatcher.dispatch({ type: "AFK", afk: true });
        FluxDispatcher.dispatch({ type: "AFK_SET", afk: true });

        // Optionally: refresh every 60 seconds to keep state consistent (adjustable)
        this.interval = setInterval(() => {
            FluxDispatcher.dispatch({ type: "AFK", afk: true });
            FluxDispatcher.dispatch({ type: "AFK_SET", afk: true });
            console.log("[AlwaysPush] Re-dispatched AFK and AFK_SET.");
        }, 60000);
    },

    // Called when the plugin is turned off
    stop() {
        // Clean up interval
        clearInterval(this.interval);

        // Optionally return to AFK: false if you want to clean state (optional)
        FluxDispatcher.dispatch({ type: "AFK", afk: false });
        FluxDispatcher.dispatch({ type: "AFK_SET", afk: false });

        console.log("[AlwaysPush] Plugin stopped. AFK state cleared.");
    },

    // Override Discord’s AFK: false dispatch with AFK: true
    enforceAfk() {
        FluxDispatcher.dispatch({ type: "AFK", afk: true });
        console.log("[AlwaysPush] Blocked AFK:false → Forced AFK:true");
    },

    // Override Discord’s AFK_SET: false dispatch with AFK_SET: true
    enforceAfkSet() {
        FluxDispatcher.dispatch({ type: "AFK_SET", afk: true });
        console.log("[AlwaysPush] Blocked AFK_SET:false → Forced AFK_SET:true");
    }
});
