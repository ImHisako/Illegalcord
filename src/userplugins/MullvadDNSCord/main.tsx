/*
 * MullvadDNSCord Plugin
 * Forces Discord to use Mullvad DNS servers for enhanced privacy
 * Simple JavaScript version
 */

(function() {
  'use strict';
  
  // Plugin configuration
  var PLUGIN_NAME = "MullvadDNSCord";
  var VERSION = "1.2.0";
  
  // Mullvad DNS records for Discord services
  var MULLVAD_DNS_RECORDS = {
    "discord.com": "162.159.137.233",
    "gateway.discord.gg": "162.159.135.233",
    "media.discordapp.net": "152.67.79.60",
    "cdn.discordapp.com": "152.67.72.12",
    "status.discord.com": "104.18.33.247",
    "ptb.discord.com": "162.159.137.233",
    "canary.discord.com": "162.159.137.233"
  };
  
  // State management
  var originalFetch = window.fetch;
  var isActive = false;
  var dnsCache = {};
  
  // Simple logger
  var log = {
    info: function(msg) { 
      console.log("[" + PLUGIN_NAME + "] " + msg);
    },
    debug: function(msg) { 
      console.debug("[" + PLUGIN_NAME + "] " + msg);
    },
    error: function(msg) { 
      console.error("[" + PLUGIN_NAME + "] " + msg);
    }
  };
  
  // Get DNS record for hostname
  function getDNSRecord(hostname) {
    return MULLVAD_DNS_RECORDS[hostname] || null;
  }
  
  // Patch fetch function
  function patchFetch() {
    if (!originalFetch) {
      log.error("Original fetch not found!");
      return false;
    }
    
    window.fetch = function(input, init) {
      try {
        var urlStr = (input instanceof Request) ? input.url : String(input);
        var url = new URL(urlStr);
        
        // Check if this is a Discord-related hostname
        if (url.hostname.indexOf("discord") !== -1 && url.hostname.indexOf("mullvad") === -1) {
          var ip = getDNSRecord(url.hostname);
          
          if (ip) {
            // Cache the resolution
            dnsCache[url.hostname] = ip;
            
            // Replace hostname with IP
            url.hostname = ip;
            urlStr = url.toString();
            
            log.debug("Resolved " + url.hostname + " -> " + ip + " (Mullvad)");
          }
        }
        
        // Call original fetch with modified URL
        var request = (input instanceof Request) 
          ? new Request(urlStr, input)
          : urlStr;
          
        return originalFetch.call(this, request, init);
        
      } catch (error) {
        log.error("Fetch patch error: " + error);
        return originalFetch.call(this, input, init);
      }
    };
    
    log.info("Fetch patched successfully");
    return true;
  }
  
  // Public API
  var MullvadDNSCord = {
    name: PLUGIN_NAME,
    version: VERSION,
    isActive: function() { return isActive; },
    
    start: function() {
      if (isActive) {
        log.info("Plugin is already active!");
        return;
      }
      
      try {
        log.info("Starting " + PLUGIN_NAME + " v" + VERSION);
        
        var fetchSuccess = patchFetch();
        
        if (fetchSuccess) {
          isActive = true;
          log.info("Plugin started successfully with " + Object.keys(MULLVAD_DNS_RECORDS).length + " DNS records");
        } else {
          throw new Error("Failed to patch network functions");
        }
        
      } catch (error) {
        log.error("Failed to start plugin: " + error);
      }
    },
    
    stop: function() {
      if (!isActive) {
        log.info("Plugin is not active!");
        return;
      }
      
      try {
        log.info("Stopping " + PLUGIN_NAME);
        
        if (originalFetch) {
          window.fetch = originalFetch;
          log.info("Fetch restored to original");
        }
        
        dnsCache = {};
        isActive = false;
        
        log.info("Plugin stopped successfully");
        
      } catch (error) {
        log.error("Error stopping plugin: " + error);
      }
    },
    
    // Utility methods
    getDNSTable: function() { 
      var copy = {};
      for (var key in MULLVAD_DNS_RECORDS) {
        copy[key] = MULLVAD_DNS_RECORDS[key];
      }
      return copy;
    },
    getCacheStats: function() {
      var keys = Object.keys(dnsCache);
      return {
        cacheSize: keys.length,
        cachedHostnames: keys
      };
    }
  };
  
  // Auto-start the plugin
  setTimeout(function() {
    MullvadDNSCord.start();
  }, 2000);
  
  // Expose API globally
  // @ts-ignore
  window.MullvadDNSCord = MullvadDNSCord;
  
  log.info(PLUGIN_NAME + " v" + VERSION + " loaded and ready");
  
})();
