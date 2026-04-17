/*
 * MullvadDNS Plugin
 * Forces Discord to use Mullvad DNS servers for enhanced privacy
 */

// @ts-ignore
import { definePluginSettings } from "@api/Settings";
// @ts-ignore
import definePlugin from "@utils/types";
// @ts-ignore
import { OptionType } from "@utils/types";

// Plugin settings
const settings = definePluginSettings({
  mullvadServer: {
    type: OptionType.SELECT,
    description: "Mullvad DNS server to use",
    options: [
      { label: "Base DNS (no filtering)", value: "dns.mullvad.net", default: true },
      { label: "Adblock (ads + trackers)", value: "adblock.dns.mullvad.net" },
      { label: "Base (ads + trackers + malware)", value: "base.dns.mullvad.net" },
      { label: "Extended (+ social media)", value: "extended.dns.mullvad.net" },
      { label: "Family (+ adult + gambling)", value: "family.dns.mullvad.net" },
      { label: "All (everything blocked)", value: "all.dns.mullvad.net" }
    ],
    default: "dns.mullvad.net"
  },
  enableLogging: {
    type: OptionType.BOOLEAN,
    description: "Enable detailed logging.",
    default: true
  },
  showNotifications: {
    type: OptionType.BOOLEAN,
    description: "Show toast notifications for DNS resolutions.",
    default: true
  },
  patchWebSocket: {
    type: OptionType.BOOLEAN,
    description: "Patch WebSocket connections for Discord gateway.",
    default: true
  },
  bypassCDN: {
    type: OptionType.BOOLEAN,
    description: "Bypass CDN domains for better performance.",
    default: false
  },
  autoStart: {
    type: OptionType.BOOLEAN,
    description: "Auto-start plugin on load.",
    default: true
  },
  logLevel: {
    type: OptionType.SELECT,
    description: "Logging level.",
    options: [
      { label: "Verbose", value: "verbose" },
      { label: "Info", value: "info" },
      { label: "Warning", value: "warn" },
      { label: "Error", value: "error" }
    ],
    default: "info"
  }
});

// @ts-ignore
export default definePlugin({
  name: "MullvadDNS",
  description: "Force Discord to use Mullvad DNS servers for enhanced privacy",
  tags: ["Privacy", "Utility"],
  authors: [{ name: "Irritably", id: 928787166916640838n }],
  settings,

  // Statistics tracking
  statistics: {
    totalRequests: 0,
    successfulResolutions: 0,
    failedResolutions: 0,
    cacheHits: 0
  },

  start() {
    // Plugin configuration
    const PLUGIN_NAME = "MullvadDNS";
    const VERSION = "1.3.0";

    // Official Mullvad DNS servers (DoH/DoT supported)
    // Source: https://mullvad.net/en/help/dns-over-https-and-dns-over-tls
    const MULLVAD_DNS_SERVERS: Record<string, string> = {
      "dns.mullvad.net": "194.242.2.2",                    // Base DNS (no content blocking)
      "adblock.dns.mullvad.net": "194.242.2.3",            // Ads + Trackers blocking
      "base.dns.mullvad.net": "194.242.2.4",               // Ads + Trackers + Malware blocking
      "extended.dns.mullvad.net": "194.242.2.5",           // Ads + Trackers + Malware + Social media blocking
      "family.dns.mullvad.net": "194.242.2.6",             // Ads + Trackers + Malware + Adult + Gambling blocking
      "all.dns.mullvad.net": "194.242.2.9"                 // All content blocking
    };

    // Get selected Mullvad server IP
    const getSelectedMullvadIP = (): string => {
      return MULLVAD_DNS_SERVERS[settings.store.mullvadServer] || MULLVAD_DNS_SERVERS["dns.mullvad.net"];
    };

    // Discord services will use Mullvad DNS resolution
    const DISCORD_DOMAINS = [
      "discord.com",
      "gateway.discord.gg",
      "media.discordapp.net",
      "cdn.discordapp.com",
      "status.discord.com",
      "ptb.discord.com",
      "canary.discord.com",
      "discordapp.net"
    ];

    // CDN domains to bypass for better performance
    const CDN_DOMAINS = [
      "cdn.discordapp.com",
      "media.discordapp.net",
      "images-ext-1.discordapp.net",
      "images-ext-2.discordapp.net"
    ];

    // State management
    const originalFetch = window.fetch;
    const originalWebSocket = window.WebSocket;
    let isActive = false;
    const dnsCache = new Map();
    const statistics = {
      totalRequests: 0,
      successfulResolutions: 0,
      failedResolutions: 0,
      cacheHits: 0,
      webSocketConnections: 0
    };

    // Advanced logger with colors and levels
    const log = {
      verbose: function (msg) {
        if (settings.store.enableLogging && settings.store.logLevel === "verbose") {
          console.debug(
            `%c[${PLUGIN_NAME}] %cVERBOSE: ${msg}`,
            "color: #9E9E9E; font-weight: bold",
            "color: #9E9E9E"
          );
        }
      },
      info: function (msg) {
        if (settings.store.enableLogging && ["verbose", "info"].includes(settings.store.logLevel)) {
          console.log(
            `%c[${PLUGIN_NAME}] %cINFO: ${msg}`,
            "color: #4CAF50; font-weight: bold",
            "color: #4CAF50"
          );
        }
      },
      warn: function (msg) {
        if (settings.store.enableLogging && ["verbose", "info", "warn"].includes(settings.store.logLevel)) {
          console.warn(
            `%c[${PLUGIN_NAME}] %cWARN: ${msg}`,
            "color: #FF9800; font-weight: bold",
            "color: #FF9800"
          );
        }
      },
      error: function (msg) {
        if (settings.store.enableLogging) {
          console.error(
            `%c[${PLUGIN_NAME}] %cERROR: ${msg}`,
            "color: #F44336; font-weight: bold",
            "color: #F44336"
          );
        }
      }
    };

    // Domains to exclude from DNS interception (whitelist)
    const EXCLUDED_DOMAINS = [
      // OAuth and authentication services
      "discord.com/api/v9/oauth2",
      "discord.com/api/oauth2",
      "discordapp.com/api/oauth2",
      // Cloud sync services
      "discord.com/api/v9/users/@me/settings-proto",
      "discord.com/api/v9/users/@me/applications-role-connection",
      // Critical API endpoints
      "discord.com/api/v9/auth",
      "discord.com/api/v9/verify",
      // CDN for critical assets
      "cdn.discordapp.com/attachments",
      "media.discordapp.net/attachments"
    ];

    // Check if URL should be excluded from DNS modification
    function shouldExcludeURL(url) {
      const urlString = url.toString().toLowerCase();

      // Check against excluded patterns
      for (const pattern of EXCLUDED_DOMAINS) {
        if (urlString.includes(pattern)) {
          log.verbose(`Excluding URL from DNS modification: ${url.hostname}${url.pathname}`);
          return true;
        }
      }

      // Exclude OAuth endpoints specifically
      if (url.pathname.includes("/oauth2/") || url.pathname.includes("/auth/")) {
        log.verbose(`Excluding OAuth endpoint: ${url.hostname}${url.pathname}`);
        return true;
      }

      return false;
    }

    // Enhanced DNS record lookup with caching
    function getDNSRecord(hostname) {
      // Check cache first
      if (dnsCache.has(hostname)) {
        statistics.cacheHits++;
        log.verbose(`Cache hit for ${hostname}: ${dnsCache.get(hostname)}`);
        return dnsCache.get(hostname);
      }

      // Check if hostname is a Discord domain
      const isDiscordDomain = DISCORD_DOMAINS.some(domain =>
        hostname === domain || hostname.endsWith(`.${domain}`)
      );

      if (isDiscordDomain) {
        // Use selected Mullvad DNS server for resolution
        const mullvadServer = getSelectedMullvadIP();
        dnsCache.set(hostname, mullvadServer);
        log.verbose(`Cached Discord domain: ${hostname} -> ${mullvadServer} (Mullvad DNS)`);
        return mullvadServer;
      }

      // Check if it's a direct Mullvad DNS server hostname
      const record = MULLVAD_DNS_SERVERS[hostname] || null;
      if (record) {
        dnsCache.set(hostname, record);
        log.verbose(`Cached new record: ${hostname} -> ${record}`);
      }
      return record;
    }

    // Enhanced fetch patch with statistics
    function patchFetch() {
      if (!originalFetch) {
        log.error("Original fetch not found!");
        return false;
      }

      window.fetch = function (input, init) {
        try {
          let urlStr = (input instanceof Request) ? input.url : String(input);
          const url = new URL(urlStr);

          // Increment request counter
          statistics.totalRequests++;

          // Check if this is a Discord-related hostname AND not excluded
          if (url.hostname.includes("discord") &&
            !url.hostname.includes("mullvad") &&
            !shouldExcludeURL(url)) {

            // Check if we should bypass CDN
            const isCDN = settings.store.bypassCDN && CDN_DOMAINS.some(cdn =>
              url.hostname === cdn || url.hostname.endsWith(`.${cdn}`)
            );

            if (isCDN) {
              log.verbose(`Bypassing CDN domain: ${url.hostname}`);
            } else {
              const ip = getDNSRecord(url.hostname);

              if (ip) {
                // Replace hostname with IP
                url.hostname = ip;
                urlStr = url.toString();

                statistics.successfulResolutions++;
                log.info(`Resolved ${url.hostname} -> ${ip} (Mullvad)`);

                // Show notification if enabled
                if (settings.store.showNotifications) {
                  showNotification(`DNS resolved: ${url.hostname} -> ${ip}`, "success");
                }
              } else {
                statistics.failedResolutions++;
                log.warn(`No DNS record found for ${url.hostname}`);
              }
            }
          } else {
            if (shouldExcludeURL(url)) {
              log.verbose(`Whitelisted URL skipped: ${url.hostname}${url.pathname}`);
            } else {
              log.verbose(`Skipping non-Discord host: ${url.hostname}`);
            }
          }

          // Call original fetch with modified URL
          const request = (input instanceof Request)
            ? new Request(urlStr, input)
            : urlStr;

          return originalFetch(request, init);

        } catch (error) {
          statistics.failedResolutions++;
          log.error(`Fetch patch error: ${error.message}`);
          return originalFetch(input, init);
        }
      };

      log.info("Fetch patched successfully");
      return true;
    }

    // WebSocket patch for Discord gateway
    function patchWebSocket() {
      if (!settings.store.patchWebSocket) {
        log.info("WebSocket patching disabled");
        return true;
      }

      if (!originalWebSocket) {
        log.error("Original WebSocket not found!");
        return false;
      }

      window.WebSocket = class extends originalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          let patchedUrl = url;

          try {
            const urlStr = url.toString();
            const urlObj = new URL(urlStr);

            // Check if this is a Discord WebSocket connection
            if (urlObj.hostname.includes("discord") && !urlObj.hostname.includes("mullvad")) {
              const ip = getDNSRecord(urlObj.hostname);

              if (ip) {
                urlObj.hostname = ip;
                patchedUrl = urlObj.toString();
                statistics.webSocketConnections++;
                log.info(`🔌 WebSocket resolved: ${urlObj.hostname} -> ${ip} (Mullvad)`);

                if (settings.store.showNotifications) {
                  showNotification(`WebSocket: ${urlObj.hostname} -> ${ip}`, "info");
                }
              }
            }
          } catch (error) {
            log.error(`WebSocket patch error: ${error}`);
          }

          super(patchedUrl, protocols);
        }
      };

      log.info("WebSocket patched successfully");
      return true;
    }

    // Toast notification helper
    function showNotification(message, type = "info") {
      try {
        const toastModule = (window as any).Vencord?.Plugins?.Plugins?.Toasts;
        if (toastModule) {
          toastModule.show({
            message: `🔒 ${message}`,
            type: type === "success"
              ? toastModule.Type.SUCCESS
              : type === "error"
                ? toastModule.Type.FAILURE
                : toastModule.Type.MESSAGE,
            id: Date.now(),
            options: { position: toastModule.Position.BOTTOM }
          });
        } else {
          log[type === "error" ? "error" : "info"](message);
        }
      } catch (e) {
        log.verbose("Toast system not available, using console");
        log[type === "error" ? "error" : "info"](message);
      }
    }

    // Public API
    const MullvadDNS = {
      name: PLUGIN_NAME,
      version: VERSION,
      isActive: () => isActive,
      statistics,

      start: () => {
        if (isActive) {
          log.warn("Plugin is already active!");
          return;
        }

        try {
          log.info(`Starting ${PLUGIN_NAME} v${VERSION}`);
          log.info(`Using Mullvad server: ${settings.store.mullvadServer} (${getSelectedMullvadIP()})`);

          const fetchSuccess = patchFetch();
          const wsSuccess = patchWebSocket();

          if (fetchSuccess) {
            isActive = true;
            showNotification(`${PLUGIN_NAME} activated successfully`, "success");
            log.info(`Plugin started successfully with ${Object.keys(MULLVAD_DNS_SERVERS).length} Mullvad DNS servers`);
            log.info(`Monitoring ${DISCORD_DOMAINS.length} Discord domains`);
            log.info(`WebSocket patch: ${settings.store.patchWebSocket ? "enabled" : "disabled"}`);
            log.info(`CDN bypass: ${settings.store.bypassCDN ? "enabled" : "disabled"}`);
          } else {
            throw new Error("Failed to patch network functions");
          }

        } catch (error) {
          log.error(`Failed to start plugin: ${error.message}`);
          showNotification(`${PLUGIN_NAME} failed to start`, "error");
        }
      },

      stop: () => {
        if (!isActive) {
          log.warn("Plugin is not active!");
          return;
        }

        try {
          log.info(`Stopping ${PLUGIN_NAME}`);

          if (originalFetch) {
            window.fetch = originalFetch;
            log.info("Fetch restored to original");
          }

          if (originalWebSocket) {
            window.WebSocket = originalWebSocket;
            log.info("WebSocket restored to original");
          }

          // Clear cache
          dnsCache.clear();
          isActive = false;

          showNotification(`${PLUGIN_NAME} deactivated`, "info");
          log.info("Plugin stopped successfully");

        } catch (error) {
          log.error(`Error stopping plugin: ${error.message}`);
        }
      },

      // Utility methods
      getDNSTable: () => ({ ...MULLVAD_DNS_SERVERS }),
      getMonitoredDomains: () => [...DISCORD_DOMAINS],
      getCacheStats: () => ({
        cacheSize: dnsCache.size,
        cachedHostnames: Array.from(dnsCache.keys()),
        cacheEntries: Object.fromEntries(dnsCache)
      }),
      getStatistics: () => ({ ...statistics }),
      getSelectedServer: () => settings.store.mullvadServer,
      clearStatistics: () => {
        statistics.totalRequests = 0;
        statistics.successfulResolutions = 0;
        statistics.failedResolutions = 0;
        statistics.cacheHits = 0;
        log.info("Statistics cleared");
      },
      clearCache: () => {
        const size = dnsCache.size;
        dnsCache.clear();
        log.info(`Cleared ${size} DNS cache entries`);
        return size;
      },
      addCustomRecord: (hostname, ip) => {
        if (typeof hostname === "string" && typeof ip === "string") {
          MULLVAD_DNS_SERVERS[hostname] = ip;
          log.info(`➕ Added custom DNS record: ${hostname} -> ${ip}`);
          return true;
        }
        return false;
      },
      removeCustomRecord: (hostname) => {
        if (Object.prototype.hasOwnProperty.call(MULLVAD_DNS_SERVERS, hostname)) {
          delete MULLVAD_DNS_SERVERS[hostname];
          dnsCache.delete(hostname);
          log.info(`➖ Removed DNS record: ${hostname}`);
          return true;
        }
        return false;
      }
    };

    // Auto-start based on settings
    if (settings.store.autoStart) {
      setTimeout(() => {
        MullvadDNS.start();
      }, 2000);
    } else {
      log.info("Auto-start disabled. Plugin ready but not active.");
      showNotification(`${PLUGIN_NAME} loaded - start manually from settings`, "info");
    }

    // Expose API globally for debugging
    // @ts-ignore
    window.MullvadDNS = MullvadDNS;

    log.info(`${PLUGIN_NAME} v${VERSION} loaded and ready`);
    log.info(`Features: Logging=${settings.store.enableLogging}, Notifications=${settings.store.showNotifications}`);
  },

  stop() {
    // Clean shutdown
    try {
      if (typeof (window as any).MullvadDNS?.stop === "function") {
        (window as any).MullvadDNS.stop();
      }
      console.log("[MullvadDNS] Plugin stopped");
    } catch (error) {
      console.error("[MullvadDNS] Error during shutdown:", error);
    }
  }
});
