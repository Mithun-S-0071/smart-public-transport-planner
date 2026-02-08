// static/js/map.js
// Smart Public Transport Planner - Leaflet + TomTom routing/autocomplete + train/bus tracking
// Traffic-based route coloring (green/yellow/red)

// CONFIG
const PROXY_MODE = true; // set true if you are running the Flask proxy endpoints /api/search and /api/route
const TOMTOM_CLIENT_KEY = "YOUR_API_KEY"; // only used if PROXY_MODE === false
const TOMTOM_TILE_KEY = "YOUR_API_KEY"; // used for TomTom traffic tiles (replace with your key)

// Map & traffic
let map;
let trafficLayer;

// Train state
const trainState = {
  marker: null, route: null, last: null, next: null, t0: 0, t1: 0, running: false, fetchInterval: null, firstFetchDone: false
};

// Bus state
const busState = {
  marker: null, route: null, routeStops: null, stopMarkers: [], last: null, next: null, t0: 0, t1: 0, running: false, fetchInterval: null, firstFetchDone: false
};

// Route state
const routeState = { routeLayer: null, start: null, end: null, info: null };

// RAF handles
let trainRAF = null;
let busRAF = null;

/* ================== INIT MAP ================== */
function initMap() {
  if (map) return;

  const center = [11.0168, 76.9558]; // Coimbatore
  map = L.map("map", { center, zoom: 7, zoomControl: true, attributionControl: true });

  // Base tiles
  const lightTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  });
  const darkTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap contributors © CARTO"
  });

  // Traffic tile (TomTom) fallback (openinframap)
  
  // TomTom traffic tiles (only work if you have a valid TOMTOM_TILE_KEY and usage quota)

  // Add chosen base + traffic
  const isDark = document.body.classList.contains("dark");
  (isDark ? darkTiles : lightTiles).addTo(map);
  trafficLayer = navigator.onLine ? tomtomTraffic : openInfraTraffic;
  trafficLayer.addTo(map);

  map.baseLayers = { light: lightTiles, dark: darkTiles };

  // Controls & UI wiring
  addTrafficToggle();
  wireSearchControls();       // train + bus
  wireRoutePlannerControls(); // route planner

  // Theme + connectivity watchers
  const observer = new MutationObserver(syncTheme);
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("online", () => switchTrafficLayer(tomtomTraffic));
  window.addEventListener("offline", () => switchTrafficLayer(openInfraTraffic));

  // add bus dashboard container
  createBusDashboardContainer();
}

/* ============== Traffic layer helpers ============== */
function switchTrafficLayer(newLayer) {
  if (!map) return;
  if (map.hasLayer(trafficLayer)) map.removeLayer(trafficLayer);
  trafficLayer = newLayer;
  map.addLayer(trafficLayer);
}

function addTrafficToggle() {
  const button = L.control({ position: "topright" });
  button.onAdd = function() {
    const div = L.DomUtil.create("button", "leaflet-bar leaflet-control leaflet-control-custom");
    div.textContent = "Hide Traffic";
    div.style.cursor = "pointer";
    div.style.background = "white";
    div.style.padding = "6px 10px";
    div.style.border = "none";
    div.style.borderRadius = "8px";
    div.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
    div.onclick = function() {
      if (map.hasLayer(trafficLayer)) {
        map.removeLayer(trafficLayer);
        div.textContent = "Show Traffic";
      } else {
        map.addLayer(trafficLayer);
        div.textContent = "Hide Traffic";
      }
    };
    return div;
  };
  button.addTo(map);
}

/* ================== Route Planner UI wiring ================== */
function wireRoutePlannerControls() {
  const fromInput = document.getElementById("routeFrom");
  const toInput = document.getElementById("routeTo");
  const findBtn = document.getElementById("findRouteBtn");
  const clearBtn = document.getElementById("clearRouteBtn");
  if (!fromInput || !toInput || !findBtn || !clearBtn) return;

  let fromTimer = null, toTimer = null;
  fromInput.addEventListener("input", (e) => {
    if (fromTimer) clearTimeout(fromTimer);
    fromTimer = setTimeout(() => doAutocomplete(e.target.value, fromInput, "fromSuggestions"), 220);
  });
  toInput.addEventListener("input", (e) => {
    if (toTimer) clearTimeout(toTimer);
    toTimer = setTimeout(() => doAutocomplete(e.target.value, toInput, "toSuggestions"), 220);
  });

  // pressing enter triggers find
  [fromInput, toInput].forEach(el => el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { findBtn.click(); ev.preventDefault(); }
  }));

  findBtn.addEventListener("click", async () => {
    const fromVal = fromInput.value.trim();
    const toVal = toInput.value.trim();
    if (!fromVal || !toVal) return alert("Enter both From and To");

    const fromCoords = await geocodePlace(fromVal, fromInput);
    const toCoords = await geocodePlace(toVal, toInput);
    if (!fromCoords || !toCoords) return alert("Couldn't resolve places to coordinates");

    const route = await requestRoute({ lat: fromCoords.lat, lon: fromCoords.lon }, { lat: toCoords.lat, lon: toCoords.lon });
    if (!route || !route.coords || !route.coords.length) {
      return alert("Route not found");
    }
    drawRouteOnMap(route, fromCoords, toCoords);
  });

  clearBtn.addEventListener("click", () => {
    clearRoute();
    fromInput.value = "";
    toInput.value = "";
    hideAutocomplete(fromInput);
    hideAutocomplete(toInput);
  });

  // hide suggestions when clicking outside
  document.addEventListener("click", (ev) => {
    if (!fromInput.contains(ev.target)) hideAutocomplete(fromInput);
    if (!toInput.contains(ev.target)) hideAutocomplete(toInput);
  });
}

/* ------------- Autocomplete helpers ------------- */
function doAutocomplete(q, inputEl, suggestId) {
  if (!q || q.length < 2) { hideAutocomplete(inputEl); return; }
  fetchAutocomplete(q).then(results => showAutocomplete(inputEl, results || [], suggestId)).catch(() => hideAutocomplete(inputEl));
}

function showAutocomplete(inputEl, items, suggestId) {
  hideAutocomplete(inputEl);
  const wrap = document.createElement("div");
  wrap.className = "autocomplete-list";
  wrap.style.display = "block";
  wrap.style.position = "absolute";
  wrap.style.zIndex = 2000;
  wrap.style.width = inputEl.offsetWidth + "px";

  items.slice(0, 8).forEach(it => {
    const row = document.createElement("div");
    row.className = "autocomplete-item";
    row.innerText = it.display;
    row.addEventListener("click", () => {
      inputEl.value = it.display;
      // attach coordinates for quick access
      inputEl._coords = { lat: it.position.lat, lon: it.position.lon };
      hideAutocomplete(inputEl);
    });
    wrap.appendChild(row);
  });

  // attach near input
  const parent = inputEl.parentElement || document.body;
  parent.style.position = parent.style.position || "relative";
  inputEl._acWrap = wrap;
  parent.appendChild(wrap);
  wrap.style.left = inputEl.offsetLeft + "px";
  wrap.style.top = (inputEl.offsetTop + inputEl.offsetHeight + 6) + "px";
}

function hideAutocomplete(inputEl) {
  if (inputEl && inputEl._acWrap) {
    inputEl._acWrap.remove();
    inputEl._acWrap = null;
  }
}

async function fetchAutocomplete(q) {
  if (!q) return [];
  try {
    if (PROXY_MODE) {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
      if (!res.ok) return [];
      const j = await res.json();
      return (j.results || []).map(r => ({ display: r.display, position: { lat: r.position.lat, lon: r.position.lon } }));
    } else {
      const key = TOMTOM_CLIENT_KEY;
      const url = `YOUR_URL_HERE`;
      const res = await fetch(url);
      const j = await res.json();
      return (j.results || []).map(r => {
        const pos = r.position || (r.address && r.address.position) || { lat: 0, lon: 0 };
        const display = r.address ? (r.address.freeformAddress || r.address.street) : (r.poi ? r.poi.name : r.type || r.query || "");
        return { display, position: { lat: pos.lat, lon: pos.lon } };
      });
    }
  } catch (e) {
    console.warn("Autocomplete error", e);
    return [];
  }
}

/* ------------- Geocode / place resolving ------------- */
async function geocodePlace(text, inputElMaybe) {
  // If user picked a suggestion, inputElMaybe._coords will be present
  if (inputElMaybe && inputElMaybe._coords) return inputElMaybe._coords;
  // Try to find any input element with same value and coords
  if (inputElMaybe) {
    const els = document.querySelectorAll("input");
    for (const el of els) {
      if (el.value === text && el._coords) return el._coords;
    }
  }
  // fallback to search API
  try {
    if (PROXY_MODE) {
      const res = await fetch(`/api/search?q=${encodeURIComponent(text)}&limit=1`);
      if (!res.ok) return null;
      const j = await res.json();
      const r = (j.results || [])[0];
      return r ? { lat: r.position.lat, lon: r.position.lon } : null;
    } else {
      const url = `YOUR_URL_HERE`;
      const res = await fetch(url);
      const j = await res.json();
      const r = (j.results || [])[0];
      const pos = r && (r.position || (r.address && r.address.position));
      return pos ? { lat: pos.lat, lon: pos.lon } : null;
    }
  } catch (e) {
    console.warn("Geocode error", e);
    return null;
  }
}

/* ============== Request route ============== */
// normalized route returned: { coords: [[lat,lng],...], distanceKm, travelTimeSec, trafficDelaySec }
async function requestRoute(from, to) {
  try {
    if (PROXY_MODE) {
      const url = `/api/route?fromLat=${encodeURIComponent(from.lat)}&fromLng=${encodeURIComponent(from.lon)}&toLat=${encodeURIComponent(to.lat)}&toLng=${encodeURIComponent(to.lon)}`;
      const res = await fetch(url);
      if (!res.ok) { console.warn("Proxy route failed", res.status); return null; }
      return await res.json();
    } else {
      const key = TOMTOM_CLIENT_KEY;
      const url = `YOUR_URL_HERE`;
      const res = await fetch(url);
      if (!res.ok) { console.warn("TomTom route failed", res.status); return null; }
      const j = await res.json();

      // Try to extract coordinates robustly
      let coords = [];
      if (j.routes && j.routes[0]) {
        const r = j.routes[0];
        // routePath.points
        if (r.routePath && Array.isArray(r.routePath.points)) {
          coords = r.routePath.points.map(p => [p.latitude, p.longitude]);
        }
        // legs[].points
        else if (r.legs && r.legs.length && r.legs[0].points) {
          coords = r.legs.flatMap(l => l.points.map(p => [p.latitude, p.longitude]));
        }
        // geometry.points
        else if (r.geometry && r.geometry.points) {
          coords = r.geometry.points.map(p => [p.latitude, p.longitude]);
        }
        // overviewPolyline (google encoded)
        else if (r.overviewPolyline && r.overviewPolyline.points) {
          coords = decodeGooglePolyline(r.overviewPolyline.points);
        }
      }
      const summary = (j.routes && j.routes[0] && j.routes[0].summary) || {};
      const distanceKm = summary.lengthInMeters ? summary.lengthInMeters / 1000 : null;
      const travelTimeSec = summary.travelTimeInSeconds || null;
      const trafficDelaySec = summary.trafficDelayInSeconds || 0;
      return { coords, distanceKm, travelTimeSec, trafficDelaySec };
    }
  } catch (e) {
    console.warn("Request route error", e);
    return null;
  }
}

/* ============== Draw & clear route ============== */
function drawRouteOnMap(route, fromCoords, toCoords) {
  if (!map) return;
  clearRoute();

  const coords = route.coords || [];
  if (!coords.length) {
    alert("No route geometry available");
    return;
  }

  // calculate color by traffic delay ratio
  const delay = (route.trafficDelaySec || 0);
  const travel = (route.travelTimeSec || 1);
  const ratio = delay / Math.max(1, travel);
  let color = "#2ECC71"; // green
  if (ratio > 0.25) color = "#E74C3C"; // red
  else if (ratio > 0.08) color = "#F39C12"; // yellow

  routeState.routeLayer = L.polyline(coords, { color, weight: 6, opacity: 0.9 }).addTo(map);
  routeState.start = L.circleMarker([fromCoords.lat, fromCoords.lon], { radius: 6, color: "#0B6" }).addTo(map).bindPopup("Start");
  routeState.end = L.circleMarker([toCoords.lat, toCoords.lon], { radius: 6, color: "#C00" }).addTo(map).bindPopup("End");

  const bounds = L.latLngBounds(coords);
  map.fitBounds(bounds.pad(0.08));

  // update info panel
  const infoWrap = document.getElementById("routeInfo");
  const summary = document.getElementById("routeSummary");
  const distEl = document.getElementById("routeDistance");
  const etaEl = document.getElementById("routeETA");
  if (infoWrap && summary && distEl && etaEl) {
    infoWrap.style.display = "block";
    summary.innerHTML = `<strong>Route</strong>`;
    distEl.innerHTML = `Distance: ${route.distanceKm ? (Math.round(route.distanceKm*10)/10) + " km" : "—"}`;
    if (route.travelTimeSec) {
      const mins = Math.round(route.travelTimeSec / 60);
      etaEl.innerHTML = `ETA: ${mins} min`;
    } else etaEl.innerHTML = `ETA: —`;
    if (route.trafficDelaySec && route.trafficDelaySec > 0) {
      const dmins = Math.round(route.trafficDelaySec / 60);
      etaEl.innerHTML += ` (Traffic delay: +${dmins} min)`;
    }
  }

  routeState.info = route;
}

function clearRoute() {
  if (!map) return;
  if (routeState.routeLayer && map.hasLayer(routeState.routeLayer)) map.removeLayer(routeState.routeLayer);
  if (routeState.start && map.hasLayer(routeState.start)) map.removeLayer(routeState.start);
  if (routeState.end && map.hasLayer(routeState.end)) map.removeLayer(routeState.end);
  routeState.routeLayer = null; routeState.start = null; routeState.end = null; routeState.info = null;
  const infoWrap = document.getElementById("routeInfo");
  if (infoWrap) infoWrap.style.display = "none";
}

/* ============== Google polyline decode (client) ============== */
function decodeGooglePolyline(encoded) {
  if (!encoded) return [];
  let index = 0, lat = 0, lng = 0, coordinates = [];
  while (index < encoded.length) {
    let shift = 0, result = 0, b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    coordinates.push([lat / 1e5, lng / 1e5]);
  }
  return coordinates;
}

/* ================== TRAIN & BUS (preserve your logic) ================== */

/* ------------- Search controls wiring (train + bus) ------------- */
function wireSearchControls() {
  const trainBtn = document.getElementById("trainTrackBtn");
  const busBtn = document.getElementById("busTrackBtn");

  if (trainBtn) {
    trainBtn.addEventListener("click", () => {
      const trainNo = (document.getElementById("trainInput")?.value || "").trim();
      if (!trainNo) return;
      startTrainTracking(trainNo);
    });
  }

  if (busBtn) {
    busBtn.addEventListener("click", () => {
      const plate = (document.getElementById("busInput")?.value || "").trim();
      if (!plate) return;
      startBusTracking(plate);
    });
  }
}

/* ----------------- TRAIN functions ----------------- */
function startTrainTracking(trainNo) {
  if (trainState.fetchInterval) clearInterval(trainState.fetchInterval);
  cancelAnimationFrame(trainRAF);
  if (trainState.marker) map.removeLayer(trainState.marker);
  if (trainState.route) map.removeLayer(trainState.route);

  trainState.firstFetchDone = false;
  const icon = L.divIcon({ className: "train-icon", html: "🚆", iconSize: [28, 28] });
  trainState.marker = L.marker(map.getCenter(), { icon }).addTo(map);
  trainState.last = trainState.next = null;
  trainState.running = true;
  fetchTrainPosition(trainNo, true);
  trainState.fetchInterval = setInterval(() => fetchTrainPosition(trainNo), 1000);
  animateTrain();
}

async function fetchTrainPosition(trainNo, fitView = false) {
  try {
    const res = await fetch(`/train/${encodeURIComponent(trainNo)}`);
    const data = await res.json();
    if (data.error) return;

    // official API shape or simulated shape
    if (data.data) {
      const r = data.data[0] || {};
      const lastStation = (r.last_station_name || "").toUpperCase();
      const nextStation = (r.current_station_name || "").toUpperCase();
      const stations = {
        //YOUR_DATA_SOURCE_HERE
      };
      const a = stations[lastStation], b = stations[nextStation];
      if (!a || !b) return;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      setTrainTarget(mid, 1000);
      if (fitView) {
        if (trainState.route) map.removeLayer(trainState.route);
        trainState.route = L.polyline([a, b], { color: "#00A8FF", weight: 5, opacity: 0.85 }).addTo(map);
        map.fitBounds(trainState.route.getBounds(), { padding: [30, 30] });
      }
      trainState.marker.bindPopup(`<b>Train ${trainNo}</b><br>${lastStation} → ${nextStation}`);
      if (fitView) trainState.marker.openPopup();
      trainState.firstFetchDone = true;
      return;
    }

    const { lat, lng, from, to, train_name, progress } = data;
    if (typeof lat === "number" && typeof lng === "number") {
      setTrainTarget([lat, lng], 1000);
      const name = train_name || ("Train " + trainNo);
      const fromText = from || "Previous Station", toText = to || "Next Station";
      const prog = progress !== undefined ? Math.round(progress) : 0;
      trainState.marker.bindPopup(`<b>${name}</b><br>${fromText} → ${toText}<br>Progress: ${prog}%`);
      if (fitView || !trainState.firstFetchDone) { map.setView([lat, lng], 9); trainState.marker.openPopup(); }
      trainState.firstFetchDone = true;
    }
  } catch (e) {
    console.warn("Train fetch error", e);
  }
}

function setTrainTarget(latlng, durationMs) {
  const now = performance.now();
  if (!trainState.last) {
    trainState.last = latlng; trainState.next = latlng; trainState.t0 = now; trainState.t1 = now + durationMs; trainState.marker.setLatLng(latlng); return;
  }
  const current = interp(trainState.last, trainState.next, clamp01((now - trainState.t0) / (trainState.t1 - trainState.t0)));
  trainState.last = current; trainState.next = latlng; trainState.t0 = now; trainState.t1 = now + durationMs;
}

function animateTrain() {
  if (!trainState.running) return;
  const now = performance.now();
  const t = clamp01((now - trainState.t0) / (trainState.t1 - trainState.t0));
  const pos = interp(trainState.last, trainState.next, easeInOut(t));
  if (pos) trainState.marker.setLatLng(pos);
  trainRAF = requestAnimationFrame(animateTrain);
}

/* ----------------- BUS functions ----------------- */
function startBusTracking(plate) {
  if (busState.fetchInterval) clearInterval(busState.fetchInterval);
  cancelAnimationFrame(busRAF);
  if (busState.marker) map.removeLayer(busState.marker);
  if (busState.route) map.removeLayer(busState.route);
  _clearBusStopsAndMarkers();

  busState.firstFetchDone = false; busState.routeStops = null;
  const icon = L.divIcon({ className: "bus-icon", html: "🚌", iconSize: [28, 28] });
  busState.marker = L.marker(map.getCenter(), { icon }).addTo(map);
  busState.last = busState.next = null; busState.running = true;

  fetchBusRouteData(plate).then(stops => { if (stops && stops.length) { busState.routeStops = stops; drawBusRouteStops(stops); } }).catch(()=>{});
  fetchBusPosition(plate, true);
  busState.fetchInterval = setInterval(() => fetchBusPosition(plate), 1000);
  animateBus();
}

async function fetchBusRouteData(plate) {
  const endpoints = [
    `/bus/${encodeURIComponent(plate)}/route`,
    "/static/data/bus_routes.json",
    "/data/bus_routes.json"
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const obj = await res.json();
      if (Array.isArray(obj) && obj.length) return obj;
      if (obj && typeof obj === "object") {
        for (const key of Object.keys(obj)) {
          const entry = obj[key]; if (!entry) continue;
          if ((entry.number_plate && entry.number_plate.toLowerCase() === plate.toLowerCase())
              || (entry.bus && entry.bus.toLowerCase() === plate.toLowerCase())
              || (entry.name && entry.name.toLowerCase().includes(plate.toLowerCase()))) {
            return entry.stops || entry.route || [];
          }
        }
      }
    } catch (e) { /* ignore and try next */ }
  }
  return null;
}

async function fetchBusPosition(plate, fitView = false) {
  try {
    const res = await fetch(`/bus/${encodeURIComponent(plate)}`);
    const data = await res.json();
    if (data.error) return;
    const lat = data.lat, lng = data.lng;
    const plateText = data.bus || data.number_plate || plate;
    const busName = data.bus_name || data.name || "Bus";
    const busType = data.bus_type || data.model || "Bus Model Unknown";
    const from = data.from || "-", to = data.to || "-";
    const progress = (data.progress !== undefined) ? data.progress : 0;
    if (typeof lat === "number" && typeof lng === "number") {
      setBusTarget([lat, lng], 1000);
      if (busState.routeStops && busState.routeStops.length) {
        updateBusDashboardWithPositionAndStops({ lat, lng, plate: plateText, name: busName, bus_type: busType, from, to, progress });
      }
      if (busState.route) map.removeLayer(busState.route);
      busState.route = L.polyline([[lat, lng]], { color: progress < 50 ? "#8A2BE2" : "#1E90FF", weight: 6, opacity: 0.9 }).addTo(map);
      const popupHtml = `<b>${busName}</b><br><small>${busType}</small><br><small>Plate: ${plateText}</small><br><br>${from} → ${to}<br>Progress: ${Math.round(progress)}%`;
      busState.marker.bindPopup(popupHtml);
      if (fitView || !busState.firstFetchDone) { map.setView([lat, lng], 10); busState.marker.openPopup(); }
      busState.firstFetchDone = true;
    }
  } catch (e) {
    console.warn("Bus fetch error", e);
  }
}

function setBusTarget(latlng, durationMs) {
  let [lat, lng] = latlng;
  if (lat > 30) { console.warn("Swapped bus coordinates auto-fixed:", latlng); [lat, lng] = [lng, lat]; }
  if (lat < 6 || lat > 35 || lng < 65 || lng > 100) { console.warn("Invalid bus position ignored:", [lat, lng]); return; }
  latlng = [lat, lng];
  const now = performance.now();
  if (!busState.last) {
    busState.last = latlng; busState.next = latlng; busState.t0 = now; busState.t1 = now + durationMs; busState.marker.setLatLng(latlng); return;
  }
  const current = interp(busState.last, busState.next, clamp01((now - busState.t0) / (busState.t1 - busState.t0)));
  busState.last = current; busState.next = latlng; busState.t0 = now; busState.t1 = now + durationMs;
}

function animateBus() {
  if (!busState.running) return;
  const now = performance.now();
  const t = clamp01((now - busState.t0) / (busState.t1 - busState.t0));
  const pos = interp(busState.last, busState.next, easeInOut(t));
  if (pos) busState.marker.setLatLng(pos);
  busRAF = requestAnimationFrame(animateBus);
}

/* ---------------- Bus UI helpers: dashboard, stops, ETA -------------- */
function createBusDashboardContainer() {
  if (document.getElementById("busDashboard")) return;
  const panel = document.createElement("div");
  panel.id = "busDashboard";
  panel.style.position = "absolute";
  panel.style.top = "80px";
  panel.style.left = "16px";
  panel.style.zIndex = 1000;
  panel.style.width = "320px";
  panel.style.maxHeight = "70vh";
  panel.style.overflow = "auto";
  panel.style.background = "rgba(255,255,255,0.95)";
  panel.style.boxShadow = "0 6px 20px rgba(0,0,0,0.15)";
  panel.style.borderRadius = "12px";
  panel.style.padding = "12px";
  panel.style.display = "none";
  panel.innerHTML = `
    <h3 style="margin:0 0 8px 0;">Bus Live Panel</h3>
    <div id="busSummary" style="font-size:14px;margin-bottom:8px;"></div>
    <div id="busProgressWrap" style="margin-bottom:8px;">
      <div style="font-size:12px;margin-bottom:6px;">Progress</div>
      <div style="background:#eee;border-radius:8px;height:14px;overflow:hidden;">
        <div id="busProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#8A2BE2,#1E90FF);"></div>
      </div>
    </div>
    <div id="busETA" style="font-size:13px;margin-bottom:8px;"></div>
    <div id="busStopsList" style="font-size:13px;"></div>
    <div style="text-align:right;margin-top:8px;">
      <button id="hideBusPanel" style="border:none;background:#ddd;padding:6px 10px;border-radius:8px;cursor:pointer;">Hide</button>
    </div>
  `;
  document.body.appendChild(panel);
  document.getElementById("hideBusPanel").addEventListener("click", () => panel.style.display = "none");
}

function drawBusRouteStops(stops) {
  _clearBusStopsAndMarkers();
  const latlngs = stops.map(s => [s.lat, s.lng]).filter(p => typeof p[0] === "number" && typeof p[1] === "number");
  if (latlngs.length < 2) return;
  busState.route = L.polyline(latlngs, { color: "#FF6A00", weight: 4, opacity: 0.7 }).addTo(map);
  busState.stopMarkers = [];
  stops.forEach((stop, idx) => {
    if (typeof stop.lat !== "number" || typeof stop.lng !== "number") return;
    const m = L.circleMarker([stop.lat, stop.lng], { radius: 6, fillColor: "#fff", color: "#333", weight: 1, fillOpacity: 1 }).addTo(map);
    m.bindPopup(`<b>${stop.name}</b><br>${stop.time || ""}`);
    m.on('click', () => { map.setView([stop.lat, stop.lng], Math.max(map.getZoom(), 10)); m.openPopup(); });
    busState.stopMarkers.push(m);
  });
  const panel = document.getElementById("busDashboard"); if (panel) panel.style.display = "block";
  renderStopsList(stops);
}

function _clearBusStopsAndMarkers() {
  if (busState.stopMarkers && busState.stopMarkers.length) {
    for (const m of busState.stopMarkers) if (map.hasLayer(m)) map.removeLayer(m);
  }
  busState.stopMarkers = [];
  if (busState.route && map.hasLayer(busState.route)) map.removeLayer(busState.route);
  busState.route = null;
  const panel = document.getElementById("busDashboard"); if (panel) panel.style.display = "none";
  const stopsList = document.getElementById("busStopsList"); if (stopsList) stopsList.innerHTML = "";
}

function renderStopsList(stops) {
  const container = document.getElementById("busStopsList"); if (!container) return;
  container.innerHTML = "<strong>Stops</strong><ul style='padding-left:18px;margin-top:6px;'>";
  stops.forEach((stop, i) => { const timeStr = stop.time ? ` (${stop.time})` : ""; container.innerHTML += `<li style="margin-bottom:6px;cursor:pointer;" data-idx="${i}">${stop.name}${timeStr}</li>`; });
  container.innerHTML += "</ul>";
  container.querySelectorAll("li[data-idx]").forEach(li => li.addEventListener("click", (ev) => {
    const idx = Number(ev.currentTarget.getAttribute("data-idx")); const s = busState.routeStops[idx];
    if (s && typeof s.lat === "number" && typeof s.lng === "number") map.setView([s.lat, s.lng], Math.max(map.getZoom(), 12));
  }));
}

function updateBusDashboardWithPositionAndStops({ lat, lng, plate, name, bus_type, from, to, progress }) {
  const summary = document.getElementById("busSummary");
  const etaEl = document.getElementById("busETA");
  const bar = document.getElementById("busProgressBar");
  if (summary) summary.innerHTML = `<b>${name}</b><br><small>${bus_type}</small><br><small>Plate: ${plate}</small><br><small>${from} → ${to}</small>`;
  if (bar) bar.style.width = `${Math.round(progress)}%`;
  if (etaEl) etaEl.innerHTML = `<strong>ETA:</strong> calculating...`;

  const stops = busState.routeStops || [];
  if (!stops.length) { if (etaEl) etaEl.innerHTML = `<strong>ETA:</strong> -`; return; }

  // Find nearest segment by midpoints
  let best = { idx: -1, dist: Infinity };
  for (let i = 0; i < stops.length - 1; i++) {
    const mid = midpointLatLng(stops[i], stops[i+1]);
    const d = haversine(lat, lng, mid[0], mid[1]);
    if (d < best.dist) best = { idx: i, dist: d };
  }
  const segIdx = best.idx;
  if (segIdx >= 0 && stops[segIdx] && stops[segIdx+1]) {
    const sA = stops[segIdx], sB = stops[segIdx+1];
    const tA = parseTimeString(sA.time), tB = parseTimeString(sB.time);
    if (tA && tB) {
      if (tB <= tA) tB.setDate(tB.getDate() + 1);
      const totalSec = (tB - tA) / 1000;
      const remainingSec = Math.max(0, totalSec * (1 - (progress/100)));
      const eta = new Date(Date.now() + remainingSec * 1000);
      if (etaEl) etaEl.innerHTML = `<strong>ETA:</strong> ${formatTime(eta)} (to ${sB.name})`;
      return;
    } else {
      const segDistKm = haversine(sA.lat, sA.lng, sB.lat, sB.lng);
      const assumedSpeedKmph = 50;
      const totalSec = (segDistKm / assumedSpeedKmph) * 3600;
      const remainingSec = Math.max(0, totalSec * (1 - (progress/100)));
      const eta = new Date(Date.now() + remainingSec * 1000);
      if (etaEl) etaEl.innerHTML = `<strong>ETA (est):</strong> ${formatTime(eta)} (to ${sB.name})`;
      return;
    }
  }
  if (etaEl) etaEl.innerHTML = `<strong>ETA:</strong> -`;
}

/* ---------------- small helpers ---------------- */
function parseTimeString(t) {
  if (!t || typeof t !== "string") return null;
  const s = t.trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [hh, mm] = s.split(":").map(x => parseInt(x, 10));
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
}
function formatTime(d) { if (!d) return "-"; const hh = String(d.getHours()).padStart(2,"0"); const mm = String(d.getMinutes()).padStart(2,"0"); return `${hh}:${mm}`; }
function midpointLatLng(a,b) { return [(a.lat + b.lat)/2, (a.lng + b.lng)/2]; }
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = v => v * Math.PI / 180; const R = 6371; const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R * c;
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function interp(a,b,t) { if (!a || !b) return a || b; return [ a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t ]; }
function easeInOut(t) { return t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; }
function syncTheme() {
  if (!map) return;
  const isDark = document.body.classList.contains("dark");
  const { light, dark } = map.baseLayers;
  if (isDark) { if (map.hasLayer(light)) { map.removeLayer(light); dark.addTo(map); } }
  else { if (map.hasLayer(dark)) { map.removeLayer(dark); light.addTo(map); } }
}

// expose init to main.js
window.initMap = initMap;
