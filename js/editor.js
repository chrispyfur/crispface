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
                        var circleType = 0; // 0=none, 1=filled, 2=open
                        if (lineText.charCodeAt(0) === 1) { circleType = 1; lineText = lineText.substring(1).trimStart(); }
                        else if (lineText.charCodeAt(0) === 2) { circleType = 2; lineText = lineText.substring(1).trimStart(); }

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
            } else if (!c.content || !c.content.source) {
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

    // Load face list and populate the face navigation dropdown
    function loadFaceDropdown(currentId) {
        var select = document.getElementById('face-select');
        if (!select) return;

        // Preserve watch param when navigating between faces
        var urlParams = new URLSearchParams(window.location.search);
        var watchParam = urlParams.get('watch') || '';

        CF.api('GET', '/api/faces.py').then(function (resp) {
            if (!resp.success || !resp.faces) {
                select.innerHTML = '<option>' + (CF.faceData.name || 'Current') + '</option>';
                return;
            }
            select.innerHTML = '';
            var faces = resp.faces;
            for (var i = 0; i < faces.length; i++) {
                var opt = document.createElement('option');
                opt.value = faces[i].id;
                opt.textContent = faces[i].name || faces[i].id;
                if (faces[i].id === currentId) opt.selected = true;
                select.appendChild(opt);
            }
        }).catch(function () {
            select.innerHTML = '<option>' + (CF.faceData.name || 'Current') + '</option>';
        });

        select.addEventListener('change', function () {
            var newId = select.value;
            if (newId && newId !== CF.faceId) {
                var url = CF.baseUrl + '/editor.html?id=' + newId;
                if (watchParam) url += '&watch=' + watchParam;
                window.location.href = url;
            }
        });
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

            createTextComplication({
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
        });

        document.getElementById('btn-delete').addEventListener('click', function () {
            var active = canvas.getActiveObject();
            if (active) {
                if (active._pollTimer) clearInterval(active._pollTimer);
                canvas.remove(active);
                canvas.discardActiveObject();
                canvas.requestRenderAll();
                window.dispatchEvent(new CustomEvent('crispface:deselect'));
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
                loadFaceDropdown(faceId);

                // Expose for properties.js and debugging
                window.CRISPFACE.canvas = canvas;
                window.CRISPFACE.createTextComplication = createTextComplication;
                window.CRISPFACE.serializeFace = serializeFace;
                window.CRISPFACE.syncBackground = syncBackground;
                window.CRISPFACE.findType = findType;
            }).catch(function () {
                alert('Failed to load face');
                window.location.href = CF.baseUrl + '/faces.html';
            });
        });
    });
})();
