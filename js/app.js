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
                window.location.href = BASE_URL + '/dashboard.html';
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
                        window.location.href = BASE_URL + '/dashboard.html';
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
            grid.style.display = 'grid';
            grid.innerHTML = '';

            for (var k = 0; k < faces.length; k++) {
                grid.appendChild(createFaceCard(faces[k], watchId));
            }
        });
    }

    function createFaceCard(face, watchId) {
        var card = document.createElement('div');
        card.className = 'face-card';

        var compCount = (face.complications || []).length;
        var editorHref = BASE_URL + '/editor.html?id=' + escHtml(face.id);
        if (watchId) editorHref += '&watch=' + escHtml(watchId);

        card.innerHTML =
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
                    addVariableRow('', '', '');
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
            var header = document.createElement('div');
            header.className = 'var-row var-row-header';
            header.innerHTML =
                '<span class="var-col-label">Name</span>' +
                '<span class="var-col-label">Label</span>' +
                '<span class="var-col-label">Default</span>' +
                '<span class="var-col-spacer"></span>';
            list.appendChild(header);
            for (var i = 0; i < variables.length; i++) {
                addVariableRow(variables[i].name, variables[i].label, variables[i].default);
            }
        } else {
            list.innerHTML = '<p class="no-selection">No variables defined</p>';
        }
    }

    function addVariableRow(name, label, defaultVal) {
        var list = document.getElementById('variables-list');
        // Remove "no variables" message if present
        var noVars = list.querySelector('.no-selection');
        if (noVars) noVars.remove();

        var row = document.createElement('div');
        row.className = 'var-row';
        row.innerHTML =
            '<input type="text" placeholder="name" class="var-name" value="' + escHtml(name || '') + '" />' +
            '<input type="text" placeholder="label" class="var-label" value="' + escHtml(label || '') + '" />' +
            '<input type="text" placeholder="default" class="var-default" value="' + escHtml(defaultVal || '') + '" />' +
            '<button type="button" class="btn btn-danger btn-sm var-remove">&times;</button>';

        row.querySelector('.var-remove').addEventListener('click', function () {
            row.remove();
            if (list.children.length === 0) {
                list.innerHTML = '<p class="no-selection">No variables defined</p>';
            }
        });

        list.appendChild(row);
    }

    function collectVariables() {
        var rows = document.querySelectorAll('.var-row');
        var variables = [];
        for (var i = 0; i < rows.length; i++) {
            var name = rows[i].querySelector('.var-name').value.trim();
            if (!name) continue;
            variables.push({
                name: name,
                label: rows[i].querySelector('.var-label').value.trim() || name,
                default: rows[i].querySelector('.var-default').value
            });
        }
        return variables;
    }

    // ---- Watch edit page ----
    var watchFaceIds = []; // current ordered face IDs for the watch being edited

    function initWatchEdit() {
        requireAuth(function () {
            var params = new URLSearchParams(window.location.search);
            var watchId = params.get('id');

            if (!watchId) {
                window.location.href = BASE_URL + '/dashboard.html';
                return;
            }

            // Load watch and all faces in parallel
            Promise.all([
                api('GET', '/api/watch.py?id=' + watchId),
                api('GET', '/api/faces.py')
            ]).then(function (results) {
                var watchResp = results[0];
                var facesResp = results[1];

                if (!watchResp.success || !watchResp.watch) {
                    alert('Watch not found');
                    window.location.href = BASE_URL + '/dashboard.html';
                    return;
                }

                var watch = watchResp.watch;
                var allFaces = facesResp.success ? facesResp.faces : [];

                document.title = 'Edit: ' + watch.name + ' - CrispFace';
                document.getElementById('page-title').textContent = 'Edit: ' + watch.name;
                document.getElementById('watch-edit-name').value = watch.name || '';

                watchFaceIds = watch.face_ids || [];

                renderWatchFaces(allFaces, watchId);
                renderAvailableFaces(allFaces, watchId);

                // Save button
                document.getElementById('btn-save').addEventListener('click', function () {
                    var statusEl = document.getElementById('save-status');
                    statusEl.textContent = 'Saving...';
                    statusEl.style.color = '#757575';

                    var body = {
                        name: document.getElementById('watch-edit-name').value,
                        face_ids: watchFaceIds
                    };

                    api('POST', '/api/watch.py?id=' + watchId, body).then(function (r) {
                        if (r.success) {
                            statusEl.textContent = 'Saved';
                            statusEl.style.color = '#43A047';
                            document.getElementById('page-title').textContent = 'Edit: ' + (r.watch.name || watchId);
                            document.title = 'Edit: ' + (r.watch.name || watchId) + ' - CrispFace';
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

                // Delete button
                document.getElementById('btn-delete-watch').addEventListener('click', function () {
                    if (!confirm('Delete this watch? (Faces will not be deleted)')) return;
                    api('DELETE', '/api/watch.py?id=' + watchId).then(function (resp) {
                        if (resp.success) {
                            // Clear current watch if it was the deleted one
                            if (localStorage.getItem('crispface_current_watch') === watchId) {
                                localStorage.removeItem('crispface_current_watch');
                            }
                            window.location.href = BASE_URL + '/dashboard.html';
                        }
                    });
                });
            });
        });
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

    // ---- Utility ----
    function escHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

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
        // editor page is handled by editor.js
    });
})();
