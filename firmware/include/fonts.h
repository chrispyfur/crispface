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

#include <Fonts/FreeMono9pt7b.h>
#include <Fonts/FreeMono12pt7b.h>
#include <Fonts/FreeMono18pt7b.h>
#include <Fonts/FreeMono24pt7b.h>

#include <Fonts/FreeSerif9pt7b.h>
#include <Fonts/FreeSerif12pt7b.h>
#include <Fonts/FreeSerif18pt7b.h>
#include <Fonts/FreeSerif24pt7b.h>

#include <Fonts/FreeSerifBold9pt7b.h>
#include <Fonts/FreeSerifBold12pt7b.h>
#include <Fonts/FreeSerifBold18pt7b.h>
#include <Fonts/FreeSerifBold24pt7b.h>

// Custom 48pt fonts generated via firmware/generate_fonts.sh
#include "crispface_fonts/FreeSans48pt7b.h"
#include "crispface_fonts/FreeSansBold48pt7b.h"
#include "crispface_fonts/FreeMono48pt7b.h"
#include "crispface_fonts/FreeMonoBold48pt7b.h"
#include "crispface_fonts/FreeSerif48pt7b.h"
#include "crispface_fonts/FreeSerifBold48pt7b.h"

// Map editor stored size to Adafruit GFX pt:
//   12 → 9pt (~13px)    16 → 12pt (~17px)
//   24 → 18pt (~25px)   48 → 24pt (~33px)
//   72 → 48pt (~67px)

inline const GFXfont* getFont(const char* family, int size, bool bold) {
    bool mono  = (family[0] == 'm'); // "mono"
    bool serif = (family[0] == 's' && family[1] == 'e'); // "serif" vs "sans"

    if (mono) {
        switch (size) {
            case 72: return bold ? &FreeMonoBold48pt7b : &FreeMono48pt7b;
            case 48: return &FreeMono24pt7b;
            case 24: return &FreeMono18pt7b;
            case 16: return &FreeMono12pt7b;
            case 12: return &FreeMono9pt7b;
            default: return &FreeMono9pt7b;
        }
    }

    if (serif) {
        if (bold) {
            switch (size) {
                case 72: return &FreeSerifBold48pt7b;
                case 48: return &FreeSerifBold24pt7b;
                case 24: return &FreeSerifBold18pt7b;
                case 16: return &FreeSerifBold12pt7b;
                case 12: return &FreeSerifBold9pt7b;
                default: return &FreeSerifBold9pt7b;
            }
        }
        switch (size) {
            case 72: return &FreeSerif48pt7b;
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
            case 48: return &FreeSansBold24pt7b;
            case 24: return &FreeSansBold18pt7b;
            case 16: return &FreeSansBold12pt7b;
            case 12: return &FreeSansBold9pt7b;
            default: return &FreeSansBold9pt7b;
        }
    }

    switch (size) {
        case 72: return &FreeSans48pt7b;
        case 48: return &FreeSans24pt7b;
        case 24: return &FreeSans18pt7b;
        case 16: return &FreeSans12pt7b;
        case 12: return &FreeSans9pt7b;
        default: return &FreeSans9pt7b;
    }
}

#endif
