(function () {
    'use strict';

    var CF = window.CRISPFACE;
    var panel = document.getElementById('props-panel');
    var currentObject = null;

    function updateObject(obj, props) {
        var canvas = CF.canvas;
        obj.set(props);
        obj.dirty = true;
        obj.setCoords();
        canvas.renderAll();
    }

    // Build font family options HTML
    function familyOptionsHtml(selected) {
        var html = '';
        var families = CF.FONT_FAMILIES;
        for (var i = 0; i < families.length; i++) {
            var sel = families[i].value === selected ? ' selected' : '';
            html += '<option value="' + families[i].value + '"' + sel + '>' + families[i].label + '</option>';
        }
        return html;
    }

    // Build font size options HTML
    function sizeOptionsHtml(selected) {
        var html = '';
        var sizes = CF.FONT_SIZES;
        for (var i = 0; i < sizes.length; i++) {
            var sel = sizes[i] === selected ? ' selected' : '';
            html += '<option value="' + sizes[i] + '"' + sel + '>' + sizes[i] + 'px</option>';
        }
        return html;
    }

    // Build align options HTML
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

        // Look up the complication type definition
        var findType = CF.findType;
        var ctype = d.complication_type && findType ? findType(d.complication_type) : null;

        var html = '';

        // Type badge
        if (ctype) {
            html += '<div class="prop-type-badge">' + escHtml(ctype.name) + '</div>';
        }

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

        // ID
        html += '<div class="prop-row"><label for="prop-id">ID</label>';
        html += '<input type="text" id="prop-id" value="' + escHtml(d.complication_id) + '" /></div>';

        if (d.type === 'text') {
            // Source (data source URL/variable)
            html += '<div class="prop-row"><label for="prop-source">Source</label>';
            html += '<input type="text" id="prop-source" value="' + escHtml(d.source || '') + '" placeholder="e.g. /crispface/api/sources/weather.py" /></div>';

            // If we have a typed complication, show labelled variable inputs
            if (ctype && ctype.variables && ctype.variables.length > 0) {
                var params = d.params || {};
                var vars = ctype.variables;
                html += '<div class="prop-section-label">Variables</div>';
                for (var vi = 0; vi < vars.length; vi++) {
                    var v = vars[vi];
                    var currentVal = params[v.name] !== undefined ? params[v.name] : (v.default || '');
                    html += '<div class="prop-row"><label for="prop-var-' + escHtml(v.name) + '">' + escHtml(v.label) + '</label>';
                    html += '<input type="text" id="prop-var-' + escHtml(v.name) + '" data-var-name="' + escHtml(v.name) + '" class="prop-var-input" value="' + escHtml(currentVal) + '" /></div>';
                }
            } else {
                // Fallback: raw params field
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

            // Preview value (what shows on canvas)
            html += '<div class="prop-row"><label for="prop-value">Preview</label>';
            html += '<input type="text" id="prop-value" value="' + escHtml(content.value || '') + '" /></div>';

            // Font family + size on one row
            html += '<div class="prop-row-inline">';
            html += '<div class="prop-row"><label for="prop-family">Font</label>';
            html += '<select id="prop-family">' + familyOptionsHtml(content.family || 'sans-serif') + '</select></div>';
            html += '<div class="prop-row"><label for="prop-size">Size</label>';
            html += '<select id="prop-size">' + sizeOptionsHtml(content.size || 12) + '</select></div>';
            html += '</div>';

            // Bold + Italic on one row
            html += '<div class="prop-row-inline">';
            html += '<div class="prop-row"><label for="prop-bold">Bold</label>';
            html += '<input type="checkbox" id="prop-bold"' + (content.bold ? ' checked' : '') + ' /></div>';
            html += '<div class="prop-row"><label for="prop-italic">Italic</label>';
            html += '<input type="checkbox" id="prop-italic"' + (content.italic ? ' checked' : '') + ' /></div>';
            html += '</div>';

            // Align
            html += '<div class="prop-row"><label for="prop-align">Align</label>';
            html += '<select id="prop-align">' + alignOptionsHtml(content.align || 'left') + '</select></div>';

            // Color
            html += '<div class="prop-row"><label for="prop-color">Color</label>';
            html += '<select id="prop-color">';
            html += '<option value="white"' + (content.color === 'white' ? ' selected' : '') + '>White</option>';
            html += '<option value="black"' + (content.color === 'black' ? ' selected' : '') + '>Black</option>';
            html += '</select></div>';
        }

        // Stale
        html += '<div class="prop-row"><label for="prop-stale">Stale (sec)</label>';
        html += '<input type="number" id="prop-stale" value="' + (d.stale_seconds || 60) + '" min="1" /></div>';

        panel.innerHTML = html;
        bindPropertyInputs(ctype);
    }

    function clearProperties() {
        currentObject = null;
        panel.innerHTML = '<div class="no-selection">Select a complication to edit its properties</div>';
    }

    function bindPropertyInputs(ctype) {
        // Position
        bindInput('prop-x', function (val) {
            updateObject(currentObject, { left: parseInt(val, 10) || 0 });
        });
        bindInput('prop-y', function (val) {
            updateObject(currentObject, { top: parseInt(val, 10) || 0 });
        });
        bindInput('prop-w', function (val) {
            updateObject(currentObject, { width: parseInt(val, 10) || 1, scaleX: 1 });
        });
        bindInput('prop-h', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.h = parseInt(val, 10) || 40;
            }
        });

        // Complication ID
        bindInput('prop-id', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.complication_id = val;
            }
        });

        // Source
        bindInput('prop-source', function (val) {
            if (currentObject.crispfaceData) {
                currentObject.crispfaceData.source = val;
            }
        });

        // Variable inputs (typed complication)
        if (ctype && ctype.variables && ctype.variables.length > 0) {
            var varInputs = panel.querySelectorAll('.prop-var-input');
            for (var i = 0; i < varInputs.length; i++) {
                (function (input) {
                    var varName = input.getAttribute('data-var-name');
                    var handler = function () {
                        if (!currentObject || !currentObject.crispfaceData) return;
                        if (!currentObject.crispfaceData.params) {
                            currentObject.crispfaceData.params = {};
                        }
                        currentObject.crispfaceData.params[varName] = input.value;
                    };
                    input.addEventListener('input', handler);
                    input.addEventListener('change', handler);
                })(varInputs[i]);
            }
        } else {
            // Params (key=value&key2=value2 format)
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
                currentObject.crispfaceData.content.size = parseInt(val, 10);
                updateObject(currentObject, { fontSize: parseInt(val, 10) });
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

        // Stale
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
