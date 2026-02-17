(function () {
    'use strict';

    var CF = window.CRISPFACE;
    var panel = document.getElementById('props-panel');
    var currentObject = null;

    var LOCAL_TYPES = ['time', 'date', 'battery'];

    function isLocal(d) {
        return LOCAL_TYPES.indexOf(d.complication_type) >= 0
            || LOCAL_TYPES.indexOf(d.complication_id) >= 0;
    }

    function updateObject(obj, props) {
        var canvas = CF.canvas;
        obj.set(props);
        obj.dirty = true;
        obj.setCoords();
        canvas.renderAll();
    }

    function familyOptionsHtml(selected) {
        var html = '';
        var families = CF.FONT_FAMILIES;
        for (var i = 0; i < families.length; i++) {
            var sel = families[i].value === selected ? ' selected' : '';
            html += '<option value="' + families[i].value + '"' + sel + '>' + families[i].label + '</option>';
        }
        return html;
    }

    function sizeOptionsHtml(selected) {
        var html = '';
        var sizes = CF.FONT_SIZES;
        for (var i = 0; i < sizes.length; i++) {
            var sel = sizes[i].value === selected ? ' selected' : '';
            html += '<option value="' + sizes[i].value + '"' + sel + '>' + sizes[i].label + '</option>';
        }
        return html;
    }

    function stepperHtml(id, value, min, max) {
        return '<div class="stepper">' +
            '<button type="button" class="stepper-btn stepper-dec" data-for="' + id + '">\u2212</button>' +
            '<input type="number" id="' + id + '" value="' + value + '"' +
            (min !== undefined ? ' min="' + min + '"' : '') +
            (max !== undefined ? ' max="' + max + '"' : '') + ' />' +
            '<button type="button" class="stepper-btn stepper-inc" data-for="' + id + '">+</button>' +
            '</div>';
    }

    function showProperties(detail) {
        if (!detail || !detail.data) {
            clearProperties();
            return;
        }

        currentObject = detail.object;
        var d = detail.data;
        var content = d.content || {};
        var local = isLocal(d);

        var findType = CF.findType;
        var ctype = d.complication_type && findType ? findType(d.complication_type) : null;

        var html = '';

        // Complication name header
        var compName = ctype ? ctype.name : (d.complication_type || d.complication_id || 'Complication');
        html += '<div class="prop-comp-name">' + escHtml(compName) + '</div>';

        // Position
        html += '<div class="prop-row-inline">';
        html += '<div class="prop-row"><label for="prop-x">X</label>';
        html += stepperHtml('prop-x', detail.left, 0, 199) + '</div>';
        html += '<div class="prop-row"><label for="prop-y">Y</label>';
        html += stepperHtml('prop-y', detail.top, 0, 199) + '</div>';
        html += '</div>';

        // Size
        html += '<div class="prop-row-inline">';
        html += '<div class="prop-row"><label for="prop-w">Width</label>';
        html += stepperHtml('prop-w', detail.width, 1, 200) + '</div>';
        html += '<div class="prop-row"><label for="prop-h">Height</label>';
        html += stepperHtml('prop-h', detail.height, 1, 200) + '</div>';
        html += '</div>';

        // Snap alignment
        html += '<div class="prop-row prop-snap-row"><label>Snap</label>';
        html += '<div class="prop-snap-buttons">';
        html += '<button type="button" class="prop-snap-btn" id="snap-left" title="Align left">Left</button>';
        html += '<button type="button" class="prop-snap-btn" id="snap-center" title="Center horizontally">Centre</button>';
        html += '<button type="button" class="prop-snap-btn" id="snap-right" title="Align right">Right</button>';
        html += '</div></div>';

        if (d.type === 'text') {
            // Variables — for complications with typed variables
            if (ctype && ctype.variables && ctype.variables.length > 0) {
                var params = d.params || {};
                var vars = ctype.variables;
                html += '<div class="prop-section-label">Variables</div>';
                for (var vi = 0; vi < vars.length; vi++) {
                    var v = vars[vi];
                    var currentVal = params[v.name] !== undefined ? params[v.name] : (v.default || '');
                    html += '<div class="prop-row"><label for="prop-var-' + escHtml(v.name) + '">' + escHtml(v.label) + '</label>';
                    if (v.type === 'feeds') {
                        var feedsList = [];
                        try { feedsList = JSON.parse(currentVal || '[]'); } catch (e) { feedsList = []; }
                        html += '<div class="prop-feed-list" id="prop-feed-list" data-var-name="' + escHtml(v.name) + '">';
                        for (var fi = 0; fi < feedsList.length; fi++) {
                            html += '<div class="prop-feed-item" data-feed-idx="' + fi + '">';
                            html += '<span class="prop-feed-name">' + escHtml(feedsList[fi].name || 'Unnamed') + '</span>';
                            if (feedsList[fi].bold) html += '<span class="prop-feed-bold-badge">BOLD</span>';
                            html += '<button type="button" class="prop-feed-edit btn btn-sm btn-secondary" data-feed-idx="' + fi + '">Edit</button>';
                            html += '<button type="button" class="prop-feed-delete btn btn-sm btn-danger" data-feed-idx="' + fi + '">Del</button>';
                            html += '</div>';
                        }
                        html += '<button type="button" class="prop-feed-add btn btn-sm btn-primary" id="prop-feed-add">+ Add Calendar</button>';
                        html += '</div></div>';
                    } else if (v.type === 'select' && v.options) {
                        var opts = v.options.split(',');
                        html += '<select id="prop-var-' + escHtml(v.name) + '" data-var-name="' + escHtml(v.name) + '" class="prop-var-input prop-var-select">';
                        for (var oi = 0; oi < opts.length; oi++) {
                            var optVal = opts[oi].trim();
                            html += '<option value="' + escHtml(optVal) + '"' + (currentVal === optVal ? ' selected' : '') + '>' + escHtml(optVal.charAt(0).toUpperCase() + optVal.slice(1)) + '</option>';
                        }
                        html += '</select></div>';
                    } else if (v.type === 'checkbox') {
                        html += '<input type="checkbox" id="prop-var-' + escHtml(v.name) + '" data-var-name="' + escHtml(v.name) + '" class="prop-var-input prop-var-checkbox"' + (currentVal === 'true' ? ' checked' : '') + ' /></div>';
                    } else {
                        html += '<input type="text" id="prop-var-' + escHtml(v.name) + '" data-var-name="' + escHtml(v.name) + '" class="prop-var-input" value="' + escHtml(currentVal) + '" />';
                        // Town verification status for uk-weather
                        if (d.complication_type === 'uk-weather' && v.name === 'town') {
                            html += '<span class="prop-town-status" id="prop-town-status"></span>';
                        }
                        html += '</div>';
                    }
                }
            } else if (!local && !ctype) {
                // Fallback: raw params field (only for untyped server complications)
                var paramsStr = '';
                if (d.params) {
                    var keys = Object.keys(d.params);
                    var pairs = [];
                    for (var p = 0; p < keys.length; p++) {
                        pairs.push(keys[p] + '=' + d.params[keys[p]]);
                    }
                    paramsStr = pairs.join('&');
                }
                html += '<div class="prop-row"><label for="prop-params">Params</label>';
                html += '<input type="text" id="prop-params" value="' + escHtml(paramsStr) + '" placeholder="e.g. city=derby" /></div>';
            }

            // Preview value — hide for "text" type since the variable IS the preview
            var isTextType = d.complication_type === 'text';
            if (!isTextType) {
                html += '<div class="prop-row"><label for="prop-value">Preview</label>';
                html += '<input type="text" id="prop-value" value="' + escHtml(content.value || '') + '" /></div>';
            }

            // Font family + size
            html += '<div class="prop-section-label">Text Style</div>';
            html += '<div class="prop-row-inline">';
            html += '<div class="prop-row"><label for="prop-family">Font</label>';
            html += '<select id="prop-family">' + familyOptionsHtml(content.family || 'sans-serif') + '</select></div>';
            html += '<div class="prop-row"><label for="prop-size">Size</label>';
            html += '<select id="prop-size">' + sizeOptionsHtml(content.size || 12) + '</select></div>';
            html += '</div>';

            // Bold + Italic
            html += '<div class="prop-row-inline">';
            html += '<div class="prop-row"><label for="prop-bold">Bold</label>';
            html += '<input type="checkbox" id="prop-bold"' + (content.bold ? ' checked' : '') + ' /></div>';
            html += '<div class="prop-row"><label for="prop-italic">Italic</label>';
            html += '<input type="checkbox" id="prop-italic"' + (content.italic ? ' checked' : '') + ' /></div>';
            html += '</div>';

            // Align (button group)
            var curAlign = content.align || 'left';
            html += '<div class="prop-row prop-snap-row"><label>Align</label>';
            html += '<div class="prop-snap-buttons">';
            html += '<button type="button" class="prop-snap-btn prop-align-btn' + (curAlign === 'left' ? ' active' : '') + '" data-align="left">Left</button>';
            html += '<button type="button" class="prop-snap-btn prop-align-btn' + (curAlign === 'center' ? ' active' : '') + '" data-align="center">Centre</button>';
            html += '<button type="button" class="prop-snap-btn prop-align-btn' + (curAlign === 'right' ? ' active' : '') + '" data-align="right">Right</button>';
            html += '</div></div>';
        }

        // Border (all complications)
        var bw = d.border_width || 0;
        var br = d.border_radius || 0;
        var bp = d.border_padding || 0;
        html += '<div class="prop-section-label">Border</div>';
        html += '<div class="prop-row-inline">';
        html += '<div class="prop-row"><label for="prop-border-width">Width</label>';
        html += stepperHtml('prop-border-width', bw, 0, 5) + '</div>';
        html += '<div class="prop-row"><label for="prop-border-radius">Radius</label>';
        html += stepperHtml('prop-border-radius', br, 0, 20) + '</div>';
        html += '</div>';
        html += '<div class="prop-row" id="prop-padding-row"' + (bw > 0 ? '' : ' style="display:none"') + '>';
        html += '<label for="prop-border-padding">Inset</label>';
        html += stepperHtml('prop-border-padding', bp, 0, 20) + '</div>';

        // Text padding (only visible when border is set)
        var pt = d.padding_top || 0;
        var pl = d.padding_left || 0;
        html += '<div id="prop-padding-section"' + (bw > 0 ? '' : ' style="display:none"') + '>';
        html += '<div class="prop-section-label">Padding</div>';
        html += '<div class="prop-row-inline">';
        html += '<div class="prop-row"><label for="prop-pad-top">Top</label>';
        html += stepperHtml('prop-pad-top', pt, 0, 50) + '</div>';
        html += '<div class="prop-row"><label for="prop-pad-left">Left</label>';
        html += stepperHtml('prop-pad-left', pl, 0, 50) + '</div>';
        html += '</div>';
        html += '</div>';

        // Advanced section — only show fields relevant to this type
        var hasAdvanced = !local; // local types only need ID, which is usually not edited
        if (hasAdvanced || !local) {
            html += '<div class="prop-advanced-toggle" id="prop-advanced-toggle">Advanced</div>';
            html += '<div class="prop-advanced" id="prop-advanced">';

            // ID (all complications)
            html += '<div class="prop-row"><label for="prop-id">ID</label>';
            html += '<input type="text" id="prop-id" value="' + escHtml(d.complication_id) + '" /></div>';

            if (!local && d.source) {
                // Source (read-only info for data-driven complications)
                html += '<div class="prop-row"><label for="prop-source">Source</label>';
                html += '<input type="text" id="prop-source" value="' + escHtml(d.source) + '" /></div>';
            }

            html += '</div>'; // end .prop-advanced
        }

        panel.innerHTML = html;
        bindPropertyInputs(ctype, local);
        bindSteppers();
        bindFeeds(ctype);

        // Advanced toggle
        var toggle = document.getElementById('prop-advanced-toggle');
        var advanced = document.getElementById('prop-advanced');
        if (toggle && advanced) {
            toggle.addEventListener('click', function () {
                var open = toggle.classList.contains('prop-advanced-open');
                advanced.style.display = open ? 'none' : 'block';
                toggle.classList.toggle('prop-advanced-open', !open);
            });
        }
    }

    function clearProperties() {
        currentObject = null;
        panel.innerHTML = '<div class="no-selection">Select a complication to edit its properties</div>';
    }

    function bindPropertyInputs(ctype, local) {
        var gi = CF.getInset || function () { return 0; };

        function getPadLeft() {
            return currentObject.crispfaceData ? (currentObject.crispfaceData.padding_left || 0) : 0;
        }
        function getPadTop() {
            return currentObject.crispfaceData ? (currentObject.crispfaceData.padding_top || 0) : 0;
        }

        // Position (property shows outer bounds, Fabric object is inset + padded)
        bindInput('prop-x', function (val) {
            var inset = gi(currentObject.crispfaceData);
            updateObject(currentObject, { left: (parseInt(val, 10) || 0) + inset + getPadLeft() });
        });
        bindInput('prop-y', function (val) {
            var inset = gi(currentObject.crispfaceData);
            updateObject(currentObject, { top: (parseInt(val, 10) || 0) + inset + getPadTop() });
        });
        bindInput('prop-w', function (val) {
            var inset = gi(currentObject.crispfaceData);
            var outerW = parseInt(val, 10) || 1;
            updateObject(currentObject, { width: Math.max(outerW - inset * 2 - getPadLeft(), 1), scaleX: 1 });
        });

        // Snap alignment buttons (use outer bounds)
        bindClick('snap-left', function () {
            var inset = gi(currentObject.crispfaceData);
            updateObject(currentObject, { left: inset + getPadLeft() });
            updatePropInput('prop-x', 0);
        });
        bindClick('snap-center', function () {
            var inset = gi(currentObject.crispfaceData);
            var outerW = Math.round(currentObject.width * (currentObject.scaleX || 1)) + inset * 2 + getPadLeft();
            var outerX = Math.round((200 - outerW) / 2);
            updateObject(currentObject, { left: outerX + inset + getPadLeft() });
            updatePropInput('prop-x', outerX);
        });
        bindClick('snap-right', function () {
            var inset = gi(currentObject.crispfaceData);
            var outerW = Math.round(currentObject.width * (currentObject.scaleX || 1)) + inset * 2 + getPadLeft();
            var outerX = 200 - outerW;
            updateObject(currentObject, { left: outerX + inset + getPadLeft() });
            updatePropInput('prop-x', outerX);
        });
        bindInput('prop-h', function (val) {
            if (currentObject.crispfaceData) {
                var inset = gi(currentObject.crispfaceData);
                var outerH = parseInt(val, 10) || 40;
                currentObject.crispfaceData.h = outerH;
                updateObject(currentObject, { height: Math.max(outerH - inset * 2 - getPadTop(), 1) });
            }
        });

        // ID
        bindInput('prop-id', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.complication_id = val;
            }
        });

        // Source (only bound if element exists — not present for local)
        bindInput('prop-source', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.source = val;
            }
        });

        // Variable inputs (typed complications)
        var _repollTimer = null;
        if (ctype && ctype.variables && ctype.variables.length > 0) {
            var compTypeId = currentObject.crispfaceData ? currentObject.crispfaceData.complication_type : '';
            var varInputs = panel.querySelectorAll('.prop-var-input');
            for (var i = 0; i < varInputs.length; i++) {
                (function (input) {
                    var varName = input.getAttribute('data-var-name');
                    var isCheckbox = input.classList.contains('prop-var-checkbox');
                    var isSelect = input.classList.contains('prop-var-select');
                    var handler = function () {
                        if (!currentObject || !currentObject.crispfaceData) return;
                        if (!currentObject.crispfaceData.params) {
                            currentObject.crispfaceData.params = {};
                        }
                        var val = isCheckbox ? (input.checked ? 'true' : 'false') : input.value;
                        currentObject.crispfaceData.params[varName] = val;
                        // Sync refresh variable to refresh_interval
                        if (varName === 'refresh') {
                            currentObject.crispfaceData.refresh_interval = parseInt(val, 10) || 30;
                        }
                        // For "text" type, the text variable IS the display value
                        if (compTypeId === 'text' && varName === 'text') {
                            currentObject.crispfaceData.content.value = val;
                            currentObject.dirty = true;
                            CF.canvas.renderAll();
                        }
                        // Re-poll source to refresh preview with new params
                        if (CF.repollSource && currentObject.crispfaceData.source) {
                            if (_repollTimer) clearTimeout(_repollTimer);
                            // Immediate for selects, debounced for text inputs
                            var delay = isSelect ? 0 : 800;
                            _repollTimer = setTimeout(function () {
                                CF.repollSource(currentObject);
                            }, delay);
                        }
                    };
                    if (isCheckbox || isSelect) {
                        input.addEventListener('change', handler);
                    } else {
                        input.addEventListener('input', handler);
                        input.addEventListener('change', handler);
                    }

                    // Town verification for uk-weather
                    if (compTypeId === 'uk-weather' && varName === 'town') {
                        (function (inp) {
                            var verify = function () {
                                var val = inp.value.trim();
                                var status = document.getElementById('prop-town-status');
                                if (!status || !val) { if (status) status.textContent = ''; return; }
                                var xhr = new XMLHttpRequest();
                                xhr.open('GET', '/crispface/api/sources/uk_town_lookup.py?q=' + encodeURIComponent(val));
                                xhr.onload = function () {
                                    if (!document.getElementById('prop-town-status')) return;
                                    try {
                                        var data = JSON.parse(xhr.responseText);
                                        var exact = null;
                                        for (var mi = 0; mi < (data.matches || []).length; mi++) {
                                            if (data.matches[mi].name.toLowerCase() === val.toLowerCase()) {
                                                exact = data.matches[mi];
                                                break;
                                            }
                                        }
                                        if (exact) {
                                            status.textContent = exact.name + ', ' + exact.county;
                                            status.style.color = '#43A047';
                                        } else {
                                            status.textContent = 'Not found';
                                            status.style.color = '#E53935';
                                        }
                                    } catch (e) {
                                        status.textContent = 'Error';
                                        status.style.color = '#E53935';
                                    }
                                };
                                xhr.onerror = function () {
                                    var s = document.getElementById('prop-town-status');
                                    if (s) { s.textContent = 'Error'; s.style.color = '#E53935'; }
                                };
                                xhr.send();
                            };
                            inp.addEventListener('blur', verify);
                            // Verify on initial render
                            if (inp.value.trim()) verify();
                        })(input);
                    }
                })(varInputs[i]);
            }
        } else if (!local) {
            // Params (key=value format)
            bindInput('prop-params', function (val) {
                if (currentObject.crispfaceData) {
                    var params = {};
                    if (val.trim()) {
                        var pairs = val.split('&');
                        for (var i = 0; i < pairs.length; i++) {
                            var kv = pairs[i].split('=', 2);
                            if (kv[0].trim()) {
                                params[kv[0].trim()] = (kv[1] || '').trim();
                            }
                        }
                    }
                    currentObject.crispfaceData.params = params;
                }
            });
        }

        // Preview value
        bindInput('prop-value', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.value = val;
                currentObject.dirty = true;
                CF.canvas.renderAll();
            }
        });

        // Font family
        bindInput('prop-family', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.family = val;
                currentObject.dirty = true;
                CF.canvas.renderAll();
            }
        });

        // Font size
        bindInput('prop-size', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.size = parseInt(val, 10);
                currentObject.dirty = true;
                CF.canvas.renderAll();
            }
        });

        // Bold
        bindCheckbox('prop-bold', function (checked) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.bold = checked;
                currentObject.dirty = true;
                CF.canvas.renderAll();
            }
        });

        // Italic
        bindCheckbox('prop-italic', function (checked) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.italic = checked;
                currentObject.dirty = true;
                CF.canvas.renderAll();
            }
        });

        // Align buttons
        var alignBtns = panel.querySelectorAll('.prop-align-btn');
        for (var ai = 0; ai < alignBtns.length; ai++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    if (!currentObject || !currentObject.crispfaceData) return;
                    var val = btn.getAttribute('data-align');
                    currentObject.crispfaceData.content.align = val;
                    currentObject.dirty = true;
                    CF.canvas.renderAll();
                    // Update active state
                    var all = panel.querySelectorAll('.prop-align-btn');
                    for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
                    btn.classList.add('active');
                });
            })(alignBtns[ai]);
        }

        // Border width — reposition Fabric object to keep outer bounds stable
        bindInput('prop-border-width', function (val) {
            if (currentObject.crispfaceData) {
                var oldInset = gi(currentObject.crispfaceData);
                var bw = parseInt(val, 10) || 0;
                currentObject.crispfaceData.border_width = bw;
                var newInset = gi(currentObject.crispfaceData);
                var delta = newInset - oldInset;
                var paddingRow = document.getElementById('prop-padding-row');
                if (paddingRow) paddingRow.style.display = bw > 0 ? '' : 'none';
                var paddingSection = document.getElementById('prop-padding-section');
                if (paddingSection) paddingSection.style.display = bw > 0 ? '' : 'none';
                updateObject(currentObject, {
                    left: currentObject.left + delta,
                    top: currentObject.top + delta,
                    width: Math.max(currentObject.width - delta * 2, 1),
                    height: Math.max(currentObject.crispfaceData.h - newInset * 2 - getPadTop(), 1)
                });
            }
        });

        // Border radius
        bindInput('prop-border-radius', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.border_radius = parseInt(val, 10) || 0;
                CF.canvas.renderAll();
            }
        });

        // Border padding — reposition Fabric object to keep outer bounds stable
        bindInput('prop-border-padding', function (val) {
            if (currentObject.crispfaceData) {
                var oldInset = gi(currentObject.crispfaceData);
                currentObject.crispfaceData.border_padding = parseInt(val, 10) || 0;
                var newInset = gi(currentObject.crispfaceData);
                var delta = newInset - oldInset;
                updateObject(currentObject, {
                    left: currentObject.left + delta,
                    top: currentObject.top + delta,
                    width: Math.max(currentObject.width - delta * 2, 1),
                    height: Math.max(currentObject.crispfaceData.h - newInset * 2 - getPadTop(), 1)
                });
            }
        });

        // Text padding top
        bindInput('prop-pad-top', function (val) {
            if (currentObject.crispfaceData) {
                var oldPad = currentObject.crispfaceData.padding_top || 0;
                var newPad = parseInt(val, 10) || 0;
                currentObject.crispfaceData.padding_top = newPad;
                var delta = newPad - oldPad;
                updateObject(currentObject, {
                    top: currentObject.top + delta,
                    height: Math.max(currentObject.height - delta, 1)
                });
            }
        });

        // Text padding left
        bindInput('prop-pad-left', function (val) {
            if (currentObject.crispfaceData) {
                var oldPad = currentObject.crispfaceData.padding_left || 0;
                var newPad = parseInt(val, 10) || 0;
                currentObject.crispfaceData.padding_left = newPad;
                var delta = newPad - oldPad;
                updateObject(currentObject, {
                    left: currentObject.left + delta,
                    width: Math.max(currentObject.width - delta, 1)
                });
            }
        });

    }

    function bindFeeds(ctype) {
        var feedList = document.getElementById('prop-feed-list');
        if (!feedList) return;
        var varName = feedList.getAttribute('data-var-name');

        function getFeeds() {
            if (!currentObject || !currentObject.crispfaceData) return [];
            var params = currentObject.crispfaceData.params || {};
            try { return JSON.parse(params[varName] || '[]'); } catch (e) { return []; }
        }

        function saveFeeds(feeds) {
            if (!currentObject || !currentObject.crispfaceData) return;
            if (!currentObject.crispfaceData.params) currentObject.crispfaceData.params = {};
            currentObject.crispfaceData.params[varName] = JSON.stringify(feeds);
            // Re-render properties to update the list
            if (CF.repollSource && currentObject.crispfaceData.source) {
                CF.repollSource(currentObject);
            }
            // Re-fire selection to refresh the properties panel
            if (currentObject) {
                var d = currentObject.crispfaceData;
                var gi = CF.getInset || function () { return 0; };
                var inset = gi(d);
                var padLeft = d.padding_left || 0;
                var padTop = d.padding_top || 0;
                showProperties({
                    object: currentObject,
                    data: d,
                    left: Math.round(currentObject.left) - inset - padLeft,
                    top: Math.round(currentObject.top) - inset - padTop,
                    width: Math.round(currentObject.width * (currentObject.scaleX || 1)) + inset * 2 + padLeft,
                    height: d.h
                });
            }
        }

        function showModal(feed, onSave) {
            var existing = document.getElementById('prop-feed-modal');
            if (existing) existing.remove();

            var overlay = document.createElement('div');
            overlay.className = 'prop-feed-modal';
            overlay.id = 'prop-feed-modal';

            var card = document.createElement('div');
            card.className = 'prop-feed-modal-inner';
            card.innerHTML =
                '<h4>' + (feed ? 'Edit Calendar' : 'Add Calendar') + '</h4>' +
                '<div class="form-group"><label for="feed-name">Name</label>' +
                '<input type="text" id="feed-name" value="' + escHtml(feed ? feed.name : '') + '" placeholder="e.g. Work" /></div>' +
                '<div class="form-group"><label for="feed-url">Feed URL</label>' +
                '<input type="text" id="feed-url" value="' + escHtml(feed ? feed.url : '') + '" placeholder="https://..." /></div>' +
                '<div class="form-group"><label><input type="checkbox" id="feed-bold"' + (feed && feed.bold ? ' checked' : '') + ' /> Bold (UPPERCASE events)</label></div>' +
                '<div class="prop-feed-modal-actions">' +
                '<button type="button" class="btn btn-primary" id="feed-save">Save</button>' +
                '<button type="button" class="btn btn-secondary" id="feed-cancel">Cancel</button>' +
                '</div>';

            overlay.appendChild(card);
            document.body.appendChild(overlay);

            // Focus name field
            document.getElementById('feed-name').focus();

            document.getElementById('feed-save').addEventListener('click', function () {
                var name = document.getElementById('feed-name').value.trim();
                var url = document.getElementById('feed-url').value.trim();
                var bold = document.getElementById('feed-bold').checked;
                if (!url) { document.getElementById('feed-url').focus(); return; }
                if (!name) name = 'Calendar';
                overlay.remove();
                onSave({ name: name, url: url, bold: bold });
            });

            document.getElementById('feed-cancel').addEventListener('click', function () {
                overlay.remove();
            });

            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) overlay.remove();
            });
        }

        // Add button
        var addBtn = document.getElementById('prop-feed-add');
        if (addBtn) {
            addBtn.addEventListener('click', function () {
                showModal(null, function (feed) {
                    var feeds = getFeeds();
                    feeds.push(feed);
                    saveFeeds(feeds);
                });
            });
        }

        // Edit buttons
        var editBtns = feedList.querySelectorAll('.prop-feed-edit');
        for (var i = 0; i < editBtns.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    var idx = parseInt(btn.getAttribute('data-feed-idx'), 10);
                    var feeds = getFeeds();
                    if (idx < 0 || idx >= feeds.length) return;
                    showModal(feeds[idx], function (updated) {
                        feeds[idx] = updated;
                        saveFeeds(feeds);
                    });
                });
            })(editBtns[i]);
        }

        // Delete buttons
        var delBtns = feedList.querySelectorAll('.prop-feed-delete');
        for (var j = 0; j < delBtns.length; j++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    var idx = parseInt(btn.getAttribute('data-feed-idx'), 10);
                    var feeds = getFeeds();
                    if (idx < 0 || idx >= feeds.length) return;
                    feeds.splice(idx, 1);
                    saveFeeds(feeds);
                });
            })(delBtns[j]);
        }
    }

    function bindSteppers() {
        var btns = panel.querySelectorAll('.stepper-btn');
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    var input = document.getElementById(btn.getAttribute('data-for'));
                    if (!input || !currentObject) return;
                    var val = parseInt(input.value, 10) || 0;
                    var step = btn.classList.contains('stepper-inc') ? 1 : -1;
                    var min = input.hasAttribute('min') ? parseInt(input.min, 10) : -Infinity;
                    var max = input.hasAttribute('max') ? parseInt(input.max, 10) : Infinity;
                    val += step;
                    if (val < min) val = min;
                    if (val > max) val = max;
                    input.value = val;
                    input.dispatchEvent(new Event('input'));
                });
            })(btns[i]);
        }
    }

    function bindInput(id, handler) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function () {
            if (!currentObject) return;
            handler(el.value);
        });
        el.addEventListener('change', function () {
            if (!currentObject) return;
            handler(el.value);
        });
    }

    function bindCheckbox(id, handler) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', function () {
            if (!currentObject) return;
            handler(el.checked);
        });
    }

    function bindClick(id, handler) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', function () {
            if (!currentObject) return;
            handler();
        });
    }

    function updatePropInput(id, val) {
        var el = document.getElementById(id);
        if (el) el.value = val;
    }

    function escHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // Listen for selection events from editor.js
    window.addEventListener('crispface:select', function (e) {
        showProperties(e.detail);
    });

    window.addEventListener('crispface:deselect', function () {
        clearProperties();
    });
})();
