/* =========================================================
   RideEase — free map version
   Real road routing via OSRM's free public router (no API key).
   Real AI translation via the Flask backend, which calls Gemini.
   Fare is calculated on the backend from the real route distance.
   ========================================================= */

const DEFAULT_CENTER = [12.9716, 77.5946]; // Bangalore fallback
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

const state = {
  map: null,
  pickup: null,        // [lat, lng]
  drop: null,
  pickupMarker: null,
  dropMarker: null,
  routeLine: null,
  routeLatLngs: null,   // full path returned by OSRM, for the vehicle marker
  vehicleMarker: null,
  mode: 'booking',
  deviationTimer: null,
  deviationTriggered: false
};

/* ---------------- Toast helper ---------------- */
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 2200);
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

/* ---------------- Map setup ---------------- */
function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(state.map);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => setPickup([pos.coords.latitude, pos.coords.longitude]),
      () => setPickup(DEFAULT_CENTER)
    );
  } else {
    setPickup(DEFAULT_CENTER);
  }

  state.map.on('click', (e) => {
    if (state.mode !== 'booking') return;
    setDrop([e.latlng.lat, e.latlng.lng]);
  });
}

function setPickup(latlng) {
  state.pickup = latlng;
  state.map.setView(latlng, 15);

  if (state.pickupMarker) {
    state.pickupMarker.setLatLng(latlng);
  } else {
    state.pickupMarker = L.circleMarker(latlng, {
      radius: 7, color: '#639922', fillColor: '#639922', fillOpacity: 1, weight: 2
    }).addTo(state.map).bindPopup('Pickup');
  }

  document.getElementById('pickupInput').value =
    `Current location (${latlng[0].toFixed(4)}, ${latlng[1].toFixed(4)})`;

  if (state.drop) requestRoute();
}

function setDrop(latlng) {
  state.drop = latlng;

  if (state.dropMarker) {
    state.dropMarker.setLatLng(latlng);
  } else {
    state.dropMarker = L.marker(latlng).addTo(state.map).bindPopup('Drop');
  }

  document.getElementById('dropInput').value =
    `Selected point (${latlng[0].toFixed(4)}, ${latlng[1].toFixed(4)})`;

  requestRoute();
}

/* ---------------- Real road route via OSRM (free, no key) ---------------- */
async function requestRoute() {
  if (!state.pickup || !state.drop) return;
  const statusEl = document.getElementById('homeStatus');
  statusEl.textContent = 'Finding route...';
  statusEl.className = 'status-msg';

  const [pLat, pLng] = state.pickup;
  const [dLat, dLng] = state.drop;
  const url = `${OSRM_URL}/${pLng},${pLat};${dLng},${dLat}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
      statusEl.textContent = 'Could not find a route between these points.';
      statusEl.className = 'status-msg error';
      return;
    }

    const route = data.routes[0];
    // GeoJSON gives [lng, lat] pairs — Leaflet wants [lat, lng]
    state.routeLatLngs = route.geometry.coordinates.map(c => [c[1], c[0]]);

    if (state.routeLine) state.map.removeLayer(state.routeLine);
    state.routeLine = L.polyline(state.routeLatLngs, { color: '#912F40', weight: 4 }).addTo(state.map);
    state.map.fitBounds(state.routeLine.getBounds(), { padding: [40, 40] });

    const distanceKm = route.distance / 1000;
    const durationMin = route.duration / 60;

    fetchFareEstimate(distanceKm, durationMin);
  } catch (err) {
    statusEl.textContent = 'Route lookup failed. Check your internet connection.';
    statusEl.className = 'status-msg error';
  }
}

/* ---------------- Fare estimate (backend calculates from real distance) ---------------- */
async function fetchFareEstimate(distanceKm, durationMin) {
  const statusEl = document.getElementById('homeStatus');
  try {
    const res = await fetch('/api/estimate-fare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ distance_km: distanceKm, duration_min: durationMin })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not estimate fare');

    document.getElementById('fareAmount').textContent = `₹${data.fare}`;
    document.getElementById('etaText').textContent = `${data.eta_min} min away`;
    document.getElementById('fareCard').style.display = 'flex';
    document.getElementById('trackingFare').textContent = `₹${data.fare}`;
    document.getElementById('trackingEta').textContent = `${data.eta_min} min away`;

    const confirmBtn = document.getElementById('confirmBtn');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm ride';
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'status-msg error';
  }
}

/* ---------------- GPS button ---------------- */
document.getElementById('gpsBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('homeStatus');
  if (!navigator.geolocation) {
    statusEl.textContent = 'Geolocation not supported on this device.';
    statusEl.className = 'status-msg error';
    return;
  }
  statusEl.textContent = 'Getting your location...';
  statusEl.className = 'status-msg';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setPickup([pos.coords.latitude, pos.coords.longitude]);
      statusEl.textContent = 'Location detected.';
    },
    () => {
      statusEl.textContent = 'Could not access location. Try clicking the map instead.';
      statusEl.className = 'status-msg error';
    }
  );
});

/* ---------------- Confirm ride -> tracking mode ---------------- */
document.getElementById('confirmBtn').addEventListener('click', () => {
  if (!state.pickup || !state.drop) return;
  enterTrackingMode();
});

function enterTrackingMode() {
  state.mode = 'tracking';
  document.getElementById('bookingCard').classList.add('hidden');
  document.getElementById('tripCard').classList.remove('hidden');
  document.getElementById('mapHint').style.display = 'none';
  document.getElementById('devDeviationBtn').classList.remove('hidden');

  const startPoint = pointAlongRoute(0.3);
  const vehicleIcon = L.divIcon({
    className: 'vehicle-icon',
    html: '<div style="background:#912F40;color:#FFFFFA;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,0.3);">&#127946;</div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
  if (state.vehicleMarker) state.map.removeLayer(state.vehicleMarker);
  state.vehicleMarker = L.marker(startPoint, { icon: vehicleIcon }).addTo(state.map);

  state.deviationTriggered = false;
  clearTimeout(state.deviationTimer);
  state.deviationTimer = setTimeout(triggerDeviation, 6000);
}

function exitTrackingMode() {
  state.mode = 'booking';
  document.getElementById('bookingCard').classList.remove('hidden');
  document.getElementById('tripCard').classList.add('hidden');
  document.getElementById('mapHint').style.display = 'block';
  document.getElementById('devDeviationBtn').classList.add('hidden');
  document.getElementById('deviationBanner').classList.add('hidden');
  clearTimeout(state.deviationTimer);

  if (state.vehicleMarker) {
    state.map.removeLayer(state.vehicleMarker);
    state.vehicleMarker = null;
  }
}

document.getElementById('backFromTracking').addEventListener('click', exitTrackingMode);

// Picks a point a fraction of the way along the real OSRM road path
function pointAlongRoute(fraction) {
  if (!state.routeLatLngs || state.routeLatLngs.length < 2) return state.pickup;
  const index = Math.floor(state.routeLatLngs.length * fraction);
  return state.routeLatLngs[Math.min(index, state.routeLatLngs.length - 1)];
}

function triggerDeviation() {
  if (state.deviationTriggered || !state.vehicleMarker) return;
  state.deviationTriggered = true;

  const mid = pointAlongRoute(0.3);
  const offset = [mid[0] + 0.003, mid[1] + 0.003];
  state.vehicleMarker.setLatLng(offset);
  document.getElementById('deviationBanner').classList.remove('hidden');
}

document.getElementById('devDeviationBtn').addEventListener('click', () => {
  state.deviationTriggered = false;
  triggerDeviation();
});
document.getElementById('closeDeviation').addEventListener('click', () => {
  document.getElementById('deviationBanner').classList.add('hidden');
});

/* ---------------- SOS modal (under development, by design) ---------------- */
document.getElementById('sosOpenBtn').addEventListener('click', () => openModal('sosModal'));
document.getElementById('sosCloseBtn').addEventListener('click', () => closeModal('sosModal'));

/* ---------------- Chat modal + real Gemini translation ---------------- */
document.getElementById('chatOpenBtn').addEventListener('click', () => openModal('chatModal'));
document.getElementById('chatCloseBtn').addEventListener('click', () => closeModal('chatModal'));

const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const langSelect = document.getElementById('langSelect');

async function translateText(text, targetLang) {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target_lang: targetLang })
    });
    const data = await res.json();
    return data.translated || text;
  } catch (err) {
    return text;
  }
}

function addBubble({ mainText, translatedText, sent }) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${sent ? 'sent' : 'received'}`;

  const main = document.createElement('p');
  main.className = 'main';
  main.textContent = mainText;
  bubble.appendChild(main);

  if (translatedText) {
    const translated = document.createElement('p');
    translated.className = 'translated';
    translated.textContent = translatedText;
    bubble.appendChild(translated);
  }

  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  return bubble;
}

document.getElementById('sendChatBtn').addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

async function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';

  const targetLang = langSelect.value;
  const bubble = addBubble({ mainText: text, translatedText: 'Translating...', sent: true });
  const translated = await translateText(text, targetLang);
  bubble.querySelector('.translated').textContent = translated;
}

const driverReplies = ['ಸರ್, ನಾನು ಗೇಟ್ ಬಳಿ ಇದ್ದೇನೆ', 'ಸ್ವಲ್ಪ ಟ್ರಾಫಿಕ್ ಇದೆ, 2 ನಿಮಿಷ ತಡವಾಗುತ್ತದೆ', 'ದಯವಿಟ್ಟು ಮುಖ್ಯ ಗೇಟ್ ಬಳಿ ಬನ್ನಿ'];

document.getElementById('simulateReplyBtn').addEventListener('click', async () => {
  const reply = driverReplies[Math.floor(Math.random() * driverReplies.length)];
  const bubble = addBubble({ mainText: reply, translatedText: 'Translating...', sent: false });
  const translated = await translateText(reply, 'en');
  bubble.querySelector('.translated').textContent = translated;
});

/* ---------------- Decorative icons still respond ---------------- */
document.getElementById('menuIcon').addEventListener('click', () => showToast('Menu — coming soon'));
document.getElementById('profileIcon').addEventListener('click', () => showToast('Profile settings — coming soon'));
document.getElementById('navHome').addEventListener('click', () => showToast('You are on Home'));
document.getElementById('navRides').addEventListener('click', () => showToast('My Rides — coming soon'));
document.getElementById('navSupport').addEventListener('click', () => showToast('Support — coming soon'));

/* ---------------- Init ---------------- */
initMap();
