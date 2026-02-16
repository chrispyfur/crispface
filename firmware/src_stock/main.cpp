#include <Watchy.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>

class StockFace : public Watchy {
public:
    StockFace(const watchySettings &s) : Watchy(s) {}

    void drawWatchFace() {
        display.fillScreen(GxEPD_BLACK);
        display.setTextColor(GxEPD_WHITE);

        // Title
        display.setFont(&FreeSans9pt7b);
        display.setCursor(40, 25);
        display.print("Watchy Stock");

        // Time
        display.setFont(&FreeSansBold24pt7b);
        char buf[6];
        snprintf(buf, sizeof(buf), "%02d:%02d", currentTime.Hour, currentTime.Minute);
        display.setCursor(25, 90);
        display.print(buf);

        // Date
        display.setFont(&FreeSans9pt7b);
        static const char* days[] = {"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
        static const char* mons[] = {"Jan","Feb","Mar","Apr","May","Jun",
                                     "Jul","Aug","Sep","Oct","Nov","Dec"};
        int dow = currentTime.Wday;
        int mon = currentTime.Month - 1;
        if (dow < 0 || dow > 6) dow = 0;
        if (mon < 0 || mon > 11) mon = 0;
        char dateBuf[20];
        snprintf(dateBuf, sizeof(dateBuf), "%s %d %s %d",
                 days[dow], currentTime.Day, mons[mon],
                 tmYearToCalendar(currentTime.Year));
        display.setCursor(30, 130);
        display.print(dateBuf);

        // Battery
        float batt = getBatteryVoltage();
        display.setCursor(55, 170);
        char battBuf[12];
        snprintf(battBuf, sizeof(battBuf), "Batt: %.1fV", batt);
        display.print(battBuf);
    }
};

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

StockFace face(settings);

void setup() { face.init(); }
void loop() {}
