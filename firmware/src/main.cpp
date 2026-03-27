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
RTC_DATA_ATTR bool cfTimeSeeded   = false; // set after build-epoch seed or NTP sync
RTC_DATA_ATTR bool cfFirstBoot    = true;  // true until first successful sync
RTC_DATA_ATTR int  cfLastSyncTry  = 0;     // timestamp of last sync attempt (for backoff)
RTC_DATA_ATTR bool cfFaceChanging = false; // skip sync when cycling faces
RTC_DATA_ATTR int  cfSyncFails    = 0;     // consecutive sync failures (for progressive backoff)
RTC_DATA_ATTR int  cfLastWifiIdx  = -1;    // last successful WiFi network index (skip scan on reconnect)

// ---- Alert system ----
struct CfAlert {
    int     eventTime;   // absolute RTC timestamp when this alert fires
    uint8_t buzzCount;   // 0 = insistent (buzz loop until dismissed), N = vibMotor N pulses
    bool    fired;
    bool    preAlert;    // true = pre-alert warning, false = at event time
    uint8_t preMin;      // pre-alert minutes (for notification header text)
    char    text[60];
    char    time[6];     // "HH:MM" for notification header
};
RTC_DATA_ATTR CfAlert cfAlerts[20];       // doubled from 10 (two per event)
RTC_DATA_ATTR int     cfAlertCount     = 0;
RTC_DATA_ATTR bool    cfNotifActive    = false;
RTC_DATA_ATTR bool    cfNotifInsistent = false;
RTC_DATA_ATTR bool    cfNotifPreAlert  = false;
RTC_DATA_ATTR uint8_t cfNotifPreMin    = 0;
RTC_DATA_ATTR char    cfNotifText[60]  = "";
RTC_DATA_ATTR char    cfNotifTime[6]   = "";

class CrispFace : public Watchy {
public:
    String cfDebugWifi; // WiFi debug log, populated by cfConnectWiFi()
    bool cfDismissing = false; // skip sync/alerts during notification dismiss redraw

    CrispFace(const watchySettings &s) : Watchy(s) {}

    // Progressive backoff: 0→0s, 1→15min, 2→30min, 3+→1hr
    int cfBackoffSeconds() {
        if (cfSyncFails <= 0) return 0;
        if (cfSyncFails == 1) return 900;
        if (cfSyncFails == 2) return 1800;
        return 3600;
    }

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

        // Seed RTC from build timestamp after flash or hard crash.
        // ESP32-S3 has no external RTC — internal clock resets on hard reset.
        // cfTimeSeeded is false after flash/crash (RTC_DATA_ATTR resets to 0),
        // stays true across normal deep sleep cycles.
        #if CRISPFACE_BUILD_EPOCH > 0
        if (!cfTimeSeeded) {
            // Try to recover last-known time from SPIFFS (more recent than build epoch)
            time_t seedTime = CRISPFACE_BUILD_EPOCH;
            File tf = SPIFFS.open("/last_time.txt", "r");
            if (tf) {
                String ts = tf.readStringUntil('\n');
                tf.close();
                time_t saved = (time_t)ts.toInt();
                if (saved > seedTime) seedTime = saved;
            }
            struct timeval tv;
            tv.tv_sec = seedTime;
            tv.tv_usec = 0;
            settimeofday(&tv, NULL);
            configTime(CRISPFACE_GMT_OFFSET * 3600, 0, "");
            RTC.read(currentTime);
            cfTimeSeeded = true;
        }
        #endif

        // Save current time to SPIFFS periodically so crash recovery
        // uses a recent timestamp instead of the (potentially old) build epoch.
        // Only write every ~10 min to reduce flash wear.
        {
            int nowCheck = makeTime(currentTime);
            File tf = SPIFFS.open("/last_time.txt", "r");
            bool needsWrite = true;
            if (tf) {
                String ts = tf.readStringUntil('\n');
                tf.close();
                int saved = ts.toInt();
                if (saved > 0 && (nowCheck - saved) < 600) needsWrite = false;
            }
            if (needsWrite) {
                File wf = SPIFFS.open("/last_time.txt", "w");
                if (wf) { wf.println(nowCheck); wf.close(); }
            }
        }

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
            // Faces cached but cfLastSync is 0 — force a sync to fix time
        }

        // First boot / reboot: show boot screen before first sync
        if (cfFirstBoot) {
            renderBootScreen();
            syncFromServer();
            cfNeedsSync = false;
            cfFirstBoot = false;
            RTC.read(currentTime);
            // Fall through to render the first synced face
            if (cfFaceCount > 0) {
                cfFaceIndex = 0;
                char path[32];
                snprintf(path, sizeof(path), "/face_%d.json", cfFaceIndex);
                renderFace(path);
            } else {
                renderFallback();
            }
            return;
        }
        cfFirstBoot = false;

        // Insistent notification: buzz first (privacy), then show text on button press
        if (cfNotifActive && cfNotifInsistent) {
            insistentBuzzLoop();       // buzzes until button press or timeout
            // Wait for button release to prevent immediate re-wake from held button
            while (digitalRead(UP_BTN_PIN) == LOW ||
                   digitalRead(DOWN_BTN_PIN) == LOW ||
                   digitalRead(BACK_BTN_PIN) == LOW ||
                   digitalRead(MENU_BTN_PIN) == LOW) {
                delay(50);
            }
            delay(100); // debounce
            cfNotifInsistent = false;  // stop buzzing phase, keep notif active
            renderNotification();      // now reveal the notification text
            return;                    // next button press dismisses via handleButtonPress
        }

        int now = makeTime(currentTime);

        // Skip sync and alert checks when redrawing after notification dismiss or face change
        if (!cfDismissing && !cfFaceChanging) {
            // Check if sync needed — also force sync if cfLastSync is 0
            // (crash recovery: time is seeded from SPIFFS/build epoch, needs NTP).
            // Progressive backoff: 0 fails=immediate, 1=15min, 2=30min, 3+=1hr
            int backoff = cfBackoffSeconds();
            bool withinBackoff = backoff > 0 && cfLastSyncTry > 0
                && (now - cfLastSyncTry) < backoff;

            bool needsRecoverySync = cfLastSync == 0 && !withinBackoff;
            bool needsStaleSync = cfLastSync > 0
                && (now - cfLastSync) > cfSyncInterval && !withinBackoff;
            bool needsFacesSync = cfFaceCount == 0 && !withinBackoff;

            // Manual sync (cfNeedsSync) is NEVER gated by backoff
            if (cfNeedsSync || needsRecoverySync
                || needsStaleSync || needsFacesSync) {
                cfLastSyncTry = now;
                syncFromServer();
                cfNeedsSync = false;
                // Re-read time after sync (NTP may have adjusted clock)
                RTC.read(currentTime);
                now = makeTime(currentTime);
            }

            // Check alerts (60s window — watch wakes every 60s, no excess buffer needed)
            for (int i = 0; i < cfAlertCount; i++) {
                if (cfAlerts[i].fired) continue;
                int diff = cfAlerts[i].eventTime - now;
                if (diff >= 0 && diff <= 60) {
                    cfAlerts[i].fired = true;
                    // Both gentle and insistent show notification screen
                    cfNotifActive = true;
                    cfNotifPreAlert = cfAlerts[i].preAlert;
                    cfNotifPreMin = cfAlerts[i].preMin;
                    strncpy(cfNotifText, cfAlerts[i].text, 59);
                    cfNotifText[59] = '\0';
                    strncpy(cfNotifTime, cfAlerts[i].time, 5);
                    cfNotifTime[5] = '\0';

                    if (cfAlerts[i].buzzCount == 0) {
                        // Insistent: continuous pulsing buzz until button press
                        cfNotifInsistent = true;
                        insistentBuzzLoop();
                        // Wait for button release to prevent immediate re-wake
                        while (digitalRead(UP_BTN_PIN) == LOW ||
                               digitalRead(DOWN_BTN_PIN) == LOW ||
                               digitalRead(BACK_BTN_PIN) == LOW ||
                               digitalRead(MENU_BTN_PIN) == LOW) {
                            delay(50);
                        }
                        delay(100); // debounce
                    } else {
                        // Gentle: triple buzz, 3s pause, triple buzz
                        vibMotor(75, 6);
                        delay(3000);
                        vibMotor(75, 6);
                    }
                    renderNotification();
                    return;
                }
            }
        }
        cfDismissing = false;
        cfFaceChanging = false;

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
            cfNotifPreMin = 0;
            cfNotifText[0] = '\0';
            cfNotifTime[0] = '\0';
            cfDismissing = true; // skip sync/alerts in the redraw
            RTC.read(currentTime);
            showWatchFace(true);
            return;
        }

        // Watchface state — our custom button handling
        if (wakeupBit & MENU_BTN_MASK) {
            cfFaceChanging = true; // skip sync when returning from menu
            Watchy::handleButtonPress(); // opens stock menu
        }
        else if (wakeupBit & UP_BTN_MASK) {
            if (cfFaceCount > 1) {
                cfFaceIndex--;
                if (cfFaceIndex < 0) cfFaceIndex = cfFaceCount - 1;
            }
            RTC.read(currentTime);
            cfFaceChanging = true;
            showWatchFace(true);
        }
        else if (wakeupBit & DOWN_BTN_MASK) {
            if (cfFaceCount > 1) {
                cfFaceIndex++;
                if (cfFaceIndex >= cfFaceCount) cfFaceIndex = 0;
            }
            RTC.read(currentTime);
            cfFaceChanging = true;
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

    // ---- Word wrap helper ----

    // Wraps text to fit within maxW pixels using the given font.
    // Inserts '\n' at word boundaries. Existing '\n' are preserved.
    void wordWrap(const char* text, char* out, int outSize, int maxW, const GFXfont* font) {
        display.setFont(font);
        int16_t tx, ty;
        uint16_t tw, th;

        int outIdx = 0;
        int i = 0;
        int len = strlen(text);

        while (i < len && outIdx < outSize - 1) {
            // Find end of this input line (up to next \n or end)
            int lineEnd = i;
            while (lineEnd < len && text[lineEnd] != '\n') lineEnd++;

            // Word-wrap this segment
            int segStart = i;
            while (segStart < lineEnd && outIdx < outSize - 1) {
                // Find how many chars fit within maxW
                int lastSpace = -1;
                int fitEnd = segStart;

                // Measure incrementally word by word
                for (int j = segStart; j <= lineEnd; j++) {
                    if (j == lineEnd || text[j] == ' ') {
                        // Measure segStart..j
                        char tmp[64];
                        int tmpLen = j - segStart;
                        if (tmpLen >= (int)sizeof(tmp)) tmpLen = sizeof(tmp) - 1;
                        memcpy(tmp, text + segStart, tmpLen);
                        tmp[tmpLen] = '\0';
                        display.getTextBounds(tmp, 0, 0, &tx, &ty, &tw, &th);
                        if ((int)tw <= maxW) {
                            fitEnd = j;
                            if (text[j] == ' ') lastSpace = j;
                        } else {
                            break;
                        }
                    }
                }

                int copyEnd;
                int nextStart;
                if (fitEnd >= lineEnd) {
                    // Whole remaining segment fits
                    copyEnd = lineEnd;
                    nextStart = lineEnd;
                } else if (lastSpace > segStart) {
                    // Break at last space that fit
                    copyEnd = lastSpace;
                    nextStart = lastSpace + 1; // skip the space
                } else {
                    // No space found — force break at fitEnd (or at least 1 char)
                    copyEnd = fitEnd > segStart ? fitEnd : segStart + 1;
                    nextStart = copyEnd;
                }

                int copyLen = copyEnd - segStart;
                if (outIdx + copyLen >= outSize - 1) copyLen = outSize - 1 - outIdx;
                memcpy(out + outIdx, text + segStart, copyLen);
                outIdx += copyLen;

                segStart = nextStart;
                // Add newline if more text follows in this segment
                if (segStart < lineEnd && outIdx < outSize - 1) {
                    out[outIdx++] = '\n';
                }
            }

            // Preserve original \n (move past it)
            i = lineEnd;
            if (i < len && text[i] == '\n') {
                if (outIdx < outSize - 1) out[outIdx++] = '\n';
                i++;
            }
        }
        out[outIdx] = '\0';
    }

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
        char headerBuf[24];
        if (cfNotifPreAlert) {
            snprintf(headerBuf, sizeof(headerBuf), "In about %d minutes", cfNotifPreMin);
        } else if (cfNotifTime[0]) {
            snprintf(headerBuf, sizeof(headerBuf), "At %s", cfNotifTime);
        } else {
            strcpy(headerBuf, "Now");
        }
        const char* header = headerBuf;
        display.getTextBounds(header, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 40);
        display.print(header);

        // Horizontal separator line
        display.drawLine(20, 50, 180, 50, GxEPD_BLACK);

        // Event text centered in middle area (word-wrapped to fit)
        const GFXfont* bodyFont = &FreeSans12pt7b;
        char wrapped[120];
        wordWrap(cfNotifText, wrapped, sizeof(wrapped), 128, bodyFont);
        drawAligned(wrapped, 20, 60, 160, 100, "center", bodyFont, GxEPD_BLACK);

        // "Press any button" hint near bottom
        display.setFont(&FreeSans9pt7b);
        const char* hint = "Press any button";
        display.getTextBounds(hint, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 170);
        display.print(hint);
    }

    // Buzz until any button is pressed or timeout. Does NOT dismiss the
    // notification — caller shows the text after this returns.
    void insistentBuzzLoop() {
        // Enable all button pins with pull-ups for reliable polling
        pinMode(UP_BTN_PIN, INPUT_PULLUP);
        pinMode(DOWN_BTN_PIN, INPUT_PULLUP);
        pinMode(BACK_BTN_PIN, INPUT_PULLUP);
        pinMode(MENU_BTN_PIN, INPUT_PULLUP);

        int cycles = 0;
        const int maxCycles = 24; // 24 × 5s = 2 minutes

        while (cycles < maxCycles) {
            vibMotor(75, 4);
            cycles++;

            for (int i = 0; i < 50; i++) {
                delay(100);
                if (digitalRead(UP_BTN_PIN) == LOW ||
                    digitalRead(DOWN_BTN_PIN) == LOW ||
                    digitalRead(BACK_BTN_PIN) == LOW ||
                    digitalRead(MENU_BTN_PIN) == LOW) {
                    return; // button pressed — caller will show notification
                }
            }
        }
    }

    // ---- WiFi network struct (for runtime network list) ----

    struct CfWifiNet {
        char ssid[33];
        char pass[64];
    };

    // Load WiFi networks from /wifi.json on SPIFFS.
    // Returns number of networks loaded into nets[] (0 on any error).
    int cfLoadWifiFromSPIFFS(CfWifiNet* nets, int maxNets) {
        File f = SPIFFS.open("/wifi.json", FILE_READ);
        if (!f) return 0;

        StaticJsonDocument<1024> doc;
        DeserializationError err = deserializeJson(doc, f);
        f.close();
        if (err) return 0;

        JsonArray arr = doc.as<JsonArray>();
        if (arr.isNull()) return 0;

        int count = 0;
        for (JsonObject net : arr) {
            if (count >= maxNets) break;
            const char* s = net["ssid"] | "";
            const char* p = net["password"] | "";
            if (strlen(s) == 0) continue;
            strncpy(nets[count].ssid, s, 32);
            nets[count].ssid[32] = '\0';
            strncpy(nets[count].pass, p, 63);
            nets[count].pass[63] = '\0';
            count++;
        }
        return count;
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
        // Build runtime network list: try SPIFFS first, fall back to compiled-in
        CfWifiNet nets[5];
        int netCount = cfLoadWifiFromSPIFFS(nets, 5);
        bool fromSPIFFS = (netCount > 0);

        if (!fromSPIFFS) {
            // Fall back to compile-time credentials (bootstrap for first flash)
#if CRISPFACE_WIFI_COUNT >= 1
            strncpy(nets[netCount].ssid, CRISPFACE_WIFI_SSID_0, 32); nets[netCount].ssid[32] = '\0';
            strncpy(nets[netCount].pass, CRISPFACE_WIFI_PASS_0, 63); nets[netCount].pass[63] = '\0';
            netCount++;
#endif
#if CRISPFACE_WIFI_COUNT >= 2
            strncpy(nets[netCount].ssid, CRISPFACE_WIFI_SSID_1, 32); nets[netCount].ssid[32] = '\0';
            strncpy(nets[netCount].pass, CRISPFACE_WIFI_PASS_1, 63); nets[netCount].pass[63] = '\0';
            netCount++;
#endif
#if CRISPFACE_WIFI_COUNT >= 3
            strncpy(nets[netCount].ssid, CRISPFACE_WIFI_SSID_2, 32); nets[netCount].ssid[32] = '\0';
            strncpy(nets[netCount].pass, CRISPFACE_WIFI_PASS_2, 63); nets[netCount].pass[63] = '\0';
            netCount++;
#endif
#if CRISPFACE_WIFI_COUNT >= 4
            strncpy(nets[netCount].ssid, CRISPFACE_WIFI_SSID_3, 32); nets[netCount].ssid[32] = '\0';
            strncpy(nets[netCount].pass, CRISPFACE_WIFI_PASS_3, 63); nets[netCount].pass[63] = '\0';
            netCount++;
#endif
#if CRISPFACE_WIFI_COUNT >= 5
            strncpy(nets[netCount].ssid, CRISPFACE_WIFI_SSID_4, 32); nets[netCount].ssid[32] = '\0';
            strncpy(nets[netCount].pass, CRISPFACE_WIFI_PASS_4, 63); nets[netCount].pass[63] = '\0';
            netCount++;
#endif
        }

        cfDebugWifi = "";

        if (debug) {
            cfDebugWifi += "WiFi: ";
            cfDebugWifi += String(netCount);
            cfDebugWifi += fromSPIFFS ? " (from API)\n" : " (built-in)\n";
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
                cfDebugWifi += nets[0].ssid;
                cfDebugWifi += "\n";
            }
            WiFi.begin(nets[0].ssid, nets[0].pass);
            int attempts = 0;
            while (WiFi.status() != WL_CONNECTED && attempts < 20) {
                delay(500);
                attempts++;
            }
            if (WiFi.status() == WL_CONNECTED) {
                if (debug) cfDebugWifi += "Connected OK\n";
                cfLastWifiIdx = 0;
                return true;
            }
            if (debug) {
                cfDebugWifi += "FAIL after ";
                cfDebugWifi += String(attempts);
                cfDebugWifi += " tries\n";
            }
            cfLastWifiIdx = -1;
            WiFi.disconnect(true);
            WiFi.mode(WIFI_OFF);
            return false;
        }

        // Multiple networks — try last successful network first (skip scan)
        if (cfLastWifiIdx >= 0 && cfLastWifiIdx < netCount) {
            if (debug) {
                cfDebugWifi += "Quick: ";
                cfDebugWifi += nets[cfLastWifiIdx].ssid;
                cfDebugWifi += "\n";
            }
            WiFi.begin(nets[cfLastWifiIdx].ssid, nets[cfLastWifiIdx].pass);
            int attempts = 0;
            while (WiFi.status() != WL_CONNECTED && attempts < 10) {
                delay(500);
                attempts++;
            }
            if (WiFi.status() == WL_CONNECTED) {
                if (debug) cfDebugWifi += "Quick OK\n";
                return true;
            }
            if (debug) cfDebugWifi += "Quick FAIL\n";
            WiFi.disconnect(true);
            delay(100);
            cfLastWifiIdx = -1;
        }

        // Full scan — either first boot or quick reconnect failed
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
                if (scannedSSID == nets[k].ssid) {
                    if (debug) {
                        cfDebugWifi += "Try: ";
                        cfDebugWifi += nets[k].ssid;
                        cfDebugWifi += "\n";
                    }
                    WiFi.begin(nets[k].ssid, nets[k].pass);
                    int attempts = 0;
                    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
                        delay(500);
                        attempts++;
                    }
                    if (WiFi.status() == WL_CONNECTED) {
                        if (debug) cfDebugWifi += "Connected OK\n";
                        cfLastWifiIdx = k;
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

        cfLastWifiIdx = -1;
        WiFi.scanDelete();
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
        return false;
    }

    // Sync RTC from NTP (call while WiFi is connected)
    void cfSyncNTP() {
        struct tm timeinfo;
        if (getLocalTime(&timeinfo, 3000)) {
            // Reject NTP results before build time (garbage/overflow)
            #if CRISPFACE_BUILD_EPOCH > 0
            time_t ntpEpoch = mktime(&timeinfo);
            if (ntpEpoch < (time_t)CRISPFACE_BUILD_EPOCH) {
                return; // NTP returned garbage, keep current RTC
            }
            #endif
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
            cfTimeSeeded = true;
        }
    }

    void syncFromServer(bool debug = false) {
        // Ensure SPIFFS is mounted (handleButtonPress may call us
        // before drawWatchFace which normally mounts it)
        SPIFFS.begin(true);

        String dbg; // debug log, displayed when debug=true
        unsigned long t0 = millis();
        unsigned long tWifi = 0, tHttp = 0, tParse = 0;
        syncProgress(5);

        if (!cfConnectWiFi(debug)) {
            cfSyncFails++;
            if (debug) {
                dbg += cfDebugWifi;
                dbg += "RESULT: WiFi FAILED\n";
                dbg += "WiFi: ";
                dbg += String(millis() - t0);
                dbg += "ms\n";
                dbg += "Fails: ";
                dbg += String(cfSyncFails);
                dbg += " Backoff: ";
                dbg += String(cfBackoffSeconds());
                dbg += "s\n";
                renderDebug(dbg);
            }
            syncProgress(0);
            return;
        }
        tWifi = millis();

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

        http.begin(client, url);
        char authHeader[80];
        snprintf(authHeader, sizeof(authHeader), "Bearer %s", CRISPFACE_API_TOKEN);
        http.addHeader("Authorization", authHeader);
        http.setUserAgent("CrispFace/" CRISPFACE_VERSION);
        http.setTimeout(CRISPFACE_HTTP_TIMEOUT);
        http.setConnectTimeout(CRISPFACE_HTTP_TIMEOUT);
        http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

        int httpCode = http.GET();
        tHttp = millis();
        if (httpCode != 200) {
            http.end();
            cfSyncNTP();
            WiFi.disconnect(true);
            WiFi.mode(WIFI_OFF);
            cfSyncFails++;
            if (debug) {
                dbg += "HTTP: ";
                dbg += String(httpCode);
                dbg += " FAILED\n";
                dbg += "WiFi: ";
                dbg += String(tWifi - t0);
                dbg += "ms HTTP: ";
                dbg += String(tHttp - tWifi);
                dbg += "ms\n";
                dbg += "Fails: ";
                dbg += String(cfSyncFails);
                dbg += " Backoff: ";
                dbg += String(cfBackoffSeconds());
                dbg += "s\n";
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

        int wifiApiCount = 0;
        bool wifiWriteOk = false;
        {
            DynamicJsonDocument doc(16384);
            DeserializationError err = deserializeJson(doc, payload);
            int payloadLen = payload.length();
            payload = "";

            if (err || !doc["success"].as<bool>()) {
                cfSyncFails++;
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
                    dbg += "Fails: ";
                    dbg += String(cfSyncFails);
                    dbg += " Backoff: ";
                    dbg += String(cfBackoffSeconds());
                    dbg += "s\n";
                    renderDebug(dbg);
                }
                syncProgress(0);
                return;
            }

            // Save WiFi networks to SPIFFS (allows OTA WiFi updates)
            JsonArray wifiArr = doc["wifi"].as<JsonArray>();
            wifiApiCount = wifiArr.isNull() ? 0 : (int)wifiArr.size();
            wifiWriteOk = false;
            if (!wifiArr.isNull()) {
                File wf = SPIFFS.open("/wifi.json", FILE_WRITE);
                if (wf) { serializeJson(wifiArr, wf); wf.close(); wifiWriteOk = true; }
            }

            JsonArray faces = doc["faces"].as<JsonArray>();
            int total = faces.size();
            if (total == 0) {
                cfSyncFails++;
                if (debug) {
                    dbg += "HTTP: 200 OK\n";
                    dbg += "Faces: 0 (empty)\n";
                    dbg += "Fails: ";
                    dbg += String(cfSyncFails);
                    dbg += " Backoff: ";
                    dbg += String(cfBackoffSeconds());
                    dbg += "s\n";
                    renderDebug(dbg);
                }
                syncProgress(0);
                return;
            }

            syncProgress(60);

            // Delete stale face files beyond new count (0..total-1 get overwritten)
            for (int i = total; i < 10; i++) {
                char path[24];
                snprintf(path, sizeof(path), "/face_%d.json", i);
                if (!SPIFFS.exists(path)) break; // no more old files
                SPIFFS.remove(path);
            }

            int count = 0;
            int minServerStale = 86400;
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
                                if (s < minServerStale) minServerStale = s;
                            }
                        }
                    }
                }

                count++;
                syncProgress(60 + (30 * count / total));
            }

            tParse = millis();

            cfFaceCount    = count;
            // If no server complications need refreshing, sync once a day
            // (user can always manual-sync via top-left button)
            cfSyncInterval = anyServerComp ? (minServerStale > 60 ? minServerStale : 60) : 86400;
            cfLastSync     = (int)makeTime(currentTime);
            cfSyncFails    = 0; // reset backoff on success

            // Collect alerts from all faces — two per event (pre-alert + event-time)
            cfAlertCount = 0;
            int syncTime = cfLastSync;
            for (JsonObject face : faces) {
                for (JsonObject comp : face["complications"].as<JsonArray>()) {
                    JsonArray alerts = comp["alerts"].as<JsonArray>();
                    if (alerts.isNull()) continue;
                    for (JsonObject alert : alerts) {
                        int secFromNow = alert["sec"] | 0;
                        if (secFromNow <= 0) continue;

                        int evTime = syncTime + secFromNow;
                        bool ins = alert["ins"] | false;
                        const char* txt = alert["text"] | "Event";
                        const char* evTimeStr = alert["time"] | "";
                        int preSec = alert["pre"] | 300; // default 300s for backwards compat

                        // 1. Pre-alert (configurable minutes before event)
                        if (cfAlertCount < 20) {
                            cfAlerts[cfAlertCount].eventTime = evTime - preSec;
                            cfAlerts[cfAlertCount].buzzCount = ins ? 0 : 1;
                            cfAlerts[cfAlertCount].fired = false;
                            cfAlerts[cfAlertCount].preAlert = true;
                            cfAlerts[cfAlertCount].preMin = preSec / 60;
                            strncpy(cfAlerts[cfAlertCount].text, txt, 59);
                            cfAlerts[cfAlertCount].text[59] = '\0';
                            strncpy(cfAlerts[cfAlertCount].time, evTimeStr, 5);
                            cfAlerts[cfAlertCount].time[5] = '\0';
                            cfAlertCount++;
                        }

                        // 2. Event-time alert
                        if (cfAlertCount < 20) {
                            cfAlerts[cfAlertCount].eventTime = evTime;
                            cfAlerts[cfAlertCount].buzzCount = ins ? 0 : 3;
                            cfAlerts[cfAlertCount].fired = false;
                            cfAlerts[cfAlertCount].preAlert = false;
                            cfAlerts[cfAlertCount].preMin = 0;
                            strncpy(cfAlerts[cfAlertCount].text, txt, 59);
                            cfAlerts[cfAlertCount].text[59] = '\0';
                            strncpy(cfAlerts[cfAlertCount].time, evTimeStr, 5);
                            cfAlerts[cfAlertCount].time[5] = '\0';
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
            unsigned long tTotal = millis();
            // Page 1 (WiFi) — append OTA count before page break
            dbg += "OTA WiFi: ";
            dbg += String(wifiApiCount);
            dbg += " Write: ";
            dbg += wifiWriteOk ? "OK" : (wifiApiCount > 0 ? "FAIL" : "N/A");
            dbg += "\n";
            dbg += "\f"; // page break: WiFi on page 1, sync on page 2
            // Page 2 (Sync results + timing)
            dbg += "URL: ";
            dbg += url;
            dbg += "\n";
            dbg += "HTTP: 200 OK\n";
            dbg += "Faces: ";
            dbg += String(cfFaceCount);
            dbg += " Sync: ";
            dbg += String(cfSyncInterval);
            dbg += "s\n";
            dbg += "WiFi: ";
            dbg += String(tWifi - t0);
            dbg += "ms\n";
            dbg += "HTTP: ";
            dbg += String(tHttp - tWifi);
            dbg += "ms\n";
            dbg += "Parse: ";
            dbg += String(tParse - tHttp);
            dbg += "ms\n";
            dbg += "Total: ";
            dbg += String(tTotal - t0);
            dbg += "ms\n";
            renderDebug(dbg);
        }

        syncProgress(100);
    }

    // ---- Debug display ----

    void renderDebug(String &info) {
        display.setFont(&FreeSans9pt7b);
        int16_t tx, ty;
        uint16_t tw, th;
        display.getTextBounds("Ay", 0, 0, &tx, &ty, &tw, &th);
        int ascent = -(int)ty;
        int lineH = (int)th + 3;
        int linesPerPage = (194 - (ascent + 2)) / lineH;

        // Split into explicit pages on '\f', then lines on '\n'
        // Each '\f' forces a new page regardless of line count
        const int maxPages = 8;
        const int maxLinesPerPage = 12;
        String pageLines[maxPages][maxLinesPerPage];
        int pageLengths[maxPages] = {};
        int totalPages = 0;

        int idx = 0;
        while (idx < (int)info.length() && totalPages < maxPages) {
            int ff = info.indexOf('\f', idx);
            String section = (ff < 0) ? info.substring(idx) : info.substring(idx, ff);
            idx = (ff < 0) ? info.length() : ff + 1;

            // Split section into lines
            int si = 0;
            while (si < (int)section.length()) {
                int nl = section.indexOf('\n', si);
                String line = (nl < 0) ? section.substring(si) : section.substring(si, nl);
                si = (nl < 0) ? section.length() : nl + 1;
                if (line.length() == 0 && si >= (int)section.length()) break;
                if (line.length() > 25) line = line.substring(0, 25);

                // Start new page if current is full
                if (pageLengths[totalPages] >= linesPerPage) {
                    totalPages++;
                    if (totalPages >= maxPages) break;
                }
                pageLines[totalPages][pageLengths[totalPages]++] = line;
            }
            // Each '\f' forces next content onto a new page
            if (ff >= 0 && totalPages < maxPages) {
                totalPages++;
            }
        }
        totalPages++; // convert from index to count
        if (totalPages > maxPages) totalPages = maxPages;
        // Remove trailing empty pages
        while (totalPages > 1 && pageLengths[totalPages - 1] == 0) totalPages--;

        // Enable buttons for dismiss polling
        pinMode(UP_BTN_PIN, INPUT_PULLUP);
        pinMode(DOWN_BTN_PIN, INPUT_PULLUP);
        pinMode(BACK_BTN_PIN, INPUT_PULLUP);
        pinMode(MENU_BTN_PIN, INPUT_PULLUP);

        int page = 0;
        bool firstRender = true;
        while (true) {
            display.setFullWindow();
            display.fillScreen(GxEPD_WHITE);
            display.setTextColor(GxEPD_BLACK);
            display.setFont(&FreeSans9pt7b);

            int y = ascent + 2;
            for (int i = 0; i < pageLengths[page]; i++) {
                display.setCursor(2, y);
                display.print(pageLines[page][i]);
                y += lineH;
            }

            // Bottom: version + page indicator
            display.setCursor(2, 194);
            if (totalPages > 1) {
                display.print("v" CRISPFACE_VERSION " [");
                display.print(page + 1);
                display.print("/");
                display.print(totalPages);
                display.print("]");
            } else {
                display.print("v" CRISPFACE_VERSION " DBG");
            }

            display.display(!firstRender); // full refresh first time, partial after
            firstRender = false;

            // Single page — no cycling needed
            if (totalPages <= 1) return;

            // Wait 3s, polling for button dismiss every 100ms
            for (int i = 0; i < 30; i++) {
                delay(100);
                if (digitalRead(UP_BTN_PIN) == LOW ||
                    digitalRead(DOWN_BTN_PIN) == LOW ||
                    digitalRead(BACK_BTN_PIN) == LOW ||
                    digitalRead(MENU_BTN_PIN) == LOW) {
                    return;
                }
            }

            page = (page + 1) % totalPages;
        }
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
            localVal = resolveLocal(strlen(typ) > 0 ? typ : cid, comp);
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

    // ---- Battery helpers ----

    // LiPo discharge curve lookup — voltage to percentage
    // The Watchy V3 360K/100K divider puts full-charge (4.2V) at 3.29V on
    // the ADC pin — above the ESP32-S3's ~3.1V accurate range at 11dB
    // attenuation.  Reported voltage caps at ~3.90V, so the curve maps
    // that to 100%.
    int batteryPercent(float v) {
        // Piecewise linear interpolation; capped at ADC ceiling (~3.90V)
        static const float vTable[] = { 3.20, 3.40, 3.50, 3.60, 3.65, 3.70, 3.75, 3.80, 3.85, 3.90 };
        static const int   pTable[] = {    0,    3,    5,   10,   20,   35,   50,   70,   88,  100 };
        static const int N = sizeof(vTable) / sizeof(vTable[0]);
        if (v <= vTable[0]) return 0;
        if (v >= vTable[N - 1]) return 100;
        for (int i = 1; i < N; i++) {
            if (v <= vTable[i]) {
                float frac = (v - vTable[i - 1]) / (vTable[i] - vTable[i - 1]);
                return pTable[i - 1] + (int)(frac * (pTable[i] - pTable[i - 1]));
            }
        }
        return 100;
    }

    bool isCharging() {
        pinMode(USB_DET_PIN, INPUT);
        return digitalRead(USB_DET_PIN) == HIGH;
    }

    // ---- Battery icon ----

    void drawBatteryIcon(int x, int y, int w, int h, uint16_t color) {
        float v = getBatteryVoltage();
        int pct = batteryPercent(v);
        bool charging = isCharging();

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

        // Charging: draw lightning bolt centered in body
        if (charging) {
            int cx = x + bodyW / 2;
            int cy = y + h / 2;
            int bh = h - pad * 2 - 2; // bolt height, inset from body
            if (bh < 6) bh = 6;
            int bw = bh * 2 / 5;      // bolt width proportional to height
            if (bw < 3) bw = 3;
            int top = cy - bh / 2;
            // Invert color over the fill for contrast
            uint16_t boltColor = (pct > 40) ? (color == GxEPD_BLACK ? GxEPD_WHITE : GxEPD_BLACK) : color;
            // Simple bolt: top-right to center-left, then center-right to bottom-left
            display.drawLine(cx + bw / 2, top, cx - bw / 2, cy, boltColor);
            display.drawLine(cx - bw / 2, cy, cx + bw / 2, cy, boltColor);
            display.drawLine(cx + bw / 2, cy, cx - bw / 2, top + bh, boltColor);
            // Thicken by drawing offset lines
            display.drawLine(cx + bw / 2 + 1, top, cx - bw / 2 + 1, cy, boltColor);
            display.drawLine(cx + bw / 2 + 1, cy, cx - bw / 2 + 1, top + bh, boltColor);
        }
    }

    // ---- Battery text (percentage or voltage) ----

    String resolveBattery(const char* mode) {
        float v = getBatteryVoltage();
        char buf[12];
        bool charging = isCharging();
        if (strcmp(mode, "percentage") == 0) {
            int pct = batteryPercent(v);
            if (charging) {
                snprintf(buf, sizeof(buf), "%d%% +", pct);
            } else {
                snprintf(buf, sizeof(buf), "%d%%", pct);
            }
        } else {
            if (charging) {
                snprintf(buf, sizeof(buf), "%.1fV +", v);
            } else {
                snprintf(buf, sizeof(buf), "%.1fV", v);
            }
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

    String resolveLocal(const char* type, JsonObject comp) {
        if (strcmp(type, "time") == 0) {
            const char* layout = comp["params"]["layout"] | "horizontal";
            if (strcmp(layout, "vertical") == 0) {
                char buf[6];
                snprintf(buf, sizeof(buf), "%02d\n%02d",
                         currentTime.Hour, currentTime.Minute);
                return String(buf);
            }
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

            const char* linePtr = line.c_str();

            // Day divider: \x04 + day name renders as ———Mon——— divider
            if ((uint8_t)linePtr[0] == 0x04) {
                const char* dayLabel = linePtr + 1;
                int lineW = bw < 120 ? bw : 120;
                int lx = bx + (bw - lineW) / 2;
                // Use smallest font for day label
                display.setFont(&FreeSans9pt7b);
                int16_t dtx, dty; uint16_t dtw, dth;
                display.getTextBounds(dayLabel, 0, 0, &dtx, &dty, &dtw, &dth);
                int divAscent = -(int)dty;
                int labelH = (int)dth;
                // Visual text spans from cursor+dtx to cursor+dtx+dtw
                // Centre the visual text within bw
                int cursorX = bx + (bw - (int)dtw) / 2 - (int)dtx;
                int textLeft = cursorX + (int)dtx;
                int textRight = textLeft + (int)dtw;
                int ly = curY - ascent + 1;
                int baseline = ly + divAscent;
                int cy = ly + labelH / 2;
                display.setCursor(cursorX, baseline);
                display.setTextColor(color);
                display.print(dayLabel);
                // Lines either side with 3px gap
                int gap = 3;
                if (textLeft - gap - 1 >= lx)
                    display.drawLine(lx, cy, textLeft - gap - 1, cy, color);
                if (textRight + gap <= lx + lineW - 1)
                    display.drawLine(textRight + gap, cy, lx + lineW - 1, cy, color);
                curY += labelH + 4;
                display.setFont(font);
                firstLine = false;
                continue;
            }

            // Check for bold marker byte (\x03 = render this line in bold)
            bool useBold = false;
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

            const char* linePtr = line.c_str();

            // Day divider: \x04 + day name renders as ———Mon——— divider
            if ((uint8_t)linePtr[0] == 0x04) {
                const char* dayLabel = linePtr + 1;
                int lineW = bw < 120 ? bw : 120;
                int lx = bx + (bw - lineW) / 2;
                display.setFont(&FreeSans9pt7b);
                int16_t dtx, dty; uint16_t dtw, dth;
                display.getTextBounds(dayLabel, 0, 0, &dtx, &dty, &dtw, &dth);
                int divAscent = -(int)dty;
                int labelH = (int)dth;
                int cursorX = bx + (bw - (int)dtw) / 2 - (int)dtx;
                int textLeft = cursorX + (int)dtx;
                int textRight = textLeft + (int)dtw;
                int ly = curY - ascent + 1;
                int baseline = ly + divAscent;
                int cy = ly + labelH / 2;
                display.setCursor(cursorX, baseline);
                display.setTextColor(color);
                display.print(dayLabel);
                int gap = 3;
                if (textLeft - gap - 1 >= lx)
                    display.drawLine(lx, cy, textLeft - gap - 1, cy, color);
                if (textRight + gap <= lx + lineW - 1)
                    display.drawLine(textRight + gap, cy, lx + lineW - 1, cy, color);
                curY += labelH + 4;
                display.setFont(font);
                firstLine = false;
                continue;
            }

            // Check for circle marker bytes (all-day event indicators)
            bool drawFilledCircle = false;
            bool drawOpenCircle = false;
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

    // ---- Boot screen (shown on every boot/reboot before first sync) ----

    void renderBootScreen() {
        display.setFullWindow();
        display.fillScreen(GxEPD_BLACK);
        display.setTextColor(GxEPD_WHITE);

        int16_t tx, ty;
        uint16_t tw, th;

        // Title
        display.setFont(&FreeSans9pt7b);
        const char* title = "CrispFace v" CRISPFACE_VERSION;
        display.getTextBounds(title, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 35);
        display.print(title);

        const char* sub1 = "Open Source";
        display.getTextBounds(sub1, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 53);
        display.print(sub1);

        const char* sub2 = "Smartwatch";
        display.getTextBounds(sub2, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 71);
        display.print(sub2);

        // Time
        display.setFont(&FreeSans24pt7b);
        char tbuf[6];
        snprintf(tbuf, sizeof(tbuf), "%02d:%02d",
                 currentTime.Hour, currentTime.Minute);
        display.getTextBounds(tbuf, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 115);
        display.print(tbuf);

        // Status
        display.setFont(&FreeSans9pt7b);
        const char* l1 = "Syncing...";
        display.getTextBounds(l1, 0, 0, &tx, &ty, &tw, &th);
        display.setCursor((200 - (int)tw) / 2, 170);
        display.print(l1);

        display.display(false); // full refresh — blocks until e-paper fully settled
    }

    // ---- Fallback screen (no faces after sync) ----

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
