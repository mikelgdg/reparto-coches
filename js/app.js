/* js/app.js — RepartoCars: UI + mapa + matrices + pegamento del solver */
(function () {
  'use strict';

  var Solver = window.Solver;

  /* ================= helpers ================= */
  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(min) {
    var t = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad(Math.floor(t / 60)) + ':' + pad(t % 60);
  }
  function fmtDur(min) {
    var m = Math.round(min);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + pad(r) + ' m' : '');
  }
  function fmtKm(m) {
    if (m == null || !isFinite(m)) return '?';
    return (m / 1000).toFixed(1).replace('.', ',') + ' km';
  }
  function fmtEUR(x) {
    return x.toFixed(2).replace('.', ',') + ' €';
  }
  function parseTime(str, def) {
    if (!str) return def;
    var p = String(str).split(':');
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m)) return def;
    return h * 60 + m;
  }
  var toastTimer = null;
  function toast(msg, kind, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = kind || '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'hidden'; }, ms || 4200);
  }
  function havMeters(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /* ================= estado ================= */
  var LS_KEY = 'reparto-cars-draft';
  function defaultState() {
    return {
      v: 2,                              // v2: seats = asientos totales (conductor incluido)
      venue: null,                       // { lat, lng, name }
      people: [],                        // { id, name, lat, lng, driver, seats, drive, noReturn }
      settings: {
        mode: 'fair',
        word: 'cena',
        arrive: '20:45',
        departOut: '20:00',
        returnT: '23:30',
        marginMode: 'auto',
        margin: 10,
        fuel: 0.15,
        keepGroups: false
      }
    };
  }
  function newPerson(id) {
    return { id: id, name: '', lat: null, lng: null, driver: false, seats: 4, drive: 'both', noReturn: false,
      alone: false, aloneText: '', prefDriver: 0, prefScope: 'both' };
  }
  function sanitizeState(s) {
    if (!s || typeof s !== 'object') return null;
    var out = defaultState();
    if (s.venue && isFinite(s.venue.lat) && isFinite(s.venue.lng)) {
      out.venue = { lat: Number(s.venue.lat), lng: Number(s.venue.lng), name: String(s.venue.name || '') };
    }
    if (Array.isArray(s.people)) {
      var ids = {};
      s.people.forEach(function (p, i) {
        if (!p || typeof p !== 'object') return;
        if (!isFinite(p.lat)) return;
        var q = newPerson(isFinite(p.id) ? p.id | 0 : i + 1);
        if (ids[q.id]) q.id = i + 1000;
        ids[q.id] = true;
        q.name = String(p.name || '').slice(0, 40);
        q.lat = Number(p.lat); q.lng = Number(p.lng);
        q.driver = !!p.driver;
        q.seats = Math.min(12, Math.max(1, p.seats | 0));
        if (q.driver && (s.v | 0) < 2) q.seats = Math.min(12, q.seats + 1); // v1→v2: era hueco libre, ahora asiento total
        q.drive = (p.drive === 'ida' || p.drive === 'vuelta') ? p.drive : 'both';
        q.noReturn = !!p.noReturn;
        q.alone = !!p.alone;
        q.aloneText = String(p.aloneText || '').slice(0, 40);
        q.prefDriver = isFinite(+p.prefDriver) ? +p.prefDriver : 0;
        q.prefScope = (p.prefScope === 'ida' || p.prefScope === 'vuelta') ? p.prefScope : 'both';
        out.people.push(q);
      });
    }
    if (s.settings && typeof s.settings === 'object') {
      var t = s.settings;
      if (t.mode === 'sum' || t.mode === 'spread') out.settings.mode = t.mode;
      out.settings.word = String(t.word || '').slice(0, 40) || out.settings.word;
      out.settings.arrive = parseTime(t.arrive, 1245) !== 1245 ? t.arrive : out.settings.arrive;
      out.settings.departOut = t.departOut || out.settings.departOut;
      out.settings.returnT = t.returnT || out.settings.returnT;
      out.settings.fuel = Math.min(5, Math.max(0, isFinite(+t.fuel) ? +t.fuel : 0.15));
      out.settings.keepGroups = !!t.keepGroups;
      out.settings.marginMode = (t.marginMode === 'manual') ? 'manual' : 'auto';
      out.settings.margin = Math.min(120, Math.max(0, isFinite(+t.margin) ? +t.margin : 10));
    }
    return out;
  }
  function encodeState(s) {
    var b = btoa(unescape(encodeURIComponent(JSON.stringify(s))));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeState(h) {
    var b = h.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b))));
  }
  var state = defaultState();

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* noop */ }
    var hash = '#s=' + encodeState(state);
    try { history.replaceState(null, '', hash); } catch (e) { /* noop */ }
  }
  function bootState() {
    var m = /^#s=(.+)$/.exec(location.hash || '');
    if (m) {
      try {
        var s = sanitizeState(decodeState(m[1]));
        if (s) { state = s; return; }
      } catch (e) { /* hash corrupto → borrador */ }
    }
    try {
      var d = localStorage.getItem(LS_KEY);
      if (d) {
        var s2 = sanitizeState(JSON.parse(d));
        if (s2) state = s2;
      }
    } catch (e) { /* noop */ }
  }
  function nextId() {
    var mx = 0;
    state.people.forEach(function (p) { if (p.id > mx) mx = p.id; });
    return mx + 1;
  }

  /* ================= mapa ================= */
  var map = null, markers = {}, pinCounter = 0;
  function initMap() {
    map = window.L.map('map', { zoomControl: true });
    window.L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);
    map.setView([43.3480, -3.0110], 13);
    map.on('click', onMapClick);
  }
  function pinIcon(kind, label) {
    var cls = 'pin pin-' + kind;
    var txt = kind === 'venue' ? '🍽️' : (kind === 'driver' ? '🚗' : esc(label || '?'));
    return window.L.divIcon({
      className: '',
      html: '<div class="' + cls + '"><span>' + txt + '</span></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 24]
    });
  }
  function redrawMarkers() {
    if (!map) return;
    Object.keys(markers).forEach(function (k) { map.removeLayer(markers[k]); });
    markers = {};
    state.people.forEach(function (p, i) {
      if (p.lat == null) return;
      markers['p' + p.id] = window.L.marker([p.lat, p.lng], {
        icon: pinIcon(p.driver ? 'driver' : 'pax', (p.name || p.id).charAt(0).toUpperCase())
      }).addTo(map).bindTooltip((p.name || 'Amigo') + (p.driver ? ' · ' + p.seats + ' plazas (tú incluido) → ' + Math.max(0, p.seats - 1) + ' pasajeros' : ''), { direction: 'top' });
      markers['p' + p.id]._pid = p.id;
    });
    if (state.venue) {
      markers.venue = window.L.marker([state.venue.lat, state.venue.lng], { icon: pinIcon('venue') })
        .addTo(map).bindTooltip(state.venue.name || 'Restaurante', { direction: 'top' });
    }
  }
  function fitAll() {
    if (!map) return;
    var pts = [];
    state.people.forEach(function (p) { if (p.lat != null) pts.push([p.lat, p.lng]); });
    if (state.venue) pts.push([state.venue.lat, state.venue.lng]);
    if (pts.length > 1) map.fitBounds(window.L.latLngBounds(pts).pad(0.25));
    else if (pts.length === 1) map.setView(pts[0], 15);
  }

  /* ---------- modo colocación ---------- */
  var placing = null; // {type:'venue'|'person'|'move', draft}
  function showHint(text) {
    $('#mapHintText').textContent = text;
    $('#mapHint').classList.remove('hidden');
  }
  function hideHint() { $('#mapHint').classList.add('hidden'); }
  function startPlaceVenue() {
    placing = { type: 'venue' };
    showHint('Haz clic en el mapa donde está el sitio 🍽️');
  }
  function startPlacePerson() {
    placing = { type: 'person', draft: newPerson(nextId()) };
    showHint('Haz clic en el mapa cerca de la casa del nuevo amigo 📍');
  }
  function startMovePerson(pid) {
    placing = { type: 'move', pid: pid };
    var p = personById(pid);
    showHint('Haz clic en el mapa para recolocar a ' + (p && p.name ? p.name : 'el amigo') + ' 📍');
  }
  function cancelPlacing() { placing = null; hideHint(); renderPeople(); }
  function onMapClick(e) {
    if (!placing) return;
    var pt = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (placing.type === 'venue') {
      state.venue = { lat: pt.lat, lng: pt.lng, name: state.venue ? state.venue.name : '' };
      placing = null; hideHint();
      renderVenue(); persist(); redrawMarkers(); fitAll();
    } else if (placing.type === 'person') {
      var d = placing.draft;
      d.lat = pt.lat; d.lng = pt.lng;
      d.name = d.name || ('Amigo ' + (state.people.length + 1));
      state.people.push(d);
      placing = null; hideHint();
      persist(); renderPeople(); redrawMarkers(); fitAll();
      var el = document.querySelector('.person[data-id="' + d.id + '"] .pname');
      if (el) el.focus();
    } else if (placing.type === 'move') {
      var p = personById(placing.pid);
      if (p) { p.lat = pt.lat; p.lng = pt.lng; persist(); redrawMarkers(); renderPeople(); }
      placing = null; hideHint();
    }
  }
  function personById(id) {
    for (var i = 0; i < state.people.length; i++) if (state.people[i].id === id) return state.people[i];
    return null;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && placing) cancelPlacing(); });
  $('#mapHintCancel').addEventListener('click', cancelPlacing);

  /* ================= buscador (Nominatim) ================= */
  function attachSearch(inputSel, resultsSel) {
    var input = $(inputSel), box = $(resultsSel);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });
    box.addEventListener('focusout', function () {
      setTimeout(function () { if (!box.contains(document.activeElement)) box.classList.add('hidden'); }, 150);
    });
    function doSearch() {
      var q = input.value.trim();
      if (q.length < 3) return;
      fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' + encodeURIComponent(q),
        { headers: { 'Accept-Language': 'es' } })
        .then(function (r) { return r.json(); })
        .then(function (list) {
          box.innerHTML = '';
          (list || []).forEach(function (it) {
            var b = document.createElement('button');
            b.textContent = it.display_name;
            b.addEventListener('click', function () {
              box.classList.add('hidden');
              input.value = '';
              chosePoint({ lat: parseFloat(it.lat), lng: parseFloat(it.lon) });
            });
            box.appendChild(b);
          });
          box.classList.toggle('hidden', !(list || []).length);
        })
        .catch(function () { toast('No se pudo buscar (¿sin internet?)', 'err'); });
    }
  }
  function chosePoint(pt) {
    if (placing && placing.type === 'venue') {
      state.venue = { lat: pt.lat, lng: pt.lng, name: state.venue ? state.venue.name : '' };
      cancelPlacing();
    } else if (placing && (placing.type === 'person' || placing.type === 'move')) {
      onMapClick({ latlng: pt });
    } else {
      state.venue = { lat: pt.lat, lng: pt.lng, name: state.venue ? state.venue.name : '' };
    }
    renderVenue(); persist(); redrawMarkers(); fitAll();
  }
  attachSearch('#venueSearch', '#venueSearchResults');

  /* ================= panel ================= */
  function renderVenue() {
    var info = $('#venueInfo');
    if (state.venue) {
      $('#venueName').classList.remove('hidden');
      $('#venueName').value = state.venue.name;
      info.innerHTML = '<div class="chip-pin">📍 ' + state.venue.lat.toFixed(5) + ', ' + state.venue.lng.toFixed(5) + '</div>';
    } else {
      $('#venueName').classList.add('hidden');
      info.textContent = 'Aún no has marcado el destino. Pulsa «Marcar en el mapa» o busca abajo y haz clic donde está.';
    }
  }
  function renderPeople() {
    var list = $('#peopleList');
    $('#peopleCount').textContent = state.people.length ? state.people.length : '';
    var driverList = state.people.filter(function (q) { return q.driver && !q.alone; });
    var html = '';
    state.people.forEach(function (p) {
      var geo = p.lat == null ? '<div class="p-geo missing">📍 sin pin — pulsa «recolocar»</div>'
        : '<div class="p-geo">📍 ' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</div>';
      var dOpts = p.driver
        ? '<span class="p-driver-opts"><span>plazas totales (tú incluido)</span><input class="pseats" type="number" min="1" max="12" value="' + p.seats + '">' +
          '<select class="pdrive">' +
          '<option value="both"' + (p.drive === 'both' ? ' selected' : '') + '>ida y vuelta</option>' +
          '<option value="ida"' + (p.drive === 'ida' ? ' selected' : '') + '>solo ida</option>' +
          '<option value="vuelta"' + (p.drive === 'vuelta' ? ' selected' : '') + '>solo vuelta</option>' +
          '</select></span>'
        : '';
      var transportOpts = p.alone
        ? '<input class="palone-text" type="text" placeholder="moto, taxi, coche ajeno…" value="' + esc(p.aloneText) + '" style="max-width:150px"> '
        : '';
      var prefOpts = (!p.driver && !p.alone && driverList.length)
        ? '<span class="p-pref">va sí o sí con <select class="ppref">' +
          '<option value="0"' + (!p.prefDriver ? ' selected' : '') + '>— libre —</option>' +
          driverList.map(function (d) {
            return '<option value="' + d.id + '"' + (p.prefDriver === d.id ? ' selected' : '') + '>' + esc(d.name || 'Amigo') + '</option>';
          }).join('') +
          '</select><select class="pprefscope">' +
          '<option value="both"' + (p.prefScope === 'both' ? ' selected' : '') + '>ida y vuelta</option>' +
          '<option value="ida"' + (p.prefScope === 'ida' ? ' selected' : '') + '>solo ida</option>' +
          '<option value="vuelta"' + (p.prefScope === 'vuelta' ? ' selected' : '') + '>solo vuelta</option>' +
          '</select></span>'
        : '';
      html +=
        '<div class="person' + (placing && placing.draft && placing.draft.id === p.id ? ' pending' : '') + '" data-id="' + p.id + '">' +
        '<div class="p-top">' +
        '<input class="pname" value="' + esc(p.name) + '" placeholder="Nombre…">' +
        '<button class="ghost pmove" title="Recolocar pin">📍</button>' +
        '<button class="ghost pdel" title="Quitar">🗑️</button>' +
        '</div>' + geo +
        '<div class="p-chips">' +
        '<label><input type="checkbox" class="pdriver"' + (p.driver ? ' checked' : '') + '>🚗 conduce</label>' +
        dOpts +
        '<label><input type="checkbox" class="pnoreturn"' + (p.noReturn ? ' checked' : '') + '>no vuelve 🏠</label>' +
        '</div>' +
        '<div class="p-chips">' +
        '<label><input type="checkbox" class="palone"' + (p.alone ? ' checked' : '') + '>🛴 otro transporte</label>' +
        transportOpts +
        prefOpts +
        '</div></div>';
    });
    list.innerHTML = html;
    Array.prototype.forEach.call(list.querySelectorAll('.person'), function (card) {
      var id = parseInt(card.getAttribute('data-id'), 10);
      var p = personById(id);
      card.querySelector('.pname').addEventListener('input', function (e) { p.name = e.target.value.slice(0, 40); persist(); });
      card.querySelector('.pmove').addEventListener('click', function () { startMovePerson(id); });
      card.querySelector('.pdel').addEventListener('click', function () {
        state.people = state.people.filter(function (q) { return q.id !== id; });
        persist(); renderPeople(); redrawMarkers();
      });
      card.querySelector('.pdriver').addEventListener('change', function (e) {
        p.driver = e.target.checked;
        if (p.driver) p.alone = false;
        persist(); renderPeople();
      });
      var seats = card.querySelector('.pseats');
      if (seats) seats.addEventListener('change', function (e) { p.seats = Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 1)); e.target.value = p.seats; persist(); });
      var drive = card.querySelector('.pdrive');
      if (drive) drive.addEventListener('change', function (e) { p.drive = e.target.value; persist(); });
      card.querySelector('.pnoreturn').addEventListener('change', function (e) { p.noReturn = e.target.checked; persist(); });
      card.querySelector('.palone').addEventListener('change', function (e) {
        p.alone = e.target.checked;
        if (p.alone) { p.driver = false; p.prefDriver = 0; }
        persist(); renderPeople();
      });
      var aloneText = card.querySelector('.palone-text');
      if (aloneText) aloneText.addEventListener('input', function (e) { p.aloneText = e.target.value.slice(0, 40); persist(); });
      var pref = card.querySelector('.ppref');
      if (pref) pref.addEventListener('change', function (e) { p.prefDriver = parseInt(e.target.value, 10) || 0; persist(); });
      var prefScope = card.querySelector('.pprefscope');
      if (prefScope) prefScope.addEventListener('change', function (e) { p.prefScope = e.target.value; persist(); });
    });
  }

  /* ---------- ajustes ---------- */
  var HELP = {
    fair: 'Minimiza el tiempo en coche de quién peor lo tiene: nadie queda claramente perjudicado.',
    sum: 'Minimiza la suma total de minutos-persona: el reparto más eficiente globalmente.',
    spread: 'Todos salen de casa a la misma hora; llega antes quien tenga un trayecto más corto.'
  };
  function applyModeUI() {
    var m = state.settings.mode;
    $('#helpMode').textContent = HELP[m];
    $('#helpMode').classList.remove('hidden');
    $('#wrapDepart').classList.toggle('hidden', m !== 'spread');
  }
  function bindSettings() {
    $('#inMode').value = state.settings.mode;
    $('#inEvent').value = state.settings.word || '';
    $('#inArrive').value = state.settings.arrive;
    $('#inDepartOut').value = state.settings.departOut;
    $('#inReturn').value = state.settings.returnT;
    $('#inFuel').value = state.settings.fuel;
    $('#inKeepGroups').checked = state.settings.keepGroups;
    $('#inMarginMode').value = state.settings.marginMode;
    $('#inMargin').value = state.settings.margin;
    applyModeUI();

    $('#inEvent').addEventListener('input', function (e) { state.settings.word = e.target.value.slice(0, 40); persist(); });
    $('#inMode').addEventListener('change', function (e) { state.settings.mode = e.target.value; persist(); applyModeUI(); });
    $('#inArrive').addEventListener('change', function (e) { state.settings.arrive = e.target.value; persist(); });
    $('#inDepartOut').addEventListener('change', function (e) { state.settings.departOut = e.target.value; persist(); });
    $('#inReturn').addEventListener('change', function (e) { state.settings.returnT = e.target.value; persist(); });
    $('#inFuel').addEventListener('change', function (e) {
      state.settings.fuel = Math.min(5, Math.max(0, isFinite(+e.target.value) ? +e.target.value : 0));
      persist();
    });
    $('#inKeepGroups').addEventListener('change', function (e) { state.settings.keepGroups = e.target.checked; persist(); });
    $('#inMarginMode').addEventListener('change', function (e) {
      state.settings.marginMode = (e.target.value === 'manual') ? 'manual' : 'auto';
      persist(); renderResults();
    });
    $('#inMargin').addEventListener('change', function (e) {
      var v = Math.min(120, Math.max(0, isFinite(+e.target.value) ? +e.target.value : 0));
      state.settings.margin = v; e.target.value = v; persist(); renderResults();
    });
    $('#venueName').addEventListener('input', function (e) {
      if (state.venue) { state.venue.name = e.target.value; persist(); }
    });
  }

  /* ---------- ORS key ---------- */
  var ORS_LS = 'reparto-cars-orskey';
  /* La clave ORS NO va en texto claro: está cifrada (XOR) con la palabra de paso
     de la pantalla de entrada. Solo se descifra al entrar, y queda guardada en el
     localStorage del navegador autorizado. Para rotarla: nueva ORS key → recalcular
     ENC_ORS (XOR con la pass) y subir el hash GATE_SHA si cambia la palabra. */
  var GATE_SHA = 'ab57c8087ca74ef63c06f6fc3fe6768093ad2bdedb0c6fb0a18290c72967d382';
  var ENC_ORS = 'Jko5BlcfB1k8KnpCKV48DmonDgI8JFdGKmQ2O34nMUM/IHYZGVkqCXo2A1k/AHkDKnc7UnkZGgIpJ24fPWc9Kn0nOU09IGFDDncxGXo2IUk9cX0ZKnArVn83BV4+CnofLVkEKlIwOQI7CQFCIF5CQVcYPQA6LQNO';
  var UNLOCK_LS = 'reparto-cars-unlock';
  function decodeKey(pass) {
    var pb = [], i, out = '';
    for (i = 0; i < pass.length; i++) pb.push(pass.charCodeAt(i));
    var bin;
    try { bin = atob(ENC_ORS); } catch (e) { return ''; }
    for (i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i) ^ pb[i % pb.length]);
    return out;
  }
  function sha256Hex(s) {
    var data = new TextEncoder().encode(s);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      var arr = new Uint8Array(buf), hex = '';
      for (var i = 0; i < arr.length; i++) hex += ('0' + arr[i].toString(16)).slice(-2);
      return hex;
    });
  }
  function getORSKey() {
    try { return localStorage.getItem(ORS_LS) || ''; } catch (e) { return ''; }
  }
  function orsUIState() {
    var saved = null, k;
    try { saved = localStorage.getItem(ORS_LS); } catch (e) { /* noop */ }
    k = getORSKey();
    $('#orsKey').value = k;
    var badge = $('#orsBadge');
    if (k && saved) { badge.textContent = 'clave ORS lista'; badge.className = 'badge ok'; }
    else if (k) { badge.textContent = 'clave ORS lista ✔'; badge.className = 'badge ok'; }
    else { badge.textContent = 'OSRM demo (tiempos reales)'; badge.className = 'badge ok'; }
  }
  /* ---------- puerta de entrada (+ reparto de la clave ORS) ---------- */
  function gateLocked() {
    try { return localStorage.getItem(UNLOCK_LS) !== GATE_SHA; } catch (e) { return true; }
  }
  function gateShow() {
    $('#gateOverlay').classList.remove('hidden');
    var inp = $('#gatePass');
    inp.value = '';
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 120); // transition
  }
  function gateHide() {
    $('#gateOverlay').classList.add('hidden');
  }
  function gateError(msg) {
    var el = $('#gateErr');
    el.textContent = msg;
    el.classList.remove('hidden');
    try { $('#gateCard').style.animation = 'none'; void $('#gateCard').offsetWidth; $('#gateCard').style.animation = ''; } catch (e) { /* noop */ }
  }
  function gateTry(pass) {
    sha256Hex(pass).then(function (hex) {
      if (hex !== GATE_SHA) { gateError('Palabra incorrecta. Prueba otra vez.'); return; }
      try {
        localStorage.setItem(UNLOCK_LS, GATE_SHA);
        if (!localStorage.getItem(ORS_LS)) localStorage.setItem(ORS_LS, decodeKey(pass));
      } catch (e) { /* modo privado: no persiste; el intento sigue funcionando esta sesión */ }
      gateHide();
      orsUIState();
      toast('Bienvenida al plan ✔ — tiempos de conducción reales activados', 'ok', 5000);
    }).catch(function () { gateError('No se pudo verificar (¿navegador muy viejo?)'); });
  }
  function gateInit() {
    $('#gateGo').addEventListener('click', function () {
      var v = $('#gatePass').value;
      if (!v) { gateError('Escribe la palabra de paso'); return; }
      gateTry(v);
    });
    $('#gatePass').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('#gateGo').click();
    });
    if (gateLocked()) gateShow();
  }
  $('#btnSaveKey').addEventListener('click', function () {
    var k = $('#orsKey').value.trim();
    if (!k) return toast('Pega antes tu clave de OpenRouteService', 'err');
    try { localStorage.setItem(ORS_LS, k); } catch (e) { /* noop */ }
    orsUIState();
    toast('Clave guardada: ahora los tiempos son reales ✔', 'ok');
  });
  $('#btnClearKey').addEventListener('click', function () {
    try { localStorage.removeItem(ORS_LS); } catch (e) { /* noop */ }
    orsUIState();
    toast('Clave borrada: volvemos a la estimación');
  });

  /* ================= matrices ================= */
  var matrixCache = {};
  function buildPoints() {
    var pts = state.people.map(function (p) { return { lat: p.lat, lng: p.lng }; });
    pts.push({ lat: state.venue.lat, lng: state.venue.lng });
    return pts;
  }
  function estimatedMatrices(pts) {
    var n = pts.length, dur = [], dis = [];
    var CIRCUITY = 1.35, SPEED = 45 * 1000 / 60; // m/min
    for (var i = 0; i < n; i++) {
      dur[i] = []; dis[i] = [];
      for (var j = 0; j < n; j++) {
        if (i === j) { dur[i][j] = 0; dis[i][j] = 0; continue; }
        var d = havMeters(pts[i], pts[j]) * CIRCUITY;
        dis[i][j] = d;
        dur[i][j] = d / SPEED;
      }
    }
    return { dur: dur, dist: dis, real: false };
  }
  function fetchORSMatrix(pts, key) {
    var url = 'https://api.openrouteservice.org/v2/matrix/driving-car';
    var locs = pts.map(function (p) { return [p.lng, p.lat]; });
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 25000);
    return fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Authorization': key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ locations: locs, metrics: ['duration', 'distance'], resolve_locations: true })
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error((j && (j.error || j.msg)) ? String(j.error || j.msg) : 'ORS HTTP ' + res.status);
        });
      }
      return res.json();
    }).then(function (j) {
      if (!j || !j.durations || !j.distances) throw new Error('Respuesta de ORS inesperada');
      var dur = j.durations.map(function (row) {
        return row.map(function (x) { return (x == null || !isFinite(x)) ? Infinity : x / 60; });
      });
      var dis = j.distances.map(function (row) {
        return row.map(function (x) { return (x == null || !isFinite(x)) ? Infinity : x; });
      });
      return { dur: dur, dist: dis, real: true };
    }).catch(function (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('ORS tardó demasiado (respuesta abortada)');
      throw e;
    });
  }
  function osrmMatrix(pts) {
    var coords = pts.map(function (p) { return p.lng.toFixed(6) + ',' + p.lat.toFixed(6); }).join(';');
    var url = 'https://router.project-osrm.org/table/v1/driving/' + coords + '?annotations=duration,distance';
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);
    return fetch(url, { signal: ctrl.signal }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('OSRM HTTP ' + res.status);
      return res.json();
    }).then(function (j) {
      if (!j || j.code !== 'Ok' || !j.durations) throw new Error('OSRM: respuesta inesperada');
      var dur = j.durations.map(function (row) {
        return row.map(function (x) { return (x == null || !isFinite(x)) ? Infinity : x / 60; });
      });
      var dis = (j.distances ||
        j.durations.map(function (row) {
          return row.map(function (x) { return x > 0 ? x * (45 * 1000 / 3600) : 0; });
        })).map(function (row) {
          return row.map(function (x) { return (x == null || !isFinite(x)) ? Infinity : x; });
        });
      return { dur: dur, dist: dis, real: true, provider: 'osrm' };
    }).catch(function (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('OSRM tardó demasiado');
      throw e;
    });
  }
  function countNulls(m) {
    var n = m.dur.length, c = 0;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) if (!isFinite(m.dur[i][j]) || !isFinite(m.dist[i][j])) c++;
    return c;
  }
  function isolatedNodeNames(m) {
    // índices cuya fila O columna está entera (o casi) vacía → pin en zona sin coches
    var n = m.dur.length, bad = [], i, j, nulls;
    for (i = 0; i < n - 1; i++) { // solo personas (la última es el destino)
      nulls = 0;
      for (j = 0; j < n; j++) if (!isFinite(m.dur[i][j])) nulls++;
      var colNulls = 0;
      for (j = 0; j < n; j++) if (!isFinite(m.dur[j][i])) colNulls++;
      if (nulls > n - 2 || colNulls > n - 2) bad.push(i);
    }
    return bad.map(function (i) { return (state.people[i] && state.people[i].name) ? state.people[i].name : 'Amigo ' + (i + 1); });
  }
  function getMatrices() {
    var pts = buildPoints();
    var key = getORSKey();
    function coordsKey(provider) {
      return provider + '::' + pts.map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }).join(';');
    }
    function osrmOrEst(errMsg) {
      var ck2 = coordsKey('osrm');
      if (matrixCache[ck2]) return Promise.resolve(matrixCache[ck2]);
      return osrmMatrix(pts).then(function (m) {
        var nn = countNulls(m);
        if (nn === 0) {
          m.provider = 'osrm';
          m.note = errMsg ? '⚠️ ' + errMsg + ' → tiempos reales vía OSRM (servidor demo).' : null;
          matrixCache[ck2] = m;
          return m;
        }
        var m2 = estimatedMatrices(pts);
        m2.provider = 'est';
        m2.note = '⏱️ OSRM dejó ' + nn + ' huecos: tiempos ESTIMADOS (recta ×1,4 a 45 km/h).';
        return m2;
      }).catch(function (e2) {
        var m2 = estimatedMatrices(pts);
        m2.provider = 'est';
        m2.note = '⏱️ ' + (errMsg ? errMsg + ' y ' : '') + 'OSRM no contesta (' + (e2.message || 'error') + '): tiempos ESTIMADOS (recta ×1,4 a 45 km/h).';
        return m2;
      });
    }
    if (key) {
      var ckO = coordsKey('ors');
      if (matrixCache[ckO]) return Promise.resolve(matrixCache[ckO]);
      return fetchORSMatrix(pts, key).then(function (m) {
        var nn = countNulls(m);
        if (nn === 0) {
          m.provider = 'ors';
          matrixCache[ckO] = m;
          return m;
        }
        var aisladas = isolatedNodeNames(m);
        var msg = 'ORS dejó ' + nn + ' huecos' + (aisladas.length ? ' (pins sin acceso en coche: ' + aisladas.join(', ') + ')' : '');
        return osrmOrEst(msg).then(function (m2) {
          if (m2.provider !== 'est') m2.note += '. Recomendación: recolocar ' + (aisladas.length ? 'el pin de ' + aisladas.join(', ') : 'el pin') + ' en la calle y recalcular.';
          return m2;
        });
      }).catch(function (e) {
        return osrmOrEst('ORS falló (' + (e.message || 'error') + ')');
      });
    }
    // sin clave: OSRM demo (tiempos reales, sin registro) con vuelco a estimación
    return osrmOrEst(null);
  }

  /* ================= cómputo ================= */
  var lastSol = null;
  function setBusy(b, txt) {
    var btn = $('#btnCalc');
    btn.disabled = b;
    btn.textContent = b ? '⏳ ' + (txt || 'Calculando…') : '🧮 Calcular reparto';
  }
  function driveInDir(p, dir) {
    if (!p || !p.driver) return false;
    if (dir === 'out') return p.drive === 'both' || p.drive === 'ida';
    return (p.drive === 'both' || p.drive === 'vuelta') && !p.noReturn;
  }
  /* scope «sí o sí con» (español) ↔ dirección interna (out/rtn) */
  function prefApplies(q, dir) {
    if (!q || !q.prefDriver) return false;
    if (q.prefScope === 'both') return true;
    if (dir === 'out') return q.prefScope === 'ida';
    return q.prefScope === 'vuelta';
  }
  function solveOne(mats, mode, dir, keepGroupsFromOut, skipNode) {
    var people = state.people, n = people.length;
    var cars = [], pax = [], paxId = [];
    people.forEach(function (p, i) {
      var drives = driveInDir(p, dir) && i !== skipNode;
      if (drives) cars.push({ driverNode: i, cap: Math.max(0, p.seats - 1) }); // seats = asientos totales → huecos para pasajeros
      if (!p.driver && !p.alone && (dir === 'out' || !p.noReturn)) { pax.push({ node: i }); paxId.push(p.id); }
    });
    var opts = {
      direction: dir,
      venueNode: n,
      pax: pax,
      cars: cars,
      mDur: mats.dur,
      mDist: mats.dist,
      mode: mode
    };
    var full = (1 << pax.length) - 1;

    // — restricción DURA: "va sí o sí con X" (según scope y dirección activa) —
    var needPref = paxId.some(function (pid) {
      var q = personById(pid);
      return prefApplies(q, dir);
    });
    var hard = null;
    if (needPref) {
      hard = cars.map(function () { return 0; });
      pax.forEach(function (px, b) {
        var q = personById(paxId[b]);
        var prefActive = prefApplies(q, dir);
        if (!prefActive) return; // libre: todas las máscaras cubren este bit más abajo
        var target = personById(q.prefDriver);
        if (!target || !driveInDir(target, dir)) return; // precheck ya avisó; aquí es infactible
        var ti = people.indexOf(target);
        for (var ci = 0; ci < cars.length; ci++) {
          if (cars[ci].driverNode === ti) { hard[ci] |= (1 << b); break; }
        }
      });
      // los bits sin restricción van en TODOS los coches
      pax.forEach(function (px, b) {
        var q = personById(paxId[b]);
        var prefActive = prefApplies(q, dir);
        if (!prefActive) cars.forEach(function (_c, ci) { hard[ci] |= (1 << b); });
      });
    }

    // — restricción SUAVE: mismos grupos que la ida (solo vuelta / keepGroups) —
    var soft = null;
    if (dir === 'rtn' && keepGroupsFromOut && keepGroupsFromOut.ok) {
      var nodeToOutDriver = {};
      keepGroupsFromOut.cars.forEach(function (c) {
        c.order.forEach(function (node) { nodeToOutDriver[node] = c.driverNode; });
      });
      soft = cars.map(function (car) {
        var mask = 0, any = false;
        pax.forEach(function (px, b) {
          if (nodeToOutDriver[px.node] === car.driverNode) { mask |= (1 << b); any = true; }
          else if (nodeToOutDriver[px.node] == null) { mask |= (1 << b); any = true; } // coche "solo vuelta"
        });
        return any ? mask : 0;
      });
    }

    // combinación: dura ∩ suave (si coexisten)
    var restriction = null;
    if (hard && soft) restriction = hard.map(function (m, ci) { return m & (soft[ci] === undefined ? full : soft[ci]); });
    else if (hard) restriction = hard;
    else if (soft) restriction = soft;
    if (restriction && vehiclesAnyZero(restriction, full)) {
      // algún pax queda sin ningún coche posible: primera causa de infactibilidad
      opts.restriction = restriction;
      opts.restrictionHard = !!hard;
      return Solver.solveDirection(opts); // responderá restrictionFailed
    }
    if (restriction) {
      opts.restriction = restriction;
      opts.restrictionHard = !!hard;
    }
    return Solver.solveDirection(opts);
  }
  function vehiclesAnyZero(masks, full) {
    // ¿máscara conjunta por pasajero nula? (indicador rápido de infactibilidad)
    var n = masks.length;
    if (!n) return false;
    var union = 0, i;
    for (i = 0; i < n; i++) union |= masks[i];
    return (union & full) !== full; // si algún pax no aparece en ninguna máscara
  }

  function precheckHard(dir) {
    var msgs = [];
    state.people.forEach(function (p) {
      if (p.driver || p.alone || !p.prefDriver) return;
      if (!prefApplies(p, dir)) return;
      var target = personById(p.prefDriver);
      var who = p.name || 'Alguien';
      if (!target) { msgs.push(who + ' va sí o sí con alguien que ya no está en la lista (revisa su tarjeta)'); return; }
      if (!target.driver) { msgs.push(who + ' va sí o sí con ' + (target.name || 'amigo') + ', pero ' + (target.name || 'ese') + ' no conduce'); return; }
      if (!driveInDir(target, dir)) {
        msgs.push(who + ' va sí o sí con ' + (target.name || 'amigo') + ', pero ' + (target.name || 'ese') + ' no conduce ' + (dir === 'out' ? 'en la ida' : 'a la vuelta'));
      }
    });
    return msgs.length ? msgs.join(' · ') : null;
  }

  function bufferFor(dMin) {
    if (state.settings.marginMode === 'manual') return Math.max(0, +state.settings.margin || 0);
    return Math.max(5, Math.round(dMin * 0.07 + 3));
  }
  function outSchedule(car) {
    var mode = state.settings.mode;
    if (mode === 'spread') {
      return { depart: parseTime(state.settings.departOut, 1200), buf: bufferFor(car.D), advisory: true };
    }
    var buf = bufferFor(car.D);
    return { depart: parseTime(state.settings.arrive, 1245) - car.D - buf, buf: buf, advisory: false };
  }

  function fleetAnalysis(mats, mode, out, rtn) {
    var rows = [];
    var base = scoreMode(mode, out, rtn);
    var nodeSaving = {};
    [out, rtn].forEach(function (s) {
      if (!s) return;
      s.cars.forEach(function (c) {
        if (!(c.dist > 0) || c.order.length === 0) return;
        nodeSaving[c.driverNode] = (nodeSaving[c.driverNode] || 0) + c.dist / 1000 * state.settings.fuel;
      });
    });
    var drivers = Object.keys(nodeSaving).map(Number);
    // también probar con conductores sin pasajeros (coches que van solos)
    [out, rtn].forEach(function (s) {
      if (!s) return;
      s.cars.forEach(function (c) { if (drivers.indexOf(c.driverNode) === -1) drivers.push(c.driverNode); });
    });
    drivers.forEach(function (dn) {
      var outR = solveOne(mats, mode, 'out', null, dn);
      var rtnR = rtn ? solveOne(mats, mode, 'rtn', null, dn) : null;
      var row = {
        node: dn,
        name: (state.people[dn] && state.people[dn].name) || 'Amigo',
        saving: Math.round((nodeSaving[dn] || 0) * 100) / 100,
        feasible: !!(outR.ok && (!rtn || rtnR.ok)),
        why: ''
      };
      if (!outR.ok) row.why = outR.restrictionFailed
        ? 'la promesa «va sí o sí con…» quedaría imposible sin este coche'
        : 'sin ese coche faltan ' + outR.missingSeats + ' huecos en la ida';
      else if (rtn && !rtnR.ok) row.why = rtnR.restrictionFailed
        ? 'la promesa «va sí o sí con…» quedaría imposible sin este coche (vuelta)'
        : 'sin ese coche faltan ' + rtnR.missingSeats + ' huecos en la vuelta';
      else {
        var alt = scoreMode(mode, outR, rtnR);
        row.delta = [alt[0] - base[0], alt[1] - base[1], alt[2] - base[2]];
      }
      rows.push(row);
    });
    return { mode: mode, base: base, rows: rows };
  }
  function scoreMode(mode, out, rtn) {
    // vector de referencia equivalente al del solver, agregando ida+vuelta
    function part(s) {
      if (!s) return { maxRide: 0, rideSum: 0, sumD: 0, maxD: 0, total: 0 };
      return { maxRide: s.metrics.rideMax, rideSum: s.metrics.rideSum, sumD: s.metrics.sumD, maxD: s.metrics.maxD, total: s.metrics.total || 0 };
    }
    var o = part(out), r = part(rtn);
    if (mode === 'fair') return [Math.max(o.maxRide, r.maxRide), o.rideSum + r.rideSum, o.sumD + r.sumD];
    if (mode === 'sum') return [o.total + r.total, Math.max(o.maxD, r.maxD), o.rideSum + r.rideSum];
    return [Math.max(o.maxD, r.maxD), o.sumD + r.sumD, o.rideSum + r.rideSum]; // spread
  }

  function compute() {
    if (!state.venue) { toast('Primero marca el punto de destino en el mapa', 'err'); return; }
    if (!state.people.length) { toast('Añade al menos a los pasajeros', 'err'); return; }
    var missing = state.people.filter(function (p) { return p.lat == null || p.lng == null; });
    if (missing.length) { toast('A ' + missing[0].name + ' le falta el pin en el mapa', 'err'); return; }
    var errOut = precheckHard('out');
    if (errOut) { toast('No se puede cumplir la promesa: ' + errOut, 'err', 9000); return; }
    setBusy(true);
    getMatrices().then(function (mats) {
      var mode = state.settings.mode;
      var out = solveOne(mats, mode, 'out', null);
      if (!out.ok) throw solveError(out, 'cada uno al salir');
      var rtn = null, retroNota = '';
      var hayVuelta = state.people.filter(function (p) { return !p.noReturn; }).length > 0;
      if (hayVuelta) {
        var errRtn = precheckHard('rtn');
        if (errRtn) { toast('No se puede cumplir la promesa: ' + errRtn, 'err', 9000); return; }
        rtn = solveOne(mats, mode, 'rtn', state.settings.keepGroups ? out : null);
        if (!rtn.ok && rtn.restrictionFailed && state.settings.keepGroups) {
          rtn = solveOne(mats, mode, 'rtn', null); // cae el vínculo suave, quedan las promesas duras
          retroNota = '⚠️ No salieron los mismos grupos a la vuelta (quedó mejor así / plazas).';
        }
        if (!rtn.ok) throw solveError(rtn, 'cada uno a la vuelta');
      }
      var analysis = fleetAnalysis(mats, mode, out, rtn);
      lastSol = { out: out, rtn: rtn, real: !!(mats.real), provider: mats.provider || (mats.real ? 'ors' : 'est'), note: retroNota, mode: mode, analysis: analysis };
      renderResults();
      try { localStorage.setItem('reparto-cars-plan', JSON.stringify(lastSol)); } catch (e) { /* noop */ }
      $('#btnCopyText').classList.remove('hidden');
      $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setBusy(false);
      if (mats.note) toast(mats.note, mats.real ? '' : 'err', 8000);
    }).catch(function (e) {
      setBusy(false);
      toast('No se pudo calcular: ' + (e && e.message ? e.message : e), 'err', 8000);
    });
  }
  function solveError(r, cuando) {
    var msg;
    if (r.missingSeats != null) {
      msg = 'No caben todos los pasajeros: faltan ' + r.missingSeats +
        ' huecos (solo hay ' + r.capTotal + ' para pasajeros). Añade otro conductor o sube las plazas.';
    } else if (r.restrictionFailed) {
      msg = 'Las promesas «va sí o sí con…» no caben: ' + cuando + ' no hay combinación válida. Revisa los vínculos en las tarjetas.';
    } else {
      msg = r.msg || 'No se encontró reparto válido para ' + cuando;
    }
    return new Error(msg);
  }

  /* ================= render resultados ================= */
  function carColor(idx) {
    var colors = getComputedStyle(document.documentElement).getPropertyValue('--car-colors').split(',').map(function (s) { return s.trim(); });
    return colors[idx % colors.length] || 'var(--accent)';
  }
  function venueLabel() { return (state.venue && state.venue.name) ? state.venue.name : 'el sitio 🍽️'; }
  function planWord() { return (state.settings.word || 'cena'); }
  function dirIntro(dir, mode) {
    var vl = (state.venue && state.venue.name) ? esc(state.venue.name) : 'el sitio';
    if (dir === 'out') {
      return mode === 'spread'
        ? 'IDA · todos salen de casa a las ' + fmtTime(parseTime(state.settings.departOut, 1200))
        : 'IDA · llegando todos a ' + vl + ' a las ' + fmtTime(parseTime(state.settings.arrive, 1245));
    }
    return 'VUELTA · saliendo todos de ' + vl + ' a las ' + fmtTime(parseTime(state.settings.returnT, 1410));
  }
  function carCardHTML(dir, car, ci, base, mode) {
    var drv = state.people[car.driverNode];
    var driverName = drv.name || 'Amigo';
    // horario (con margen de seguridad en la ida si no es salida común)
    var sched, depart;
    if (dir === 'out') {
      sched = outSchedule(car);
      depart = sched.depart;
    } else depart = base; // salida común del restaurante
    var lines = [];
    lines.push({ t: depart, label: (dir === 'out' ? 'sale de casa de ' : 'sale de ' + venueLabel() + ' — ') + driverName });
    car.order.forEach(function (node, k) {
      var p = state.people[node];
      var label = p.name || 'Amigo';
      lines.push({ t: depart + car.tau[k], label: (dir === 'out' ? 'recoge a ' : 'deja a ') + label, ride: car.rides[k].ride });
    });
    var endLabel = dir === 'out' ? 'llega a ' + venueLabel() : 'llega a casa de ' + driverName;
    lines.push({ t: depart + car.D, label: endLabel, arr: true });
    var used = car.order.length;   // pasajeros
    var capT = car.cap + 1;        // asientos totales del coche
    var ocupantes = used + 1;      // conductor incluido
    var driveNote = '';
    if (dir === 'out' && drv.drive === 'ida') driveNote = '🚗 solo lleva a la ida — no conduce a la vuelta';
    if (dir === 'rtn') {
      if (drv.drive === 'vuelta') driveNote = '🚗 conduce solo la vuelta';
      var noRtn = drv.noReturn;
      if (noRtn) driveNote = '🏠 ' + driverName + ' no vuelve';
    }
    if (dir === 'out' && sched && !sched.advisory && sched.buf > 0) {
      driveNote = '🛡️ margen de seguridad incluido: ' + sched.buf + ' min (imprevistos, aparcamiento…)';
    }
    var costTxt = '';
    if (state.settings.fuel > 0 && car.dist > 0) {
      var cost = car.dist / 1000 * state.settings.fuel;
      if (used > 0) costTxt = fmtKm(car.dist) + ' → ' + fmtEUR(cost / ocupantes) + ' por persona (' + ocupantes + ', conductor incluido)';
      else costTxt = fmtKm(car.dist) + ' · va solo';
    }
    var html = '<div class="car-card" style="border-top-color:' + carColor(ci) + '">';
    html += '<h3>' + (dir === 'out' ? '🚗' : '🌙') + ' Coche de ' + esc(driverName) +
      '<span class="plazas" title="ocupantes/asientos totales">' + ocupantes + '/' + capT + ' plazas' +
      (used ? ' · 1 conductor + ' + used + (used === 1 ? ' pasajero' : ' pasajeros') : ' · solo conduce') + '</span></h3>';
    lines.forEach(function (l) {
      html += '<div class="car-line"><span class="t">' + fmtTime(l.t) + '</span><span' +
        (l.arr ? ' class="arr"' : '') + '>' + esc(l.label) +
        (l.ride != null ? ' <span class="muted">(' + fmtDur(l.ride) + ' en coche)</span>' : '') + '</span></div>';
    });
    if (driveNote) html += '<div class="car-note">' + esc(driveNote) + '</div>';
    if (costTxt) html += '<div class="car-cost">⛽ ' + esc(costTxt) + ' (' + state.settings.fuel.toFixed(2).replace('.', ',') + ' €/km)</div>';
    html += '</div>';
    return html;
  }

  function renderResults() {
    if (!lastSol) return;
    var mode = lastSol.mode;
    var body = $('#resultsBody');
    var html = '';
    var baseOut = (mode === 'spread') ? parseTime(state.settings.departOut, 1200) : parseTime(state.settings.arrive, 1245);
    var baseRtn = parseTime(state.settings.returnT, 1410);

    // métricas
    function mets(dir) {
      var s = lastSol[dir];
      if (!s) return null;
      return s.metrics;
    }
    var mo = mets('out'), mr = lastSol.rtn ? mets('rtn') : null;
    html += '<div class="metric-strip">';
    if (mo) {
      if (mode === 'fair') html += metric('ida · peor pasajero', fmtDur(mo.rideMax));
      if (mode === 'sum') html += metric('ida · tiempo total', fmtDur(mo.total));
      if (mode === 'spread') html += metric('ida · última llegada', fmtTime(baseOut + mo.maxD));
    }
    if (mr) {
      if (mode === 'fair') html += metric('vuelta · peor pasajero', fmtDur(mr.rideMax));
      if (mode === 'sum') html += metric('vuelta · tiempo total', fmtDur(mr.total));
      if (mode === 'spread') html += metric('vuelta · última en llegar a casa', fmtTime(baseRtn + mr.maxD));
    }
    html += metric('⏱️ tiempos', lastSol.provider === 'ors' ? 'reales (OpenRouteService)'
      : lastSol.provider === 'osrm' ? 'reales (OSRM demo)' : 'estimados');
    html += '</div>';
    if (lastSol.note) html += '<div class="car-note">' + esc(lastSol.note) + '</div>';

    html += '<div class="res-section">' + esc(dirIntro('out', mode)) + '</div><div class="car-grid">';
    lastSol.out.cars.forEach(function (car, ci) { html += carCardHTML('out', car, ci, baseOut, mode); });
    html += '</div>';

    if (lastSol.rtn && lastSol.rtn.cars.length) {
      html += '<div class="res-section">' + esc(dirIntro('rtn', mode)) + '</div><div class="car-grid">';
      lastSol.rtn.cars.forEach(function (car, ci) { html += carCardHTML('rtn', car, ci, baseRtn, mode); });
      html += '</div>';
    }

    // resumen por persona
    html += '<div class="res-section">👤 Resumen por persona</div>' + personTableHTML();
    if (lastSol.analysis && lastSol.analysis.rows && lastSol.analysis.rows.length) {
      html += '<div class="res-section">🔎 ¿Sobra algún coche? (análisis de flota)</div>' + fleetAnalysisHTML(lastSol.analysis);
    }
    body.innerHTML = html;
  }
  function fleetAnalysisHTML(a) {
    var TH = { fair: 10, sum: 30, spread: 10 };
    var rows = a.rows.map(function (r) {
      var res;
      if (!r.feasible) res = '✖ no factible — ' + esc(r.why);
      else {
        var dv = r.delta ? r.delta[0] : 0;
        var lbl = a.mode === 'sum' ? 'persona-min' : 'min';
        var word = a.mode === 'fair' ? 'peor pasajero' : (a.mode === 'sum' ? 'tiempo total' : 'última llegada');
        res = 'saliendo sin él: ' + word + ' pasa de ' + fmtDur(a.base[0]) + ' a ' + fmtDur(a.base[0] + dv) +
          (dv > 0.5 ? ' (+' + (Math.round(dv * 10) / 10) + ' ' + lbl + ')' : ' (igual)');
        if (dv <= TH[a.mode]) res += ' → <strong>se puede quitar ✔</strong>';
      }
      var saving = r.saving > 0 ? 'ahorra ~' + fmtEUR(r.saving) + ' de gasolina (ida+vuelta)' : 'sin coste de gasolina';
      return '<tr><td>🚗 ' + esc(r.name) + '</td><td>' + res + '</td><td>' + esc(saving) + '</td></tr>';
    }).join('');
    return '<table class="person-summary"><thead><tr><th>Coche</th><th>Coste en tiempos</th><th>Ahorro</th></tr></thead><tbody>' +
      rows + '</tbody>' +
      '<tfoot><tr><td colspan="3" class="muted">Comparación con cada coche retirado uno a uno (el resto se reoptimiza). ' +
      'El ahorro es gasolina estimada del propio coche; el coste son los peores tiempos resultantes con el objetivo actual.</td></tfoot></table>';
  }
  function metric(label, value) {
    return '<div class="metric"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }
  function personTableHTML() {
    var idxOut = {}, idxRtn = {};
    lastSol.out.cars.forEach(function (car) {
      idxOut[car.driverNode] = car;
      car.order.forEach(function (node) { idxOut[node] = car; });
    });
    if (lastSol.rtn) lastSol.rtn.cars.forEach(function (car) {
      idxRtn[car.driverNode] = car;
      car.order.forEach(function (node) { idxRtn[node] = car; });
    });
    var rows = '';
    state.people.forEach(function (p, i) {
      if (p.alone) {
        var t = p.aloneText ? ' (' + p.aloneText + ')' : '';
        rows += '<tr><td>' + esc(p.name || 'Amigo') + '</td><td>🛴 otro transporte' + esc(t) +
          '</td><td>🛴 otro transporte' + esc(t) + '</td></tr>';
        return;
      }
      var outC = idxOut[i], rtnC = idxRtn[i];
      var outTxt, rtnTxt;
      if (p.noReturn) rtnTxt = '— no vuelve';
      else if (rtnC) {
        var rbase = parseTime(state.settings.returnT, 1410);
        var at;
        if (rtnC.driverNode === i) at = rbase + rtnC.D;
        else {
          var k2 = rtnC.order.indexOf(i);
          at = rbase + rtnC.tau[k2];
        }
        rtnTxt = '🚗 ' + (state.people[rtnC.driverNode].name || 'Amigo') + ' · a casa ' + fmtTime(at);
      } else rtnTxt = '—';
      if (outC) {
        var sched = outSchedule(outC);
        var tOut;
        if (outC.driverNode === i) tOut = sched.depart;
        else {
          var k = outC.order.indexOf(i);
          tOut = sched.depart + outC.tau[k];
        }
        outTxt = '🚗 ' + (outC.driverNode === i ? 'conduce' : (state.people[outC.driverNode].name || 'Amigo')) + ' · ' + fmtTime(tOut);
      } else outTxt = '—';
      rows += '<tr><td>' + esc(p.name || 'Amigo') + '</td><td>' + esc(outTxt) + '</td><td>' + esc(rtnTxt) + '</td></tr>';
    });
    return '<table class="person-summary"><thead><tr><th>Persona</th><th>Ida</th><th>Vuelta</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---------- copiar resumen ---------- */
  $('#btnCopyText').addEventListener('click', function () {
    if (!lastSol) return;
    var txt = buildSummaryText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('Resumen copiado ✔ pégalo en el grupo', 'ok'); },
        function () { fallbackCopy(txt); });
    } else fallbackCopy(txt);
  });
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Resumen copiado ✔', 'ok'); }
    catch (e) { toast('No se pudo copiar automáticamente', 'err'); }
    document.body.removeChild(ta);
  }
  function buildSummaryText() {
    var mode = lastSol.mode;
    var baseOut = (mode === 'spread') ? parseTime(state.settings.departOut, 1200) : parseTime(state.settings.arrive, 1245);
    var baseRtn = parseTime(state.settings.returnT, 1410);
    var L = [];
    L.push('🚗 REPARTO DE COCHES — ' + planWord() + ' en ' + ((state.venue && state.venue.name) || 'el sitio'));
    L.push(dirIntro('out', mode));
    lastSol.out.cars.forEach(function (car, ci) {
      var drv = state.people[car.driverNode].name || 'Amigo';
      var head = '🚗 Coche de ' + drv;
      L.push('');
      L.push(head);
      var schedW = (mode === 'spread') ? null : outSchedule(car);
      var depart = (mode === 'spread') ? baseOut : (schedW ? schedW.depart : baseOut - car.D);
      L.push('   ' + fmtTime(depart) + ' · sale de casa de ' + drv);
      car.order.forEach(function (node, k) {
        var nm = state.people[node].name || 'Amigo';
        L.push('   ' + fmtTime(depart + car.tau[k]) + ' · recoge a ' + nm);
      });
      L.push('   ' + fmtTime(depart + car.D) + ' · llega a ' + venueLabel());
      if (state.settings.fuel > 0 && car.dist > 0 && car.order.length) {
        var cst = car.dist / 1000 * state.settings.fuel / (car.order.length + 1);
        L.push('   💶 ' + fmtEUR(cst) + ' por persona (conductor incluido · ' + fmtKm(car.dist) + ')');
      }
    });
    if (lastSol.rtn && lastSol.rtn.cars.length) {
      L.push('');
      L.push(dirIntro('rtn', mode));
      lastSol.rtn.cars.forEach(function (car) {
        var drv = state.people[car.driverNode].name || 'Amigo';
        L.push('');
        L.push('🌙 Coche de ' + drv);
        L.push('   ' + fmtTime(baseRtn) + ' · sale de ' + venueLabel());
        car.order.forEach(function (node, k) {
          var nm = state.people[node].name || 'Amigo';
          L.push('   ' + fmtTime(baseRtn + car.tau[k]) + ' · deja a ' + nm);
        });
        L.push('   ' + fmtTime(baseRtn + car.D) + ' · ' + drv + ' llega a casa');
      });
    }
    L.push('');
    L.push('(generado con RepartoCars)');
    return L.join('\n');
  }

  /* ---------- compartir ---------- */
  $('#btnShare').addEventListener('click', function () {
    persist();
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        toast('🔗 Enlace copiado: mándaselo al grupo — cada uno se puede editar su sitio y volver a compartir.', 'ok', 6000);
      }, function () { fallbackCopy(url); toast('Enlace copiado ✔', 'ok'); });
    } else { fallbackCopy(url); toast('Enlace copiado', 'ok'); }
  });

  /* ---------- demo / limpiar ---------- */
  $('#btnDemo').addEventListener('click', function () {
    var names = ['Marta', 'Javier', 'Lucía', 'Dani', 'Carla', 'Álvaro', 'Rocío', 'Pablo', 'Elena', 'Diego', 'Nuria', 'Iván', 'Sara'];
    // Getxo y alrededores (Bizkaia): [lat, lng]
    var homes = [
      [43.3480, -3.0130], // Las Arenas
      [43.3500, -3.0215], // Algorta
      [43.3430, -3.0050], // Neguri
      [43.3345, -3.0040], // Romo
      [43.3305, -3.0255], // Leioa (C/ Landabazarra, junto a la BI-637)
      [43.3450, -3.0190], // Areeta
      [43.2975, -3.0200], // Barakaldo
      [43.3745, -3.0300], // Sopelana
      [43.3205, -3.0210], // Portugalete
      [43.4115, -2.9500], // Plentzia
      [43.3135, -3.0060], // Erandio
      [43.3405, -3.0100], // Neguri alto
      [43.3360, -3.0150]  // Getxo centro
    ];
    state.people = names.map(function (nm, i) {
      var p = newPerson(i + 1);
      p.name = nm;
      p.lat = homes[i][0];
      p.lng = homes[i][1];
      p.driver = i < 4;
      if (p.driver) p.seats = [4, 4, 5, 3][i]; // asientos totales: antes eran 3+3+4+2 huecos libres
      return p;
    });
    state.venue = { lat: 43.3478, lng: -3.0040, name: 'Restaurante (ejemplo) — Puerto Deportivo' };
    persist(); renderPeople(); renderVenue(); redrawMarkers(); fitAll();
    try { localStorage.removeItem('reparto-cars-plan'); } catch (e) { /* noop */ }
    toast('Ejemplo cargado: 13 amigos por Getxo y alrededores, 4 coches (4+4+5+3 asientos totales) y 9 pasajeros. Pulsa calcular 🧮', 'ok', 7000);
  });
  $('#btnClear').addEventListener('click', function () {
    if (!confirm('¿Empezar de cero? Se borra todo lo montado.')) return;
    state = defaultState();
    try { localStorage.removeItem('reparto-cars-plan'); } catch (e) { /* noop */ }
    persist(); renderPeople(); renderVenue(); redrawMarkers();
    map.setView([43.3480, -3.0110], 13);
  });
  $('#btnVenueMark').addEventListener('click', function () {
    if (placing && placing.type === 'venue') cancelPlacing();
    else { startPlaceVenue(); renderPeople(); }
  });
  $('#btnAddPerson').addEventListener('click', function () {
    if (placing && placing.type === 'person') cancelPlacing();
    else { startPlacePerson(); }
  });
  $('#btnCalc').addEventListener('click', compute);

  /* ================= arranque ================= */
  bootState();
  bindSettings();
  gateInit();
  orsUIState();
  try {
    initMap();
  } catch (e) {
    toast('El mapa no cargó (¿sin internet?): puedes seguir configurando y calcular con estimación', 'err', 9000);
  }
  renderVenue();
  renderPeople();
  redrawMarkers();
  if (state.people.length) fitAll();
  // restaurar el último plan calculado (persistencia de resultados)
  try {
    var savedPlan = localStorage.getItem('reparto-cars-plan');
    if (savedPlan) {
      var restored = JSON.parse(savedPlan);
      if (restored && restored.out && restored.out.ok) {
        lastSol = restored;
        renderResults();
        $('#btnCopyText').classList.remove('hidden');
        toast('Último plan calculado restaurado ✔ — pulsa «Calcular» si has cambiado algo.', 'ok', 6000);
      }
    }
  } catch (e) { /* plan corrupto → ignorar */ }
})();
