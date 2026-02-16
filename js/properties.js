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

    function alignOptionsHtml(selected) {
        var html = '';
        var aligns = CF.ALIGNS;
        for (var i = 0; i < aligns.length; i++) {
            var sel = aligns[i] === selected ? ' selected' : '';
            html += '<option value="' + aligns[i] + '"' + sel + '>' + aligns[i].charAt(0).toUpperCase() + aligns[i].slice(1) + '</option>';
        }
        return html;
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
        html += '<input type="number" id="prop-x" value="' + detail.left + '" min="0" max="199" /></div>';
        html += '<div class="prop-row"><label for="prop-y">Y</label>';
        html += '<input type="number" id="prop-y" value="' + detail.top + '" min="0" max="199" /></div>';
        html += '</div>';

        // Size
        html += '<div class="prop-row-inline">';
        html += '<div class="prop-row"><label for="prop-w">Width</label>';
        html += '<input type="number" id="prop-w" value="' + detail.width + '" min="1" max="200" /></div>';
        html += '<div class="prop-row"><label for="prop-h">Height</label>';
        html += '<input type="number" id="prop-h" value="' + detail.height + '" min="1" max="200" /></div>';
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
                    if (v.type === 'select' && v.options) {
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
                        html += '<input type="text" id="prop-var-' + escHtml(v.name) + '" data-var-name="' + escHtml(v.name) + '" class="prop-var-input" value="' + escHtml(currentVal) + '" /></div>';
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

            // Align + Color
            html += '<div class="prop-row-inline">';
            html += '<div class="prop-row"><label for="prop-align">Align</label>';
            html += '<select id="prop-align">' + alignOptionsHtml(content.align || 'left') + '</select></div>';
            html += '<div class="prop-row"><label for="prop-color">Color</label>';
            html += '<select id="prop-color">';
            html += '<option value="white"' + (content.color === 'white' ? ' selected' : '') + '>White</option>';
            html += '<option value="black"' + (content.color === 'black' ? ' selected' : '') + '>Black</option>';
            html += '</select></div>';
            html += '</div>';
        }

        // Border (all complications)
        var bw = d.border_width || 0;
        var br = d.border_radius || 0;
        var bp = d.border_padding || 0;
        html += '<div class="prop-section-label">Border</div>';
        html += '<div class="prop-row-inline">';
        html += '<div class="prop-row"><label for="prop-border-width">Width</label>';
        html += '<input type="number" id="prop-border-width" value="' + bw + '" min="0" max="5" /></div>';
        html += '<div class="prop-row"><label for="prop-border-radius">Radius</label>';
        html += '<input type="number" id="prop-border-radius" value="' + br + '" min="0" max="20" /></div>';
        html += '</div>';
        html += '<div class="prop-row" id="prop-padding-row"' + (bw > 0 ? '' : ' style="display:none"') + '>';
        html += '<label for="prop-border-padding">Padding</label>';
        html += '<input type="number" id="prop-border-padding" value="' + bp + '" min="0" max="20" /></div>';

        // Advanced section — only show fields relevant to this type
        var hasAdvanced = !local; // local types only need ID, which is usually not edited
        if (hasAdvanced || !local) {
            html += '<div class="prop-advanced-toggle" id="prop-advanced-toggle">Advanced</div>';
            html += '<div class="prop-advanced" id="prop-advanced">';

            // ID (all complications)
            html += '<div class="prop-row"><label for="prop-id">ID</label>';
            html += '<input type="text" id="prop-id" value="' + escHtml(d.complication_id) + '" /></div>';

            if (!local && d.type === 'text') {
                // Source (server complications only)
                html += '<div class="prop-row"><label for="prop-source">Source</label>';
                html += '<input type="text" id="prop-source" value="' + escHtml(d.source || '') + '" placeholder="e.g. /crispface/api/sources/weather.py" /></div>';

                // Needs refresh + refresh interval (server complications only)
                var staleEnabled = d.stale_enabled !== false;
                html += '<div class="prop-row"><label for="prop-stale-enabled">Needs refresh</label>';
                html += '<input type="checkbox" id="prop-stale-enabled"' + (staleEnabled ? ' checked' : '') + ' /></div>';

                html += '<div class="prop-row" id="prop-stale-row"' + (staleEnabled ? '' : ' style="display:none"') + '><label for="prop-stale">Refresh after</label>';
                html += '<input type="number" id="prop-stale" value="' + (d.stale_seconds || 60) + '" min="1" /></div>';
            }

            html += '</div>'; // end .prop-advanced
        }

        panel.innerHTML = html;
        bindPropertyInputs(ctype, local);

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

        // Position (property shows outer bounds, Fabric object is inset)
        bindInput('prop-x', function (val) {
            var inset = gi(currentObject.crispfaceData);
            updateObject(currentObject, { left: (parseInt(val, 10) || 0) + inset });
        });
        bindInput('prop-y', function (val) {
            var inset = gi(currentObject.crispfaceData);
            updateObject(currentObject, { top: (parseInt(val, 10) || 0) + inset });
        });
        bindInput('prop-w', function (val) {
            var inset = gi(currentObject.crispfaceData);
            var outerW = parseInt(val, 10) || 1;
            updateObject(currentObject, { width: Math.max(outerW - inset * 2, 1), scaleX: 1 });
        });

        // Snap alignment buttons (use outer bounds)
        bindClick('snap-left', function () {
            var inset = gi(currentObject.crispfaceData);
            updateObject(currentObject, { left: inset });
            updatePropInput('prop-x', 0);
        });
        bindClick('snap-center', function () {
            var inset = gi(currentObject.crispfaceData);
            var outerW = Math.round(currentObject.width * (currentObject.scaleX || 1)) + inset * 2;
            var outerX = Math.round((200 - outerW) / 2);
            updateObject(currentObject, { left: outerX + inset });
            updatePropInput('prop-x', outerX);
        });
        bindClick('snap-right', function () {
            var inset = gi(currentObject.crispfaceData);
            var outerW = Math.round(currentObject.width * (currentObject.scaleX || 1)) + inset * 2;
            var outerX = 200 - outerW;
            updateObject(currentObject, { left: outerX + inset });
            updatePropInput('prop-x', outerX);
        });
        bindInput('prop-h', function (val) {
            if (currentObject.crispfaceData) {
                var inset = gi(currentObject.crispfaceData);
                var outerH = parseInt(val, 10) || 40;
                currentObject.crispfaceData.h = outerH;
                updateObject(currentObject, { height: Math.max(outerH - inset * 2, 1) });
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
                        // For "text" type, the text variable IS the display value
                        if (compTypeId === 'text' && varName === 'text') {
                            currentObject.crispfaceData.content.value = val;
                            updateObject(currentObject, { text: val });
                        }
                    };
                    if (isCheckbox || isSelect) {
                        input.addEventListener('change', handler);
                    } else {
                        input.addEventListener('input', handler);
                        input.addEventListener('change', handler);
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
                updateObject(currentObject, { text: val });
            }
        });

        // Font family
        bindInput('prop-family', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.family = val;
                updateObject(currentObject, { fontFamily: val });
            }
        });

        // Font size
        bindInput('prop-size', function (val) {
            if (currentObject.crispfaceData) {
                var stored = parseInt(val, 10);
                var displayMap = CF.DISPLAY_SIZE_MAP || {};
                var display = displayMap[stored] || stored;
                currentObject.crispfaceData.content.size = stored;
                updateObject(currentObject, { fontSize: display });
            }
        });

        // Bold
        bindCheckbox('prop-bold', function (checked) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.bold = checked;
                updateObject(currentObject, { fontWeight: checked ? 'bold' : 'normal' });
            }
        });

        // Italic
        bindCheckbox('prop-italic', function (checked) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.italic = checked;
                updateObject(currentObject, { fontStyle: checked ? 'italic' : 'normal' });
            }
        });

        // Align
        bindInput('prop-align', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.align = val;
                updateObject(currentObject, { textAlign: val });
            }
        });

        // Color
        bindInput('prop-color', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.content.color = val;
                updateObject(currentObject, { fill: val === 'white' ? '#ffffff' : '#000000' });
            }
        });

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
                updateObject(currentObject, {
                    left: currentObject.left + delta,
                    top: currentObject.top + delta,
                    width: Math.max(currentObject.width - delta * 2, 1),
                    height: Math.max(currentObject.crispfaceData.h - newInset * 2, 1)
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
                    height: Math.max(currentObject.crispfaceData.h - newInset * 2, 1)
                });
            }
        });

        // Can expire toggle
        bindCheckbox('prop-stale-enabled', function (checked) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.stale_enabled = checked;
                var row = document.getElementById('prop-stale-row');
                if (row) row.style.display = checked ? '' : 'none';
            }
        });

        // Stale (only bound if element exists — not present for local)
        bindInput('prop-stale', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.stale_seconds = parseInt(val, 10) || 60;
            }
        });
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
