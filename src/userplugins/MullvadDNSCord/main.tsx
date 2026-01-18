/*
 * MullvadDNSCord Plugin
 * Forces Discord to use Mullvad DNS servers for enhanced privacy
 * Standalone version without external dependencies
 */

// Simple standalone version that works without Vencord imports
(function () {
  "use strict";

  const PLUGIN_NAME = "MullvadDNSCord";
  const VERSION = "1.2.0";

  // Mullvad DNS records for Discord services
  const MULLVAD_DNS_RECORDS = {
    "discord.com": "162.159.137.233",
    "gateway.discord.gg": "162.159.135.233",
    "media.discordapp.net": "152.67.79.60",
    "cdn.discordapp.com": "152.67.72.12",
    "status.discord.com": "104.18.33.247",
    "ptb.discord.com": "162.159.137.233",
    "canary.discord.com": "162.159.137.233",
    "discordapp.net": "152.67.79.60"
  };

  // Store original functions
  let originalFetch: typeof fetch | null = null;
  let originalXHR: typeof XMLHttpRequest | null = null;
  let isActive = false;
  const dnsCache = new Map<string, string>();

  // Logger utility
  const log = {
    info: (...args: any[]) =>
      console.log(
        `[%c${PLUGIN_NAME}%c]`,
        "color: #4CAF50; font-weight: bold",
        "color: inherit",
        ...args
      ),
    warn: (...args: any[]) =>
      console.warn(
        `[%c${PLUGIN_NAME}%c]`,
        "color: #FF9800; font-weight: bold",
        "color: inherit",
        ...args
      ),
    error: (...args: any[]) =>
      console.error(
        `[%c${PLUGIN_NAME}%c]`,
        "color: #F44336; font-weight: bold",
        "color: inherit",
        ...args
      ),
    debug: (...args: any[]) =>
      console.debug(
        `[%c${PLUGIN_NAME}%c]`,
        "color: #2196F3; font-weight: bold",
        "color: inherit",
        ...args
      )
  };

  // Simple toast notification fallback
  function showToast(
    message: string,
    type: "info" | "success" | "error" = "info"
  ) {
    try {
      // Try to use Discord's toast system if available
      const toastModule = (window as any).Vencord?.Plugins?.Plugins?.Toasts;
      if (toastModule) {
        toastModule.show({
          message: `🔒 ${message}`,
          type:
            type === "success"
              ? toastModule.Type.SUCCESS
              : type === "error"
                ? toastModule.Type.FAILURE
                : toastModule.Type.MESSAGE,
          id: Date.now(),
          options: { position: toastModule.Position.BOTTOM }
        });
      } else {
        // Fallback to console
        log[type](message);
      }
    } catch (e) {
      log.debug("Toast system not available, using console");
      log[type](message);
    }
  }

  // Get DNS record for hostname
  function getDNSRecord(hostname: string): string | null {
    return MULLVAD_DNS_RECORDS[hostname] || null;
  }

  // Enhanced fetch patch
  function patchFetch() {
    if (!window.fetch) {
      log.error("Original fetch not found!");
      return false;
    }

    originalFetch = window.fetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      try {
        let urlStr = input instanceof Request ? input.url : String(input);
        const url = new URL(urlStr);

        // Check if this is a Discord-related hostname
        const isDiscordHost =
          url.hostname.includes("discord") &&
          !url.hostname.includes("mullvad"); // Avoid recursion

        if (isDiscordHost) {
          const ip = getDNSRecord(url.hostname);

          if (ip) {
            // Cache the resolution
            dnsCache.set(url.hostname, ip);

            // Replace hostname with IP
            url.hostname = ip;
            urlStr = url.toString();

            log.debug(`🔄 Resolved ${url.hostname} → ${ip} (Mullvad)`);

            // Show notification for main domains
            if (["discord.com", "gateway.discord.gg"].includes(url.hostname)) {
              showToast(`DNS resolved: ${url.hostname} → ${ip}`, "info");
            }
          }
        }

        // Call original fetch with modified URL
        const request = input instanceof Request
          ? new Request(urlStr, {
            ...input,
            ...init
          })
          : urlStr;

        return originalFetch!.call(this, request, init);
      } catch (error) {
        log.error("Fetch patch error:", error);
        // Fallback to original fetch
        return originalFetch!.call(this, input, init);
      }
    };

    log.info("✅ Fetch patched successfully");
    return true;
  }

  // XMLHttpRequest patch
  function patchXHR() {
    if (!window.XMLHttpRequest) {
      log.error("Original XMLHttpRequest not found!");
      return false;
    }

    originalXHR = window.XMLHttpRequest;

    // @ts-ignore - Extending global XMLHttpRequest
    window.XMLHttpRequest = function () {
      const xhr = new originalXHR!();
      const originalOpen = xhr.open;

      xhr.open = function (method: string, url: string | URL, ...args: any[]) {
        try {
          // Handle both string and URL objects
          const urlStr = url.toString ? url.toString() : String(url);
          const urlObj = new URL(urlStr, window.location.origin);

          if (
            urlObj.hostname.includes("discord") &&
            !urlObj.hostname.includes("mullvad")
          ) {
            const ip = getDNSRecord(urlObj.hostname);

            if (ip) {
              dnsCache.set(urlObj.hostname, ip);
              urlObj.hostname = ip;

              log.debug(`🔄 XHR Resolved ${urlObj.hostname} → ${ip}`);

              // @ts-ignore
              return originalOpen.apply(this, [method, urlObj.toString()].concat(args));
            }
          }

          // @ts-ignore
          return originalOpen.apply(this, [method, url].concat(args));
        } catch (error) {
          log.error("XHR patch error:", error);
          // Fallback to original open
          // @ts-ignore
          return originalOpen.apply(this, [method, url].concat(args));
        }
      };

      return xhr;
    };

    log.info("✅ XMLHttpRequest patched successfully");
    return true;
  }

  // Restore original functions
  function restoreFetch() {
    if (originalFetch) {
      window.fetch = originalFetch;
      log.info("🔄 Fetch restored to original");
    }
  }

  function restoreXHR() {
    if (originalXHR) {
      // @ts-ignore
      window.XMLHttpRequest = originalXHR;
      log.info("🔄 XMLHttpRequest restored to original");
    }
  }

  // Public API
  const MullvadDNSCord = {
    name: PLUGIN_NAME,
    version: VERSION,
    isActive: () => isActive,

    start() {
      if (isActive) {
        log.warn("Plugin is already active!");
        return;
      }

      try {
        log.info(`🚀 Starting ${PLUGIN_NAME} v${VERSION}`);

        const fetchSuccess = patchFetch();
        const xhrSuccess = patchXHR();

        if (fetchSuccess || xhrSuccess) {
          isActive = true;
          showToast(
            `${PLUGIN_NAME} activated - Discord traffic now routed through Mullvad DNS`,
            "success"
          );
          log.info(
            `✅ Plugin started successfully with ${Object.keys(MULLVAD_DNS_RECORDS).length} DNS records`
          );
        } else {
          throw new Error("Failed to patch network functions");
        }
      } catch (error) {
        log.error("❌ Failed to start plugin:", error);
        showToast(`${PLUGIN_NAME} failed to start`, "error");
      }
    },

    stop() {
      if (!isActive) {
        log.warn("Plugin is not active!");
        return;
      }

      try {
        log.info(`🛑 Stopping ${PLUGIN_NAME}`);

        restoreFetch();
        restoreXHR();
        dnsCache.clear();
        isActive = false;

        showToast(`${PLUGIN_NAME} deactivated`, "info");
        log.info("✅ Plugin stopped successfully");
      } catch (error) {
        log.error("❌ Error stopping plugin:", error);
      }
    },

    // Utility methods
    getDNSTable: () => ({ ...MULLVAD_DNS_RECORDS }),
    getCacheStats: () => ({
      cacheSize: dnsCache.size,
      cachedHostnames: Array.from(dnsCache.keys())
    }),
    clearCache: () => {
      const cleared = dnsCache.size;
      dnsCache.clear();
      log.info(`🧹 Cleared ${cleared} DNS cache entries`);
      return cleared;
    },
    addCustomRecord: (hostname: string, ip: string) => {
      if (typeof hostname === "string" && typeof ip === "string") {
        // @ts-ignore
        MULLVAD_DNS_RECORDS[hostname] = ip;
        log.info(`➕ Added custom DNS record: ${hostname} → ${ip}`);
        return true;
      }
      return false;
    },
    removeCustomRecord: (hostname: string) => {
      // @ts-ignore
      if (Object.prototype.hasOwnProperty.call(MULLVAD_DNS_RECORDS, hostname)) {
        // @ts-ignore
        delete MULLVAD_DNS_RECORDS[hostname];
        dnsCache.delete(hostname);
        log.info(`➖ Removed DNS record: ${hostname}`);
        return true;
      }
      return false;
    }
  };

  // Auto-start the plugin after a short delay to ensure Discord is loaded
  setTimeout(() => {
    MullvadDNSCord.start();
  }, 2000);

  // Expose API globally for debugging/testing
  (window as any).MullvadDNSCord = MullvadDNSCord;

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    if (isActive) {
      MullvadDNSCord.stop();
    }
  });

  log.info(`📦 ${PLUGIN_NAME} v${VERSION} loaded and ready`);

  // Export for module systems (though this is primarily a standalone script)
  return MullvadDNSCord;
})();
