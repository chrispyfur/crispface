(function () {
    'use strict';

    var CF = window.CRISPFACE;
    var canvas;
    var nextCompId = 1;

    var FONT_FAMILIES = [
        { value: 'sans-serif', label: 'Sans' },
        { value: 'serif', label: 'Serif' },
        { value: 'monospace', label: 'Mono' }
    ];

    // Stored values map to Adafruit GFX pt sizes on the watch.
    // Drop 8px from the dropdown (same as 12 on watch). Legacy 8 still renders.
    var FONT_SIZES = [
        { value: 12, label: 'Small (9pt)' },
        { value: 16, label: 'Medium (12pt)' },
        { value: 24, label: 'Large (18pt)' },
        { value: 48, label: 'X-Large (24pt)' },
        { value: 72, label: 'Huge (48pt)' }
    ];

    // Map stored editor px → GFX getTextBounds("Ay") height for FreeSans at that pt size.
    // Ensures editor text fills the same vertical space as on the watch.
    var DISPLAY_SIZE_MAP = { 8: 17, 12: 17, 16: 23, 24: 34, 48: 44, 72: 89 };

    var ALIGNS = ['left', 'center', 'right'];

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
                obj.crispfaceData.h = h + inset * 2; // store outer height
                if (obj.clipPath) {
                    obj.clipPath.set({ width: w, height: h });
                }
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

        // Draw complication borders after canvas render
        canvas.on('after:render', function () {
            var ctx = canvas.getContext('2d');
            canvas.getObjects().forEach(function (obj) {
                if (!obj.crispfaceData) return;
                var d = obj.crispfaceData;
                var bw = d.border_width || 0;
                if (bw <= 0) return;

                var br = d.border_radius || 0;
                var col = (d.content && d.content.color === 'white') ? '#ffffff' : '#000000';
                var ins = getInset(d);
                var x = Math.round(obj.left) - ins;
                var y = Math.round(obj.top) - ins;
                var w = Math.round(obj.width * (obj.scaleX || 1)) + ins * 2;
                var h = d.h || Math.round(obj.height * (obj.scaleY || 1));

                ctx.save();
                ctx.strokeStyle = col;
                ctx.lineWidth = bw;
                if (br > 0) {
                    var r = Math.min(br, w / 2, h / 2);
                    ctx.beginPath();
                    ctx.moveTo(x + r, y);
                    ctx.lineTo(x + w - r, y);
                    ctx.arcTo(x + w, y, x + w, y + r, r);
                    ctx.lineTo(x + w, y + h - r);
                    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
                    ctx.lineTo(x + r, y + h);
                    ctx.arcTo(x, y + h, x, y + h - r, r);
                    ctx.lineTo(x, y + r);
                    ctx.arcTo(x, y, x + r, y, r);
                    ctx.closePath();
                    ctx.stroke();
                } else {
                    ctx.strokeRect(x + bw / 2, y + bw / 2, w - bw, h - bw);
                }
                ctx.restore();
            });
        });

        // Load existing complications
        loadFace(CF.faceData);

        window.CRISPFACE.canvas = canvas;

        // Start live polling for complications with sources
        startLivePolling();
    }

    // Enforce canvas bounds (uses outer complication bounds including border+padding)
    function enforceBounds(obj) {
        var inset = obj.crispfaceData ? getInset(obj.crispfaceData) : 0;
        var fabricW = Math.round(obj.width * (obj.scaleX || 1));
        var outerH = obj.crispfaceData ? obj.crispfaceData.h : Math.round(obj.height * (obj.scaleY || 1));

        if (obj.left - inset < 0) obj.set('left', inset);
        if (obj.top - inset < 0) obj.set('top', inset);
        if (obj.left + fabricW + inset > 200) obj.set('left', Math.max(inset, 200 - fabricW - inset));
        if (obj.top - inset + outerH > 200) obj.set('top', Math.max(inset, 200 - outerH + inset));
    }

    // Get crispface data from currently selected object (returns outer bounds)
    function getSelectedComplication() {
        var obj = canvas.getActiveObject();
        if (!obj || !obj.crispfaceData) return null;
        var inset = getInset(obj.crispfaceData);
        return {
            object: obj,
            data: obj.crispfaceData,
            left: Math.round(obj.left) - inset,
            top: Math.round(obj.top) - inset,
            width: Math.round(obj.width * (obj.scaleX || 1)) + inset * 2,
            height: obj.crispfaceData.h
        };
    }

    // Create a text complication on canvas
    function createTextComplication(data) {
        var content = migrateContent(data.content || {});
        var currentBg = CF.faceData.background;
        // Always contrast with background
        var fgHex = currentBg === 'black' ? '#ffffff' : '#000000';
        var fgName = currentBg === 'black' ? 'white' : 'black';

        var fontWeight = content.bold ? 'bold' : 'normal';
        var fontStyle = content.italic ? 'italic' : 'normal';

        var storedSize = content.size || 12;
        var displaySize = DISPLAY_SIZE_MAP[storedSize] || storedSize;

        var compH = data.h || 40;
        var inset = (data.border_width || 0) > 0 ? (data.border_width || 0) + (data.border_padding || 0) : 0;
        var innerW = Math.max((data.w || 80) - inset * 2, 1);
        var innerH = Math.max(compH - inset * 2, 1);

        var text = new fabric.Textbox(content.value || 'Text', {
            left: (data.x || 10) + inset,
            top: (data.y || 10) + inset,
            width: innerW,
            height: innerH,
            fontSize: displaySize,
            fontFamily: content.family || 'sans-serif',
            fontWeight: fontWeight,
            fontStyle: fontStyle,
            fill: fgHex,
            textAlign: content.align || 'left',
            splitByGrapheme: true,
            editable: false,
            lockRotation: true,
            hasRotatingPoint: false,
            cornerStyle: 'rect',
            cornerSize: 6,
            transparentCorners: false,
            cornerColor: '#FF7F4F',
            borderColor: '#FF7F4F',
            borderScaleFactor: 1
        });

        text.crispfaceData = {
            complication_id: data.complication_id || ('comp_' + nextCompId++),
            complication_type: data.complication_type || '',
            type: 'text',
            h: compH,
            stale_seconds: data.stale_seconds || 60,
            stale_enabled: data.stale_enabled !== false,
            source: content.source || '',
            params: data.params || {},
            border_width: data.border_width || 0,
            border_radius: data.border_radius || 0,
            border_padding: data.border_padding || 0,
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

        // Clip text rendering to inner bounds (prevents overflow past padding)
        text.clipPath = new fabric.Rect({
            width: innerW,
            height: innerH,
            originX: 'center',
            originY: 'center'
        });

        // Override initDimensions so Fabric.js doesn't auto-recalculate height
        var origInitDimensions = text.initDimensions.bind(text);
        text.initDimensions = function () {
            origInitDimensions();
            var ins = getInset(this.crispfaceData);
            this.height = Math.max(this.crispfaceData.h - ins * 2, 1);
            // Keep clipPath in sync with inner dimensions
            if (this.clipPath) {
                this.clipPath.set({
                    width: Math.max(this.width, 1),
                    height: this.height
                });
            }
        };
        text.height = innerH;
        text.setCoords();

        canvas.add(text);
        canvas.setActiveObject(text);
        canvas.requestRenderAll();

        return text;
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

    // Format seconds into human-readable interval
    function formatInterval(seconds) {
        if (seconds <= 0) return 'never';
        if (seconds < 60) return seconds + 's';
        if (seconds < 3600) return Math.round(seconds / 60) + 'min';
        if (seconds < 86400) return Math.round(seconds / 3600) + 'hr';
        return Math.round(seconds / 86400) + 'd';
    }

    // Show each complication's refresh interval in the sidebar
    function updateRefreshList(face) {
        var listEl = document.getElementById('face-refresh-list');
        if (!listEl) return;
        var complications = face.complications || [];
        var LOCAL_TYPES = { time: true, date: true, battery: true };

        var items = [];
        for (var i = 0; i < complications.length; i++) {
            var c = complications[i];
            var cType = c.complication_type || c.complication_id || '';
            var isLocal = LOCAL_TYPES[cType] || false;
            var name = cType || c.complication_id || 'comp ' + (i + 1);
            if (isLocal) {
                items.push({ name: name, freq: 'local' });
            } else {
                var stale = c.stale_enabled !== false ? (c.stale_seconds || 60) : -1;
                items.push({ name: name, freq: stale > 0 ? formatInterval(stale) : 'never' });
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
            var comp = {
                complication_id: d.complication_id,
                complication_type: d.complication_type || '',
                type: d.type,
                x: Math.round(obj.left) - inset,
                y: Math.round(obj.top) - inset,
                w: Math.round(obj.width * (obj.scaleX || 1)) + inset * 2,
                h: d.h,
                stale_seconds: d.stale_seconds,
                stale_enabled: d.stale_enabled !== false,
                border_width: d.border_width || 0,
                border_radius: d.border_radius || 0,
                border_padding: d.border_padding || 0,
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
        var fgHex = bg === 'white' ? '#000000' : '#ffffff';
        var fgName = bg === 'white' ? 'black' : 'white';

        canvas.backgroundColor = bg === 'white' ? '#ffffff' : '#000000';

        var objects = canvas.getObjects();
        for (var i = 0; i < objects.length; i++) {
            var obj = objects[i];
            if (obj.crispfaceData && obj.crispfaceData.type === 'text') {
                obj.crispfaceData.content.color = fgName;
                obj.set({ fill: fgHex });
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
        var interval = (obj.crispfaceData.stale_seconds || 60) * 1000;

        function poll() {
            fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                if (data.value !== undefined) {
                    obj.crispfaceData.content.value = String(data.value);
                    obj.set({ text: String(data.value) });
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
            if (ctype) {
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
