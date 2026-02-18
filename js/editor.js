(function () {
    'use strict';

    var CF = window.CRISPFACE;
    var canvas;
    var nextCompId = 1;

    var FONT_FAMILIES = [
        { value: 'sans-serif', label: 'Sans' },
        { value: 'serif', label: 'Serif' },
        { value: 'monospace', label: 'Tamzen' }
    ];

    // Stored values map to Adafruit GFX pt sizes on the watch.
    // Drop 8px from the dropdown (same as 12 on watch). Legacy 8 still renders.
    var FONT_SIZES = [
        { value: 12, label: 'Small (9pt)' },
        { value: 16, label: 'Medium (12pt)' },
        { value: 24, label: 'Large (18pt)' },
        { value: 48, label: 'X-Large (24pt)' },
        { value: 60, label: 'XXL (36pt)' },
        { value: 72, label: 'Huge (48pt)' }
    ];

    // Pre-computed GFX font metrics from Adafruit GFX bitmap font headers.
    // Keys: family|size|bold → { th: getTextBounds("Ay") height, ascent: -(int)ty }
    // These match the firmware's drawAligned() rendering exactly.
    var GFX_METRICS = {
        // sans-serif regular
        'sans-serif|12|0': { th: 17, ascent: 12 }, 'sans-serif|16|0': { th: 23, ascent: 17 },
        'sans-serif|24|0': { th: 34, ascent: 25 }, 'sans-serif|48|0': { th: 44, ascent: 33 },
        'sans-serif|60|0': { th: 67, ascent: 51 }, 'sans-serif|72|0': { th: 89, ascent: 69 },
        // sans-serif bold
        'sans-serif|12|1': { th: 17, ascent: 12 }, 'sans-serif|16|1': { th: 23, ascent: 17 },
        'sans-serif|24|1': { th: 33, ascent: 25 }, 'sans-serif|48|1': { th: 45, ascent: 33 },
        'sans-serif|60|1': { th: 68, ascent: 51 }, 'sans-serif|72|1': { th: 89, ascent: 69 },
        // monospace regular (Tamzen bitmap)
        'monospace|12|0': { th: 13, ascent: 11 },  'monospace|16|0': { th: 16, ascent: 12 },
        'monospace|24|0': { th: 26, ascent: 22 },  'monospace|48|0': { th: 32, ascent: 24 },
        'monospace|60|0': { th: 60, ascent: 42 },  'monospace|72|0': { th: 80, ascent: 56 },
        // monospace bold (Tamzen bitmap)
        'monospace|12|1': { th: 13, ascent: 11 },  'monospace|16|1': { th: 16, ascent: 12 },
        'monospace|24|1': { th: 26, ascent: 22 },  'monospace|48|1': { th: 32, ascent: 24 },
        'monospace|60|1': { th: 60, ascent: 42 },  'monospace|72|1': { th: 80, ascent: 56 },
        // serif regular
        'serif|12|0': { th: 16, ascent: 11 },  'serif|16|0': { th: 21, ascent: 15 },
        'serif|24|0': { th: 31, ascent: 22 },  'serif|48|0': { th: 42, ascent: 31 },
        'serif|60|0': { th: 63, ascent: 47 },  'serif|72|0': { th: 83, ascent: 62 },
        // serif bold
        'serif|12|1': { th: 16, ascent: 11 },  'serif|16|1': { th: 21, ascent: 15 },
        'serif|24|1': { th: 31, ascent: 23 },  'serif|48|1': { th: 42, ascent: 32 },
        'serif|60|1': { th: 63, ascent: 48 },  'serif|72|1': { th: 84, ascent: 64 }
    };
    // Legacy alias for 8px (same as 12)
    GFX_METRICS['sans-serif|8|0'] = GFX_METRICS['sans-serif|12|0'];
    GFX_METRICS['sans-serif|8|1'] = GFX_METRICS['sans-serif|12|1'];
    GFX_METRICS['monospace|8|0'] = GFX_METRICS['monospace|12|0'];
    GFX_METRICS['monospace|8|1'] = GFX_METRICS['monospace|12|1'];
    GFX_METRICS['serif|8|0'] = GFX_METRICS['serif|12|0'];
    GFX_METRICS['serif|8|1'] = GFX_METRICS['serif|12|1'];

    function getGfxMetrics(family, size, bold) {
        var key = family + '|' + size + '|' + (bold ? '1' : '0');
        return GFX_METRICS[key] || { th: size, ascent: Math.round(size * 0.75) };
    }

    // DISPLAY_SIZE_MAP kept for backward compat — maps stored size to FreeSans th.
    // The after:render code now uses getGfxMetrics() for per-font accuracy.
    var DISPLAY_SIZE_MAP = { 8: 17, 12: 17, 16: 23, 24: 34, 48: 44, 60: 67, 72: 89 };

    var ALIGNS = ['left', 'center', 'right'];
    var drawWeatherIconPreview; // assigned in initCanvas, used by renderFacePreview

    // Map editor font families to @font-face web fonts (same TTFs as GFX firmware)
    var CANVAS_FONT = {
        'sans-serif': 'CrispSans',
        'monospace': 'CrispMono',
        'serif': 'CrispSerif'
    };

    // Compute text inset from border + padding (0 when no border)
    function getInset(d) {
        var bw = d.border_width || 0;
        if (bw <= 0) return 0;
        return bw + (d.border_padding || 0);
    }

    // Expose for properties.js
    window.CRISPFACE.FONT_FAMILIES = FONT_FAMILIES;
    window.CRISPFACE.FONT_SIZES = FONT_SIZES;
    window.CRISPFACE.DISPLAY_SIZE_MAP = DISPLAY_SIZE_MAP;
    window.CRISPFACE.GFX_METRICS = GFX_METRICS;
    window.CRISPFACE.getGfxMetrics = getGfxMetrics;
    window.CRISPFACE.CANVAS_FONT = CANVAS_FONT;
    window.CRISPFACE.ALIGNS = ALIGNS;
    window.CRISPFACE.getInset = getInset;

    // Migrate old combined font spec (e.g. "sans-12") to separate fields
    function migrateContent(content) {
        if (content.font && !content.family) {
            var match = content.font.match(/^(sans|mono)-?(\d+)$/);
            if (match) {
                content.family = match[1] === 'mono' ? 'monospace' : 'sans-serif';
                content.size = parseInt(match[2], 10);
            }
            delete content.font;
        }
        if (!content.family) content.family = 'sans-serif';
        if (!content.size) content.size = 12;
        if (content.bold === undefined) content.bold = false;
        if (content.italic === undefined) content.italic = false;
        return content;
    }

    // Render a face preview onto a plain 2D canvas context from raw face JSON
    function renderFacePreview(ctx, faceData) {
        var bg = faceData.background === 'white' ? '#ffffff' : '#000000';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 200, 200);

        var complications = faceData.complications || [];
        for (var ci = 0; ci < complications.length; ci++) {
            var c = complications[ci];
            if (c.type !== 'text') continue;

            // Clone content and migrate old format
            var content = {};
            var src = c.content || {};
            for (var k in src) content[k] = src[k];
            content = migrateContent(content);

            var col = (content.color === 'white') ? '#ffffff' : '#000000';
            var bw = c.border_width || 0;
            var inset = bw > 0 ? bw + (c.border_padding || 0) : 0;
            var padLeft = c.padding_left || 0;
            var padTop = c.padding_top || 0;

            var ix = (c.x || 0) + inset + padLeft;
            var iy = (c.y || 0) + inset + padTop;
            var iw = Math.max((c.w || 80) - inset * 2 - padLeft, 1);
            var ih = Math.max((c.h || 40) - inset * 2 - padTop, 1);

            // Draw border
            if (bw > 0) {
                var br = c.border_radius || 0;
                var bx = c.x || 0;
                var by = c.y || 0;
                var bww = c.w || 80;
                var bh = c.h || 40;
                ctx.save();
                ctx.strokeStyle = col;
                ctx.lineWidth = bw;
                if (br > 0) {
                    var r = Math.min(br, bww / 2, bh / 2);
                    ctx.beginPath();
                    ctx.moveTo(bx + r, by);
                    ctx.lineTo(bx + bww - r, by);
                    ctx.arcTo(bx + bww, by, bx + bww, by + r, r);
                    ctx.lineTo(bx + bww, by + bh - r);
                    ctx.arcTo(bx + bww, by + bh, bx + bww - r, by + bh, r);
                    ctx.lineTo(bx + r, by + bh);
                    ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
                    ctx.lineTo(bx, by + r);
                    ctx.arcTo(bx, by, bx + r, by, r);
                    ctx.closePath();
                    ctx.stroke();
                } else {
                    ctx.strokeRect(bx + bw / 2, by + bw / 2, bww - bw, bh - bw);
                }
                ctx.restore();
            }

            var cType = c.complication_type || c.complication_id || '';

            // Battery icon
            if (cType === 'battery' && (c.params || {}).display !== 'percentage' && (c.params || {}).display !== 'voltage') {
                ctx.save();
                ctx.fillStyle = bg;
                ctx.fillRect(ix, iy, iw, ih);
                var nubW = 2, gap = 1;
                var bodyW = iw - nubW - gap;
                if (bodyW < 6) bodyW = 6;
                ctx.strokeStyle = col;
                ctx.lineWidth = 1;
                ctx.strokeRect(ix + 0.5, iy + 0.5, bodyW - 1, ih - 1);
                var nubH = Math.floor(ih * 2 / 5);
                if (nubH < 2) nubH = 2;
                var nubY = iy + Math.floor((ih - nubH) / 2);
                ctx.fillStyle = col;
                ctx.fillRect(ix + bodyW + gap, nubY, nubW, nubH);
                var bPad = 2;
                var maxFillW = bodyW - bPad * 2;
                var fillW = Math.floor(maxFillW * 0.65);
                if (fillW > 0) ctx.fillRect(ix + bPad, iy + bPad, fillW, ih - bPad * 2);
                ctx.restore();
                continue;
            }

            // Weather icon
            if (String(content.value || '').indexOf('icon:') === 0) {
                var iconParts = String(content.value).substring(5).split(':');
                var weatherCode = parseInt(iconParts[0], 10) || 0;
                var iconSize = iconParts.length > 1 ? parseInt(iconParts[1], 10) : 0;
                ctx.save();
                ctx.fillStyle = bg;
                ctx.fillRect(ix, iy, iw, ih);
                if (drawWeatherIconPreview) {
                    if (iconSize > 0 && iconSize < iw && iconSize < ih) {
                        var ox = ix + Math.round((iw - iconSize) / 2);
                        var oy = iy + Math.round((ih - iconSize) / 2);
                        drawWeatherIconPreview(ctx, weatherCode, ox, oy, iconSize, iconSize, col);
                    } else {
                        drawWeatherIconPreview(ctx, weatherCode, ix, iy, iw, ih, col);
                    }
                }
                ctx.restore();
                continue;
            }

            // Text rendering
            var gfx = getGfxMetrics(content.family, content.size, content.bold);
            var weight = content.bold ? 'bold ' : '';
            var cfFont = CANVAS_FONT[content.family] || 'CrispSans';

            ctx.fillStyle = bg;
            ctx.fillRect(ix, iy, iw, ih);

            ctx.font = weight + gfx.th + 'px ' + cfFont;
            ctx.fillStyle = col;
            ctx.textBaseline = 'alphabetic';

            var metrics = ctx.measureText('Ay');
            var ascent = Math.round(metrics.actualBoundingBoxAscent);
            var lineH = gfx.th + 2;

            ctx.save();
            ctx.beginPath();
            ctx.rect(ix, iy, iw, ih);
            ctx.clip();

            var text = String(content.value || '');
            var lines = text.split('\n');
            var curY = iy + ascent;
            var align = content.align || 'left';

            for (var li = 0; li < lines.length; li++) {
                if (curY - ascent >= iy + ih) break;
                var lineText = lines[li];

                // Day divider
                if (lineText.charCodeAt(0) === 4 && lineText.length <= 1) {
                    var divW = Math.min(iw, 120);
                    var dlx = ix + Math.round((iw - divW) / 2);
                    var dly = curY - ascent + 1;
                    var dcx = dlx + Math.round(divW / 2);
                    var dcy = dly + 1;
                    ctx.fillRect(dcx, dly, 1, 1);
                    ctx.fillRect(dcx - 1, dcy, 3, 1);
                    ctx.fillRect(dcx, dly + 2, 1, 1);
                    if (dcx - 4 >= dlx) ctx.fillRect(dlx, dcy, dcx - 4 - dlx + 1, 1);
                    if (dcx + 4 <= dlx + divW - 1) ctx.fillRect(dcx + 4, dcy, dlx + divW - 1 - (dcx + 4) + 1, 1);
                    curY += 7;
                    continue;
                }

                var lineBold = false;
                if (lineText.charCodeAt(0) === 3) { lineBold = true; lineText = lineText.substring(1); }

                var circleType = 0;
                if (lineText.charCodeAt(0) === 1) { circleType = 1; lineText = lineText.substring(1).trimStart(); }
                else if (lineText.charCodeAt(0) === 2) { circleType = 2; lineText = lineText.substring(1).trimStart(); }

                var lineWeight = (content.bold || lineBold) ? 'bold ' : weight;
                ctx.font = lineWeight + gfx.th + 'px ' + cfFont;

                var circleW = 0;
                if (circleType) {
                    var cr = Math.round(ascent / 4);
                    circleW = cr * 2 + 3;
                }

                var lineW = ctx.measureText(lineText).width;
                var curX;
                if (align === 'center') {
                    curX = ix + Math.round((iw - lineW - circleW) / 2);
                } else if (align === 'right') {
                    curX = ix + iw - Math.ceil(lineW) - circleW;
                } else {
                    curX = ix;
                }

                if (circleType) {
                    var cr2 = Math.round(ascent / 4);
                    var circY = curY - Math.round(ascent / 2);
                    var circX = curX + cr2;
                    ctx.beginPath();
                    ctx.arc(circX, circY, cr2, 0, Math.PI * 2);
                    if (circleType === 1) ctx.fill(); else ctx.stroke();
                    curX += circleW;
                }
                ctx.fillText(lineText, curX, curY);
                curY += lineH;
            }
            ctx.font = weight + gfx.th + 'px ' + cfFont;
            ctx.restore();
        }
    }

    // Initialize canvas (called after face data is loaded)
    function initCanvas() {
        canvas = new fabric.Canvas('face-canvas', {
            width: 200,
            height: 200,
            backgroundColor: CF.faceData.background === 'white' ? '#ffffff' : '#000000',
            selection: true,
            enableRetinaScaling: false
        });

        // CSS scale to 400x400 with pixelated rendering
        var wrapper = document.querySelector('.canvas-container-wrapper');
        var canvasContainer = wrapper.querySelector('.canvas-container') ||
                              canvas.wrapperEl;
        if (canvasContainer) {
            canvasContainer.style.width = '400px';
            canvasContainer.style.height = '400px';
        }
        var upperCanvas = canvas.upperCanvasEl;
        var lowerCanvas = canvas.lowerCanvasEl;
        if (upperCanvas) {
            upperCanvas.style.width = '400px';
            upperCanvas.style.height = '400px';
            upperCanvas.style.imageRendering = 'pixelated';
        }
        if (lowerCanvas) {
            lowerCanvas.style.width = '400px';
            lowerCanvas.style.height = '400px';
            lowerCanvas.style.imageRendering = 'pixelated';
        }

        // Snap to integer pixels on move
        canvas.on('object:moving', function (e) {
            var obj = e.target;
            obj.set({
                left: Math.round(obj.left),
                top: Math.round(obj.top)
            });
            enforceBounds(obj);
        });

        // Snap on scale/resize — sync both w and h to crispfaceData
        canvas.on('object:scaling', function (e) {
            var obj = e.target;
            var w = Math.round(obj.width * obj.scaleX);
            var h = Math.round(obj.height * obj.scaleY);
            obj.set({
                width: w,
                height: h,
                scaleX: 1,
                scaleY: 1,
                left: Math.round(obj.left),
                top: Math.round(obj.top)
            });
            if (obj.crispfaceData) {
                var inset = getInset(obj.crispfaceData);
                var pTop = obj.crispfaceData.padding_top || 0;
                obj.crispfaceData.h = h + inset * 2 + pTop; // store outer height
            }
            enforceBounds(obj);
        });

        // Notify properties panel on selection
        canvas.on('selection:created', function (e) {
            window.dispatchEvent(new CustomEvent('crispface:select', { detail: getSelectedComplication() }));
        });
        canvas.on('selection:updated', function (e) {
            window.dispatchEvent(new CustomEvent('crispface:select', { detail: getSelectedComplication() }));
        });
        canvas.on('selection:cleared', function () {
            window.dispatchEvent(new CustomEvent('crispface:deselect'));
        });
        canvas.on('object:modified', function (e) {
            var active = canvas.getActiveObject();
            if (active) {
                window.dispatchEvent(new CustomEvent('crispface:select', { detail: getSelectedComplication() }));
            }
        });

        // Weather icon drawing for editor preview (mirrors firmware drawWeatherIcon)
        drawWeatherIconPreview = function(ctx, code, x, y, w, h, col) {
            var cx = x + w / 2, cy = y + h / 2;
            var s = Math.min(w, h);

            function cloudShape(cx, cy, s) {
                var r1 = s * 0.3, r2 = s * 0.25;
                var baseW = s * 0.75, baseH = s * 0.2;
                var baseY = cy + r2 * 0.5;
                ctx.fillStyle = col;
                ctx.fillRect(cx - baseW / 2, baseY, baseW, baseH);
                ctx.beginPath();
                ctx.arc(cx - baseW / 4, baseY, r2, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(cx, baseY - r1 / 3, r1, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(cx + baseW / 4, baseY, r2 - 1, 0, Math.PI * 2);
                ctx.fill();
            }

            function sunShape(cx, cy, s) {
                var r = s / 5;
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
                var dx = [10, 7, 0, -7, -10, -7, 0, 7];
                var dy = [0, -7, -10, -7, 0, 7, 10, 7];
                var inner = r + 2, outer = r * 2;
                ctx.strokeStyle = col;
                ctx.lineWidth = 1;
                for (var i = 0; i < 8; i++) {
                    ctx.beginPath();
                    ctx.moveTo(cx + dx[i] * inner / 10, cy + dy[i] * inner / 10);
                    ctx.lineTo(cx + dx[i] * outer / 10, cy + dy[i] * outer / 10);
                    ctx.stroke();
                }
            }

            function rainDrops(cx, cy, s, count) {
                var dropH = s / 6;
                var spacing = s / (count + 1);
                var startX = cx - (count - 1) * spacing / 2;
                ctx.strokeStyle = col;
                ctx.lineWidth = 1;
                for (var i = 0; i < count; i++) {
                    var dx = startX + i * spacing;
                    ctx.beginPath();
                    ctx.moveTo(dx, cy);
                    ctx.lineTo(dx - 1, cy + dropH);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(dx + 1, cy);
                    ctx.lineTo(dx, cy + dropH);
                    ctx.stroke();
                }
            }

            function snowDots(cx, cy, s) {
                var spacing = s / 4;
                ctx.fillStyle = col;
                for (var row = 0; row < 2; row++) {
                    var dy = cy + row * spacing;
                    var offset = row * spacing / 2;
                    for (var i = 0; i < 3 - row; i++) {
                        ctx.beginPath();
                        ctx.arc(cx - spacing + offset + i * spacing, dy, 1.5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            function lightning(cx, cy, s) {
                var bh = s * 0.4, bw = s / 6;
                ctx.strokeStyle = col;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx + bw, cy);
                ctx.lineTo(cx - bw / 2, cy + bh / 2);
                ctx.lineTo(cx + bw / 2, cy + bh / 2);
                ctx.lineTo(cx - bw, cy + bh);
                ctx.stroke();
            }

            if (code <= 1) {
                sunShape(cx, cy, s);
            } else if (code <= 3) {
                sunShape(cx + s / 5, cy - s / 5, s * 0.67);
                cloudShape(cx - s / 8, cy + s / 8, s * 0.75);
            } else if (code <= 6) {
                // Fog: horizontal lines
                ctx.strokeStyle = col;
                ctx.lineWidth = 2;
                var pad = w / 8;
                for (var i = 1; i <= 4; i++) {
                    var ly = y + i * h / 5;
                    var lx = x + pad + (i % 2 === 0 ? pad / 2 : 0);
                    var lw = w - pad * 2 - (i % 2 === 0 ? pad / 2 : 0);
                    ctx.beginPath();
                    ctx.moveTo(lx, ly);
                    ctx.lineTo(lx + lw, ly);
                    ctx.stroke();
                }
            } else if (code <= 8) {
                cloudShape(cx, cy - s / 8, s);
            } else if (code <= 12) {
                cloudShape(cx, cy - s / 4, s);
                rainDrops(cx, cy + s / 5, s, 3);
            } else if (code <= 15) {
                cloudShape(cx, cy - s / 4, s);
                rainDrops(cx, cy + s / 5, s, 5);
            } else if (code <= 27) {
                cloudShape(cx, cy - s / 4, s);
                snowDots(cx, cy + s / 5, s);
            } else if (code <= 30) {
                cloudShape(cx, cy - s / 4, s);
                lightning(cx, cy + s / 6, s);
            } else {
                cloudShape(cx, cy - s / 8, s);
            }
        };

        // Draw complication borders and battery icon after canvas render
        canvas.on('after:render', function () {
            var ctx = canvas.getContext('2d');
            canvas.getObjects().forEach(function (obj) {
                if (!obj.crispfaceData) return;
                var d = obj.crispfaceData;
                var col = (d.content && d.content.color === 'white') ? '#ffffff' : '#000000';

                // Draw border
                var bw = d.border_width || 0;
                if (bw > 0) {
                    var br = d.border_radius || 0;
                    var ins = getInset(d);
                    var pL = d.padding_left || 0;
                    var pT = d.padding_top || 0;
                    var bx = Math.round(obj.left) - ins - pL;
                    var by = Math.round(obj.top) - ins - pT;
                    var bww = Math.round(obj.width * (obj.scaleX || 1)) + ins * 2 + pL;
                    var bh = d.h || Math.round(obj.height * (obj.scaleY || 1));

                    ctx.save();
                    ctx.strokeStyle = col;
                    ctx.lineWidth = bw;
                    if (br > 0) {
                        var r = Math.min(br, bww / 2, bh / 2);
                        ctx.beginPath();
                        ctx.moveTo(bx + r, by);
                        ctx.lineTo(bx + bww - r, by);
                        ctx.arcTo(bx + bww, by, bx + bww, by + r, r);
                        ctx.lineTo(bx + bww, by + bh - r);
                        ctx.arcTo(bx + bww, by + bh, bx + bww - r, by + bh, r);
                        ctx.lineTo(bx + r, by + bh);
                        ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
                        ctx.lineTo(bx, by + r);
                        ctx.arcTo(bx, by, bx + r, by, r);
                        ctx.closePath();
                        ctx.stroke();
                    } else {
                        ctx.strokeRect(bx + bw / 2, by + bw / 2, bww - bw, bh - bw);
                    }
                    ctx.restore();
                }

                // Inner bounds for custom rendering
                var ix = Math.round(obj.left);
                var iy = Math.round(obj.top);
                var iw = Math.round(obj.width * (obj.scaleX || 1));
                var ih = Math.round(obj.height * (obj.scaleY || 1));
                var bg = CF.faceData.background === 'black' ? '#000000' : '#ffffff';

                // Draw battery icon (replaces text for icon mode)
                var cType = d.complication_type || d.complication_id || '';
                if (cType === 'battery' && (d.params || {}).display !== 'percentage' && (d.params || {}).display !== 'voltage') {
                    ctx.save();
                    ctx.fillStyle = bg;
                    ctx.fillRect(ix, iy, iw, ih);

                    // Match firmware drawBatteryIcon
                    var nubW = 2, gap = 1;
                    var bodyW = iw - nubW - gap;
                    if (bodyW < 6) bodyW = 6;

                    // Body outline
                    ctx.strokeStyle = col;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(ix + 0.5, iy + 0.5, bodyW - 1, ih - 1);

                    // Nub
                    var nubH = Math.floor(ih * 2 / 5);
                    if (nubH < 2) nubH = 2;
                    var nubY = iy + Math.floor((ih - nubH) / 2);
                    ctx.fillStyle = col;
                    ctx.fillRect(ix + bodyW + gap, nubY, nubW, nubH);

                    // Fill at 65% (preview)
                    var pad = 2;
                    var maxFillW = bodyW - pad * 2;
                    var fillW = Math.floor(maxFillW * 0.65);
                    if (fillW > 0) {
                        ctx.fillRect(ix + pad, iy + pad, fillW, ih - pad * 2);
                    }

                    ctx.restore();
                } else if (d.type === 'text' && d.content && String(d.content.value || '').indexOf('icon:') === 0) {
                    // Weather icon preview — value is "icon:CODE" or "icon:CODE:SIZE"
                    var iconParts = String(d.content.value).substring(5).split(':');
                    var weatherCode = parseInt(iconParts[0], 10) || 0;
                    var iconSize = iconParts.length > 1 ? parseInt(iconParts[1], 10) : 0;
                    ctx.save();
                    ctx.fillStyle = bg;
                    ctx.fillRect(ix, iy, iw, ih);
                    if (iconSize > 0 && iconSize < iw && iconSize < ih) {
                        // Center the icon at the requested pixel size
                        var ox = ix + Math.round((iw - iconSize) / 2);
                        var oy = iy + Math.round((ih - iconSize) / 2);
                        drawWeatherIconPreview(ctx, weatherCode, ox, oy, iconSize, iconSize, col);
                    } else {
                        drawWeatherIconPreview(ctx, weatherCode, ix, iy, iw, ih, col);
                    }
                    ctx.restore();
                } else if (d.type === 'text' && d.content) {
                    // Draw text matching firmware's drawAligned() algorithm
                    var content = d.content;
                    var gfx = getGfxMetrics(content.family, content.size, content.bold);
                    var weight = content.bold ? 'bold ' : '';
                    var cfFont = CANVAS_FONT[content.family] || 'CrispSans';

                    // Fill inner area with background (occludes overlapping complications)
                    ctx.fillStyle = bg;
                    ctx.fillRect(ix, iy, iw, ih);

                    // Set font — use actual FreeFonts via @font-face, gfx.th as font-size
                    ctx.font = weight + gfx.th + 'px ' + cfFont;
                    ctx.fillStyle = col;
                    ctx.textBaseline = 'alphabetic';

                    // Measure ascent from browser using the actual FreeFont
                    // (accurate since it's the same font the firmware uses)
                    var metrics = ctx.measureText('Ay');
                    var ascent = Math.round(metrics.actualBoundingBoxAscent);
                    var lineH = gfx.th + 2; // firmware: th + 2

                    // Clip to inner bounds
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(ix, iy, iw, ih);
                    ctx.clip();

                    // Split on newlines (firmware doesn't word-wrap)
                    var text = String(content.value || '');
                    var lines = text.split('\n');
                    var curY = iy + ascent; // firmware: curY = by + ascent
                    var align = content.align || 'left';

                    for (var li = 0; li < lines.length; li++) {
                        if (curY - ascent >= iy + ih) break;
                        var lineText = lines[li];

                        // Day divider: \x04 renders as ornamental ———◆——— line
                        if (lineText.charCodeAt(0) === 4 && lineText.length <= 1) {
                            var divW = Math.min(iw, 120);
                            var dlx = ix + Math.round((iw - divW) / 2);
                            var dly = curY - ascent + 1;
                            var dcx = dlx + Math.round(divW / 2);
                            var dcy = dly + 1;
                            // Diamond
                            ctx.fillRect(dcx, dly, 1, 1);
                            ctx.fillRect(dcx - 1, dcy, 3, 1);
                            ctx.fillRect(dcx, dly + 2, 1, 1);
                            // Lines either side
                            if (dcx - 4 >= dlx)
                                ctx.fillRect(dlx, dcy, dcx - 4 - dlx + 1, 1);
                            if (dcx + 4 <= dlx + divW - 1)
                                ctx.fillRect(dcx + 4, dcy, dlx + divW - 1 - (dcx + 4) + 1, 1);
                            curY += 7;
                            continue;
                        }

                        // Bold marker: \x03 prefix means render this line in bold
                        var lineBold = false;
                        if (lineText.charCodeAt(0) === 3) { lineBold = true; lineText = lineText.substring(1); }

                        var circleType = 0; // 0=none, 1=filled, 2=open
                        if (lineText.charCodeAt(0) === 1) { circleType = 1; lineText = lineText.substring(1).trimStart(); }
                        else if (lineText.charCodeAt(0) === 2) { circleType = 2; lineText = lineText.substring(1).trimStart(); }

                        // Switch font weight for bold-marked lines
                        var lineWeight = (content.bold || lineBold) ? 'bold ' : weight;
                        ctx.font = lineWeight + gfx.th + 'px ' + cfFont;

                        var circleW = 0;
                        if (circleType) {
                            var cr = Math.round(ascent / 4);
                            circleW = cr * 2 + 3;
                        }

                        var lineW = ctx.measureText(lineText).width;
                        var curX;
                        if (align === 'center') {
                            curX = ix + Math.round((iw - lineW - circleW) / 2);
                        } else if (align === 'right') {
                            curX = ix + iw - Math.ceil(lineW) - circleW;
                        } else {
                            curX = ix;
                        }

                        if (circleType) {
                            var cr = Math.round(ascent / 4);
                            var cy = curY - Math.round(ascent / 2);
                            var cx = curX + cr;
                            ctx.beginPath();
                            ctx.arc(cx, cy, cr, 0, Math.PI * 2);
                            if (circleType === 1) ctx.fill(); else ctx.stroke();
                            curX += circleW;
                        }
                        ctx.fillText(lineText, curX, curY);
                        curY += lineH;
                    }
                    // Restore base font after line loop
                    ctx.font = weight + gfx.th + 'px ' + cfFont;
                    ctx.restore();
                }
            });
        });

        // Load existing complications
        loadFace(CF.faceData);

        window.CRISPFACE.canvas = canvas;

        // Re-render once web fonts are loaded (first render may use fallback)
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () { canvas.renderAll(); });
        }

        // Start live polling for complications with sources
        startLivePolling();
    }

    // Enforce canvas bounds (uses outer complication bounds including border+padding)
    function enforceBounds(obj) {
        var inset = obj.crispfaceData ? getInset(obj.crispfaceData) : 0;
        var padLeft = obj.crispfaceData ? (obj.crispfaceData.padding_left || 0) : 0;
        var padTop = obj.crispfaceData ? (obj.crispfaceData.padding_top || 0) : 0;
        var totalL = inset + padLeft;
        var totalT = inset + padTop;
        var fabricW = Math.round(obj.width * (obj.scaleX || 1));
        var outerH = obj.crispfaceData ? obj.crispfaceData.h : Math.round(obj.height * (obj.scaleY || 1));

        if (obj.left - totalL < 0) obj.set('left', totalL);
        if (obj.top - totalT < 0) obj.set('top', totalT);
        if (obj.left + fabricW + inset > 200) obj.set('left', Math.max(totalL, 200 - fabricW - inset));
        if (obj.top - totalT + outerH > 200) obj.set('top', Math.max(totalT, 200 - outerH + totalT));
    }

    // Get crispface data from currently selected object (returns outer bounds)
    function getSelectedComplication() {
        var obj = canvas.getActiveObject();
        if (!obj || !obj.crispfaceData) return null;
        var inset = getInset(obj.crispfaceData);
        var padLeft = obj.crispfaceData.padding_left || 0;
        var padTop = obj.crispfaceData.padding_top || 0;
        return {
            object: obj,
            data: obj.crispfaceData,
            left: Math.round(obj.left) - inset - padLeft,
            top: Math.round(obj.top) - inset - padTop,
            width: Math.round(obj.width * (obj.scaleX || 1)) + inset * 2 + padLeft,
            height: obj.crispfaceData.h
        };
    }

    // Create a text complication on canvas
    function createTextComplication(data) {
        var content = migrateContent(data.content || {});
        var currentBg = CF.faceData.background;
        var fgName = currentBg === 'black' ? 'white' : 'black';

        var compH = data.h || 40;
        var inset = (data.border_width || 0) > 0 ? (data.border_width || 0) + (data.border_padding || 0) : 0;
        var padLeft = data.padding_left || 0;
        var padTop = data.padding_top || 0;
        var innerW = Math.max((data.w || 80) - inset * 2 - padLeft, 1);
        var innerH = Math.max(compH - inset * 2 - padTop, 1);

        var rect = new fabric.Rect({
            left: (data.x || 10) + inset + padLeft,
            top: (data.y || 10) + inset + padTop,
            width: innerW,
            height: innerH,
            fill: 'transparent',
            stroke: 'transparent',
            lockRotation: true,
            hasRotatingPoint: false,
            cornerStyle: 'rect',
            cornerSize: 6,
            transparentCorners: false,
            cornerColor: '#FF7F4F',
            borderColor: '#FF7F4F',
            borderScaleFactor: 1
        });

        rect.crispfaceData = {
            complication_id: data.complication_id || ('comp_' + nextCompId++),
            complication_type: data.complication_type || '',
            type: 'text',
            h: compH,
            refresh_interval: data.refresh_interval || (data.params && data.params.refresh ? parseInt(data.params.refresh, 10) : 30),
            source: content.source || '',
            params: data.params || {},
            border_width: data.border_width || 0,
            border_radius: data.border_radius || 0,
            border_padding: data.border_padding || 0,
            padding_top: padTop,
            padding_left: padLeft,
            content: {
                value: content.value || 'Text',
                family: content.family || 'sans-serif',
                size: content.size || 12,
                bold: !!content.bold,
                italic: !!content.italic,
                align: content.align || 'left',
                color: fgName
            }
        };

        canvas.add(rect);
        canvas.setActiveObject(rect);
        canvas.requestRenderAll();

        return rect;
    }

    // Load face data onto canvas
    function loadFace(faceData) {
        canvas.clear();
        canvas.backgroundColor = faceData.background === 'white' ? '#ffffff' : '#000000';

        var complications = faceData.complications || [];
        for (var i = 0; i < complications.length; i++) {
            var c = complications[i];
            if (c.type === 'text') {
                createTextComplication(c);
            }
        }

        canvas.discardActiveObject();
        canvas.requestRenderAll();
    }

    // Populate left sidebar fields from face data
    function populateSidebar(face) {
        document.getElementById('face-name').value = face.name || '';
        var bgSelect = document.getElementById('face-background');
        bgSelect.value = face.background || 'black';

        updateRefreshList(face);
    }

    // Format minutes into human-readable interval
    function formatInterval(mins) {
        if (mins <= 0) return 'never';
        if (mins < 60) return mins + 'min';
        if (mins < 1440) return Math.round(mins / 60) + 'hr';
        return Math.round(mins / 1440) + 'd';
    }

    // Rebuild refresh list from live canvas objects
    function refreshSidebarIntervals() {
        var objects = canvas.getObjects();
        var comps = [];
        for (var i = 0; i < objects.length; i++) {
            var d = objects[i].crispfaceData;
            if (!d) continue;
            comps.push(d);
        }
        updateRefreshList({ complications: comps });
    }

    // Show each complication's refresh interval in the sidebar
    function updateRefreshList(face) {
        var listEl = document.getElementById('face-refresh-list');
        if (!listEl) return;
        var complications = face.complications || [];
        var LOCAL_TYPES = { time: true, date: true, battery: true, version: true };

        var items = [];
        for (var i = 0; i < complications.length; i++) {
            var c = complications[i];
            var cType = c.complication_type || c.complication_id || '';
            var isLocal = LOCAL_TYPES[cType] || false;
            var name = cType || c.complication_id || 'comp ' + (i + 1);
            if (isLocal) {
                items.push({ name: name, freq: 'local' });
            } else if (!c.content || !c.content.source || cType === 'text') {
                items.push({ name: name, freq: 'static' });
            } else {
                items.push({ name: name, freq: formatInterval(c.refresh_interval || 30) });
            }
        }

        if (items.length === 0) {
            listEl.innerHTML = '<span class="no-selection">No complications</span>';
            return;
        }

        var html = '<table class="refresh-table">';
        for (var j = 0; j < items.length; j++) {
            html += '<tr><td>' + CF.escHtml(items[j].name) + '</td>' +
                '<td>' + items[j].freq + '</td></tr>';
        }
        html += '</table>';
        listEl.innerHTML = html;
    }

    // Load face list as thumbnail cards in the sidebar
    function loadFaceCards(currentId) {
        var listEl = document.getElementById('face-card-list');
        if (!listEl) return;

        var urlParams = new URLSearchParams(window.location.search);
        var watchParam = urlParams.get('watch') || '';

        var facesPromise;
        if (watchParam) {
            // Fetch watch face_ids and all faces, then filter/order
            facesPromise = Promise.all([
                CF.api('GET', '/api/watch.py?id=' + watchParam),
                CF.api('GET', '/api/faces.py')
            ]).then(function (results) {
                var watchResp = results[0];
                var facesResp = results[1];
                var allFaces = facesResp.success ? facesResp.faces : [];
                if (!watchResp.success || !watchResp.watch || !watchResp.watch.face_ids) {
                    return allFaces;
                }
                var ids = watchResp.watch.face_ids;
                var faceMap = {};
                for (var i = 0; i < allFaces.length; i++) {
                    faceMap[allFaces[i].id] = allFaces[i];
                }
                var ordered = [];
                for (var j = 0; j < ids.length; j++) {
                    if (faceMap[ids[j]]) ordered.push(faceMap[ids[j]]);
                }
                return ordered.length > 0 ? ordered : allFaces;
            });
        } else {
            facesPromise = CF.api('GET', '/api/faces.py').then(function (resp) {
                return resp.success ? resp.faces : [];
            });
        }

        facesPromise.then(function (faces) {
            listEl.innerHTML = '';
            if (faces.length === 0) {
                listEl.innerHTML = '<div class="no-selection">No faces</div>';
                return;
            }

            for (var i = 0; i < faces.length; i++) {
                var face = faces[i];
                var card = document.createElement('div');
                card.className = 'face-card' + (face.id === currentId ? ' face-card-active' : '');
                card.setAttribute('data-face-id', face.id);
                card.setAttribute('draggable', 'true');

                var cvs = document.createElement('canvas');
                cvs.className = 'face-card-canvas';
                cvs.width = 200;
                cvs.height = 200;
                card.appendChild(cvs);

                var nameDiv = document.createElement('div');
                nameDiv.className = 'face-card-name';
                nameDiv.textContent = face.name || face.id;
                card.appendChild(nameDiv);

                listEl.appendChild(card);

                // Click handler for switching
                (function (faceId) {
                    card.addEventListener('click', function () {
                        if (faceId === CF.faceId) return;
                        switchToFace(faceId);
                    });
                })(face.id);
            }

            // Render previews after fonts are ready
            document.fonts.ready.then(function () {
                var cards = listEl.querySelectorAll('.face-card');
                for (var i = 0; i < cards.length; i++) {
                    var faceId = cards[i].getAttribute('data-face-id');
                    var faceData = null;
                    for (var j = 0; j < faces.length; j++) {
                        if (faces[j].id === faceId) { faceData = faces[j]; break; }
                    }
                    if (faceData) {
                        var cvs = cards[i].querySelector('.face-card-canvas');
                        renderFacePreview(cvs.getContext('2d'), faceData);
                    }
                }
            });

            // Enable drag-and-drop reordering
            initFaceCardDragDrop(listEl);
        }).catch(function () {
            listEl.innerHTML = '<div class="no-selection">Failed to load faces</div>';
        });
    }

    // Switch to a different face without page reload
    function switchToFace(faceId) {
        CF.api('GET', '/api/face.py?id=' + faceId).then(function (resp) {
            if (!resp.success || !resp.face) return;

            stopAllPolling();
            CF.faceId = resp.face.id;
            CF.faceData = resp.face;
            loadFace(resp.face);
            populateSidebar(resp.face);
            startLivePolling();

            // Update active card highlight
            var cards = document.querySelectorAll('#face-card-list .face-card');
            for (var i = 0; i < cards.length; i++) {
                cards[i].classList.toggle('face-card-active', cards[i].getAttribute('data-face-id') === faceId);
            }

            // Update URL without reload
            var params = new URLSearchParams(window.location.search);
            params.set('id', faceId);
            history.replaceState(null, '', '?' + params.toString());

            // Update title
            document.title = 'Edit: ' + (resp.face.name || faceId) + ' - CrispFace';
        });
    }

    // Update the current face's thumbnail card after save
    function refreshCurrentCardPreview() {
        var card = document.querySelector('#face-card-list .face-card[data-face-id="' + CF.faceId + '"]');
        if (!card) return;
        var cvs = card.querySelector('.face-card-canvas');
        if (!cvs) return;
        var data = serializeFace();
        renderFacePreview(cvs.getContext('2d'), data);
        var nameEl = card.querySelector('.face-card-name');
        if (nameEl) nameEl.textContent = data.name || CF.faceId;
    }

    // Drag-and-drop reordering for face cards with FLIP animation
    function initFaceCardDragDrop(container) {
        var cards = container.querySelectorAll('.face-card');
        if (cards.length < 2) return;

        var dragSrc = null;
        var didDrag = false;

        // FLIP: snapshot positions before DOM move
        function snapshotPositions(exclude) {
            var items = container.querySelectorAll('.face-card');
            var rects = {};
            for (var i = 0; i < items.length; i++) {
                if (items[i] !== exclude) {
                    rects[items[i].getAttribute('data-face-id')] = items[i].getBoundingClientRect();
                }
            }
            return rects;
        }

        // FLIP: animate from old positions to new
        function playFlip(before) {
            var items = container.querySelectorAll('.face-card');
            for (var i = 0; i < items.length; i++) {
                var el = items[i];
                var id = el.getAttribute('data-face-id');
                if (!before[id]) continue;
                var after = el.getBoundingClientRect();
                var dx = before[id].left - after.left;
                var dy = before[id].top - after.top;
                if (dx === 0 && dy === 0) continue;
                el.style.transition = 'none';
                el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
                el.offsetHeight; // force reflow
                el.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
                el.style.transform = '';
            }
        }

        for (var i = 0; i < cards.length; i++) {
            (function (card) {
                card.addEventListener('dragstart', function (e) {
                    dragSrc = card;
                    didDrag = false;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', '');
                    setTimeout(function () { card.classList.add('dragging'); }, 0);
                });

                card.addEventListener('dragend', function () {
                    card.classList.remove('dragging');
                    if (dragSrc && didDrag) {
                        saveFaceCardOrder();
                    }
                    // Block click from firing after drag
                    if (didDrag) {
                        card.addEventListener('click', function suppress(e) {
                            e.stopImmediatePropagation();
                            card.removeEventListener('click', suppress, true);
                        }, true);
                    }
                    dragSrc = null;
                });

                card.addEventListener('dragover', function (e) {
                    if (!dragSrc || dragSrc === card) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';

                    var rect = card.getBoundingClientRect();
                    var midY = rect.top + rect.height / 2;
                    var insertBefore = e.clientY < midY ? card : card.nextSibling;

                    // Only move if position actually changes
                    if (insertBefore === dragSrc || insertBefore === dragSrc.nextSibling) return;

                    didDrag = true;
                    var rects = snapshotPositions(dragSrc);
                    container.insertBefore(dragSrc, insertBefore);
                    playFlip(rects);
                });

                card.addEventListener('drop', function (e) {
                    e.preventDefault();
                });
            })(cards[i]);
        }
    }

    // Persist face card order after drag
    function saveFaceCardOrder() {
        var container = document.getElementById('face-card-list');
        if (!container) return;
        var cards = container.querySelectorAll('.face-card[data-face-id]');
        var newOrder = [];
        for (var i = 0; i < cards.length; i++) {
            newOrder.push(cards[i].getAttribute('data-face-id'));
        }

        var urlParams = new URLSearchParams(window.location.search);
        var watchParam = urlParams.get('watch') || '';

        if (watchParam) {
            // Watch-scoped: save face_ids order to the watch
            CF.api('POST', '/api/watch.py?id=' + watchParam, { face_ids: newOrder });
        } else {
            // No watch: update sort_order on each face
            for (var j = 0; j < newOrder.length; j++) {
                CF.api('POST', '/api/face.py?id=' + newOrder[j], { sort_order: j });
            }
        }
    }

    // Serialize canvas to spec-format JSON
    function serializeFace() {
        var objects = canvas.getObjects();
        var complications = [];

        for (var i = 0; i < objects.length; i++) {
            var obj = objects[i];
            if (!obj.crispfaceData) continue;

            var d = obj.crispfaceData;
            var contentOut = {
                value: d.content.value,
                family: d.content.family,
                size: d.content.size,
                bold: d.content.bold,
                italic: d.content.italic,
                align: d.content.align,
                color: d.content.color
            };
            if (d.source) contentOut.source = d.source;

            var inset = getInset(d);
            var padLeft = d.padding_left || 0;
            var padTop = d.padding_top || 0;
            var comp = {
                complication_id: d.complication_id,
                complication_type: d.complication_type || '',
                type: d.type,
                x: Math.round(obj.left) - inset - padLeft,
                y: Math.round(obj.top) - inset - padTop,
                w: Math.round(obj.width * (obj.scaleX || 1)) + inset * 2 + padLeft,
                h: d.h,
                refresh_interval: d.refresh_interval || 30,
                border_width: d.border_width || 0,
                border_radius: d.border_radius || 0,
                border_padding: d.border_padding || 0,
                padding_top: padTop,
                padding_left: padLeft,
                content: contentOut,
                sort_order: i
            };
            if (d.params && Object.keys(d.params).length > 0) {
                comp.params = d.params;
            }
            complications.push(comp);
        }

        return {
            id: CF.faceId,
            name: document.getElementById('face-name').value,
            background: document.getElementById('face-background').value,
            complications: complications
        };
    }

    // Save face via API
    function saveFace() {
        var data = serializeFace();
        var statusEl = document.getElementById('save-status');
        statusEl.textContent = 'Saving...';
        statusEl.style.color = '#757575';

        CF.api('POST', '/api/face.py?id=' + CF.faceId, data)
            .then(function (resp) {
                if (resp.success) {
                    statusEl.textContent = 'Saved';
                    statusEl.style.color = '#43A047';
                    setTimeout(function () { statusEl.textContent = ''; }, 2000);
                    refreshCurrentCardPreview();
                } else {
                    statusEl.textContent = 'Error: ' + (resp.error || 'Unknown');
                    statusEl.style.color = '#E53935';
                }
            })
            .catch(function () {
                statusEl.textContent = 'Network error';
                statusEl.style.color = '#E53935';
            });
    }

    // Background color sync — also invert all complication text colors
    function syncBackground() {
        var bg = document.getElementById('face-background').value;
        var fgName = bg === 'white' ? 'black' : 'white';

        canvas.backgroundColor = bg === 'white' ? '#ffffff' : '#000000';

        var objects = canvas.getObjects();
        for (var i = 0; i < objects.length; i++) {
            var obj = objects[i];
            if (obj.crispfaceData && obj.crispfaceData.type === 'text') {
                obj.crispfaceData.content.color = fgName;
                obj.dirty = true;
            }
        }

        // Update the property panel if something is selected
        var active = canvas.getActiveObject();
        if (active && active.crispfaceData) {
            window.dispatchEvent(new CustomEvent('crispface:select', { detail: getSelectedComplication() }));
        }

        canvas.renderAll();
    }

    // ---- Live polling for complication sources ----
    function startLivePolling() {
        var objects = canvas.getObjects();
        for (var i = 0; i < objects.length; i++) {
            var obj = objects[i];
            if (obj.crispfaceData && obj.crispfaceData.source) {
                pollSource(obj);
            }
        }
    }

    function pollSource(obj) {
        var url = obj.crispfaceData.source;
        // Make relative URLs absolute against our base
        if (url.charAt(0) === '/') {
            // already absolute path
        } else if (url.indexOf('http') !== 0) {
            url = CF.baseUrl + '/' + url;
        }
        // Append params as query string
        var params = obj.crispfaceData.params;
        if (params && Object.keys(params).length > 0) {
            var qs = [];
            var keys = Object.keys(params);
            for (var i = 0; i < keys.length; i++) {
                qs.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(params[keys[i]]));
            }
            url += (url.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
        }
        var interval = (obj.crispfaceData.refresh_interval || 30) * 60000;

        function poll() {
            fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                if (data.value !== undefined) {
                    obj.crispfaceData.content.value = String(data.value);
                    obj.dirty = true;
                    canvas.renderAll();
                }
            }).catch(function () {});
        }

        poll(); // immediate first fetch
        obj._pollTimer = setInterval(poll, interval);
    }

    // Re-poll a single object: clear existing timer and restart
    function repollSource(obj) {
        if (!obj || !obj.crispfaceData) return;
        if (obj._pollTimer) {
            clearInterval(obj._pollTimer);
            obj._pollTimer = null;
        }
        if (obj.crispfaceData.source) {
            pollSource(obj);
        }
    }

    function stopAllPolling() {
        if (!canvas) return;
        var objects = canvas.getObjects();
        for (var i = 0; i < objects.length; i++) {
            if (objects[i]._pollTimer) {
                clearInterval(objects[i]._pollTimer);
                objects[i]._pollTimer = null;
            }
        }
    }

    // ---- Simulation mode ----
    var simulating = false;
    var simElements = null; // DOM elements created during simulation
    var allFaces = null; // loaded face list for navigation
    var currentFaceIndex = -1;

    function enterSimulation() {
        simulating = true;
        canvas.discardActiveObject();
        canvas.selection = false;
        canvas.forEachObject(function (obj) {
            obj.selectable = false;
            obj.evented = false;
        });
        canvas.renderAll();
        document.body.classList.add('simulating');

        // Load face list for navigation — scoped to watch if ?watch= param or localStorage
        var urlParams = new URLSearchParams(window.location.search);
        var watchParam = urlParams.get('watch') || localStorage.getItem('crispface_current_watch');

        var facesPromise;
        if (watchParam) {
            facesPromise = CF.api('GET', '/api/watch.py?id=' + watchParam).then(function (resp) {
                if (!resp.success || !resp.watch || !resp.watch.face_ids || resp.watch.face_ids.length === 0) {
                    // Fall back to all faces
                    return CF.api('GET', '/api/faces.py').then(function (r) {
                        return r.success ? r.faces : [];
                    });
                }
                // Build face list in watch order by fetching each face
                var ids = resp.watch.face_ids;
                var promises = [];
                for (var i = 0; i < ids.length; i++) {
                    promises.push(CF.api('GET', '/api/face.py?id=' + ids[i]));
                }
                return Promise.all(promises).then(function (results) {
                    var faces = [];
                    for (var j = 0; j < results.length; j++) {
                        if (results[j].success && results[j].face) {
                            faces.push(results[j].face);
                        }
                    }
                    return faces;
                });
            });
        } else {
            facesPromise = CF.api('GET', '/api/faces.py').then(function (resp) {
                return resp.success ? resp.faces : [];
            });
        }

        facesPromise.then(function (faces) {
            allFaces = faces;
            for (var i = 0; i < allFaces.length; i++) {
                if (allFaces[i].id === CF.faceId) {
                    currentFaceIndex = i;
                    break;
                }
            }
        });

        buildWatchBody();
    }

    function exitSimulation() {
        simulating = false;

        // Move canvas container back to wrapper before removing watch body
        var wrapper = document.querySelector('.canvas-container-wrapper');
        var canvasContainer = canvas.wrapperEl;
        if (canvasContainer && wrapper) {
            wrapper.insertBefore(canvasContainer, wrapper.firstChild);
        }

        // If we navigated to a different face, reload the original
        var params = new URLSearchParams(window.location.search);
        var originalId = params.get('id');
        if (originalId && originalId !== CF.faceId) {
            CF.api('GET', '/api/face.py?id=' + originalId).then(function (resp) {
                if (resp.success && resp.face) {
                    stopAllPolling();
                    CF.faceId = resp.face.id;
                    CF.faceData = resp.face;
                    populateSidebar(resp.face);
                    loadFace(resp.face);
                    startLivePolling();
                }
            });
        }

        canvas.selection = true;
        canvas.forEachObject(function (obj) {
            obj.selectable = true;
            obj.evented = true;
        });
        canvas.renderAll();
        document.body.classList.remove('simulating');

        if (simElements) {
            if (simElements.watchBody) simElements.watchBody.remove();
            if (simElements.exitBtn) simElements.exitBtn.remove();
            simElements = null;
        }
    }

    function buildWatchBody() {
        simElements = {};

        // Wrap the canvas in a watch body
        var wrapper = document.querySelector('.canvas-container-wrapper');
        var watchBody = document.createElement('div');
        watchBody.className = 'sim-watch';

        var body = document.createElement('div');
        body.className = 'sim-watch-body';

        // Move canvas container into watch body
        var canvasContainer = wrapper.querySelector('.canvas-container') || canvas.wrapperEl;
        body.appendChild(canvasContainer);

        // Buttons: Back (top-left), Menu (bottom-left), Up (top-right), Down (bottom-right)
        var buttons = [
            { name: 'back', label: 'Back', action: 'back' },
            { name: 'menu', label: 'Menu', action: 'menu' },
            { name: 'up', label: 'Up', action: 'up' },
            { name: 'down', label: 'Down', action: 'down' }
        ];

        for (var i = 0; i < buttons.length; i++) {
            var btn = document.createElement('button');
            btn.className = 'sim-btn sim-btn-' + buttons[i].name;
            btn.setAttribute('data-action', buttons[i].action);
            body.appendChild(btn);

            var lbl = document.createElement('span');
            lbl.className = 'sim-btn-label';
            lbl.textContent = buttons[i].label;
            body.appendChild(lbl);
        }

        // Face name
        var faceName = document.createElement('div');
        faceName.className = 'sim-face-name';
        faceName.id = 'sim-face-name';
        faceName.textContent = CF.faceData.name || '';
        body.appendChild(faceName);

        watchBody.appendChild(body);
        wrapper.appendChild(watchBody);
        simElements.watchBody = watchBody;

        // Exit button
        var exitBtn = document.createElement('button');
        exitBtn.className = 'sim-exit';
        exitBtn.textContent = 'Exit Simulation';
        exitBtn.addEventListener('click', exitSimulation);
        document.body.appendChild(exitBtn);
        simElements.exitBtn = exitBtn;

        // Bind button interactions
        bindSimButtons(body);
    }

    function bindSimButtons(body) {
        var btns = body.querySelectorAll('.sim-btn');
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                var pressTimer = null;
                var tapCount = 0;
                var tapTimer = null;
                var longFired = false;
                var action = btn.getAttribute('data-action');

                btn.addEventListener('mousedown', function () {
                    longFired = false;
                    pressTimer = setTimeout(function () {
                        longFired = true;
                        handleButton(action, 'long');
                    }, 600);
                });

                btn.addEventListener('mouseup', function () {
                    clearTimeout(pressTimer);
                    if (longFired) return;
                    tapCount++;
                    clearTimeout(tapTimer);
                    tapTimer = setTimeout(function () {
                        if (tapCount >= 2) {
                            handleButton(action, 'double');
                        } else {
                            handleButton(action, 'tap');
                        }
                        tapCount = 0;
                    }, 250);
                });

                btn.addEventListener('mouseleave', function () {
                    clearTimeout(pressTimer);
                });
            })(btns[i]);
        }
    }

    function handleButton(action, gesture) {
        if (action === 'up' && gesture === 'tap') {
            navigateFace(-1);
        } else if (action === 'down' && gesture === 'tap') {
            navigateFace(1);
        } else if (action === 'menu' && gesture === 'tap') {
            // Force refresh all data sources
            stopAllPolling();
            startLivePolling();
            flashButton('Refreshed');
        } else if (action === 'menu' && gesture === 'long') {
            exitSimulation();
        }
        // Back + double taps reserved for future use
    }

    function navigateFace(direction) {
        if (!allFaces || allFaces.length < 2) return;
        currentFaceIndex += direction;
        if (currentFaceIndex < 0) currentFaceIndex = allFaces.length - 1;
        if (currentFaceIndex >= allFaces.length) currentFaceIndex = 0;

        var nextFace = allFaces[currentFaceIndex];

        // Load the new face
        CF.api('GET', '/api/face.py?id=' + nextFace.id).then(function (resp) {
            if (!resp.success || !resp.face) return;
            stopAllPolling();
            CF.faceId = resp.face.id;
            CF.faceData = resp.face;
            loadFace(resp.face);
            // Re-disable selection for simulation
            canvas.forEachObject(function (obj) {
                obj.selectable = false;
                obj.evented = false;
            });
            startLivePolling();
            var nameEl = document.getElementById('sim-face-name');
            if (nameEl) nameEl.textContent = resp.face.name;
        });
    }

    function flashButton(msg) {
        var nameEl = document.getElementById('sim-face-name');
        if (!nameEl) return;
        var orig = nameEl.textContent;
        nameEl.textContent = msg;
        setTimeout(function () { nameEl.textContent = orig; }, 1000);
    }

    // Load complication types and populate the dropdown
    function loadComplicationTypes() {
        var select = document.getElementById('comp-type-select');
        if (!select) return;
        CF.api('GET', '/api/complications.py').then(function (data) {
            if (!data.success) return;
            CF.complicationTypes = data.types;
            select.innerHTML = '';
            for (var i = 0; i < data.types.length; i++) {
                var opt = document.createElement('option');
                opt.value = data.types[i].id;
                opt.textContent = data.types[i].name;
                select.appendChild(opt);
            }
        });
    }

    // Find a loaded complication type by ID
    function findType(typeId) {
        var types = CF.complicationTypes || [];
        for (var i = 0; i < types.length; i++) {
            if (types[i].id === typeId) return types[i];
        }
        return null;
    }

    // Toolbar bindings
    function bindToolbar() {
        document.getElementById('btn-add-comp').addEventListener('click', function () {
            var select = document.getElementById('comp-type-select');
            var typeId = select.value;
            var ctype = findType(typeId);

            var params = {};
            var source = '';
            if (ctype && ctype.script) {
                source = '/crispface/api/sources/' + ctype.script;
                var vars = ctype.variables || [];
                for (var i = 0; i < vars.length; i++) {
                    params[vars[i].name] = vars[i].default || '';
                }
            }

            var newObj = createTextComplication({
                complication_type: typeId || '',
                x: 10,
                y: 10,
                w: 80,
                params: params,
                content: {
                    value: ctype ? ctype.name : 'Text',
                    source: source,
                    family: 'sans-serif',
                    size: 12,
                    bold: false,
                    italic: false,
                    align: 'left'
                }
            });
            // Start polling immediately for sourced complications
            if (source && newObj.crispfaceData) {
                pollSource(newObj);
            }
            refreshSidebarIntervals();
        });

        document.getElementById('btn-delete').addEventListener('click', function () {
            var active = canvas.getActiveObject();
            if (active) {
                if (active._pollTimer) clearInterval(active._pollTimer);
                canvas.remove(active);
                canvas.discardActiveObject();
                canvas.requestRenderAll();
                window.dispatchEvent(new CustomEvent('crispface:deselect'));
                refreshSidebarIntervals();
            }
        });

        document.getElementById('btn-save').addEventListener('click', saveFace);

        document.getElementById('btn-simulate').addEventListener('click', function () {
            if (simulating) exitSimulation();
            else enterSimulation();
        });

        document.getElementById('face-background').addEventListener('change', syncBackground);

        // Keyboard shortcuts
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
                var active = canvas.getActiveObject();
                if (active) {
                    if (active._pollTimer) clearInterval(active._pollTimer);
                    canvas.remove(active);
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                    window.dispatchEvent(new CustomEvent('crispface:deselect'));
                    refreshSidebarIntervals();
                    e.preventDefault();
                }
            }
            if (e.key === 'Escape' && simulating) {
                exitSimulation();
                e.preventDefault();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveFace();
            }
        });
    }

    // Init: fetch face from API, then set up canvas
    document.addEventListener('DOMContentLoaded', function () {
        // Check auth first
        CF.requireAuth(function () {
            // Get face ID from URL
            var params = new URLSearchParams(window.location.search);
            var faceId = params.get('id');

            if (!faceId) {
                window.location.href = CF.baseUrl + '/faces.html';
                return;
            }

            CF.faceId = faceId;

            // Fetch face data from API
            CF.api('GET', '/api/face.py?id=' + faceId).then(function (resp) {
                if (!resp.success || !resp.face) {
                    alert('Face not found');
                    window.location.href = CF.baseUrl + '/faces.html';
                    return;
                }

                CF.faceData = resp.face;
                document.title = 'Edit: ' + resp.face.name + ' - CrispFace';

                populateSidebar(resp.face);
                initCanvas();
                bindToolbar();
                loadComplicationTypes();
                loadFaceCards(faceId);

                // Face settings cog toggle
                var fsToggle = document.getElementById('face-settings-toggle');
                var fsBody = document.getElementById('face-settings-body');
                if (fsToggle && fsBody) {
                    fsToggle.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var open = fsBody.style.display !== 'none';
                        fsBody.style.display = open ? 'none' : '';
                        fsToggle.classList.toggle('face-settings-open', !open);
                    });
                    // Close panel when clicking outside
                    document.addEventListener('click', function (e) {
                        if (fsBody.style.display !== 'none' && !fsBody.contains(e.target) && e.target !== fsToggle) {
                            fsBody.style.display = 'none';
                            fsToggle.classList.remove('face-settings-open');
                        }
                    });
                }

                // Expose for properties.js and debugging
                window.CRISPFACE.canvas = canvas;
                window.CRISPFACE.createTextComplication = createTextComplication;
                window.CRISPFACE.serializeFace = serializeFace;
                window.CRISPFACE.syncBackground = syncBackground;
                window.CRISPFACE.findType = findType;
                window.CRISPFACE.repollSource = repollSource;
                window.CRISPFACE.refreshSidebarIntervals = refreshSidebarIntervals;
            }).catch(function () {
                alert('Failed to load face');
                window.location.href = CF.baseUrl + '/faces.html';
            });
        });
    });
})();
