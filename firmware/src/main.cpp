// ArduinoJson must be included before Watchy.h because Arduino_JSON
// (bundled with Watchy) defines `#define typeof typeof_` which breaks
// ArduinoJson's pgmspace macros.
#include <ArduinoJson.h>
#include <Watchy.h>
#include <SPIFFS.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "config.h"
#include "fonts.h"

// ---- RTC_DATA_ATTR state (persists across deep sleep) ----
RTC_DATA_ATTR int  cfFaceIndex   = 0;
RTC_DATA_ATTR int  cfFaceCount   = 0;
RTC_DATA_ATTR int  cfLastSync    = 0;
RTC_DATA_ATTR int  cfSyncInterval = 600; // seconds between server syncs
RTC_DATA_ATTR bool cfNeedsSync   = true;  // sync on first boot
RTC_DATA_ATTR int  cfLastBackPress = 0;   // for double-press detection

// ---- Alert system ----
struct CfAlert {
    int     eventTime;   // absolute RTC timestamp when this alert fires
    uint8_t buzzCount;   // 0 = insistent (buzz loop until dismissed), N = vibMotor N pulses
    bool    fired;
    bool    preAlert;    // true = "In 5 min" warning, false = "Now" at event time
    char    text[60];
};
RTC_DATA_ATTR CfAlert cfAlerts[20];       // doubled from 10 (two per event)
RTC_DATA_ATTR int     cfAlertCount     = 0;
RTC_DATA_ATTR bool    cfNotifActive    = false;
RTC_DATA_ATTR bool    cfNotifInsistent = false;
RTC_DATA_ATTR bool    cfNotifPreAlert  = false;
RTC_DATA_ATTR char    cfNotifText[60]  = "";

class CrispFace : public Watchy {
public:
    String cfDebugWifi; // WiFi debug log, populated by cfConnectWiFi()

    CrispFace(const watchySettings &s) : Watchy(s) {}

    void drawWatchFace() {
        // Mount SPIFFS every wake — it's unmounted after deep sleep
        if (!SPIFFS.begin(true)) {
            display.fillScreen(GxEPD_WHITE);
            display.setTextColor(GxEPD_BLACK);
            display.setFont(NULL);
            display.setCursor(10, 100);
            display.print("SPIFFS failed");
            return;
        }

        // If RTC time looks unset, seed it from build epoch
        #if CRISPFACE_BUILD_EPOCH > 0
        RTC.read(currentTime);
        if (currentTime.Year + 1970 < 2026) {
            time_t epoch = CRISPFACE_BUILD_EPOCH + (CRISPFACE_GMT_OFFSET * 3600);
            struct tm *bt = localtime(&epoch);
            tmElements_t tm;
            tm.Year   = bt->tm_year + 1900 - 1970;
            tm.Month  = bt->tm_mon + 1;
            tm.Day    = bt->tm_mday;
            tm.Hour   = bt->tm_hour;
            tm.Minute = bt->tm_min;
            tm.Second = bt->tm_sec;
            tm.Wday   = bt->tm_wday + 1;
            RTC.set(tm);
            RTC.read(currentTime);
        }
        #endif

        // If RTC was lost (e.g. hard crash), check SPIFFS for cached faces
        if (cfFaceCount == 0) {
            for (int i = 0; i < 20; i++) {
                char path[24];
                snprintf(path, sizeof(path), "/face_%d.json", i);
                if (SPIFFS.exists(path)) {
                    cfFaceCount = i + 1;
                } else {
                    break;
                }
            }
            if (cfFaceCount > 0) cfNeedsSync = false;
        }

        // If insistent notification is active, show it and buzz
        if (cfNotifActive && cfNotifInsistent) {
            renderNotification();
            insistentBuzzLoop();
            return;
        }

        int now = makeTime(currentTime);

        // Check if sync needed
        if (cfNeedsSync || (cfLastSync > 0 && (now - cfLastSync) > cfSyncInterval)
            || cfFaceCount == 0) {
            syncFromServer();
            cfNeedsSync = false;
            // Re-read time after sync (NTP may have adjusted clock)
            RTC.read(currentTime);
            now = makeTime(currentTime);
        }

        // Check alerts (90s window — watch wakes every 60s, buffer without overlap)
        for (int i = 0; i < cfAlertCount; i++) {
            if (cfAlerts[i].fired) continue;
            int diff = cfAlerts[i].eventTime - now;
            if (diff >= 0 && diff <= 90) {
                cfAlerts[i].fired = true;
                if (cfAlerts[i].buzzCount == 0) {
                    // Insistent: show notification + buzz loop
                    cfNotifActive = true;
                    cfNotifInsistent = true;
                    cfNotifPreAlert = cfAlerts[i].preAlert;
                    strncpy(cfNotifText, cfAlerts[i].text, 59);
                    cfNotifText[59] = '\0';
                    renderNotification();
                    insistentBuzzLoop();
                    return;
                } else {
                    // Regular: buzz N times (1 for pre-alert, 3 for event)
                    vibMotor(75, cfAlerts[i].buzzCount * 2);
                }
            }
        }

        // Render current face from SPIFFS
        if (cfFaceCount > 0) {
            if (cfFaceIndex >= cfFaceCount) cfFaceIndex = 0;
            if (cfFaceIndex < 0) cfFaceIndex = cfFaceCount - 1;

            char path[32];
            snprintf(path, sizeof(path), "/face_%d.json", cfFaceIndex);
            renderFace(path);
        } else {
            renderFallback();
        }
    }

    void handleButtonPress() {
        uint64_t wakeupBit = esp_sleep_get_ext1_wakeup_status();

        // When in a menu/app, let the stock Watchy code handle everything
        if (guiState != WATCHFACE_STATE) {
            Watchy::handleButtonPress();
            return;
        }

        // If notification active, any button dismisses
        if (cfNotifActive) {
            cfNotifActive = false;
            cfNotifInsistent = false;
            cfNotifPreAlert = false;
            cfNotifText[0] = '\0';
            RTC.read(currentTime);
            showWatchFace(true);
            return;
        }

        // Watchface state — our custom button handling
        if (wakeupBit & MENU_BTN_MASK) {
            Watchy::handleButtonPress(); // opens stock menu
        }
        else if (wakeupBit & UP_BTN_MASK) {
            if (cfFaceCount > 1) {
                cfFaceIndex--;
                if (cfFaceIndex < 0) cfFaceIndex = cfFaceCount - 1;
            }
            RTC.read(currentTime);
            showWatchFace(true);
        }
        else if (wakeupBit & DOWN_BTN_MASK) {
            if (cfFaceCount > 1) {
                cfFaceIndex++;
                if (cfFaceIndex >= cfFaceCount) cfFaceIndex = 0;
            }
            RTC.read(currentTime);
            showWatchFace(true);
        }
        else if (wakeupBit & BACK_BTN_MASK) {
            RTC.read(currentTime);
            int now = makeTime(currentTime);
            bool doublePress = (cfLastBackPress > 0 && (now - cfLastBackPress) <= 4);
            cfLastBackPress = now;

            // Long hold detection: if still held after 1.5s → debug sync
            pinMode(BACK_BTN_PIN, INPUT);
            delay(1500);
            if (digitalRead(BACK_BTN_PIN) == LOW) {
                // Long hold — debug sync
                syncFromServer(true);
                cfNeedsSync = false;
                RTC.read(currentTime);
                // Debug screen stays visible; next normal wake redraws
                return;
            }

            cfNeedsSync = true;
            showWatchFace(!doublePress); // double-press = full refresh
        }
    }

private:

    // ---- Notification rendering ----

    void renderNotification() {
        display.setFullWindow();
        display.fillScreen(GxEPD_WHITE);
        display.setTextColor(GxEPD_BLACK);

        // Rounded rect border: 10px margin, 2px width, 8px radius
        display.drawRoundRect(10, 10, 180, 180, 8, GxEPD_BLACK);
        display.drawRoundRect(11, 11, 178, 178, 7, GxEPD_BLACK);

        int16_t tx, ty;
        uint16_t tw, th;

        // Context-aware header centered near top
        display.setFont(&FreeSans9pt7b);
        const char* header = cfNotifPreAlert ? "In 5 min" : "Now";
        display.getTextBounds(header, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 40);
        display.print(header);

        // Horizontal separator line
        display.drawLine(20, 50, 180, 50, GxEPD_BLACK);

        // Event text centered in middle area
        const GFXfont* bodyFont = &FreeSans12pt7b;
        drawAligned(cfNotifText, 20, 60, 160, 80, "center", bodyFont, GxEPD_BLACK);

        // "Press any button" hint near bottom
        display.setFont(&FreeSans9pt7b);
        const char* hint = "Press any button";
        display.getTextBounds(hint, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 170);
        display.print(hint);

        // Push to display immediately (buzz loop blocks before showWatchFace can flush)
        display.display(true);
    }

    void insistentBuzzLoop() {
        // Enable all button pins with pull-ups for reliable polling
        // (plain INPUT loses RTC pull-up config, pins may float)
        pinMode(UP_BTN_PIN, INPUT_PULLUP);
        pinMode(DOWN_BTN_PIN, INPUT_PULLUP);
        pinMode(BACK_BTN_PIN, INPUT_PULLUP);
        pinMode(MENU_BTN_PIN, INPUT_PULLUP);

        // Timeout after 2 minutes to prevent stuck watch
        int cycles = 0;
        const int maxCycles = 24; // 24 × 5s = 2 minutes

        while (cycles < maxCycles) {
            vibMotor(75, 4);
            cycles++;

            // Wait 5 seconds, polling all buttons every 100ms
            for (int i = 0; i < 50; i++) {
                delay(100);
                if (digitalRead(UP_BTN_PIN) == LOW ||
                    digitalRead(DOWN_BTN_PIN) == LOW ||
                    digitalRead(BACK_BTN_PIN) == LOW ||
                    digitalRead(MENU_BTN_PIN) == LOW) {
                    cfNotifActive = false;
                    cfNotifInsistent = false;
                    cfNotifPreAlert = false;
                    cfNotifText[0] = '\0';
                    return;
                }
            }
        }

        // Timeout: auto-dismiss so the watch isn't stuck
        cfNotifActive = false;
        cfNotifInsistent = false;
        cfNotifPreAlert = false;
        cfNotifText[0] = '\0';
    }

    // ---- Server sync ----

    void syncProgress(int percent) {
        // Thin progress bar at the very bottom — partial window update only
        const int barY = 196;
        const int barH = 4;
        display.fillRect(0, barY, 200, barH, GxEPD_BLACK);
        if (percent > 0) {
            int fillW = (200 * percent) / 100;
            if (fillW > 200) fillW = 200;
            display.fillRect(0, barY, fillW, barH, GxEPD_WHITE);
        }
        display.displayWindow(0, barY, 200, barH);
    }

    bool cfConnectWiFi(bool debug = false) {
        // Known networks from config (injected at build time)
        const char* knownSSIDs[] = {
#if CRISPFACE_WIFI_COUNT >= 1
            CRISPFACE_WIFI_SSID_0,
#endif
#if CRISPFACE_WIFI_COUNT >= 2
            CRISPFACE_WIFI_SSID_1,
#endif
#if CRISPFACE_WIFI_COUNT >= 3
            CRISPFACE_WIFI_SSID_2,
#endif
#if CRISPFACE_WIFI_COUNT >= 4
            CRISPFACE_WIFI_SSID_3,
#endif
#if CRISPFACE_WIFI_COUNT >= 5
            CRISPFACE_WIFI_SSID_4,
#endif
        };
        const char* knownPasses[] = {
#if CRISPFACE_WIFI_COUNT >= 1
            CRISPFACE_WIFI_PASS_0,
#endif
#if CRISPFACE_WIFI_COUNT >= 2
            CRISPFACE_WIFI_PASS_1,
#endif
#if CRISPFACE_WIFI_COUNT >= 3
            CRISPFACE_WIFI_PASS_2,
#endif
#if CRISPFACE_WIFI_COUNT >= 4
            CRISPFACE_WIFI_PASS_3,
#endif
#if CRISPFACE_WIFI_COUNT >= 5
            CRISPFACE_WIFI_PASS_4,
#endif
        };
        const int netCount = CRISPFACE_WIFI_COUNT;
        cfDebugWifi = "";

        if (debug) {
            cfDebugWifi += "WiFi: ";
            cfDebugWifi += String(netCount);
            cfDebugWifi += " known\n";
        }

        WiFi.disconnect(true);
        delay(100);
        WiFi.mode(WIFI_STA);

        if (netCount == 0) {
            if (debug) cfDebugWifi += "No networks!\n";
            WiFi.mode(WIFI_OFF);
            return false;
        }

        if (netCount == 1) {
            // Single network — connect directly without scanning
            if (debug) {
                cfDebugWifi += "Try: ";
                cfDebugWifi += knownSSIDs[0];
                cfDebugWifi += "\n";
            }
            WiFi.begin(knownSSIDs[0], knownPasses[0]);
            int attempts = 0;
            while (WiFi.status() != WL_CONNECTED && attempts < 40) {
                delay(500);
                attempts++;
            }
            if (WiFi.status() == WL_CONNECTED) {
                if (debug) cfDebugWifi += "Connected OK\n";
                return true;
            }
            if (debug) {
                cfDebugWifi += "FAIL after ";
                cfDebugWifi += String(attempts);
                cfDebugWifi += " tries\n";
            }
            WiFi.disconnect(true);
            WiFi.mode(WIFI_OFF);
            return false;
        }

        // Multiple networks — scan and connect to strongest known one
        int found = WiFi.scanNetworks();
        if (debug) {
            cfDebugWifi += "Scan: ";
            cfDebugWifi += String(found);
            cfDebugWifi += " found\n";
        }
        if (found <= 0) {
            WiFi.scanDelete();
            WiFi.disconnect(true);
            WiFi.mode(WIFI_OFF);
            return false;
        }

        // WiFi.scanNetworks() returns results sorted by RSSI (strongest first).
        // Iterate scan results and try connecting to first known match.
        for (int i = 0; i < found; i++) {
            String scannedSSID = WiFi.SSID(i);
            if (debug && i < 5) {
                cfDebugWifi += " ";
                cfDebugWifi += scannedSSID;
                cfDebugWifi += " (";
                cfDebugWifi += String(WiFi.RSSI(i));
                cfDebugWifi += ")\n";
            }
            for (int k = 0; k < netCount; k++) {
                if (scannedSSID == knownSSIDs[k]) {
                    if (debug) {
                        cfDebugWifi += "Try: ";
                        cfDebugWifi += knownSSIDs[k];
                        cfDebugWifi += "\n";
                    }
                    WiFi.begin(knownSSIDs[k], knownPasses[k]);
                    int attempts = 0;
                    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
                        delay(500);
                        attempts++;
                    }
                    if (WiFi.status() == WL_CONNECTED) {
                        if (debug) cfDebugWifi += "Connected OK\n";
                        WiFi.scanDelete();
                        return true;
                    }
                    if (debug) {
                        cfDebugWifi += "FAIL after ";
                        cfDebugWifi += String(attempts);
                        cfDebugWifi += " tries\n";
                    }
                    // Connection failed — try next scanned network
                    WiFi.disconnect(true);
                    delay(100);
                    break;
                }
            }
        }

        WiFi.scanDelete();
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
        return false;
    }

    // Sync RTC from NTP (call while WiFi is connected)
    void cfSyncNTP() {
        struct tm timeinfo;
        if (getLocalTime(&timeinfo, 5000)) {
            tmElements_t tm;
            tm.Year   = timeinfo.tm_year + 1900 - 1970;
            tm.Month  = timeinfo.tm_mon + 1;
            tm.Day    = timeinfo.tm_mday;
            tm.Hour   = timeinfo.tm_hour;
            tm.Minute = timeinfo.tm_min;
            tm.Second = timeinfo.tm_sec;
            tm.Wday   = timeinfo.tm_wday + 1; // tm_wday 0=Sun → Wday 1=Sun
            RTC.set(tm);
            RTC.read(currentTime);
        }
    }

    void syncFromServer(bool debug = false) {
        String dbg; // debug log, displayed when debug=true
        syncProgress(5);

        if (!cfConnectWiFi(debug)) {
            if (debug) {
                dbg += cfDebugWifi;
                dbg += "RESULT: WiFi FAILED\n";
                renderDebug(dbg);
            }
            syncProgress(0);
            return;
        }

        if (debug) {
            dbg += cfDebugWifi;
            dbg += "IP: ";
            dbg += WiFi.localIP().toString();
            dbg += "\nRSSI: ";
            dbg += String(WiFi.RSSI());
            dbg += "dBm\n";
        }

        // Start NTP in background (non-blocking) — runs while HTTP proceeds
        configTime(CRISPFACE_GMT_OFFSET * 3600, 0, "pool.ntp.org");

        syncProgress(20);

        WiFiClientSecure client;
        client.setInsecure();

        HTTPClient http;
        char url[128];
        snprintf(url, sizeof(url), "%s%s?watch_id=%s",
                 CRISPFACE_SERVER, CRISPFACE_API_PATH, CRISPFACE_WATCH_ID);

        if (debug) {
            dbg += "URL: ";
            dbg += url;
            dbg += "\n";
        }

        http.begin(client, url);
        char authHeader[80];
        snprintf(authHeader, sizeof(authHeader), "Bearer %s", CRISPFACE_API_TOKEN);
        http.addHeader("Authorization", authHeader);
        http.setUserAgent("CrispFace/" CRISPFACE_VERSION);
        http.setTimeout(CRISPFACE_HTTP_TIMEOUT);
        http.setConnectTimeout(CRISPFACE_HTTP_TIMEOUT);
        http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

        int httpCode = http.GET();
        if (httpCode != 200) {
            http.end();
            cfSyncNTP();
            WiFi.disconnect(true);
            WiFi.mode(WIFI_OFF);
            if (debug) {
                dbg += "HTTP: ";
                dbg += String(httpCode);
                dbg += " FAILED\n";
                renderDebug(dbg);
            }
            syncProgress(0);
            return;
        }

        syncProgress(40);

        // Get payload, sync time, then kill WiFi
        String payload = http.getString();
        http.end();
        cfSyncNTP();
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);

        syncProgress(50);

        {
            DynamicJsonDocument doc(16384);
            DeserializationError err = deserializeJson(doc, payload);
            int payloadLen = payload.length();
            payload = "";

            if (err || !doc["success"].as<bool>()) {
                if (debug) {
                    dbg += "HTTP: 200 OK\n";
                    dbg += "Body: ";
                    dbg += String(payloadLen);
                    dbg += " bytes\n";
                    if (err) {
                        dbg += "JSON: ";
                        dbg += err.c_str();
                        dbg += "\n";
                    } else {
                        dbg += "API: success=false\n";
                    }
                    renderDebug(dbg);
                }
                syncProgress(0);
                return;
            }

            JsonArray faces = doc["faces"].as<JsonArray>();
            int total = faces.size();
            if (total == 0) {
                if (debug) {
                    dbg += "HTTP: 200 OK\n";
                    dbg += "Faces: 0 (empty)\n";
                    renderDebug(dbg);
                }
                syncProgress(0);
                return;
            }

            syncProgress(60);

            // Delete old face files
            for (int i = 0; i < 10; i++) {
                char path[24];
                snprintf(path, sizeof(path), "/face_%d.json", i);
                SPIFFS.remove(path);
            }

            int count = 0;
            int maxServerStale = 0;
            bool anyServerComp = false;

            for (JsonObject face : faces) {
                char path[24];
                snprintf(path, sizeof(path), "/face_%d.json", count);

                File out = SPIFFS.open(path, FILE_WRITE);
                if (out) {
                    serializeJson(face, out);
                    out.close();
                }

                // Check face-level stale — if -1, skip complication stale checks
                int faceStale = face["stale"] | 60;
                if (faceStale > 0) {
                    for (JsonObject comp : face["complications"].as<JsonArray>()) {
                        if (!(comp["local"] | false)) {
                            int s = comp["stale"] | 600;
                            if (s > 0) {
                                anyServerComp = true;
                                if (s > maxServerStale) maxServerStale = s;
                            }
                        }
                    }
                }

                count++;
                syncProgress(60 + (30 * count / total));
            }

            cfFaceCount    = count;
            // If no server complications need refreshing, sync once a day
            // (user can always manual-sync via top-left button)
            cfSyncInterval = anyServerComp ? (maxServerStale > 300 ? maxServerStale : 300) : 86400;
            cfLastSync     = (int)makeTime(currentTime);

            // Collect alerts from all faces — two per event (pre-alert + event-time)
            cfAlertCount = 0;
            int syncTime = cfLastSync;
            for (JsonObject face : faces) {
                for (JsonObject comp : face["complications"].as<JsonArray>()) {
                    JsonArray alerts = comp["alerts"].as<JsonArray>();
                    if (alerts.isNull()) continue;
                    for (JsonObject alert : alerts) {
                        int minFromNow = alert["min"] | 0;
                        if (minFromNow <= 0) continue;

                        int evTime = syncTime + (minFromNow * 60);
                        bool ins = alert["ins"] | false;
                        const char* txt = alert["text"] | "Event";

                        // 1. Pre-alert (5 min before event)
                        if (cfAlertCount < 20) {
                            cfAlerts[cfAlertCount].eventTime = evTime - 300;
                            cfAlerts[cfAlertCount].buzzCount = ins ? 0 : 1;
                            cfAlerts[cfAlertCount].fired = false;
                            cfAlerts[cfAlertCount].preAlert = true;
                            strncpy(cfAlerts[cfAlertCount].text, txt, 59);
                            cfAlerts[cfAlertCount].text[59] = '\0';
                            cfAlertCount++;
                        }

                        // 2. Event-time alert
                        if (cfAlertCount < 20) {
                            cfAlerts[cfAlertCount].eventTime = evTime;
                            cfAlerts[cfAlertCount].buzzCount = ins ? 0 : 3;
                            cfAlerts[cfAlertCount].fired = false;
                            cfAlerts[cfAlertCount].preAlert = false;
                            strncpy(cfAlerts[cfAlertCount].text, txt, 59);
                            cfAlerts[cfAlertCount].text[59] = '\0';
                            cfAlertCount++;
                        }

                        if (cfAlertCount >= 20) break;
                    }
                    if (cfAlertCount >= 20) break;
                }
                if (cfAlertCount >= 20) break;
            }
        }

        if (debug) {
            dbg += "HTTP: 200 OK\n";
            dbg += "Faces: ";
            dbg += String(cfFaceCount);
            dbg += "\nInterval: ";
            dbg += String(cfSyncInterval);
            dbg += "s\n";
            renderDebug(dbg);
        }

        syncProgress(100);
    }

    // ---- Debug display ----

    void renderDebug(String &info) {
        display.setFullWindow();
        display.fillScreen(GxEPD_WHITE);
        display.setTextColor(GxEPD_BLACK);
        display.setFont(NULL); // built-in 6x8 font
        display.setCursor(0, 0);

        // Print line by line (built-in font is 8px tall)
        int y = 4;
        int idx = 0;
        while (idx < (int)info.length() && y < 196) {
            int nl = info.indexOf('\n', idx);
            String line = (nl < 0) ? info.substring(idx) : info.substring(idx, nl);
            idx = (nl < 0) ? info.length() : nl + 1;

            // Truncate long lines to fit 200px (33 chars at 6px)
            if (line.length() > 33) line = line.substring(0, 33);

            display.setCursor(2, y);
            display.print(line);
            y += 10;
        }

        // Show version at bottom
        display.setCursor(2, 190);
        display.print("CrispFace v" CRISPFACE_VERSION " DBG");

        display.display(true); // partial refresh
    }

    // ---- Render face from SPIFFS ----

    void renderFace(const char* path) {
        display.setFullWindow();
        File f = SPIFFS.open(path, FILE_READ);
        if (!f) { renderFallback(); return; }

        DynamicJsonDocument doc(8192);
        DeserializationError err = deserializeJson(doc, f);
        f.close();
        if (err) { renderFallback(); return; }

        // Background
        const char* bg = doc["bg"] | "white";
        display.fillScreen(strcmp(bg, "black") == 0 ? GxEPD_BLACK : GxEPD_WHITE);

        int now = makeTime(currentTime);

        // Render each complication
        for (JsonObject comp : doc["complications"].as<JsonArray>()) {
            renderComplication(comp, now);
        }
    }

    // ---- Render single complication ----

    void renderComplication(JsonObject comp, int now) {
        int x           = comp["x"] | 0;
        int y           = comp["y"] | 0;
        int w           = comp["w"] | 0;
        int h           = comp["h"] | 0;
        int stale       = comp["stale"] | 60;
        const char* val = comp["value"] | "";
        const char* ff  = comp["font"] | "sans";
        int sz          = comp["size"] | 16;
        bool bold       = comp["bold"] | false;
        const char* al  = comp["align"] | "left";
        const char* col = comp["color"] | "black";
        bool isLocal    = comp["local"] | false;
        const char* typ = comp["type"] | "";
        const char* cid = comp["id"] | "";
        int bw          = comp["bw"] | 0;
        int br          = comp["br"] | 0;
        int bp          = comp["bp"] | 0;

        // Resolve local values — check id first (type may be empty)
        String localVal;
        if (isLocal) {
            localVal = resolveLocal(strlen(typ) > 0 ? typ : cid);
            val = localVal.c_str();
        }

        // Stale check (server complications only; stale <= 0 means never expires)
        bool isStale = !isLocal && stale > 0 && cfLastSync > 0 && (now - cfLastSync) > stale;

        const GFXfont* font = getFont(ff, sz, bold);
        const GFXfont* boldFont = bold ? nullptr : getFont(ff, sz, true);
        uint16_t color = (strcmp(col, "white") == 0) ? GxEPD_WHITE : GxEPD_BLACK;

        // Draw border if configured
        if (bw > 0) {
            drawBorder(x, y, w, h, bw, br, color);
        }

        // Inset text area by border width + padding (only when border exists)
        int inset = (bw > 0) ? (bw + bp) : 0;
        int pt = comp["pt"] | 0;
        int pl = comp["pl"] | 0;
        int tx = x + inset + pl;
        int ty = y + inset + pt;
        int tw = w - inset * 2 - pl;
        int th = h - inset * 2 - pt;
        if (tw < 1) tw = 1;
        if (th < 1) th = 1;

        // Battery: check display param (icon/percentage/voltage)
        const char* effType = strlen(typ) > 0 ? typ : cid;
        String batVal; // must outlive val pointer
        if (isLocal && strcmp(effType, "battery") == 0) {
            const char* batDisplay = comp["params"]["display"] | "icon";
            if (strcmp(batDisplay, "icon") == 0) {
                drawBatteryIcon(tx, ty, tw, th, color);
                return;
            }
            batVal = resolveBattery(batDisplay);
            val = batVal.c_str();
        }

        // Weather icon: value "icon:CODE" or "icon:CODE:SIZE"
        if (strncmp(val, "icon:", 5) == 0) {
            int weatherCode = atoi(val + 5);
            // Parse optional size after second colon
            const char* sizeStr = strchr(val + 5, ':');
            int iconSize = sizeStr ? atoi(sizeStr + 1) : 0;
            if (iconSize > 0 && iconSize < tw && iconSize < th) {
                // Center icon at specified size within bounding box
                int ox = tx + (tw - iconSize) / 2;
                int oy = ty + (th - iconSize) / 2;
                drawWeatherIcon(weatherCode, ox, oy, iconSize, iconSize, color);
            } else {
                drawWeatherIcon(weatherCode, tx, ty, tw, th, color);
            }
            return;
        }

        if (isStale) {
            drawItalic(val, tx, ty, tw, th, al, font, color);
        } else {
            drawAligned(val, tx, ty, tw, th, al, font, color, boldFont);
        }
    }

    // ---- Draw border (rect or rounded rect) ----

    void drawBorder(int x, int y, int w, int h, int bw, int br, uint16_t color) {
        if (br <= 0) {
            // Simple rectangle border
            for (int i = 0; i < bw; i++) {
                display.drawRect(x + i, y + i, w - 2 * i, h - 2 * i, color);
            }
        } else {
            // Rounded rectangle border
            int r = br;
            if (r > w / 2) r = w / 2;
            if (r > h / 2) r = h / 2;
            for (int i = 0; i < bw; i++) {
                display.drawRoundRect(x + i, y + i, w - 2 * i, h - 2 * i, r, color);
                if (r > 1) r--;
            }
        }
    }

    // ---- Battery icon ----

    void drawBatteryIcon(int x, int y, int w, int h, uint16_t color) {
        float v = getBatteryVoltage();
        int pct = (int)((v - 3.3f) / (4.2f - 3.3f) * 100.0f);
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;

        // Body dimensions (leave room for nub on right)
        int nubW = 2;
        int gap = 1;
        int bodyW = w - nubW - gap;
        if (bodyW < 6) bodyW = 6;

        // Body outline
        display.drawRect(x, y, bodyW, h, color);

        // Nub (centered vertically on right side)
        int nubH = h * 2 / 5;
        if (nubH < 2) nubH = 2;
        int nubY = y + (h - nubH) / 2;
        display.fillRect(x + bodyW + gap, nubY, nubW, nubH, color);

        // Fill proportional to charge (2px inset from body edge)
        int pad = 2;
        int maxFillW = bodyW - pad * 2;
        int fillW = (maxFillW * pct) / 100;
        if (fillW > 0) {
            display.fillRect(x + pad, y + pad, fillW, h - pad * 2, color);
        }
    }

    // ---- Battery text (percentage or voltage) ----

    String resolveBattery(const char* mode) {
        float v = getBatteryVoltage();
        char buf[8];
        if (strcmp(mode, "percentage") == 0) {
            int pct = (int)((v - 3.3f) / (4.2f - 3.3f) * 100.0f);
            if (pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            snprintf(buf, sizeof(buf), "%d%%", pct);
        } else {
            snprintf(buf, sizeof(buf), "%.1fV", v);
        }
        return String(buf);
    }

    // ---- Weather icons ----

    void drawCloudShape(int cx, int cy, int s, uint16_t color) {
        // Cloud from overlapping circles + flat base
        int r1 = s * 3 / 10;  // main bump
        int r2 = s / 4;       // side bumps
        int baseH = s / 5;
        int baseW = s * 3 / 4;
        int baseY = cy + r2 / 2;
        // Flat base
        display.fillRect(cx - baseW / 2, baseY, baseW, baseH, color);
        // Left bump
        display.fillCircle(cx - baseW / 4, baseY, r2, color);
        // Center bump (taller)
        display.fillCircle(cx, baseY - r1 / 3, r1, color);
        // Right bump
        display.fillCircle(cx + baseW / 4, baseY, r2 - 1, color);
    }

    void drawSunIcon(int cx, int cy, int s, uint16_t color) {
        int r = s / 5;
        display.fillCircle(cx, cy, r, color);
        // 8 rays using integer offsets (x10 scale: 10,0 / 7,7 / 0,10 / etc.)
        const int dx[] = {10, 7, 0, -7, -10, -7, 0, 7};
        const int dy[] = {0, -7, -10, -7, 0, 7, 10, 7};
        int inner = r + 2;
        int outer = r * 2;
        for (int i = 0; i < 8; i++) {
            int x1 = cx + dx[i] * inner / 10;
            int y1 = cy + dy[i] * inner / 10;
            int x2 = cx + dx[i] * outer / 10;
            int y2 = cy + dy[i] * outer / 10;
            display.drawLine(x1, y1, x2, y2, color);
        }
    }

    void drawPartCloudIcon(int cx, int cy, int s, uint16_t color) {
        // Small sun upper-right
        drawSunIcon(cx + s / 5, cy - s / 5, s * 2 / 3, color);
        // Cloud lower-left, overlapping
        drawCloudShape(cx - s / 8, cy + s / 8, s * 3 / 4, color);
    }

    void drawFogIcon(int x, int y, int w, int h, uint16_t color) {
        // Horizontal lines at different heights
        int lineH = h / 6;
        int pad = w / 8;
        for (int i = 1; i <= 4; i++) {
            int ly = y + i * h / 5;
            int lx = x + pad + (i % 2 == 0 ? pad / 2 : 0);
            int lw = w - pad * 2 - (i % 2 == 0 ? pad / 2 : 0);
            display.drawLine(lx, ly, lx + lw, ly, color);
            if (lineH > 1) {
                display.drawLine(lx, ly + 1, lx + lw, ly + 1, color);
            }
        }
    }

    void drawRainDrops(int cx, int cy, int s, int count, uint16_t color) {
        int dropH = s / 6;
        int spacing = s / (count + 1);
        int startX = cx - (count - 1) * spacing / 2;
        for (int i = 0; i < count; i++) {
            int dx = startX + i * spacing;
            // Slight angle on drops
            display.drawLine(dx, cy, dx - 1, cy + dropH, color);
            display.drawLine(dx + 1, cy, dx, cy + dropH, color);
        }
    }

    void drawSnowDots(int cx, int cy, int s, uint16_t color) {
        int spacing = s / 4;
        int startX = cx - spacing;
        // Two rows of dots
        for (int row = 0; row < 2; row++) {
            int dy = cy + row * spacing;
            int offset = row * spacing / 2;
            for (int i = 0; i < 3 - row; i++) {
                int dx = startX + offset + i * spacing;
                display.fillCircle(dx, dy, 1, color);
            }
        }
    }

    void drawLightningBolt(int cx, int cy, int s, uint16_t color) {
        int bh = s * 2 / 5;
        int bw = s / 6;
        // Zigzag: top-right → center-left → center-right → bottom-left
        display.drawLine(cx + bw, cy, cx - bw / 2, cy + bh / 2, color);
        display.drawLine(cx - bw / 2, cy + bh / 2, cx + bw / 2, cy + bh / 2, color);
        display.drawLine(cx + bw / 2, cy + bh / 2, cx - bw, cy + bh, color);
        // Thicken
        display.drawLine(cx + bw + 1, cy, cx - bw / 2 + 1, cy + bh / 2, color);
        display.drawLine(cx + bw / 2 + 1, cy + bh / 2, cx - bw + 1, cy + bh, color);
    }

    void drawWeatherIcon(int code, int x, int y, int w, int h, uint16_t color) {
        int cx = x + w / 2;
        int cy = y + h / 2;
        int s = (w < h) ? w : h;

        if (code <= 1) {
            // Clear / Sunny
            drawSunIcon(cx, cy, s, color);
        } else if (code <= 3) {
            // Partly cloudy
            drawPartCloudIcon(cx, cy, s, color);
        } else if (code <= 6) {
            // Mist / Fog
            drawFogIcon(x, y, w, h, color);
        } else if (code <= 8) {
            // Cloudy / Overcast
            drawCloudShape(cx, cy - s / 8, s, color);
        } else if (code <= 12) {
            // Light rain / showers / drizzle
            drawCloudShape(cx, cy - s / 4, s, color);
            drawRainDrops(cx, cy + s / 5, s, 3, color);
        } else if (code <= 15) {
            // Heavy rain / heavy showers
            drawCloudShape(cx, cy - s / 4, s, color);
            drawRainDrops(cx, cy + s / 5, s, 5, color);
        } else if (code <= 27) {
            // Sleet, hail, snow
            drawCloudShape(cx, cy - s / 4, s, color);
            drawSnowDots(cx, cy + s / 5, s, color);
        } else if (code <= 30) {
            // Thunder
            drawCloudShape(cx, cy - s / 4, s, color);
            drawLightningBolt(cx, cy + s / 6, s, color);
        } else {
            // Unknown — just draw a cloud
            drawCloudShape(cx, cy - s / 8, s, color);
        }
    }

    // ---- Local complication values ----

    String resolveLocal(const char* type) {
        if (strcmp(type, "time") == 0) {
            char buf[6];
            snprintf(buf, sizeof(buf), "%02d:%02d",
                     currentTime.Hour, currentTime.Minute);
            return String(buf);
        }
        if (strcmp(type, "version") == 0) {
            return String("v" CRISPFACE_VERSION);
        }
        if (strcmp(type, "date") == 0) {
            static const char* days[] =
                {"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
            static const char* mons[] =
                {"Jan","Feb","Mar","Apr","May","Jun",
                 "Jul","Aug","Sep","Oct","Nov","Dec"};
            int dow = currentTime.Wday - 1; // Wday is 1-7 (Sun=1), array is 0-6
            int mon = currentTime.Month - 1;
            if (dow < 0 || dow > 6) dow = 0;
            if (mon < 0 || mon > 11) mon = 0;
            char buf[16];
            snprintf(buf, sizeof(buf), "%s %d %s",
                     days[dow], currentTime.Day, mons[mon]);
            return String(buf);
        }
        return String(type);
    }

    // ---- Draw multi-line aligned text ----

    void drawAligned(const char* text, int bx, int by, int bw, int bh,
                     const char* align, const GFXfont* font, uint16_t color,
                     const GFXfont* boldFont = nullptr) {
        display.setFont(font);

        int16_t tx, ty;
        uint16_t tw, th;
        display.getTextBounds("Ay", 0, 0, &tx, &ty, &tw, &th);
        int ascent = -(int)ty;  // distance from baseline to top of tallest char
        int lineH = (int)th + 2;

        String str(text);
        int curY = by + ascent; // baseline so text top aligns with top of area
        int idx = 0;
        bool firstLine = true;

        while (idx <= (int)str.length() && (firstLine || (curY - by) <= bh)) {
            int nl = str.indexOf('\n', idx);
            String line = (nl < 0) ? str.substring(idx)
                                   : str.substring(idx, nl);
            idx = (nl < 0) ? str.length() + 1 : nl + 1;

            // Check for bold marker byte (\x03 = render this line in bold)
            bool useBold = false;
            const char* linePtr = line.c_str();
            if ((uint8_t)linePtr[0] == 0x03) { useBold = true; linePtr++; }

            // Check for circle marker bytes (all-day event indicators)
            bool drawFilledCircle = false;
            bool drawOpenCircle = false;
            if ((uint8_t)linePtr[0] == 0x01) { drawFilledCircle = true; linePtr++; }
            else if ((uint8_t)linePtr[0] == 0x02) { drawOpenCircle = true; linePtr++; }
            if ((drawFilledCircle || drawOpenCircle) && linePtr[0] == ' ') linePtr++;

            // Select font for this line (bold variant if marked and available)
            const GFXfont* lineFont = (useBold && boldFont) ? boldFont : font;
            display.setFont(lineFont);

            // Use linePtr (markers stripped) for measurement
            display.getTextBounds(linePtr, 0, 0, &tx, &ty, &tw, &th);

            // Account for circle width in alignment
            int circleW = 0;
            if (drawFilledCircle || drawOpenCircle) {
                int cr = ascent / 4;
                circleW = cr * 2 + 3;
            }

            int curX;
            if (strcmp(align, "center") == 0)
                curX = bx + (bw - (int)tw - circleW) / 2;
            else if (strcmp(align, "right") == 0)
                curX = bx + bw - (int)tw - circleW;
            else
                curX = bx;

            // Draw circle marker if present
            int penX = curX;
            if (drawFilledCircle || drawOpenCircle) {
                int cr = ascent / 4;
                int cy = curY - ascent / 2;
                int cx = curX + cr;
                if (drawFilledCircle) display.fillCircle(cx, cy, cr, color);
                else display.drawCircle(cx, cy, cr, color);
                penX = curX + cr * 2 + 3;
            }

            // Render glyph-by-glyph with pixel clipping to bounds
            int lineLen = (int)strlen(linePtr);
            for (int i = 0; i < lineLen; i++) {
                uint8_t c = (uint8_t)linePtr[i];
                if (c < lineFont->first || c > lineFont->last) continue;

                GFXglyph *gl = &lineFont->glyph[c - lineFont->first];
                uint8_t  *bm = lineFont->bitmap;
                uint16_t  bo = gl->bitmapOffset;
                uint8_t   gw = gl->width;
                uint8_t   gh = gl->height;
                int8_t    xo = gl->xOffset;
                int8_t    yo = gl->yOffset;

                uint8_t bit = 0, bits = 0;
                for (int row = 0; row < gh; row++) {
                    for (int col = 0; col < gw; col++) {
                        if (!(bit++ & 7))
                            bits = pgm_read_byte(&bm[bo++]);
                        if (bits & 0x80) {
                            int px = penX + xo + col;
                            int py = curY + yo + row;
                            if (px >= bx && px < bx + bw &&
                                py >= by && py < by + bh)
                                display.drawPixel(px, py, color);
                        }
                        bits <<= 1;
                    }
                }
                penX += gl->xAdvance;
            }
            // Restore base font for next line's metrics consistency
            display.setFont(font);
            firstLine = false;
            curY += lineH;
        }
    }

    // ---- Fake italic via per-row pixel skew ----

    void drawItalic(const char* text, int bx, int by, int bw, int bh,
                    const char* align, const GFXfont* font, uint16_t color) {
        display.setFont(font);

        int16_t tx, ty;
        uint16_t tw, th;
        display.getTextBounds("Ay", 0, 0, &tx, &ty, &tw, &th);
        int ascent = -(int)ty;
        int lineH = (int)th + 2;
        int skew = lineH / 5;
        if (skew < 1) skew = 1;

        String str(text);
        int curY = by + ascent;
        int idx = 0;
        bool firstLine = true;

        while (idx <= (int)str.length() && (firstLine || (curY - by) <= bh)) {
            int nl = str.indexOf('\n', idx);
            String line = (nl < 0) ? str.substring(idx)
                                   : str.substring(idx, nl);
            idx = (nl < 0) ? str.length() + 1 : nl + 1;

            // Check for circle marker bytes (all-day event indicators)
            bool drawFilledCircle = false;
            bool drawOpenCircle = false;
            const char* linePtr = line.c_str();
            if ((uint8_t)linePtr[0] == 0x01) { drawFilledCircle = true; linePtr++; }
            else if ((uint8_t)linePtr[0] == 0x02) { drawOpenCircle = true; linePtr++; }
            if ((drawFilledCircle || drawOpenCircle) && linePtr[0] == ' ') linePtr++;

            const char* measStr = (drawFilledCircle || drawOpenCircle) ? linePtr : line.c_str();
            display.getTextBounds(measStr, 0, 0, &tx, &ty, &tw, &th);

            int circleW = 0;
            if (drawFilledCircle || drawOpenCircle) {
                int cr = ascent / 4;
                circleW = cr * 2 + 3;
            }

            int baseX;
            if (strcmp(align, "center") == 0)
                baseX = bx + (bw - (int)tw - circleW) / 2;
            else if (strcmp(align, "right") == 0)
                baseX = bx + bw - (int)tw - circleW;
            else
                baseX = bx;

            // Draw circle marker if present
            int penX = baseX;
            if (drawFilledCircle || drawOpenCircle) {
                int cr = ascent / 4;
                int cy = curY - ascent / 2;
                int cx = baseX + cr;
                if (drawFilledCircle) display.fillCircle(cx, cy, cr, color);
                else display.drawCircle(cx, cy, cr, color);
                penX = baseX + cr * 2 + 3;
            }

            // Render each glyph with X shear
            int lineLen = (drawFilledCircle || drawOpenCircle) ? (int)strlen(linePtr) : (int)line.length();
            const char* renderStr = (drawFilledCircle || drawOpenCircle) ? linePtr : line.c_str();
            for (int i = 0; i < lineLen; i++) {
                uint8_t c = (uint8_t)renderStr[i];
                if (c < font->first || c > font->last) continue;

                GFXglyph *gl = &font->glyph[c - font->first];
                uint8_t  *bm = font->bitmap;
                uint16_t  bo = gl->bitmapOffset;
                uint8_t   gw = gl->width;
                uint8_t   gh = gl->height;
                int8_t    xo = gl->xOffset;
                int8_t    yo = gl->yOffset;

                uint8_t bit = 0, bits = 0;
                for (int row = 0; row < gh; row++) {
                    int shear = (int)((float)(gh - row) * skew / gh);
                    for (int col = 0; col < gw; col++) {
                        if (!(bit++ & 7))
                            bits = pgm_read_byte(&bm[bo++]);
                        if (bits & 0x80) {
                            int px = penX + xo + col + shear;
                            int py = curY + yo + row;
                            if (px >= bx && px < bx + bw &&
                                py >= by && py < by + bh)
                                display.drawPixel(px, py, color);
                        }
                        bits <<= 1;
                    }
                }
                penX += gl->xAdvance;
            }
            firstLine = false;
            curY += lineH;
        }
    }

    // ---- Fallback screen ----

    void renderFallback() {
        display.setFullWindow();
        display.fillScreen(GxEPD_BLACK);
        display.setTextColor(GxEPD_WHITE);

        int16_t tx, ty;
        uint16_t tw, th;

        // Title
        display.setFont(&FreeSans9pt7b);
        const char* title = "CrispFace v" CRISPFACE_VERSION;
        display.getTextBounds(title, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 40);
        display.print(title);

        // Time
        display.setFont(&FreeSans24pt7b);
        char tbuf[6];
        snprintf(tbuf, sizeof(tbuf), "%02d:%02d",
                 currentTime.Hour, currentTime.Minute);
        display.getTextBounds(tbuf, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 110);
        display.print(tbuf);

        // Instructions
        display.setFont(&FreeSans9pt7b);
        const char* l1 = "No faces cached";
        const char* l2 = "Press top-left to sync";
        display.getTextBounds(l1, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 155);
        display.print(l1);
        display.getTextBounds(l2, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 180);
        display.print(l2);
    }
};

// ---- Entry point ----

watchySettings settings {
    .cityID = "",
    .lat = "",
    .lon = "",
    .weatherAPIKey = "",
    .weatherURL = "",
    .weatherUnit = "metric",
    .weatherLang = "en",
    .weatherUpdateInterval = 30,
    .ntpServer = "pool.ntp.org",
    .gmtOffset = 0,
    .vibrateOClock = false
};

CrispFace face(settings);

void setup() { face.init(); }
void loop() {}
