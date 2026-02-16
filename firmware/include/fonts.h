#ifndef CRISPFACE_FONTS_H
#define CRISPFACE_FONTS_H

#include <Adafruit_GFX.h>

// Standard Adafruit GFX bundled fonts (9, 12, 18, 24pt)
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSans12pt7b.h>
#include <Fonts/FreeSans18pt7b.h>
#include <Fonts/FreeSans24pt7b.h>

#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>

// Tamzen bitmap fonts (regular + bold at all sizes)
#include "crispface_fonts/Tamzen13x1.h"
#include "crispface_fonts/Tamzen13x1Bold.h"
#include "crispface_fonts/Tamzen16x1.h"
#include "crispface_fonts/Tamzen16x1Bold.h"
#include "crispface_fonts/Tamzen26x2.h"
#include "crispface_fonts/Tamzen26x2Bold.h"
#include "crispface_fonts/Tamzen32x2.h"
#include "crispface_fonts/Tamzen32x2Bold.h"
#include "crispface_fonts/Tamzen60x3.h"
#include "crispface_fonts/Tamzen60x3Bold.h"
#include "crispface_fonts/Tamzen80x4.h"
#include "crispface_fonts/Tamzen80x4Bold.h"

#include <Fonts/FreeSerif9pt7b.h>
#include <Fonts/FreeSerif12pt7b.h>
#include <Fonts/FreeSerif18pt7b.h>
#include <Fonts/FreeSerif24pt7b.h>

#include <Fonts/FreeSerifBold9pt7b.h>
#include <Fonts/FreeSerifBold12pt7b.h>
#include <Fonts/FreeSerifBold18pt7b.h>
#include <Fonts/FreeSerifBold24pt7b.h>

// Custom 36pt + 48pt fonts generated via firmware/generate_fonts.sh
#include "crispface_fonts/FreeSans36pt7b.h"
#include "crispface_fonts/FreeSansBold36pt7b.h"
#include "crispface_fonts/FreeSerif36pt7b.h"
#include "crispface_fonts/FreeSerifBold36pt7b.h"

#include "crispface_fonts/FreeSans48pt7b.h"
#include "crispface_fonts/FreeSansBold48pt7b.h"
#include "crispface_fonts/FreeSerif48pt7b.h"
#include "crispface_fonts/FreeSerifBold48pt7b.h"

// Map editor stored size to Adafruit GFX pt:
//   12 → 9pt (~13px)    16 → 12pt (~17px)
//   24 → 18pt (~25px)   48 → 24pt (~33px)
//   60 → 36pt (~51px)   72 → 48pt (~67px)

inline const GFXfont* getFont(const char* family, int size, bool bold) {
    bool mono  = (family[0] == 'm'); // "mono"
    bool serif = (family[0] == 's' && family[1] == 'e'); // "serif" vs "sans"

    if (mono) {
        if (bold) {
            switch (size) {
                case 72: return &Tamzen80x4Bold;
                case 60: return &Tamzen60x3Bold;
                case 48: return &Tamzen32x2Bold;
                case 24: return &Tamzen26x2Bold;
                case 16: return &Tamzen16x1Bold;
                case 12: return &Tamzen13x1Bold;
                default: return &Tamzen13x1Bold;
            }
        }
        switch (size) {
            case 72: return &Tamzen80x4;
            case 60: return &Tamzen60x3;
            case 48: return &Tamzen32x2;
            case 24: return &Tamzen26x2;
            case 16: return &Tamzen16x1;
            case 12: return &Tamzen13x1;
            default: return &Tamzen13x1;
        }
    }

    if (serif) {
        if (bold) {
            switch (size) {
                case 72: return &FreeSerifBold48pt7b;
                case 60: return &FreeSerifBold36pt7b;
                case 48: return &FreeSerifBold24pt7b;
                case 24: return &FreeSerifBold18pt7b;
                case 16: return &FreeSerifBold12pt7b;
                case 12: return &FreeSerifBold9pt7b;
                default: return &FreeSerifBold9pt7b;
            }
        }
        switch (size) {
            case 72: return &FreeSerif48pt7b;
            case 60: return &FreeSerif36pt7b;
            case 48: return &FreeSerif24pt7b;
            case 24: return &FreeSerif18pt7b;
            case 16: return &FreeSerif12pt7b;
            case 12: return &FreeSerif9pt7b;
            default: return &FreeSerif9pt7b;
        }
    }

    // Sans-serif (default)
    if (bold) {
        switch (size) {
            case 72: return &FreeSansBold48pt7b;
            case 60: return &FreeSansBold36pt7b;
            case 48: return &FreeSansBold24pt7b;
            case 24: return &FreeSansBold18pt7b;
            case 16: return &FreeSansBold12pt7b;
            case 12: return &FreeSansBold9pt7b;
            default: return &FreeSansBold9pt7b;
        }
    }

    switch (size) {
        case 72: return &FreeSans48pt7b;
        case 60: return &FreeSans36pt7b;
        case 48: return &FreeSans24pt7b;
        case 24: return &FreeSans18pt7b;
        case 16: return &FreeSans12pt7b;
        case 12: return &FreeSans9pt7b;
        default: return &FreeSans9pt7b;
    }
}

#endif
