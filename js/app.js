(function () {
    'use strict';

    var BASE_URL = '/crispface';

    window.CRISPFACE = window.CRISPFACE || {};
    window.CRISPFACE.baseUrl = BASE_URL;

    // ---- API helper ----
    function api(method, url, body) {
        var opts = {
            method: method,
            credentials: 'same-origin',
            headers: {}
        };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        return fetch(BASE_URL + url, opts).then(function (r) {
            return r.json();
        });
    }

    window.CRISPFACE.api = api;

    // ---- Watch selector ----
    function initWatchSelector(callback) {
        api('GET', '/api/watches.py').then(function (data) {
            if (!data.success) {
                if (callback) callback(null);
                return;
            }
            var watches = data.watches;
            var currentId = localStorage.getItem('crispface_current_watch');

            // Validate stored ID against actual watches
            var valid = false;
            for (var i = 0; i < watches.length; i++) {
                if (watches[i].id === currentId) {
                    valid = true;
                    break;
                }
            }
            if (!valid && watches.length > 0) {
                currentId = watches[0].id;
                localStorage.setItem('crispface_current_watch', currentId);
            }

            window.CRISPFACE.currentWatchId = currentId;
            window.CRISPFACE.watches = watches;

            populateWatchBrand(watches, currentId);
            if (callback) callback(currentId);
        }).catch(function () {
            if (callback) callback(null);
        });
    }

    function populateWatchBrand(watches, currentId) {
        var nameEl = document.getElementById('watch-name');
        var editLink = document.getElementById('brand-edit');
        var newLink = document.getElementById('brand-new');
        if (!nameEl) return;

        if (watches.length <= 1) {
            // Single watch — just show name as text
            nameEl.textContent = watches.length > 0 ? watches[0].name : 'CrispFace';
        } else {
            // Multiple watches — replace span with select
            var select = document.createElement('select');
            select.id = 'watch-name';
            for (var i = 0; i < watches.length; i++) {
                var opt = document.createElement('option');
                opt.value = watches[i].id;
                opt.textContent = watches[i].name;
                if (watches[i].id === currentId) opt.selected = true;
                select.appendChild(opt);
            }
            select.addEventListener('change', function () {
                localStorage.setItem('crispface_current_watch', this.value);
                window.location.reload();
            });
            nameEl.parentNode.replaceChild(select, nameEl);
        }

        // Edit link -> watch-edit page for current watch
        if (editLink) {
            editLink.addEventListener('click', function (e) {
                e.preventDefault();
                var wid = localStorage.getItem('crispface_current_watch');
                if (wid) {
                    window.location.href = BASE_URL + '/watch-edit.html?id=' + wid;
                }
            });
        }

        // New link -> prompt for name, create, switch
        if (newLink) {
            newLink.addEventListener('click', function (e) {
                e.preventDefault();
                var name = prompt('New watch name:');
                if (!name || !name.trim()) return;
                api('POST', '/api/watches.py', { name: name.trim() }).then(function (resp) {
                    if (resp.success && resp.watch) {
                        localStorage.setItem('crispface_current_watch', resp.watch.id);
                        window.location.reload();
                    }
                });
            });
        }
    }

    // ---- Auth check (for protected pages) ----
    function requireAuth(callback) {
        api('GET', '/api/session.py').then(function (data) {
            if (!data.authenticated) {
                window.location.href = BASE_URL + '/index.html';
                return;
            }
            window.CRISPFACE.user = data.user;
            // Set username in sidebar
            var userEl = document.getElementById('sidebar-user');
            if (userEl) {
                userEl.textContent = data.user;
            }
            // Init watch selector, then call page callback
            initWatchSelector(function (watchId) {
                if (callback) callback(data.user);
            });
        }).catch(function () {
            window.location.href = BASE_URL + '/index.html';
        });
    }

    window.CRISPFACE.requireAuth = requireAuth;

    // ---- Login page ----
    function initLogin() {
        var form = document.getElementById('login-form');
        if (!form) return;

        // If already logged in, redirect
        api('GET', '/api/session.py').then(function (data) {
            if (data.authenticated) {
                window.location.href = BASE_URL + '/faces.html';
            }
        }).catch(function () {});

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var username = document.getElementById('username').value.trim();
            var password = document.getElementById('password').value;
            var errorEl = document.getElementById('login-error');
            errorEl.style.display = 'none';

            api('POST', '/api/login.py', { username: username, password: password })
                .then(function (data) {
                    if (data.success) {
                        window.location.href = BASE_URL + '/faces.html';
                    } else {
                        errorEl.textContent = data.error || 'Login failed';
                        errorEl.style.display = 'block';
                    }
                })
                .catch(function () {
                    errorEl.textContent = 'Network error';
                    errorEl.style.display = 'block';
                });
        });
    }

    // ---- Dashboard page ----
    function initDashboard() {
        requireAuth(function () {
            var watchId = window.CRISPFACE.currentWatchId;
            if (!watchId) return;

            // Load current watch to get face count
            api('GET', '/api/watch.py?id=' + watchId).then(function (data) {
                if (data.success && data.watch) {
                    var count = (data.watch.face_ids || []).length;
                    var el = document.getElementById('face-count');
                    if (el) {
                        el.textContent = count + ' face' + (count !== 1 ? 's' : '') + ' in this watch';
                    }
                }
            });
        });
    }

    // ---- Faces page ----
    function initFaces() {
        requireAuth(function () {
            // View toggle
            var toggleBtn = document.getElementById('btn-view-toggle');
            var viewMode = localStorage.getItem('crispface_faces_view') || 'grid';
            toggleBtn.textContent = viewMode === 'list' ? 'Grid' : 'List';

            toggleBtn.addEventListener('click', function () {
                viewMode = viewMode === 'grid' ? 'list' : 'grid';
                localStorage.setItem('crispface_faces_view', viewMode);
                var container = document.getElementById('face-grid');
                container.className = viewMode === 'list' ? 'face-list' : 'face-grid';
                toggleBtn.textContent = viewMode === 'list' ? 'Grid' : 'List';
            });

            loadFaceList();

            document.getElementById('btn-new-face').addEventListener('click', function () {
                var watchId = window.CRISPFACE.currentWatchId;
                api('POST', '/api/faces.py', { name: 'Untitled Face' }).then(function (data) {
                    if (!data.success) return;
                    var faceId = data.face.id;
                    if (!watchId) {
                        window.location.href = BASE_URL + '/editor.html?id=' + faceId;
                        return;
                    }
                    // Add face to current watch's face_ids
                    api('GET', '/api/watch.py?id=' + watchId).then(function (wr) {
                        if (!wr.success || !wr.watch) {
                            window.location.href = BASE_URL + '/editor.html?id=' + faceId;
                            return;
                        }
                        var ids = wr.watch.face_ids || [];
                        ids.push(faceId);
                        api('POST', '/api/watch.py?id=' + watchId, { face_ids: ids }).then(function () {
                            window.location.href = BASE_URL + '/editor.html?id=' + faceId + '&watch=' + watchId;
                        });
                    });
                });
            });
        });
    }

    function loadFaceList() {
        var watchId = window.CRISPFACE.currentWatchId;
        if (!watchId) return;

        // Load watch and all faces in parallel
        Promise.all([
            api('GET', '/api/watch.py?id=' + watchId),
            api('GET', '/api/faces.py')
        ]).then(function (results) {
            var watchResp = results[0];
            var facesResp = results[1];

            var grid = document.getElementById('face-grid');
            var empty = document.getElementById('empty-state');

            if (!watchResp.success || !watchResp.watch || !facesResp.success) {
                grid.style.display = 'none';
                empty.style.display = 'block';
                return;
            }

            var watchFaceIds = watchResp.watch.face_ids || [];
            var allFaces = facesResp.faces;

            // Build lookup
            var faceMap = {};
            for (var i = 0; i < allFaces.length; i++) {
                faceMap[allFaces[i].id] = allFaces[i];
            }

            // Filter to faces in this watch, in watch order
            var faces = [];
            for (var j = 0; j < watchFaceIds.length; j++) {
                var face = faceMap[watchFaceIds[j]];
                if (face) faces.push(face);
            }

            if (faces.length === 0) {
                grid.style.display = 'none';
                empty.style.display = 'block';
                return;
            }

            empty.style.display = 'none';
            var viewMode = localStorage.getItem('crispface_faces_view') || 'grid';
            grid.className = viewMode === 'list' ? 'face-list' : 'face-grid';
            grid.style.display = '';
            grid.innerHTML = '';

            for (var k = 0; k < faces.length; k++) {
                grid.appendChild(createFaceCard(faces[k], watchId));
            }

            initFaceDragDrop(grid, watchId);
        });
    }

    function createFaceCard(face, watchId) {
        var card = document.createElement('div');
        card.className = 'face-card';
        card.setAttribute('draggable', 'true');
        card.setAttribute('data-face-id', face.id);

        var compCount = (face.complications || []).length;
        var editorHref = BASE_URL + '/editor.html?id=' + escHtml(face.id);
        if (watchId) editorHref += '&watch=' + escHtml(watchId);

        card.innerHTML =
            '<span class="drag-handle" title="Drag to reorder">&#9776;</span>' +
            '<h3>' + escHtml(face.name) + '</h3>' +
            '<p class="face-meta">' + escHtml(face.slug) + ' &middot; ' +
            compCount + ' complication' + (compCount !== 1 ? 's' : '') + '</p>' +
            '<div class="face-actions">' +
            '<a href="' + editorHref + '" class="btn btn-primary btn-sm">Edit</a>' +
            '<button type="button" class="btn btn-danger btn-sm" data-delete="' + escHtml(face.id) + '">Delete</button>' +
            '</div>';

        card.querySelector('[data-delete]').addEventListener('click', function () {
            if (!confirm('Delete this face?')) return;
            api('DELETE', '/api/face.py?id=' + face.id).then(function (resp) {
                if (resp.success) {
                    loadFaceList();
                }
            });
        });

        return card;
    }

    function initFaceDragDrop(container, watchId) {
        var cards = container.querySelectorAll('.face-card');
        var dragSrcEl = null;

        // FLIP animation: snapshot positions, do DOM move, animate displacement
        function animateReorder(movedEl) {
            var siblings = container.querySelectorAll('.face-card');
            // Snapshot current positions of all cards except the dragged one
            var rects = {};
            for (var s = 0; s < siblings.length; s++) {
                if (siblings[s] !== movedEl) {
                    rects[siblings[s].getAttribute('data-face-id')] = siblings[s].getBoundingClientRect();
                }
            }
            return rects;
        }

        function playFlip(before) {
            var siblings = container.querySelectorAll('.face-card');
            for (var s = 0; s < siblings.length; s++) {
                var el = siblings[s];
                var id = el.getAttribute('data-face-id');
                if (!before[id]) continue;
                var after = el.getBoundingClientRect();
                var dx = before[id].left - after.left;
                var dy = before[id].top - after.top;
                if (dx === 0 && dy === 0) continue;
                // Apply inverse transform (snap to old position)
                el.style.transition = 'none';
                el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
                // Force reflow then animate to natural position
                el.offsetHeight; // eslint-disable-line no-unused-expressions
                el.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
                el.style.transform = '';
            }
        }

        for (var i = 0; i < cards.length; i++) {
            (function (card) {
                card.addEventListener('dragstart', function (e) {
                    dragSrcEl = card;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', '');
                    // Delay so browser captures drag image before we fade it
                    setTimeout(function () {
                        card.classList.add('dragging');
                    }, 0);
                });

                card.addEventListener('dragend', function () {
                    card.classList.remove('dragging');
                    if (dragSrcEl) {
                        saveFaceOrder(watchId);
                        dragSrcEl = null;
                    }
                });

                card.addEventListener('dragover', function (e) {
                    if (!dragSrcEl || dragSrcEl === card) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';

                    var rect = card.getBoundingClientRect();
                    var isListView = container.classList.contains('face-list');
                    var needsMove = false;
                    var insertBefore = null;

                    if (isListView) {
                        // List: vertical only
                        var midY = rect.top + rect.height / 2;
                        if (e.clientY < midY) {
                            if (card.previousElementSibling !== dragSrcEl) {
                                needsMove = true;
                                insertBefore = card;
                            }
                        } else {
                            if (card.nextElementSibling !== dragSrcEl) {
                                needsMove = true;
                                insertBefore = card.nextSibling;
                            }
                        }
                    } else {
                        // Grid: use both axes
                        var midX = rect.left + rect.width / 2;
                        var midY2 = rect.top + rect.height / 2;
                        var before = (e.clientY < midY2) || (e.clientY < midY2 + rect.height / 4 && e.clientX < midX);
                        if (before) {
                            if (card.previousElementSibling !== dragSrcEl) {
                                needsMove = true;
                                insertBefore = card;
                            }
                        } else {
                            if (card.nextElementSibling !== dragSrcEl) {
                                needsMove = true;
                                insertBefore = card.nextSibling;
                            }
                        }
                    }

                    if (needsMove) {
                        // FLIP: snapshot → move → animate
                        var rects = animateReorder(dragSrcEl);
                        container.insertBefore(dragSrcEl, insertBefore);
                        playFlip(rects);
                    }
                });

                card.addEventListener('drop', function (e) {
                    e.preventDefault();
                });
            })(cards[i]);
        }
    }

    function saveFaceOrder(watchId) {
        var container = document.getElementById('face-grid');
        var cards = container.querySelectorAll('.face-card[data-face-id]');
        var newOrder = [];
        for (var i = 0; i < cards.length; i++) {
            newOrder.push(cards[i].getAttribute('data-face-id'));
        }
        api('POST', '/api/watch.py?id=' + watchId, { face_ids: newOrder });
    }

    // ---- Complications list page ----
    function initComplications() {
        requireAuth(function () {
            loadTypeList();

            document.getElementById('btn-new-type').addEventListener('click', function () {
                api('POST', '/api/complications.py', { name: 'New Type' }).then(function (data) {
                    if (data.success) {
                        window.location.href = BASE_URL + '/complication-edit.html?id=' + data.type.id;
                    }
                });
            });
        });
    }

    function loadTypeList() {
        api('GET', '/api/complications.py').then(function (data) {
            if (!data.success) return;
            var grid = document.getElementById('type-grid');
            var empty = document.getElementById('empty-state');

            if (data.types.length === 0) {
                grid.style.display = 'none';
                empty.style.display = 'block';
                return;
            }

            empty.style.display = 'none';
            grid.style.display = 'grid';
            grid.innerHTML = '';

            for (var i = 0; i < data.types.length; i++) {
                grid.appendChild(createTypeCard(data.types[i]));
            }
        });
    }

    function createTypeCard(ctype) {
        var card = document.createElement('div');
        card.className = 'face-card';

        var varCount = (ctype.variables || []).length;

        card.innerHTML =
            '<h3>' + escHtml(ctype.name) + '</h3>' +
            '<p class="face-meta">' + escHtml(ctype.description || 'No description') + '</p>' +
            '<p class="face-meta">' + varCount + ' variable' + (varCount !== 1 ? 's' : '') + '</p>' +
            '<div class="face-actions">' +
            '<a href="' + BASE_URL + '/complication-edit.html?id=' + escHtml(ctype.id) + '" class="btn btn-primary btn-sm">Edit</a>' +
            '<button type="button" class="btn btn-danger btn-sm" data-delete="' + escHtml(ctype.id) + '">Delete</button>' +
            '</div>';

        card.querySelector('[data-delete]').addEventListener('click', function () {
            if (!confirm('Delete "' + ctype.name + '"? This will also delete its script.')) return;
            api('DELETE', '/api/complication.py?id=' + ctype.id).then(function (resp) {
                if (resp.success) {
                    loadTypeList();
                }
            });
        });

        return card;
    }

    // ---- Complication edit page ----
    function initComplicationEdit() {
        requireAuth(function () {
            var params = new URLSearchParams(window.location.search);
            var typeId = params.get('id');

            if (!typeId) {
                window.location.href = BASE_URL + '/complications.html';
                return;
            }

            api('GET', '/api/complication.py?id=' + typeId).then(function (resp) {
                if (!resp.success || !resp.type) {
                    alert('Type not found');
                    window.location.href = BASE_URL + '/complications.html';
                    return;
                }

                var ctype = resp.type;
                document.title = 'Edit: ' + ctype.name + ' - CrispFace';
                document.getElementById('page-title').textContent = 'Edit: ' + ctype.name;
                document.getElementById('comp-name').value = ctype.name || '';
                document.getElementById('comp-description').value = ctype.description || '';
                document.getElementById('comp-script').value = ctype.script_source || '';

                renderVariables(ctype.variables || []);

                // Add variable button
                document.getElementById('btn-add-var').addEventListener('click', function () {
                    addVariableRow('', '', '', 'text');
                });

                // Toggle script editor
                var scriptVisible = false;
                document.getElementById('btn-toggle-script').addEventListener('click', function () {
                    scriptVisible = !scriptVisible;
                    document.getElementById('script-editor').style.display = scriptVisible ? 'block' : 'none';
                    this.textContent = scriptVisible ? 'Hide Script' : 'Show Script';
                });

                // Save
                document.getElementById('btn-save').addEventListener('click', function () {
                    var statusEl = document.getElementById('save-status');
                    statusEl.textContent = 'Saving...';
                    statusEl.style.color = '#757575';

                    var variables = collectVariables();
                    var body = {
                        name: document.getElementById('comp-name').value,
                        description: document.getElementById('comp-description').value,
                        variables: variables
                    };
                    // Only send script if the editor was shown
                    if (scriptVisible) {
                        body.script_source = document.getElementById('comp-script').value;
                    }

                    api('POST', '/api/complication.py?id=' + typeId, body).then(function (r) {
                        if (r.success) {
                            statusEl.textContent = 'Saved';
                            statusEl.style.color = '#43A047';
                            document.getElementById('page-title').textContent = 'Edit: ' + (r.type.name || typeId);
                            document.title = 'Edit: ' + (r.type.name || typeId) + ' - CrispFace';
                            setTimeout(function () { statusEl.textContent = ''; }, 2000);
                        } else {
                            statusEl.textContent = 'Error: ' + (r.error || 'Unknown');
                            statusEl.style.color = '#E53935';
                        }
                    }).catch(function () {
                        statusEl.textContent = 'Network error';
                        statusEl.style.color = '#E53935';
                    });
                });
            }).catch(function () {
                alert('Failed to load type');
                window.location.href = BASE_URL + '/complications.html';
            });
        });
    }

    function renderVariables(variables) {
        var list = document.getElementById('variables-list');
        list.innerHTML = '';
        if (variables.length > 0) {
            var table = document.createElement('table');
            table.className = 'var-table';
            table.innerHTML =
                '<thead><tr>' +
                '<th class="col-name">Name</th><th>Label</th><th class="col-type">Type</th>' +
                '<th class="col-default">Default</th><th class="col-options">Options</th><th class="col-remove"></th>' +
                '</tr></thead><tbody></tbody>';
            list.appendChild(table);
            for (var i = 0; i < variables.length; i++) {
                addVariableRow(variables[i].name, variables[i].label, variables[i].default, variables[i].type || 'text', variables[i].options || '');
            }
        } else {
            list.innerHTML = '<p class="no-selection">No variables defined</p>';
        }
    }

    function addVariableRow(name, label, defaultVal, varType, options) {
        var list = document.getElementById('variables-list');
        // Remove "no variables" message if present
        var noVars = list.querySelector('.no-selection');
        if (noVars) noVars.remove();

        // Ensure table exists
        var table = list.querySelector('.var-table');
        if (!table) {
            table = document.createElement('table');
            table.className = 'var-table';
            table.innerHTML =
                '<thead><tr>' +
                '<th class="col-name">Name</th><th>Label</th><th class="col-type">Type</th>' +
                '<th class="col-default">Default</th><th class="col-options">Options</th><th class="col-remove"></th>' +
                '</tr></thead><tbody></tbody>';
            list.appendChild(table);
        }
        var tbody = table.querySelector('tbody');

        var type = varType || 'text';
        var row = document.createElement('tr');
        row.className = 'var-row';
        row.innerHTML =
            '<td><input type="text" placeholder="name" class="var-name" value="' + escHtml(name || '') + '" /></td>' +
            '<td><input type="text" placeholder="label" class="var-label" value="' + escHtml(label || '') + '" /></td>' +
            '<td class="col-type"><select class="var-type">' +
                '<option value="text"' + (type === 'text' ? ' selected' : '') + '>Text</option>' +
                '<option value="checkbox"' + (type === 'checkbox' ? ' selected' : '') + '>Checkbox</option>' +
                '<option value="select"' + (type === 'select' ? ' selected' : '') + '>Select</option>' +
            '</select></td>' +
            '<td><input type="text" placeholder="default" class="var-default" value="' + escHtml(defaultVal || '') + '" /></td>' +
            '<td><input type="text" placeholder="a,b,c" class="var-options" value="' + escHtml(options || '') + '" /></td>' +
            '<td class="col-remove"><button type="button" class="btn btn-danger btn-sm var-remove">&times;</button></td>';

        row.querySelector('.var-remove').addEventListener('click', function () {
            row.remove();
            if (tbody.children.length === 0) {
                table.remove();
                list.innerHTML = '<p class="no-selection">No variables defined</p>';
            }
        });

        tbody.appendChild(row);
    }

    function collectVariables() {
        var rows = document.querySelectorAll('.var-row');
        var variables = [];
        for (var i = 0; i < rows.length; i++) {
            var nameEl = rows[i].querySelector('.var-name');
            if (!nameEl) continue;
            var name = nameEl.value.trim();
            if (!name) continue;
            var typeEl = rows[i].querySelector('.var-type');
            var varType = typeEl ? typeEl.value : 'text';
            var v = {
                name: name,
                label: rows[i].querySelector('.var-label').value.trim() || name,
                type: varType,
                default: rows[i].querySelector('.var-default').value
            };
            var optionsEl = rows[i].querySelector('.var-options');
            if (optionsEl && optionsEl.value.trim()) {
                v.options = optionsEl.value.trim();
            }
            variables.push(v);
        }
        return variables;
    }

    // ---- Watch edit page ----
    var watchFaceIds = []; // current ordered face IDs for the watch being edited
    var watchWifiNetworks = []; // WiFi networks for this watch

    var TIMEZONES = [
        'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
        'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Rome', 'Europe/Madrid',
        'Europe/Lisbon', 'Europe/Zurich', 'Europe/Vienna', 'Europe/Stockholm',
        'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Warsaw',
        'Europe/Prague', 'Europe/Budapest', 'Europe/Bucharest', 'Europe/Athens',
        'Europe/Istanbul', 'Europe/Moscow',
        'US/Eastern', 'US/Central', 'US/Mountain', 'US/Pacific', 'US/Alaska', 'US/Hawaii',
        'Canada/Eastern', 'Canada/Central', 'Canada/Mountain', 'Canada/Pacific',
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'America/Mexico_City', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
        'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
        'Asia/Kolkata', 'Asia/Dubai', 'Asia/Seoul', 'Asia/Bangkok',
        'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
        'Pacific/Auckland', 'Africa/Johannesburg', 'Africa/Cairo'
    ];

    function populateTimezoneSelect(selectedTz) {
        var sel = document.getElementById('watch-timezone');
        if (!sel) return;
        sel.innerHTML = '';
        for (var i = 0; i < TIMEZONES.length; i++) {
            var opt = document.createElement('option');
            opt.value = TIMEZONES[i];
            opt.textContent = TIMEZONES[i];
            if (TIMEZONES[i] === selectedTz) opt.selected = true;
            sel.appendChild(opt);
        }
    }

    function initWatchEdit() {
        requireAuth(function () {
            var params = new URLSearchParams(window.location.search);
            var watchId = params.get('id');

            if (!watchId) {
                window.location.href = BASE_URL + '/faces.html';
                return;
            }

            // Bind buttons immediately (they exist in static HTML, not async)
            document.getElementById('btn-add-wifi').addEventListener('click', function () {
                collectWifiNetworks();
                if (watchWifiNetworks.length >= 5) {
                    alert('Maximum 5 WiFi networks');
                    return;
                }
                watchWifiNetworks.push({ ssid: '', password: '', _editing: true });
                renderWifiNetworks();
            });

            document.getElementById('btn-save').addEventListener('click', function () {
                var statusEl = document.getElementById('save-status');
                statusEl.textContent = 'Saving...';
                statusEl.style.color = '#757575';

                collectWifiNetworks();

                // Strip transient _editing flag before sending
                var cleanNets = [];
                for (var wi = 0; wi < watchWifiNetworks.length; wi++) {
                    var wn = watchWifiNetworks[wi];
                    if (wn.ssid) cleanNets.push({ ssid: wn.ssid, password: wn.password });
                }

                var tzSelect = document.getElementById('watch-timezone');
                var body = {
                    name: document.getElementById('watch-edit-name').value,
                    face_ids: watchFaceIds,
                    wifi_networks: cleanNets,
                    timezone: tzSelect ? tzSelect.value : 'Europe/London'
                };

                api('POST', '/api/watch.py?id=' + watchId, body).then(function (r) {
                    if (r.success) {
                        statusEl.textContent = 'Saved';
                        statusEl.style.color = '#43A047';
                        document.getElementById('page-title').textContent = 'Edit: ' + (r.watch.name || watchId);
                        document.title = 'Edit: ' + (r.watch.name || watchId) + ' - CrispFace';
                        setTimeout(function () { statusEl.textContent = ''; }, 2000);
                        // Commit all networks (strip _editing, remove empty)
                        watchWifiNetworks = cleanNets;
                        renderWifiNetworks();
                    } else {
                        statusEl.textContent = 'Error: ' + (r.error || 'Unknown');
                        statusEl.style.color = '#E53935';
                    }
                }).catch(function () {
                    statusEl.textContent = 'Network error';
                    statusEl.style.color = '#E53935';
                });
            });

            document.getElementById('btn-delete-watch').addEventListener('click', function () {
                if (!confirm('Delete this watch? (Faces will not be deleted)')) return;
                api('DELETE', '/api/watch.py?id=' + watchId).then(function (resp) {
                    if (resp.success) {
                        if (localStorage.getItem('crispface_current_watch') === watchId) {
                            localStorage.removeItem('crispface_current_watch');
                        }
                        window.location.href = BASE_URL + '/faces.html';
                    }
                });
            });

            // Load watch and all faces
            Promise.all([
                api('GET', '/api/watch.py?id=' + watchId),
                api('GET', '/api/faces.py')
            ]).then(function (results) {
                var watchResp = results[0];
                var facesResp = results[1];

                if (!watchResp.success || !watchResp.watch) {
                    alert('Watch not found');
                    window.location.href = BASE_URL + '/faces.html';
                    return;
                }

                var watch = watchResp.watch;
                var allFaces = facesResp.success ? facesResp.faces : [];

                document.title = 'Edit: ' + watch.name + ' - CrispFace';
                document.getElementById('page-title').textContent = 'Edit: ' + watch.name;
                document.getElementById('watch-edit-name').value = watch.name || '';

                populateTimezoneSelect(watch.timezone || 'Europe/London');

                watchFaceIds = watch.face_ids || [];
                watchWifiNetworks = watch.wifi_networks || [];

                renderWifiNetworks();
                renderWatchFaces(allFaces, watchId);
                renderAvailableFaces(allFaces, watchId);
            });
        });
    }

    function renderWifiNetworks() {
        var list = document.getElementById('wifi-list');
        if (!list) return;
        list.innerHTML = '';

        if (watchWifiNetworks.length === 0) {
            list.innerHTML = '<p class="no-selection">No WiFi networks configured</p>';
            return;
        }

        for (var i = 0; i < watchWifiNetworks.length; i++) {
            var net = watchWifiNetworks[i];
            var row = document.createElement('div');
            row.className = 'wifi-row';

            if (net._editing) {
                // Editing state: inputs + OK button
                row.classList.add('wifi-row-editing');
                row.innerHTML =
                    '<input type="text" placeholder="SSID" class="wifi-ssid" value="' + escHtml(net.ssid || '') + '" />' +
                    '<div class="wifi-pass-wrap">' +
                    '<input type="password" placeholder="Password" class="wifi-pass" value="' + escHtml(net.password || '') + '" />' +
                    '<button type="button" class="wifi-pass-toggle" title="Show/hide password">show</button>' +
                    '</div>' +
                    '<button type="button" class="btn btn-primary btn-sm wifi-ok">OK</button>' +
                    '<button type="button" class="btn btn-danger btn-sm var-remove">&times;</button>';

                // Password toggle
                (function (rowEl) {
                    rowEl.querySelector('.wifi-pass-toggle').addEventListener('click', function () {
                        var input = rowEl.querySelector('.wifi-pass');
                        if (input.type === 'password') {
                            input.type = 'text';
                            this.textContent = 'hide';
                        } else {
                            input.type = 'password';
                            this.textContent = 'show';
                        }
                    });
                })(row);

                // OK button — commit this row
                (function (idx) {
                    row.querySelector('.wifi-ok').addEventListener('click', function () {
                        collectWifiNetworks();
                        if (!watchWifiNetworks[idx] || !watchWifiNetworks[idx].ssid) {
                            alert('SSID is required');
                            return;
                        }
                        delete watchWifiNetworks[idx]._editing;
                        renderWifiNetworks();
                    });
                })(i);
            } else {
                // Committed state: static display
                var masked = net.password ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '(none)';
                row.classList.add('wifi-row-committed');
                row.innerHTML =
                    '<span class="wifi-static-ssid">' + escHtml(net.ssid) + '</span>' +
                    '<span class="wifi-static-pass">' + masked + '</span>' +
                    '<button type="button" class="btn btn-secondary btn-sm wifi-edit">Edit</button>' +
                    '<button type="button" class="btn btn-danger btn-sm var-remove">&times;</button>';

                // Edit button
                (function (idx) {
                    row.querySelector('.wifi-edit').addEventListener('click', function () {
                        collectWifiNetworks();
                        watchWifiNetworks[idx]._editing = true;
                        renderWifiNetworks();
                    });
                })(i);
            }

            // Remove button (both states)
            (function (idx) {
                row.querySelector('.var-remove').addEventListener('click', function () {
                    collectWifiNetworks();
                    watchWifiNetworks.splice(idx, 1);
                    renderWifiNetworks();
                });
            })(i);

            list.appendChild(row);
        }
    }

    function collectWifiNetworks() {
        var list = document.getElementById('wifi-list');
        if (!list) return;
        var rows = list.querySelectorAll('.wifi-row');
        var nets = [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].classList.contains('wifi-row-editing')) {
                var ssidInput = rows[i].querySelector('.wifi-ssid');
                var passInput = rows[i].querySelector('.wifi-pass');
                var ssid = ssidInput ? ssidInput.value.trim() : '';
                var pass = passInput ? passInput.value : '';
                nets.push({ ssid: ssid, password: pass, _editing: true });
            } else {
                // Committed row — preserve from watchWifiNetworks
                if (i < watchWifiNetworks.length) {
                    var existing = watchWifiNetworks[i];
                    nets.push({ ssid: existing.ssid, password: existing.password });
                }
            }
        }
        watchWifiNetworks = nets;
    }

    function renderWatchFaces(allFaces, watchId) {
        var list = document.getElementById('watch-face-list');
        list.innerHTML = '';

        if (watchFaceIds.length === 0) {
            list.innerHTML = '<p class="no-selection">No faces added yet</p>';
            return;
        }

        // Build a lookup map
        var faceMap = {};
        for (var i = 0; i < allFaces.length; i++) {
            faceMap[allFaces[i].id] = allFaces[i];
        }

        for (var j = 0; j < watchFaceIds.length; j++) {
            var fid = watchFaceIds[j];
            var face = faceMap[fid];
            if (!face) continue;

            var row = document.createElement('div');
            row.className = 'watch-face-row';
            row.setAttribute('data-face-id', fid);

            row.innerHTML =
                '<span class="watch-face-name">' + escHtml(face.name) + '</span>' +
                '<div class="watch-face-actions">' +
                '<button type="button" class="btn btn-secondary btn-sm" data-move="up" title="Move up">&uarr;</button>' +
                '<button type="button" class="btn btn-secondary btn-sm" data-move="down" title="Move down">&darr;</button>' +
                '<a href="' + BASE_URL + '/editor.html?id=' + escHtml(fid) + '&watch=' + escHtml(watchId) + '" class="btn btn-primary btn-sm">Edit</a>' +
                '<button type="button" class="btn btn-danger btn-sm" data-remove="' + escHtml(fid) + '">Remove</button>' +
                '</div>';

            (function (idx, faceId) {
                row.querySelector('[data-move="up"]').addEventListener('click', function () {
                    if (idx === 0) return;
                    var tmp = watchFaceIds[idx - 1];
                    watchFaceIds[idx - 1] = watchFaceIds[idx];
                    watchFaceIds[idx] = tmp;
                    renderWatchFaces(allFaces, watchId);
                });
                row.querySelector('[data-move="down"]').addEventListener('click', function () {
                    if (idx >= watchFaceIds.length - 1) return;
                    var tmp = watchFaceIds[idx + 1];
                    watchFaceIds[idx + 1] = watchFaceIds[idx];
                    watchFaceIds[idx] = tmp;
                    renderWatchFaces(allFaces, watchId);
                });
                row.querySelector('[data-remove]').addEventListener('click', function () {
                    watchFaceIds.splice(idx, 1);
                    renderWatchFaces(allFaces, watchId);
                    renderAvailableFaces(allFaces, watchId);
                });
            })(j, fid);

            list.appendChild(row);
        }
    }

    function renderAvailableFaces(allFaces, watchId) {
        var grid = document.getElementById('available-faces');
        grid.innerHTML = '';

        var available = [];
        for (var i = 0; i < allFaces.length; i++) {
            if (watchFaceIds.indexOf(allFaces[i].id) === -1) {
                available.push(allFaces[i]);
            }
        }

        if (available.length === 0) {
            grid.innerHTML = '<p class="no-selection">All faces are in this watch</p>';
            return;
        }

        for (var j = 0; j < available.length; j++) {
            var face = available[j];
            var card = document.createElement('div');
            card.className = 'face-card';
            card.innerHTML =
                '<h3>' + escHtml(face.name) + '</h3>' +
                '<div class="face-actions">' +
                '<button type="button" class="btn btn-primary btn-sm" data-add="' + escHtml(face.id) + '">Add</button>' +
                '</div>';

            (function (fid) {
                card.querySelector('[data-add]').addEventListener('click', function () {
                    watchFaceIds.push(fid);
                    renderWatchFaces(allFaces, watchId);
                    renderAvailableFaces(allFaces, watchId);
                });
            })(face.id);

            grid.appendChild(card);
        }
    }

    // ---- Logout ----
    function initLogout() {
        document.addEventListener('click', function (e) {
            if (e.target && e.target.id === 'btn-logout') {
                e.preventDefault();
                api('POST', '/api/logout.py').then(function () {
                    window.location.href = BASE_URL + '/index.html';
                }).catch(function () {
                    window.location.href = BASE_URL + '/index.html';
                });
            }
        });
    }

    // ---- Flash page ----
    function initFlash() {
        requireAuth(function () {
            var buildBtn = document.getElementById('btn-build');
            var statusEl = document.getElementById('flash-status');
            var flashWrap = document.getElementById('flash-wrap');
            var installBtn = document.getElementById('install-btn');
            var options = document.querySelectorAll('.firmware-option');
            var watchSelect = document.getElementById('flash-watch-select');
            var watchPicker = document.getElementById('flash-watch-picker');
            var wifiInfo = document.getElementById('flash-wifi-info');
            var watchesData = [];
            var lastBuild = null; // metadata for the most recent build

            // ---- Flash history (localStorage) ----
            var FLASH_LOG_KEY = 'crispface_flash_log';
            var FLASH_LOG_MAX = 50;

            function getFlashLog() {
                try {
                    return JSON.parse(localStorage.getItem(FLASH_LOG_KEY)) || [];
                } catch (e) { return []; }
            }

            function saveFlashLog(log) {
                localStorage.setItem(FLASH_LOG_KEY, JSON.stringify(log.slice(-FLASH_LOG_MAX)));
            }

            function addLogEntry(entry) {
                var log = getFlashLog();
                log.push(entry);
                saveFlashLog(log);
                renderFlashLog();
            }

            function updateLastLogEntry(updates) {
                var log = getFlashLog();
                if (log.length === 0) return;
                var last = log[log.length - 1];
                for (var k in updates) last[k] = updates[k];
                saveFlashLog(log);
                renderFlashLog();
            }

            function formatTime(ts) {
                var d = new Date(ts);
                var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
                return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
            }

            function renderFlashLog() {
                var container = document.getElementById('flash-log-entries');
                if (!container) return;
                var log = getFlashLog();
                container.innerHTML = '';

                if (log.length === 0) {
                    container.innerHTML = '<p class="flash-log-empty">No flashes yet</p>';
                    return;
                }

                // Show last 5, newest first
                var recent = log.slice(-5).reverse();
                for (var i = 0; i < recent.length; i++) {
                    var entry = recent[i];
                    var div = document.createElement('div');
                    div.className = 'flash-log-entry';

                    var resultClass = entry.status === 'flashed' ? 'flash-log-result-flashed' : 'flash-log-result-built';
                    var resultLabel = entry.status === 'flashed' ? 'Flashed' : 'Built';

                    div.innerHTML =
                        '<span class="flash-log-time">' + escHtml(formatTime(entry.timestamp)) + '</span>' +
                        '<span class="flash-log-version">v' + escHtml(entry.version || '?') + '</span>' +
                        '<span class="flash-log-watch">' + escHtml(entry.watchName || entry.env || '') + '</span>' +
                        '<span class="flash-log-result ' + resultClass + '">' + resultLabel + '</span>';

                    container.appendChild(div);
                }
            }

            function showAllFlashes() {
                var existing = document.querySelector('.flash-log-popup');
                if (existing) existing.remove();

                var log = getFlashLog().slice().reverse();
                var overlay = document.createElement('div');
                overlay.className = 'flash-log-popup';

                var inner = document.createElement('div');
                inner.className = 'flash-log-popup-inner';

                var html = '<button type="button" class="flash-log-popup-close">&times;</button>';
                html += '<h2>All Flash History</h2>';

                if (log.length === 0) {
                    html += '<p class="flash-log-empty">No flashes yet</p>';
                } else {
                    for (var i = 0; i < log.length; i++) {
                        var entry = log[i];
                        var resultClass = entry.status === 'flashed' ? 'flash-log-result-flashed' : 'flash-log-result-built';
                        var resultLabel = entry.status === 'flashed' ? 'Flashed' : 'Built';
                        html += '<div class="flash-log-entry">' +
                            '<span class="flash-log-time">' + escHtml(formatTime(entry.timestamp)) + '</span>' +
                            '<span class="flash-log-version">v' + escHtml(entry.version || '?') + '</span>' +
                            '<span class="flash-log-watch">' + escHtml(entry.watchName || entry.env || '') +
                            (entry.sizeKB ? ' (' + entry.sizeKB + ' KB)' : '') + '</span>' +
                            '<span class="flash-log-result ' + resultClass + '">' + resultLabel + '</span>' +
                            '</div>';
                    }
                }

                inner.innerHTML = html;
                overlay.appendChild(inner);
                document.body.appendChild(overlay);

                inner.querySelector('.flash-log-popup-close').addEventListener('click', function () {
                    overlay.remove();
                });
                overlay.addEventListener('click', function (e) {
                    if (e.target === overlay) overlay.remove();
                });
            }

            document.getElementById('flash-log-all').addEventListener('click', function (e) {
                e.preventDefault();
                showAllFlashes();
            });

            renderFlashLog();

            // ---- Watch picker ----
            function getSelectedEnv() {
                var checked = document.querySelector('input[name="firmware"]:checked');
                return checked ? checked.value : 'watchy';
            }

            function setStatus(msg, cls) {
                statusEl.innerHTML = msg;
                statusEl.className = cls || '';
            }

            function getWatchName() {
                var id = watchSelect.value;
                for (var i = 0; i < watchesData.length; i++) {
                    if (watchesData[i].id === id) return watchesData[i].name;
                }
                return '';
            }

            function loadWatches() {
                api('GET', '/api/watches.py').then(function (data) {
                    if (!data.success || !data.watches || data.watches.length === 0) return;
                    watchesData = data.watches;
                    watchSelect.innerHTML = '';
                    var currentId = localStorage.getItem('crispface_current_watch');
                    for (var i = 0; i < data.watches.length; i++) {
                        var opt = document.createElement('option');
                        opt.value = data.watches[i].id;
                        opt.textContent = data.watches[i].name;
                        if (data.watches[i].id === currentId) opt.selected = true;
                        watchSelect.appendChild(opt);
                    }
                    watchPicker.style.display = '';
                    updateWifiInfo();
                }).catch(function () {});
            }

            function updateWifiInfo() {
                var id = watchSelect.value;
                for (var i = 0; i < watchesData.length; i++) {
                    if (watchesData[i].id === id) {
                        var nets = watchesData[i].wifi_networks || [];
                        if (nets.length === 0) {
                            wifiInfo.textContent = 'No WiFi networks configured for this watch';
                        } else {
                            var ssids = [];
                            for (var j = 0; j < nets.length; j++) ssids.push(nets[j].ssid);
                            wifiInfo.textContent = nets.length + ' network' + (nets.length !== 1 ? 's' : '') + ': ' + ssids.join(', ');
                        }
                        return;
                    }
                }
                wifiInfo.textContent = '';
            }

            watchSelect.addEventListener('change', updateWifiInfo);
            loadWatches();

            // Firmware picker styling
            document.querySelectorAll('input[name="firmware"]').forEach(function (radio) {
                radio.addEventListener('change', function () {
                    options.forEach(function (opt) { opt.classList.remove('firmware-option-selected'); });
                    this.closest('.firmware-option').classList.add('firmware-option-selected');
                    flashWrap.style.display = 'none';
                    setStatus('', '');
                });
            });

            // Check Web Serial support
            if (!('serial' in navigator)) {
                buildBtn.disabled = true;
                buildBtn.textContent = 'Not Supported';
                setStatus('Web Serial API not available. Use Chrome or Edge 89+.', 'status-error');
                return;
            }

            document.getElementById('btn-test').addEventListener('click', async function () {
                setStatus('Requesting serial port...', 'status-building');
                try {
                    var port = await navigator.serial.requestPort();
                    await port.open({ baudRate: 115200 });
                    var info = port.getInfo();
                    var desc = 'Connected';
                    if (info.usbVendorId) desc += ' (VID: 0x' + info.usbVendorId.toString(16) + ')';
                    await port.close();
                    setStatus(desc + ' — device detected', 'status-success');
                } catch (e) {
                    if (e.name === 'NotFoundError') {
                        setStatus('No port selected', '');
                    } else {
                        setStatus('Connection failed: ' + e.message, 'status-error');
                    }
                }
            });

            // Detect flash dialog close — ESP Web Tools fires "closed" on the install button
            installBtn.addEventListener('closed', function () {
                if (lastBuild) {
                    updateLastLogEntry({ status: 'flashed' });
                    lastBuild = null;
                }
            });

            buildBtn.addEventListener('click', async function () {
                var env = getSelectedEnv();
                var label = env === 'watchy' ? 'CrispFace' : 'Watchy Stock';

                buildBtn.disabled = true;
                buildBtn.textContent = 'Building...';
                flashWrap.style.display = 'none';
                setStatus('Compiling ' + label + ' firmware...', 'status-building');

                try {
                    var url = BASE_URL + '/api/build_firmware.php?env=' + env;
                    if (env === 'watchy' && watchSelect.value) {
                        url += '&watch_id=' + encodeURIComponent(watchSelect.value);
                    }

                    var resp = await fetch(url);
                    var data = await resp.json();

                    if (!data.success) {
                        setStatus('Build failed: ' + (data.error || 'Unknown error'), 'status-error');
                        if (data.output) console.error('Build output:', data.output);
                        return;
                    }

                    var sizeKB = Math.round(data.size / 1024);
                    setStatus('Built v' + (data.version || '?') + ' (' + sizeKB + ' KB)', 'status-success');

                    // Record build in log
                    lastBuild = {
                        timestamp: Date.now(),
                        version: data.version || '?',
                        env: env,
                        watchName: getWatchName() || label,
                        sizeKB: sizeKB,
                        status: 'built'
                    };
                    addLogEntry(lastBuild);

                    installBtn.setAttribute('manifest', data.manifest);
                    flashWrap.style.display = '';
                } catch (e) {
                    setStatus('Build request failed: ' + e.message, 'status-error');
                } finally {
                    buildBtn.disabled = false;
                    buildBtn.textContent = 'Build';
                }
            });
        });
    }

    // ---- Utility ----
    function escHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
    window.CRISPFACE.escHtml = escHtml;

    // ---- Auto-init based on page ----
    document.addEventListener('DOMContentLoaded', function () {
        initLogout();

        var body = document.body;
        var page = body.getAttribute('data-page');

        if (page === 'login') initLogin();
        else if (page === 'dashboard') initDashboard();
        else if (page === 'faces') initFaces();
        else if (page === 'watch-edit') initWatchEdit();
        else if (page === 'complications') initComplications();
        else if (page === 'complication-edit') initComplicationEdit();
        else if (page === 'flash') initFlash();
        // editor page is handled by editor.js
    });
})();
