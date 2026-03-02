const STORAGE_KEY = "spacely-demo-v1";
let mapInstance = null;
let userLocationMarker = null;
let mapProvider = "leaflet";
let googleMapsLoading = null;
let googleMarkers = [];
let googleUserMarker = null;
let googleDestinationMarker = null;
let googleActiveHaloMarker = null;
let googleClusterer = null;
let googleMapsReady = false;
let mapInitSeq = 0;
let plannedSearchSeq = 0;
let lotSheetDragState = null;
let homeViewportSnapshot = null;
let googleZoomAnimTimer = null;
let availabilityUnsubscribe = null;
let idCounter = 1000;
let firebaseBootPromise = null;
let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let firebaseRecaptchaVerifier = null;
let firebaseOtpConfirmation = null;

const nowIso = () => new Date().toISOString();
const money = (n) => `ILS ${Number(n).toFixed(2)}`;
const minutesBetween = (a, b) => Math.max(1, Math.floor((new Date(b) - new Date(a)) / 60000));
const secondsBetween = (a, b) => Math.max(0, Math.floor((new Date(b) - new Date(a)) / 1000));
const fmt = (d) => new Date(d).toLocaleString();
const uid = (prefix) => `${prefix}_${Date.now()}_${idCounter++}`;
const SUPPLY_SEGMENTS = ["structured", "municipal_blue_white", "private_hourly"];
const HOME_COMFORT_ZOOM = 14;
const DESTINATION_FOCUS_ZOOM = 17;
const VEHICLE_MANUFACTURERS = [
  "Toyota",
  "Hyundai",
  "Kia",
  "Mazda",
  "Honda",
  "Mitsubishi",
  "Skoda",
  "Volkswagen",
  "Nissan",
  "Suzuki",
  "Tesla",
  "BMW",
  "Mercedes-Benz",
  "Audi",
  "Subaru",
  "Peugeot",
  "Renault",
  "Citroen",
  "Ford",
  "Chevrolet",
];
const VEHICLE_COLOR_CODES = ["white", "black", "silver", "gray", "blue", "red", "green", "yellow", "brown", "orange"];

function formatDistance(meters) {
  if (meters == null || Number.isNaN(meters)) return "—";
  if (meters >= 1000) {
    const km = Math.round((meters / 1000) * 10) / 10;
    return `${km} ${t("kilometer_short")}`;
  }
  return `${Math.round(meters)} ${t("meter_short")}`;
}

function lotSegmentType(lot) {
  const seg = String(lot?.segment_type || "structured");
  return SUPPLY_SEGMENTS.includes(seg) ? seg : "structured";
}

function isSingleSpotSupplySegment(segmentOrLot) {
  const seg = typeof segmentOrLot === "string" ? segmentOrLot : lotSegmentType(segmentOrLot);
  return seg === "private_hourly" || seg === "municipal_blue_white";
}

function toFourDigitSerial(value) {
  const n = Number(value);
  const normalized = Number.isFinite(n) ? n : 1000;
  const clamped = 1000 + (Math.abs(Math.floor(normalized)) % 9000);
  return String(clamped).padStart(4, "0");
}

function hashString(str) {
  const s = String(str || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function allocateUniqueSerialCode(seed, usedSet) {
  let codeNum = 1000 + (hashString(seed) % 9000);
  let attempts = 0;
  while (usedSet.has(String(codeNum).padStart(4, "0")) && attempts < 9000) {
    codeNum = 1000 + ((codeNum - 999) % 9000);
    attempts++;
  }
  const code = String(codeNum).padStart(4, "0");
  usedSet.add(code);
  return code;
}

function getLotDisplayCode(lot) {
  if (!lot) return "";
  if (!isSingleSpotSupplySegment(lot)) return String(lot.name || "");
  const serial = String(lot.serial_code_4 || "").replace(/\D/g, "");
  if (serial.length >= 4) return serial.slice(-4);
  if (serial.length > 0) return serial.padStart(4, "0");
  return toFourDigitSerial(hashString(lot.id || lot.name || "lot"));
}

function getAssignedDisplayCode(sessionOrReservation, lot) {
  if (isSingleSpotSupplySegment(lot)) return getLotDisplayCode(lot);
  if (sessionOrReservation?.assigned_spot_code) return sessionOrReservation.assigned_spot_code;
  return "";
}

function vehicleImageFor(vehicle) {
  if (!vehicle) return "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=900&q=80";
  const key = `${vehicle.manufacturer || ""} ${vehicle.model || ""}`.toLowerCase();
  if (key.includes("tesla")) return "https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=900&q=80";
  if (key.includes("kia")) return "https://images.unsplash.com/photo-1619767886558-efdc259cde1a?auto=format&fit=crop&w=900&q=80";
  if (key.includes("hyundai")) return "https://images.unsplash.com/photo-1542282088-fe8426682b8f?auto=format&fit=crop&w=900&q=80";
  if (key.includes("toyota")) return "https://images.unsplash.com/photo-1617469767053-d3b523a0b982?auto=format&fit=crop&w=900&q=80";
  return "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=900&q=80";
}

function vehicleDisplayName(vehicle) {
  if (!vehicle) return "";
  const base = String(vehicle.manufacturer || "").trim();
  const model = String(vehicle.model || "").trim();
  return [base, model].filter(Boolean).join(" ") || String(vehicle.license_plate || "").trim();
}

function vehicleColorLabel(code) {
  return t(`vehicle_color_${String(code || "").toLowerCase()}`) || String(code || "");
}

function renderVehicleSizePicker(selected = "regular") {
  const options = [
    { value: "small", icon: "🚗", label: t("size_small") },
    { value: "regular", icon: "🚙", label: t("size_regular") },
    { value: "large", icon: "🚐", label: t("size_large") },
    { value: "extra_large", icon: "🚚", label: t("size_xl") },
  ];
  return `
    <div class="vehicle-size-help">${t("vehicle_size_help")}</div>
    <div class="vehicle-size-icon-grid">
      ${options
        .map(
          (opt) => `
            <label class="vehicle-size-icon-option ${selected === opt.value ? "selected" : ""}">
              <input type="radio" name="vehicle_size" value="${opt.value}" ${selected === opt.value ? "checked" : ""} />
              <span class="vehicle-size-icon">${opt.icon}</span>
              <span class="vehicle-size-label">${opt.label}</span>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function renderVehicleInputFields(vehicle = null) {
  const manufacturer = String(vehicle?.manufacturer || "");
  const color = String(vehicle?.color || "white").toLowerCase();
  const size = String(vehicle?.vehicle_size || "regular");
  const specialConditions = Array.isArray(vehicle?.special_conditions) ? vehicle.special_conditions : [];
  const isElectric = Boolean(vehicle?.is_electric);
  const isDefault = Boolean(vehicle?.is_default);
  const nickname = String(vehicle?.nickname || "");
  const license = String(vehicle?.license_plate || "");
  const vehicleId = String(vehicle?.id || "");
  return `
    ${vehicleId ? `<input type="hidden" name="vehicle_id" value="${vehicleId}" />` : ""}
    <input name="license_plate" placeholder="${t("license_plate")}" value="${license}" required />
    <input name="manufacturer" list="vehicle-manufacturers-list" placeholder="${t("manufacturer")}" value="${manufacturer}" />
    <select name="color">
      ${VEHICLE_COLOR_CODES.map((code) => `<option value="${code}" ${color === code ? "selected" : ""}>${vehicleColorLabel(code)}</option>`).join("")}
    </select>
    ${renderVehicleSizePicker(size)}
    <div class="vehicle-special-features">
      <div class="vehicle-size-help"><strong>${t("special_features")}</strong></div>
      <label><input type="checkbox" name="special_conditions" value="disabled" ${specialConditions.includes("disabled") ? "checked" : ""} /> ${t("cond_disabled")}</label>
      <label><input type="checkbox" name="is_electric" ${isElectric ? "checked" : ""} /> ${t("electric")}</label>
      <label><input type="checkbox" name="special_conditions" value="stroller" ${specialConditions.includes("stroller") ? "checked" : ""} /> ${t("cond_stroller")}</label>
    </div>
    <label><input type="checkbox" name="is_default" ${isDefault ? "checked" : ""} /> ${t("set_default")}</label>
    <input name="nickname" placeholder="${t("nickname")}" value="${nickname}" />
  `;
}

const DESTINATION_MOCKS = [
  { name: "עזריאלי תל אביב", lat: 32.074, lng: 34.792 },
  { name: "רוטשילד תל אביב", lat: 32.063, lng: 34.774 },
  { name: "דיזנגוף סנטר", lat: 32.075, lng: 34.774 },
  { name: "איכילוב תל אביב", lat: 32.084, lng: 34.788 },
  { name: "קניון איילון רמת גן", lat: 32.109, lng: 34.838 },
  { name: "הבורסה רמת גן", lat: 32.085, lng: 34.801 },
  { name: "אוניברסיטת תל אביב", lat: 32.113, lng: 34.804 },
  { name: "רידינג תל אביב", lat: 32.101, lng: 34.774 },
  { name: "קניון הזהב ראשון לציון", lat: 31.968, lng: 34.806 },
  { name: "מרכז העיר פתח תקווה", lat: 32.087, lng: 34.887 },
];

const ADDRESS_MOCKS = [
  { name: "רחוב שטמפפר, פתח תקווה", lat: 32.0917, lng: 34.8877 },
  { name: "רחוב הרצל, פתח תקווה", lat: 32.0867, lng: 34.8872 },
  { name: "רחוב ז׳בוטינסקי, פתח תקווה", lat: 32.0974, lng: 34.8784 },
  { name: "רחוב בר כוכבא, פתח תקווה", lat: 32.0912, lng: 34.8827 },
  { name: "רחוב חיים עוזר, פתח תקווה", lat: 32.0893, lng: 34.8866 },
  { name: "רחוב שטמפפר, בני ברק", lat: 32.0885, lng: 34.8388 },
  { name: "רחוב ז׳בוטינסקי, בני ברק", lat: 32.0874, lng: 34.8344 },
  { name: "רחוב רבי עקיבא, בני ברק", lat: 32.0856, lng: 34.8355 },
  { name: "רחוב הרצל, תל אביב", lat: 32.0568, lng: 34.7712 },
  { name: "רחוב דיזנגוף, תל אביב", lat: 32.0796, lng: 34.7734 },
  { name: "רחוב אבן גבירול, תל אביב", lat: 32.0778, lng: 34.7816 },
  { name: "שדרות רוטשילד, תל אביב", lat: 32.0644, lng: 34.7747 },
  { name: "רחוב אלנבי, תל אביב", lat: 32.0684, lng: 34.7721 },
  { name: "רחוב ארלוזורוב, תל אביב", lat: 32.0915, lng: 34.7814 },
  { name: "רחוב ביאליק, רמת גן", lat: 32.0833, lng: 34.8159 },
  { name: "רחוב ז׳בוטינסקי, רמת גן", lat: 32.0867, lng: 34.8059 },
  { name: "רחוב אבא הלל, רמת גן", lat: 32.0852, lng: 34.8118 },
  { name: "רחוב הרצל, ראשון לציון", lat: 31.9645, lng: 34.8019 },
  { name: "רחוב ז׳בוטינסקי, ראשון לציון", lat: 31.9732, lng: 34.8048 },
  { name: "רחוב רוטשילד, ראשון לציון", lat: 31.9688, lng: 34.8037 },
  { name: "רחוב ויצמן, כפר סבא", lat: 32.1759, lng: 34.9075 },
  { name: "רחוב תל חי, כפר סבא", lat: 32.1801, lng: 34.9087 },
  { name: "רחוב הרצל, רחובות", lat: 31.8936, lng: 34.8115 },
  { name: "רחוב המדע, רחובות", lat: 31.9068, lng: 34.8088 },
  { name: "רחוב הרצל, חיפה", lat: 32.8148, lng: 34.9982 },
  { name: "שדרות הנשיא, חיפה", lat: 32.8047, lng: 34.9897 },
  { name: "רחוב הרצל, ירושלים", lat: 31.7868, lng: 35.2019 },
  { name: "רחוב יפו, ירושלים", lat: 31.7832, lng: 35.2137 },
];

function plannedDestinationCatalog() {
  const seen = new Set();
  const all = [...DESTINATION_MOCKS, ...ADDRESS_MOCKS];
  return all.filter((d) => {
    if (!d?.name || seen.has(d.name)) return false;
    seen.add(d.name);
    return true;
  });
}

function normalizeAddressText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[׳'"]/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveDestinationFromFreeText(query) {
  const q = normalizeAddressText(query);
  if (!q) return null;
  const catalog = plannedDestinationCatalog();
  const exact = catalog.find((d) => normalizeAddressText(d.name) === q);
  if (exact) return { ...exact };

  const qTokens = q.split(" ").filter(Boolean);
  const scored = catalog
    .map((d) => {
      const dn = normalizeAddressText(d.name);
      let score = 0;
      if (dn.includes(q)) score += 10;
      qTokens.forEach((tok) => {
        if (dn.includes(tok)) score += 2;
      });
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length) return { ...scored[0].d };
  return null;
}

function plannedArrivalDate() {
  return new Date(Date.now() + (appState.plannedArrivalOffsetMin || 0) * 60000);
}

function getHomeRankedLots() {
  const anchor = getHomeAnchorPoint();
  const arrival = plannedArrivalDate();
  const now = new Date();
  const active = driverDataService.getParkingSupply({ segments: appState.homeSegmentFilters });
  return active
    .map((lot) => {
      const pred = computePredictedAvailability(lot, arrival, now);
      return {
        ...lot,
        __pred: pred,
        __available: pred?.predicted_available_spots ?? lot.available_spots,
        __hourly: Number(lot?.pricing?.hourly_rate || 0),
        __dist: distanceMeters(anchor, lot.location),
      };
    })
    .filter((lot) => lot.__pred.predicted_available_spots > 0)
    .sort((a, b) => a.__dist - b.__dist);
}

function getHomeTop6Lots() {
  const ranked = getHomeRankedLots();
  if (!ranked.length) return [];
  const chosen = [];
  const picked = new Set();
  const addBy = (list, predicate, tag) => {
    const found = list.find((lot) => !picked.has(lot.id) && predicate(lot));
    if (!found) return;
    picked.add(found.id);
    chosen.push({ ...found, __rankTag: tag });
  };
  addBy(ranked, () => true, "nearest");
  addBy([...ranked].sort((a, b) => a.__hourly - b.__hourly), () => true, "cheapest");
  addBy([...ranked].sort((a, b) => b.__available - a.__available), () => true, "most_available");
  ranked.forEach((lot) => {
    if (chosen.length >= 6 || picked.has(lot.id)) return;
    picked.add(lot.id);
    chosen.push({ ...lot, __rankTag: "nearby" });
  });
  return chosen.slice(0, 6);
}

function getHomeVisibleLots() {
  return getHomeTop6Lots();
}

function getHomeCarouselAnchor() {
  if (isInIsraelBounds(appState.plannedDestination)) return appState.plannedDestination;
  if (isInIsraelBounds(appState.userLocation)) return appState.userLocation;
  return null;
}

function getHomeCarouselLots() {
  const anchor = getHomeCarouselAnchor();
  const ranked = getMapDisplayLots()
    .map((lot) => ({
      ...lot,
      distance_meters: anchor ? distanceMeters(anchor, lot.location) : Number.MAX_SAFE_INTEGER,
      hourly_rate: Number(lot?.pricing?.hourly_rate || 0),
      available_spots_display: lot.__pred?.predicted_available_spots ?? lot.available_spots,
    }))
    .sort((a, b) => a.distance_meters - b.distance_meters);
  if (!anchor) return [];
  if (isInIsraelBounds(appState.plannedDestination)) {
    const nearDestination = ranked.filter((lot) => lot.distance_meters <= 5000);
    return nearDestination.length ? nearDestination : ranked.slice(0, 10);
  }
  return ranked;
}

function getHomeMapFocusPoints(activeLot) {
  const points = [];
  if (isInIsraelBounds(appState.plannedDestination)) points.push({ lat: appState.plannedDestination.lat, lng: appState.plannedDestination.lng });
  else if (isInIsraelBounds(appState.userLocation)) points.push({ lat: appState.userLocation.lat, lng: appState.userLocation.lng });
  if (activeLot?.location) points.push({ lat: activeLot.location.lat, lng: activeLot.location.lng });
  return points;
}

function getMapDisplayLots() {
  const anchor = getHomeAnchorPoint();
  const arrival = plannedArrivalDate();
  const now = new Date();
  return driverDataService
    .getParkingSupply({ segments: appState.homeSegmentFilters })
    .filter((lot) => Number(lot.available_spots || 0) > 0)
    .map((lot) => ({
      ...lot,
      __pred: computePredictedAvailability(lot, arrival, now),
      __dist: distanceMeters(anchor, lot.location),
    }));
}

function getHomeAnchorPoint() {
  if (isInIsraelBounds(appState.plannedDestination)) return appState.plannedDestination;
  if (isInIsraelBounds(appState.userLocation)) return { name: t("current_location_token"), lat: appState.userLocation.lat, lng: appState.userLocation.lng };
  const firstLot =
    driverDataService.getParkingSupply({ segments: appState.homeSegmentFilters })[0] ||
    driverDataService.getParkingSupply({ includeInactive: true })[0];
  return firstLot ? { name: firstLot.name, lat: firstLot.location.lat, lng: firstLot.location.lng } : { name: t("current_location_token"), lat: 32.087, lng: 34.78 };
}

function lotStableNoise(lotId) {
  const n = Number(String(lotId).replace(/\D/g, "")) || 1;
  return ((n * 17) % 11 - 5) / 100; // -0.05 .. +0.05
}

function computePredictedAvailability(lot, arrivalDate = new Date(), nowDate = new Date()) {
  const hour = arrivalDate.getHours();
  let factor = 1;
  if ((hour >= 8 && hour < 10) || (hour >= 17 && hour < 20)) factor -= 0.22;
  else if (hour >= 0 && hour < 6) factor += 0.1;
  const weekendBoost = [5, 6].includes(arrivalDate.getDay()) ? 0.06 : 0;
  const noise = lotStableNoise(lot.id);
  factor += weekendBoost + noise;
  const predicted = Math.max(0, Math.round(lot.available_spots * factor));
  const confidence = Math.abs(arrivalDate - nowDate) > 45 * 60000 ? "low" : Math.abs(arrivalDate - nowDate) > 20 * 60000 ? "medium" : "high";
  return { predicted_available_spots: predicted, confidence };
}

const I18N = {
  en: {
    app_title: "SpaceLy",
    nav_driver: "Driver",
    nav_admin: "Admin",
    nav_dashboard: "Dashboard",
    nav_parking_lots: "Parking Lots",
    nav_parking_map: "Parking Map",
    nav_issues: "Issues",
    nav_users: "Users",
    nav_audit_log: "Audit Log",
    nav_settings: "Settings",
    nav_edit_floor: "Edit Floor",
    nav_home: "Home",
    nav_vehicles: "My Vehicles",
    nav_parking: "My Parking",
    nav_payments: "Payments",
    nav_notifications: "Notifications",
    nav_map: "Map",
    nav_favorites: "Favorites",
    add_favorite: "Add to favorites",
    remove_favorite: "Remove from favorites",
    nav_reserve: "Reserve",
    nav_profile: "Profile",
    app_subtitle: "Smart Parking Management",
    unread: "Unread",
    switch_to_admin: "Switch to Admin View",
    switch_to_driver: "Switch to Driver View",
    reset_demo: "Reset Demo",
    personal_area: "Personal Area",
    language: "Language",
    language_help: "Choose app language",
    quick_actions: "Quick Actions",
    open_notifications: "Open Notifications",
    open_reservations: "Open Reservations",
    mobile_home: "Home",
    mobile_vehicles: "Vehicles",
    mobile_parking: "Parking",
    mobile_payments: "Payments",
    mobile_profile: "Profile",
    parking_discovery: "Parking Discovery",
    map_overview: "Real-time lot availability and map overview.",
    nearby_lots: "Nearby Parking Lots",
    open_selected_lot: "Open Selected Lot",
    spots_count: "spots",
    hourly: "Hourly",
    status: "Status",
    view: "View",
    lpr_entry: "Simulate LPR Entry",
    start_parking_manual: "Start Parking",
    no_lot_found: "No lot found",
    available_spots: "Available Spots",
    floors: "Floors",
    pricing: "Pricing",
    first_hour: "First Hour",
    daily_max: "Daily Max",
    grace: "Grace",
    minutes_short: "min",
    operating_hours: "Operating Hours",
    amenities: "Amenities",
    back: "Back",
    active_parking: "Active Parking",
    no_active_session: "No active or assigned session.",
    upcoming_reservation: "Upcoming reservation",
    start: "Start",
    arrive_with_reservation: "Arrive with Reservation",
    go_home: "Go to Home",
    active_parking_session: "Active Parking Session",
    lot: "Lot",
    spot: "Spot",
    entry: "Entry",
    assignment_expires: "Assignment Expires",
    navigation: "Navigation",
    timer: "Timer",
    estimated_cost: "Estimated Cost",
    needs_charging: "Needs Charging",
    yes: "Yes",
    no: "No",
    i_arrived: "I Arrived",
    manual_exit: "Exit (Manual)",
    report_issue: "Report Issue",
    issue_type: "Issue Type",
    spot_type: "Parking Type",
    describe_issue: "Describe the issue",
    photos_urls: "Photo URLs comma-separated (optional)",
    submit_issue: "Submit Issue",
    my_vehicles: "My Vehicles",
    electric: "Electric",
    fuel: "Fuel",
    default_vehicle: "Default",
    set_default: "Set Default",
    add_vehicle: "Add Vehicle",
    nickname: "Nickname",
    manufacturer: "Manufacturer",
    model: "Model",
    year: "Year",
    color: "Color",
    license_plate: "License Plate",
    size_small: "Small",
    size_regular: "Regular",
    size_large: "Large",
    size_xl: "Extra Large",
    cond_disabled: "Disabled",
    cond_stroller: "Stroller",
    cond_pregnant: "Pregnant",
    cond_elderly: "Elderly",
    payment_history: "Payment History",
    no_payments: "No payments yet.",
    debt: "Debt",
    notifications: "Notifications",
    mark_all_read: "Mark All Read",
    new_badge: "New",
    read: "Read",
    no_notifications: "No notifications.",
    payment_summary: "Payment Summary",
    no_pending_payment: "No pending payment.",
    duration: "Duration",
    exit: "Exit",
    base_rate: "Base Rate",
    extra_charges: "Extra Charges",
    discounts: "Discounts",
    total: "Total",
    simulate_failure: "Simulate Failure",
    pay_now: "Pay Now",
    reserve_parking: "Reserve Parking",
    save_parking: "Save Parking",
    save_not_available_municipal: "Saving is not available for Blue & White parking.",
    save_parking_title: "Save a parking spot?",
    save_parking_text: "Saving a spot costs ILS 10. The spot is held for up to 30 minutes.",
    save_parking_emphasis: "If no entry is detected within 30 minutes, the spot is released and you will be charged.",
    confirm_save_parking: "Save my spot",
    reserved_parking: "Reserved Parking",
    reserved_until: "Reserved until",
    reserved_spot_label: "Your reserved spot:",
    reserved_timer: "Reservation timer",
    inline_reserved_title: "Reservation running",
    inline_active_title: "Parking is active",
    simulate_entry: "Simulate entry to parking lot",
    reservation_expired_fee: "Reservation expired. Spot released and fee charged.",
    reservation_release_fee: "Reservation released. Hold fee was charged.",
    parking_hold_fee_label: "Parking hold fee",
    select_lot: "Select Lot",
    regular: "Regular",
    disabled: "Disabled",
    ev_charging: "EV Charging",
    wide: "Wide",
    stroller: "Stroller",
    vip: "VIP",
    booking_fee: "Booking fee demo",
    reserve_prepay: "Reserve + Prepay",
    my_reservations: "My Reservations",
    arrive: "Arrive",
    no_reservations: "No reservations yet.",
    dashboard: "Dashboard",
    overall_occupancy: "Overall Occupancy",
    active_sessions: "Active Sessions",
    open_issues: "Open Issues",
    daily_revenue: "Daily Revenue",
    recent_audit_logs: "Recent Audit Logs",
    no_logs: "No logs yet.",
    admin_parking_map: "Admin Parking Map",
    legend: "Legend",
    issue_reports: "Issue Reports",
    photos: "Photos",
    no_photos: "No photos",
    no_issues: "No issues.",
    users: "Users",
    audit_log: "Audit Log",
    target: "Target",
    by: "by",
    no_audit_events: "No audit events.",
    system_settings: "System Settings",
    default_pricing: "Default Pricing",
    timeout_settings: "Timeout Settings",
    save_settings: "Save Settings",
    edit_floor_layout: "Edit Floor Layout",
    row_letter: "Row Letter (A..Z)",
    spot_number: "Spot Number",
    add_spot: "Add Spot",
    switch_mode: "Switch Mode",
    reset: "Reset",
    lpr_existing_session: "You already have an active/assigned parking session.",
    lpr_no_default_vehicle: "Set a default vehicle first.",
    default_vehicle_set_in_profile: "No default vehicle is set. Please set one in Profile > Vehicle Management.",
    lpr_lot_inactive: "Selected parking lot is not active.",
    lpr_no_spot: "No suitable spot available.",
    fill_required: "Please fill all required fields.",
    default_vehicle_required: "Default vehicle is required.",
    reservation_no_spot: "No suitable spot for reservation.",
    issue_required: "Issue type and description are required.",
    reset_confirm: "Reset demo data?",
    prompt_spot_status: "Set status for",
    used_spot: "Use spot",
    navigate: "Navigate",
    full_details: "Full Details",
    close: "Close",
    nearby_count: "parking lots nearby",
    locating: "Find my location",
    location_denied: "Location permission denied. Please enable location.",
    location_unavailable: "Unable to get location now.",
    nav_steps: "Navigation Instructions",
    cant_find_spot: "Can't find my spot",
    exit_parking_lot: "Exit Parking",
    report_parking_issue: "Report Parking Issue",
    searching_with_vehicle: "Searching With Vehicle",
    switch_vehicle: "Switch Vehicle",
    vehicle_size: "Vehicle Size",
    nearest_lots: "Nearest Parking Lots",
    no_available_lots: "No available parking lots nearby.",
    lot_name: "Lot Name",
    price_per_hour: "Price / Hour",
    your_vehicle: "Your Vehicle",
    results_count: "results",
    meter_short: "m",
    kilometer_short: "km",
    color_theme: "Color Theme",
    color_theme_help: "Choose your app color style",
    theme_blue: "Blue",
    theme_purple: "Purple",
    theme_emerald: "Emerald",
    theme_orange: "Orange",
    theme_rose: "Rose",
    theme_indigo: "Indigo",
    theme_teal: "Teal",
    theme_slate: "Slate",
    drag_to_close: "Swipe down or tap outside to close",
    my_profile: "Personal Area",
    edit_personal_details: "Edit Personal Details",
    vehicle_management: "Vehicle Management",
    payment_methods: "Payment Methods",
    invoices: "Invoices",
    subscriptions_benefits: "Subscriptions & Benefits",
    support: "Support",
    back_to_profile: "Back to profile",
    phone: "Phone",
    save: "Save",
    add_payment_method: "Add Payment Method",
    no_payment_methods: "No payment methods saved yet.",
    no_subscriptions: "No active subscriptions.",
    personal_details: "Personal Details",
    choose_vehicle_title: "Choose Vehicle",
    choose_vehicle_subtitle: "Choose the vehicle you want to search parking with",
    add_new_vehicle_card: "Add New Vehicle",
    sedan: "Sedan",
    suv: "SUV",
    hatchback: "Hatchback",
    electric_car: "Electric",
    lots_around_you: "Parking Around You",
    sort_by: "Sort by",
    sort_proximity: "Proximity",
    sort_availability: "Available Spots",
    lot_entries: "Lot Entrances",
    primary_entry: "Main Entrance",
    secondary_entry: "Secondary Entrance",
    floor_regular: "Regular Spots",
    floor_disabled: "Disabled Spots",
    floor_electric: "EV Spots",
    every_15_minutes: "Every additional 15 minutes",
    enable_location: "Enable location access",
    assigned_spot: "Assigned Spot",
    textual_navigation: "Text Navigation",
    release_parking: "Release Parking",
    release_reserved: "Release Reservation",
    end_parking: "End Parking",
    parking_guard_other_lot_active: "You already have an active or reserved parking in another location.",
    release_parking_done: "Spot released. Billing remains active until lot exit.",
    report_issue_quick: "Report Issue",
    choose_issue_type: "Choose issue type",
    issue_auto_reassign_info: "For relevant issues, the system will automatically assign an alternative spot.",
    issue_reassigned_msg: "Issue detected. We assigned you a new spot: {spot}.",
    issue_no_alternative: "No alternative spot available right now. Parking team has been notified.",
    issue_no_wide_alternative: "No suitable wider spot is available right now. Try another entry and follow the updated guidance.",
    issue_guidance_updated: "Navigation guidance was updated. You can also call support.",
    call_support: "Call support",
    admin_issue_filter_all: "All issues",
    admin_issue_filter_urgent: "Requires immediate action",
    issue_resolution_action: "Resolution",
    reassigned: "Reassigned",
    guidance_updated: "Guidance Updated",
    escalated_no_spot: "Escalated (No Spot)",
    logged_only: "Logged Only",
    response_time_ms: "Response Time (ms)",
    no_spot_released: "No active spot to release.",
    welcome_title: "Welcome",
    your_parking_label: "Your Parking:",
    simulate_exit: "Simulate Exit",
    release_confirm_title: "Done parking?",
    release_confirm_text: "Great. Until you exit the parking lot, someone else can receive your spot.",
    release_confirm_emphasis: "Billing ends only when you actually exit the lot.",
    confirm_release: "Release my spot",
    existing_parking_block: "There is already an active or reserved parking. You cannot start or reserve another parking.",
    reserved_release_done: "Reserved spot released.",
    cancel: "Cancel",
    home_mode_nearby: "Find Parking Now",
    home_mode_planned: "Plan Trip",
    current_location_token: "Your current location",
    home_map_compare_title: "Parking around you",
    no_lots_current_location: "No parking around your area. Try another address.",
    no_lots_selected_address: "No parking lots found near this address. Try another location.",
    home_view_map: "Map",
    home_view_list: "List",
    home_list_title: "Parking Nearby",
    segment_structured: "Parking Lots",
    segment_municipal_blue_white: "Blue & White",
    segment_private_hourly: "Private Spots",
    rank_nearest: "Closest",
    rank_cheapest: "Cheapest",
    rank_most_available: "Most Available",
    rank_nearby: "Nearby",
    home_intro_title: "Your parking is waiting for you",
    home_intro_subtitle: "Swipe right and choose the best parking for you",
    enable_location_cta: "Enable location",
    location_address_mode_hint: "Location access is off. You can still search by address.",
    no_lots_found_for_anchor: "No parking lots were found near this location.",
    destination_placeholder: "Where are you going?",
    search_where_placeholder: "Where would you like to park?",
    destination_empty: "Select a destination to see parking near your destination.",
    destination_not_found: "No destinations found.",
    destination_help: "Type street + city and choose an address.",
    apply_destination: "Apply address",
    arrival_time: "Arrival Time",
    now_short: "Now",
    in_15: "In 15 min",
    in_30: "In 30 min",
    in_60: "In 60 min",
    sort_predicted: "Predicted Availability",
    sort_price: "Price",
    predicted_available: "Predicted",
    distance_label: "Distance",
    clear_destination: "Clear destination",
    around_destination: "Parking Near Destination",
    confidence_low: "Low confidence",
    confidence_medium: "Medium confidence",
    confidence_high: "High confidence",
    auth_signin_signup: "Sign in / Sign up",
    auth_phone_title: "Sign in with phone",
    auth_phone_subtitle: "Enter an Israeli phone number to receive a verification SMS.",
    auth_phone_placeholder: "05XXXXXXXX",
    auth_send_code: "Send code",
    auth_otp_placeholder: "6-digit code",
    auth_verify_code: "Verify and continue",
    auth_change_phone: "Change number",
    auth_signout: "Sign out",
    edit_vehicle: "Edit vehicle",
    save_vehicle_changes: "Save vehicle changes",
    cancel_edit: "Cancel edit",
    personal_details_saved: "Personal details saved.",
    profile_image_saved: "Profile image saved.",
    profile_image_uploading: "Uploading profile image",
    profile_image_upload_failed: "Image upload failed. Please try again.",
    profile_saving: "Saving details...",
    profile_save_failed: "Could not save details. Please try again.",
    vehicle_saved: "Vehicle saved.",
    auth_required_action: "To start or reserve parking, please sign in with your phone number.",
    auth_profile_required: "Complete your personal details before starting parking.",
    auth_vehicle_required: "Add a default vehicle before starting parking.",
    auth_service_unavailable: "Authentication service is currently unavailable.",
    auth_invalid_phone: "Enter a valid Israeli phone number.",
    auth_invalid_otp: "Enter a valid 6-digit code.",
    auth_sms_sent: "Verification code sent by SMS.",
    auth_welcome: "Welcome back",
    auth_complete_profile_cta: "Complete profile",
    auth_complete_vehicle_cta: "Add vehicle",
    auth_loading: "Checking your session...",
    onboarding_title: "Let's finish your setup",
    onboarding_subtitle: "Complete details and add a default vehicle to start parking.",
    onboarding_profile_card_title: "Personal details",
    onboarding_vehicle_card_title: "Vehicle management",
    onboarding_phone_locked: "Phone number (verified)",
    onboarding_avatar_url: "Profile image URL (optional)",
    onboarding_complete_start: "Complete profile and start",
    onboarding_missing_profile: "Missing personal details",
    onboarding_missing_vehicle: "Missing default vehicle",
    onboarding_ready: "All set",
    onboarding_next: "Next",
    onboarding_back: "Back",
    onboarding_step_personal: "Step 1/2 - Personal details",
    onboarding_step_vehicle: "Step 2/2 - Vehicle details",
    vehicle_size_help: "Vehicle size helps us assign a spot that actually fits your car.",
    special_features: "Special features",
    license_plate_required: "License plate is required.",
    vehicle_color_white: "White",
    vehicle_color_black: "Black",
    vehicle_color_silver: "Silver",
    vehicle_color_gray: "Gray",
    vehicle_color_blue: "Blue",
    vehicle_color_red: "Red",
    vehicle_color_green: "Green",
    vehicle_color_yellow: "Yellow",
    vehicle_color_brown: "Brown",
    vehicle_color_orange: "Orange",
    full_name_required: "Full name is required.",
    email_required: "Email is required.",
    email_invalid: "Enter a valid email address.",
    home_tour_step_search: "Search where you want to park.",
    home_tour_step_filters: "Turn parking layers on or off here.",
    home_tour_step_cards: "Swipe cards to compare nearby parking.",
    home_tour_step_nav: "Use the bottom menu for profile, favorites and alerts.",
    home_tour_next: "Next",
    home_tour_skip: "Skip",
    home_tour_finish: "Finish",
  },
  he: {
    app_title: "Spacely",
    nav_driver: "נהג",
    nav_admin: "אדמין",
    nav_dashboard: "דשבורד",
    nav_parking_lots: "חניונים",
    nav_parking_map: "מפת חניה",
    nav_issues: "תקלות",
    nav_users: "משתמשים",
    nav_audit_log: "יומן פעולות",
    nav_settings: "הגדרות",
    nav_edit_floor: "עריכת קומה",
    nav_home: "בית",
    nav_vehicles: "הרכבים שלי",
    nav_parking: "החניה שלי",
    nav_payments: "תשלומים",
    nav_notifications: "התראות",
    nav_map: "מפה",
    nav_favorites: "מועדפים",
    add_favorite: "הוסף למועדפים",
    remove_favorite: "הסר ממועדפים",
    nav_reserve: "הזמנה",
    nav_profile: "איזור אישי",
    app_subtitle: "ניהול חניה חכם",
    unread: "לא נקראו",
    switch_to_admin: "מעבר לתצוגת אדמין",
    switch_to_driver: "מעבר לתצוגת נהג",
    reset_demo: "איפוס דמו",
    personal_area: "אזור אישי",
    language: "שפה",
    language_help: "בחר שפת אפליקציה",
    quick_actions: "פעולות מהירות",
    open_notifications: "מעבר להתראות",
    open_reservations: "מעבר להזמנות",
    mobile_home: "בית",
    mobile_vehicles: "רכבים",
    mobile_parking: "חניה",
    mobile_payments: "תשלומים",
    mobile_profile: "אישי",
    parking_discovery: "איתור חניה",
    map_overview: "זמינות חניונים בזמן אמת ומפה אינטראקטיבית.",
    nearby_lots: "חניונים קרובים",
    open_selected_lot: "פתח חניון נבחר",
    spots_count: "חניות",
    hourly: "לשעה",
    status: "סטטוס",
    view: "צפייה",
    lpr_entry: "סימולציית כניסת LPR",
    start_parking_manual: "הפעלת חניה",
    no_lot_found: "לא נמצא חניון",
    available_spots: "חניות פנויות",
    floors: "קומות",
    pricing: "תמחור",
    first_hour: "שעה ראשונה",
    daily_max: "מקסימום יומי",
    grace: "גרייס",
    minutes_short: "דק'",
    operating_hours: "שעות פעילות",
    amenities: "שירותים",
    back: "חזרה",
    active_parking: "חניה פעילה",
    no_active_session: "אין כרגע סשן חניה פעיל או מוקצה.",
    upcoming_reservation: "הזמנה קרובה",
    start: "התחלה",
    arrive_with_reservation: "הגעתי עם הזמנה",
    go_home: "חזרה לבית",
    active_parking_session: "סשן חניה פעיל",
    lot: "חניון",
    spot: "מקום",
    entry: "כניסה",
    assignment_expires: "ההקצאה פגה ב-",
    navigation: "ניווט",
    timer: "טיימר",
    estimated_cost: "עלות משוערת",
    needs_charging: "צריך טעינה",
    yes: "כן",
    no: "לא",
    i_arrived: "הגעתי",
    manual_exit: "יציאה ידנית",
    report_issue: "דיווח תקלה",
    issue_type: "סוג תקלה",
    spot_type: "סוג החניה",
    describe_issue: "תיאור התקלה",
    photos_urls: "קישורי תמונות מופרדים בפסיקים (אופציונלי)",
    submit_issue: "שליחת דיווח",
    my_vehicles: "הרכבים שלי",
    electric: "חשמלי",
    fuel: "בנזין/דיזל",
    default_vehicle: "ברירת מחדל",
    set_default: "הגדר כברירת מחדל",
    add_vehicle: "הוספת רכב",
    nickname: "כינוי",
    manufacturer: "יצרן",
    model: "דגם",
    year: "שנה",
    color: "צבע",
    license_plate: "מספר רישוי",
    size_small: "קטן",
    size_regular: "רגיל",
    size_large: "גדול",
    size_xl: "גדול מאוד",
    cond_disabled: "נכה",
    cond_stroller: "עגלת תינוק",
    cond_pregnant: "בהריון",
    cond_elderly: "מבוגר",
    payment_history: "היסטוריית תשלומים",
    no_payments: "אין תשלומים עדיין.",
    debt: "חוב",
    notifications: "התראות",
    mark_all_read: "סמן הכל כנקרא",
    new_badge: "חדש",
    read: "קראתי",
    no_notifications: "אין התראות.",
    payment_summary: "סיכום תשלום",
    no_pending_payment: "אין תשלום ממתין.",
    duration: "משך זמן",
    exit: "יציאה",
    base_rate: "עלות בסיס",
    extra_charges: "חיובים נוספים",
    discounts: "הנחות",
    total: "סה\"כ",
    simulate_failure: "סימולציית כשל",
    pay_now: "שלם עכשיו",
    reserve_parking: "הזמנת חניה",
    save_parking: "שמירת חניה",
    save_not_available_municipal: "לא ניתן לשמור חניה בכחול-לבן.",
    save_parking_title: "לשמור חניה?",
    save_parking_text: "שמירת חניה בעלות של 10 ש\"ח. החניה נשמרת לעד 30 דקות.",
    save_parking_emphasis: "אם המערכת לא מזהה כניסה בתוך 30 דקות, החניה משתחררת והמערכת תחייב אותך.",
    confirm_save_parking: "שמור לי חניה",
    reserved_parking: "חניה שמורה",
    reserved_until: "שמורה עד",
    reserved_spot_label: "החניה השמורה שלך:",
    reserved_timer: "טיימר שמירה",
    inline_reserved_title: "שמירת חניה פעילה",
    inline_active_title: "חניה פעילה",
    simulate_entry: "סימולציית כניסה לחניון",
    reservation_expired_fee: "תוקף השמירה הסתיים. החניה שוחררה וחויבת בעמלה.",
    reservation_release_fee: "החניה השמורה שוחררה. דמי השמירה חויבו.",
    parking_hold_fee_label: "דמי שמירת חניה",
    select_lot: "בחר חניון",
    regular: "רגיל",
    disabled: "נכה",
    ev_charging: "עמדת טעינה",
    wide: "רחב",
    stroller: "עגלה",
    vip: "VIP",
    booking_fee: "עמלת הזמנה בדמו",
    reserve_prepay: "הזמן + שלם מראש",
    my_reservations: "ההזמנות שלי",
    arrive: "הגעתי",
    no_reservations: "אין הזמנות עדיין.",
    dashboard: "דשבורד",
    overall_occupancy: "תפוסה כללית",
    active_sessions: "סשנים פעילים",
    open_issues: "תקלות פתוחות",
    daily_revenue: "הכנסה יומית",
    recent_audit_logs: "לוגים אחרונים",
    no_logs: "אין לוגים עדיין.",
    admin_parking_map: "מפת חניה לאדמין",
    legend: "מקרא",
    issue_reports: "דיווחי תקלות",
    photos: "תמונות",
    no_photos: "אין תמונות",
    no_issues: "אין תקלות.",
    users: "משתמשים",
    audit_log: "יומן פעולות",
    target: "יעד",
    by: "על ידי",
    no_audit_events: "אין אירועים ביומן.",
    system_settings: "הגדרות מערכת",
    default_pricing: "תמחור ברירת מחדל",
    timeout_settings: "הגדרות טיימאאוט",
    save_settings: "שמירת הגדרות",
    edit_floor_layout: "עריכת פריסת קומה",
    row_letter: "אות שורה (A..Z)",
    spot_number: "מספר מקום",
    add_spot: "הוסף מקום",
    switch_mode: "החלפת מצב",
    reset: "איפוס",
    lpr_existing_session: "יש לך כבר סשן חניה פעיל/מוקצה.",
    lpr_no_default_vehicle: "יש להגדיר רכב ברירת מחדל קודם.",
    default_vehicle_set_in_profile: "לא הוגדר רכב ברירת מחדל. נא להגדיר בפרופיל > ניהול רכבים.",
    lpr_lot_inactive: "החניון שנבחר אינו פעיל כרגע.",
    lpr_no_spot: "לא נמצא מקום מתאים כרגע.",
    fill_required: "יש למלא את כל השדות החובה.",
    default_vehicle_required: "נדרש רכב ברירת מחדל.",
    reservation_no_spot: "לא נמצא מקום מתאים להזמנה.",
    issue_required: "יש לבחור סוג תקלה ולמלא תיאור.",
    reset_confirm: "לאפס את נתוני הדמו?",
    prompt_spot_status: "בחר סטטוס עבור",
    used_spot: "עבר למקום",
    navigate: "ניווט",
    full_details: "פרטים מלאים",
    close: "סגור",
    nearby_count: "חניונים באזור",
    locating: "מיקום נוכחי",
    location_denied: "אין הרשאת מיקום. יש לאפשר גישה למיקום.",
    location_unavailable: "לא ניתן לקבל מיקום כרגע.",
    nav_steps: "הנחיות ניווט",
    cant_find_spot: "לא מוצא את החניה",
    exit_parking_lot: "יצאתי מהחניון",
    report_parking_issue: "דיווח על בעיה בחניה",
    searching_with_vehicle: "מחפש חניה עם הרכב",
    switch_vehicle: "החלף רכב",
    vehicle_size: "גודל רכב",
    nearest_lots: "חניונים קרובים",
    no_available_lots: "אין כרגע חניונים פנויים באזור.",
    lot_name: "שם חניון",
    price_per_hour: "מחיר לשעה",
    your_vehicle: "הרכב שלך",
    results_count: "תוצאות",
    meter_short: "מ'",
    kilometer_short: "ק\"מ",
    color_theme: "ערכת צבעים",
    color_theme_help: "בחר סגנון צבע לאפליקציה",
    theme_blue: "כחול קלאסי",
    theme_purple: "סגול מודרני",
    theme_emerald: "ירוק אמרלד",
    theme_orange: "כתום אנרגטי",
    theme_rose: "ורוד פרימיום",
    theme_indigo: "אינדיגו עמוק",
    theme_teal: "טורקיז רענן",
    theme_slate: "אפור מינימלי",
    drag_to_close: "גרור מטה או לחץ מחוץ לכרטיס כדי לסגור",
    my_profile: "איזור אישי",
    edit_personal_details: "ערוך פרטים אישיים",
    vehicle_management: "ניהול רכבים",
    payment_methods: "אמצעי תשלום",
    invoices: "חשבוניות",
    subscriptions_benefits: "מינוי והטבות",
    support: "פניה לתמיכה",
    back_to_profile: "חזרה לפרופיל",
    phone: "טלפון",
    save: "שמירה",
    add_payment_method: "הוסף אמצעי תשלום",
    no_payment_methods: "אין אמצעי תשלום שמורים כרגע.",
    no_subscriptions: "אין כרגע מינוי פעיל.",
    personal_details: "פרטים אישיים",
    choose_vehicle_title: "בחר רכב",
    choose_vehicle_subtitle: "בחר את הרכב שאיתו תחפש חניה",
    add_new_vehicle_card: "הוספת רכב חדש",
    sedan: "סדאן",
    suv: "SUV",
    hatchback: "האצ'בק",
    electric_car: "חשמלי",
    lots_around_you: "חניות מסביבך",
    sort_by: "מיון לפי",
    sort_proximity: "קרבה",
    sort_availability: "כמות חניות פנויות",
    lot_entries: "כניסות לחניון",
    primary_entry: "כניסה ראשית",
    secondary_entry: "כניסה דרומית",
    floor_regular: "חניה רגילה",
    floor_disabled: "נכים",
    floor_electric: "רכב חשמלי",
    every_15_minutes: "כל 15 דקות נוספות",
    enable_location: "אפשר גישה למיקום",
    assigned_spot: "חניה שהוקצתה",
    textual_navigation: "הנחיות ניווט",
    release_parking: "שחרור חניה",
    release_reserved: "שחרור שמירה",
    end_parking: "סיום חניה",
    parking_guard_other_lot_active: "כבר קיימת עבורך חניה פעילה או שמורה במיקום אחר.",
    release_parking_done: "החניה שוחררה. החיוב נשאר פעיל עד יציאה בפועל.",
    report_issue_quick: "דיווח על תקלה",
    choose_issue_type: "בחר סוג תקלה",
    issue_auto_reassign_info: "במקרים מתאימים המערכת תקצה חניה חלופית אוטומטית.",
    issue_reassigned_msg: "זוהתה בעיה. הקצנו עבורך חניה חדשה: {spot}.",
    issue_no_alternative: "לא נמצאה חלופה כרגע, צוות החניון מטפל.",
    issue_no_wide_alternative: "לא נמצאה כרגע חניה רחבה מתאימה. נסו כניסה אחרת ופעלו לפי ההנחיות המעודכנות.",
    issue_guidance_updated: "הנחיות הניווט עודכנו. אפשר גם להתקשר לנציג.",
    call_support: "שיחה לנציג",
    admin_issue_filter_all: "כל התקלות",
    admin_issue_filter_urgent: "דורש פעולה מיידית",
    issue_resolution_action: "סוג טיפול",
    reassigned: "הוקצתה חלופה",
    guidance_updated: "עודכן ניווט",
    escalated_no_spot: "הוסלם (ללא חלופה)",
    logged_only: "תועד בלבד",
    response_time_ms: "זמן תגובה (מ\"ש)",
    no_spot_released: "אין חניה פעילה לשחרור.",
    welcome_title: "ברוכים הבאים",
    your_parking_label: "החניה שלכם:",
    simulate_exit: "סימולציית יציאה מהחניון",
    release_confirm_title: "סיימתם לחנות?",
    release_confirm_text: "מצוין. עד שאתם יוצאים מהחניון, מישהו אחר יכול לקבל את החניה שלכם.",
    release_confirm_emphasis: "החיוב בפועל יסתיים רק עם יציאתכם מהחניון.",
    confirm_release: "שחרר את החניה שלי",
    existing_parking_block: "ישנה חניה פעילה או שמורה, לא ניתן לשמור או להפעיל חניה נוספת.",
    reserved_release_done: "החניה השמורה שוחררה.",
    cancel: "ביטול",
    home_mode_nearby: "מחפש חניה עכשיו",
    home_mode_planned: "מתכנן נסיעה",
    current_location_token: "מיקומך הנוכחי",
    home_map_compare_title: "חניות מסביבך",
    no_lots_current_location: "אין חניות באיזורך, נסה כתובת אחרת",
    no_lots_selected_address: "אין חניות ליד הכתובת הזו, נסה מיקום אחר",
    home_view_map: "מפה",
    home_view_list: "רשימה",
    home_list_title: "חניונים באיזור",
    segment_structured: "חניונים",
    segment_municipal_blue_white: "כחול לבן",
    segment_private_hourly: "חניות פרטיות",
    rank_nearest: "הכי קרוב",
    rank_cheapest: "הכי זול",
    rank_most_available: "הכי פנוי",
    rank_nearby: "באיזור",
    home_intro_title: "החניה שלך מחכה לך",
    home_intro_subtitle: "גלול ימינה ובחר את החניה המתאימה ביותר",
    enable_location_cta: "אפשר גישה למיקום",
    location_address_mode_hint: "אין הרשאת מיקום. עדיין אפשר לחפש לפי כתובת.",
    no_lots_found_for_anchor: "לא נמצאו חניונים ליד המיקום הזה.",
    destination_placeholder: "לאן נוסעים?",
    search_where_placeholder: "היכן תרצה לחנות?",
    destination_empty: "בחר יעד כדי לראות חניונים ליד היעד.",
    destination_not_found: "לא נמצאו יעדים.",
    destination_help: "הקלד רחוב + עיר ובחר כתובת מהרשימה.",
    apply_destination: "החל כתובת",
    arrival_time: "זמן הגעה",
    now_short: "עכשיו",
    in_15: "בעוד 15 דק'",
    in_30: "בעוד 30 דק'",
    in_60: "בעוד 60 דק'",
    sort_predicted: "זמינות צפויה",
    sort_price: "מחיר",
    predicted_available: "צפי",
    distance_label: "מרחק",
    clear_destination: "נקה יעד",
    around_destination: "חניונים ליד היעד",
    confidence_low: "אמינות נמוכה",
    confidence_medium: "אמינות בינונית",
    confidence_high: "אמינות גבוהה",
    auth_signin_signup: "התחברות / הרשמה",
    auth_phone_title: "התחברות עם טלפון",
    auth_phone_subtitle: "הזן מספר טלפון ישראלי לקבלת קוד אימות ב-SMS.",
    auth_phone_placeholder: "05XXXXXXXX",
    auth_send_code: "שלח קוד",
    auth_otp_placeholder: "קוד בן 6 ספרות",
    auth_verify_code: "אמת והמשך",
    auth_change_phone: "שנה מספר",
    auth_signout: "התנתק",
    edit_vehicle: "ערוך רכב",
    save_vehicle_changes: "שמור שינויים ברכב",
    cancel_edit: "בטל עריכה",
    personal_details_saved: "הפרטים האישיים נשמרו.",
    profile_image_saved: "תמונת הפרופיל נשמרה.",
    profile_image_uploading: "מעלה תמונת פרופיל",
    profile_image_upload_failed: "העלאת התמונה נכשלה. נסה שוב.",
    profile_saving: "שומר פרטים...",
    profile_save_failed: "שמירת הפרטים נכשלה. נסה שוב.",
    vehicle_saved: "פרטי הרכב נשמרו.",
    auth_required_action: "כדי להפעיל או לשמור חניה צריך להתחבר עם מספר טלפון.",
    auth_profile_required: "יש להשלים פרטים אישיים לפני הפעלת חניה.",
    auth_vehicle_required: "יש להוסיף רכב ברירת מחדל לפני הפעלת חניה.",
    auth_service_unavailable: "שירות האימות אינו זמין כרגע.",
    auth_invalid_phone: "יש להזין מספר טלפון ישראלי תקין.",
    auth_invalid_otp: "יש להזין קוד אימות בן 6 ספרות.",
    auth_sms_sent: "קוד אימות נשלח ב-SMS.",
    auth_welcome: "ברוך/ה הבא/ה",
    auth_complete_profile_cta: "השלם פרופיל",
    auth_complete_vehicle_cta: "הוסף רכב",
    auth_loading: "בודק את סטטוס ההתחברות...",
    onboarding_title: "בואו נשלים את ההגדרה",
    onboarding_subtitle: "השלם פרטים והוסף רכב ברירת מחדל כדי להתחיל לחנות.",
    onboarding_profile_card_title: "פרטים אישיים",
    onboarding_vehicle_card_title: "ניהול רכבים",
    onboarding_phone_locked: "טלפון (מאומת)",
    onboarding_avatar_url: "קישור לתמונת פרופיל (אופציונלי)",
    onboarding_complete_start: "השלמת פרופיל והתחלה",
    onboarding_missing_profile: "חסרים פרטים אישיים",
    onboarding_missing_vehicle: "חסר רכב ברירת מחדל",
    onboarding_ready: "הכל מוכן",
    onboarding_next: "הבא",
    onboarding_back: "חזרה",
    onboarding_step_personal: "שלב 1/2 - פרטים אישיים",
    onboarding_step_vehicle: "שלב 2/2 - פרטי רכב",
    vehicle_size_help: "גודל הרכב עוזר למערכת להקצות לך חניה שמתאימה באמת לרכב.",
    special_features: "מאפיינים מיוחדים",
    license_plate_required: "מספר רישוי הוא שדה חובה.",
    vehicle_color_white: "לבן",
    vehicle_color_black: "שחור",
    vehicle_color_silver: "כסוף",
    vehicle_color_gray: "אפור",
    vehicle_color_blue: "כחול",
    vehicle_color_red: "אדום",
    vehicle_color_green: "ירוק",
    vehicle_color_yellow: "צהוב",
    vehicle_color_brown: "חום",
    vehicle_color_orange: "כתום",
    full_name_required: "יש להזין שם מלא.",
    email_required: "יש להזין אימייל.",
    email_invalid: "יש להזין כתובת אימייל תקינה.",
    home_tour_step_search: "כאן מחפשים את היעד שבו תרצה לחנות.",
    home_tour_step_filters: "כאן מפעילים או מכבים שכבות של סוגי חניות.",
    home_tour_step_cards: "גלול בכרטיסים כדי להשוות חניות קרובות.",
    home_tour_step_nav: "התפריט התחתון מוביל לאזור אישי, מועדפים והתראות.",
    home_tour_next: "הבא",
    home_tour_skip: "דלג",
    home_tour_finish: "סיום",
  },
};

function getUiLanguage() {
  return appState?.data?.settings?.ui_language === "he" ? "he" : "en";
}

function getUiTheme() {
  const theme = appState?.data?.settings?.ui_theme || "blue";
  const valid = ["blue", "purple", "emerald", "orange", "rose", "indigo", "teal", "slate"];
  return valid.includes(theme) ? theme : "blue";
}

function t(key) {
  const lang = getUiLanguage();
  return I18N[lang][key] || I18N.en[key] || key;
}

function normalizeIsraeliPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (/^05\d{8}$/.test(digits)) return `+972${digits.slice(1)}`;
  if (/^9725\d{8}$/.test(digits)) return `+${digits}`;
  if (/^\+9725\d{8}$/.test(String(raw || "").trim())) return String(raw).trim();
  return "";
}

function getCurrentUid() {
  return appState?.auth?.uid || null;
}

function currentUserProfile() {
  const uid = getCurrentUid();
  if (!uid) return null;
  return appState.data.users.find((u) => u.id === uid) || null;
}

function canStartOrReserve() {
  if (activeSessionForUser() || activeReservationHoldForUser()) return { ok: false, reason: "existing_active" };
  if (appState.auth.status !== "signed_in" || !getCurrentUid()) return { ok: false, reason: "signed_out" };
  if (appState.onboarding?.needsProfile) return { ok: false, reason: "profile_incomplete" };
  if (appState.onboarding?.needsVehicle) return { ok: false, reason: "no_default_vehicle" };
  return { ok: true };
}

function authGuardMessage(reason) {
  if (reason === "profile_incomplete") return t("auth_profile_required");
  if (reason === "no_default_vehicle") return t("auth_vehicle_required");
  if (reason === "existing_active") return t("existing_parking_block");
  return t("auth_required_action");
}

function resetProfileUploadFeedback() {
  appState.profileImageUpload = { status: "idle", progress: 0, message: "" };
}

function setProfileUploadFeedback(status, message = "", progress = 0) {
  appState.profileImageUpload = {
    status: status || "idle",
    progress: Math.max(0, Math.min(100, Number(progress) || 0)),
    message: String(message || ""),
  };
}

function resetProfileSaveFeedback() {
  appState.profileSaveFeedback = { status: "idle", message: "" };
}

function setProfileSaveFeedback(status, message = "") {
  appState.profileSaveFeedback = { status: status || "idle", message: String(message || "") };
}

function updateOnboardingState() {
  const uid = getCurrentUid();
  const homeTourSeen = Boolean(appState?.data?.settings?.onboarding_home_tour_seen);
  if (!uid) {
    appState.onboarding = { needsProfile: false, needsVehicle: false, completed: false, homeTourSeen, tourActive: false, tourStep: 0 };
    appState.onboardingStep = 1;
    return;
  }
  const profile = appState.data.users.find((u) => u.id === uid);
  const hasProfile = Boolean(
    profile?.full_name &&
      String(profile.full_name).trim() &&
      profile?.email &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email || "").trim())
  );
  const owned = appState.data.vehicles.filter((v) => v.owner_id === uid && v.is_active);
  const hasDefaultVehicle = owned.some((v) => v.is_default);
  const prev = appState.onboarding || {};
  appState.onboarding = {
    needsProfile: !hasProfile,
    needsVehicle: !hasDefaultVehicle,
    completed: hasProfile && hasDefaultVehicle,
    homeTourSeen,
    tourActive: Boolean(prev.tourActive) && !homeTourSeen,
    tourStep: Number.isFinite(prev.tourStep) ? prev.tourStep : 0,
  };
  if (appState.onboarding.completed) {
    appState.onboardingStep = 2;
  } else if (appState.onboarding.needsProfile) {
    appState.onboardingStep = 1;
  } else {
    appState.onboardingStep = 2;
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function getOnboardingChecklist() {
  const uid = getCurrentUid();
  const user = currentUserProfile();
  const fullNameOk = Boolean(user?.full_name && String(user.full_name).trim());
  const emailOk = Boolean(user?.email && isValidEmail(user.email));
  const profileOk = fullNameOk && emailOk;
  const vehicles = appState.data.vehicles.filter((v) => v.owner_id === uid && v.is_active);
  const defaultOk = vehicles.some((v) => v.is_default);
  return {
    profileOk,
    vehicleOk: defaultOk,
    canComplete: profileOk && defaultOk,
  };
}

function ensureRecaptchaContainer() {
  let el = document.getElementById("auth-recaptcha-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "auth-recaptcha-root";
    el.style.position = "fixed";
    el.style.bottom = "8px";
    el.style.left = "8px";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    document.body.appendChild(el);
  }
  return el;
}

async function ensureFirebaseReady() {
  if (firebaseApp && firebaseAuth && firebaseDb) return true;
  if (firebaseBootPromise) return firebaseBootPromise;
  firebaseBootPromise = (async () => {
    try {
      if (!window.firebase?.initializeApp) return false;
      const response = await fetch("/api/firebase-config");
      if (!response.ok) return false;
      const payload = await response.json();
      if (!payload?.enabled || !payload?.config?.apiKey) return false;
      const cfg = payload.config;
      firebaseApp = window.firebase.apps?.length ? window.firebase.app() : window.firebase.initializeApp(cfg);
      firebaseAuth = window.firebase.auth();
      firebaseDb = window.firebase.firestore();
      return true;
    } catch {
      return false;
    }
  })();
  const ready = await firebaseBootPromise;
  firebaseBootPromise = null;
  return ready;
}

const profileService = {
  async getProfile(uid) {
    if (!uid || !firebaseDb) return null;
    const snap = await firebaseDb.collection("users").doc(uid).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
      uid,
      phone_e164: data.phone_e164 || "",
      full_name: data.full_name || "",
      email: data.email || "",
      avatar_url: data.avatar_url || "",
      role: data.role || "user",
    };
  },
  async upsertProfile(uid, payload = {}) {
    if (!uid || !firebaseDb) return;
    const ref = firebaseDb.collection("users").doc(uid);
    const prev = await ref.get();
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const data = {
      uid,
      phone_e164: payload.phone_e164 || "",
      full_name: payload.full_name || "",
      email: payload.email || "",
      avatar_url: payload.avatar_url || "",
      role: prev.exists ? (prev.data()?.role || "user") : "user",
      updated_at: now,
    };
    if (!prev.exists) data.created_at = now;
    await ref.set(data, { merge: true });
  },
};

const vehicleService = {
  async list(uid) {
    if (!uid || !firebaseDb) return [];
    const snap = await firebaseDb.collection("users").doc(uid).collection("vehicles").get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  },
  async upsert(uid, vehicle) {
    if (!uid || !firebaseDb || !vehicle?.id) return;
    const ref = firebaseDb.collection("users").doc(uid).collection("vehicles").doc(vehicle.id);
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const next = {
      ...vehicle,
      owner_uid: uid,
      updated_at: now,
    };
    const exists = await ref.get();
    if (!exists.exists) next.created_at = now;
    await ref.set(next, { merge: true });
    if (vehicle.is_default) {
      await vehicleService.setDefault(uid, vehicle.id);
    }
  },
  async setDefault(uid, vehicleId) {
    if (!uid || !vehicleId || !firebaseDb) return;
    const coll = firebaseDb.collection("users").doc(uid).collection("vehicles");
    const snap = await coll.get();
    const batch = firebaseDb.batch();
    snap.docs.forEach((doc) => {
      batch.set(doc.ref, { is_default: doc.id === vehicleId, updated_at: window.firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
    await batch.commit();
  },
};

async function syncUserDataFromCloud(uid) {
  if (!uid) return;
  const phone = appState.auth.phoneE164 || "";
  const profile = await profileService.getProfile(uid);
  if (!profile) {
    await profileService.upsertProfile(uid, {
      phone_e164: phone,
      full_name: "",
      email: "",
      avatar_url: "",
    });
  }
  const refreshedProfile = (await profileService.getProfile(uid)) || { uid, phone_e164: phone, full_name: "", email: "", avatar_url: "", role: "user" };
  appState.data.users = appState.data.users.filter((u) => u.id !== uid);
  appState.data.users.push({
    id: uid,
    email: refreshedProfile.email || "",
    full_name: refreshedProfile.full_name || "",
    avatar_url: refreshedProfile.avatar_url || "",
    role: "user",
    created_date: nowIso(),
  });
  appState.profileAvatarPreview = refreshedProfile.avatar_url || appState.profileAvatarPreview || "";
  if (refreshedProfile.phone_e164) appState.data.settings.profile_phone = refreshedProfile.phone_e164.replace(/^\+972/, "0");

  const cloudVehicles = await vehicleService.list(uid);
  const normalized = cloudVehicles.map((v) => ({
    id: v.id,
    owner_id: uid,
    license_plate: v.license_plate || "",
    manufacturer: v.manufacturer || "",
    model: v.model || "",
    year: Number(v.year || new Date().getFullYear()),
    color: v.color || "",
    vehicle_size: v.vehicle_size || "regular",
    is_electric: Boolean(v.is_electric),
    special_conditions: Array.isArray(v.special_conditions) ? v.special_conditions : [],
    is_active: v.is_active !== false,
    is_default: Boolean(v.is_default),
    nickname: v.nickname || "",
  }));
  appState.data.vehicles = appState.data.vehicles.filter((v) => v.owner_id !== uid).concat(normalized);
  if (!appState.data.vehicles.some((v) => v.owner_id === uid && v.is_default && v.is_active) && normalized.length) {
    normalized[0].is_default = true;
    await vehicleService.setDefault(uid, normalized[0].id);
  }
  updateOnboardingState();
  persist();
}

const authService = {
  async sendOtp(phoneLocalIsraeli) {
    const ready = await ensureFirebaseReady();
    if (!ready || !firebaseAuth) throw new Error("service_unavailable");
    const phoneE164 = normalizeIsraeliPhone(phoneLocalIsraeli);
    if (!phoneE164) throw new Error("invalid_phone");
    const recaptchaEl = ensureRecaptchaContainer();
    if (firebaseRecaptchaVerifier && !document.body.contains(recaptchaEl)) {
      try {
        firebaseRecaptchaVerifier.clear();
      } catch {}
      firebaseRecaptchaVerifier = null;
    }
    if (!firebaseRecaptchaVerifier) {
      firebaseRecaptchaVerifier = new window.firebase.auth.RecaptchaVerifier(recaptchaEl, {
        size: "invisible",
      });
      await firebaseRecaptchaVerifier.render();
    }
    firebaseOtpConfirmation = await firebaseAuth.signInWithPhoneNumber(phoneE164, firebaseRecaptchaVerifier);
    return { phoneE164 };
  },
  async verifyOtp(code) {
    const otp = String(code || "").trim();
    if (!/^\d{6}$/.test(otp)) throw new Error("invalid_otp");
    if (!firebaseOtpConfirmation) throw new Error("otp_not_requested");
    const result = await firebaseOtpConfirmation.confirm(otp);
    firebaseOtpConfirmation = null;
    return result?.user || null;
  },
  async signOut() {
    if (!firebaseAuth) return;
    await firebaseAuth.signOut();
  },
};

async function bootstrapAuth() {
  appState.auth.status = "loading";
  render();
  const ready = await ensureFirebaseReady();
  if (!ready || !firebaseAuth) {
    appState.auth.status = "signed_out";
    appState.auth.error = t("auth_service_unavailable");
    appState.userId = null;
    resetProfileUploadFeedback();
    resetProfileSaveFeedback();
    updateOnboardingState();
    render();
    return;
  }
  firebaseAuth.onAuthStateChanged(async (fbUser) => {
    if (!fbUser) {
      appState.auth.status = "signed_out";
      appState.auth.uid = null;
      appState.auth.phoneE164 = null;
      appState.userId = null;
      appState.auth.error = "";
      appState.profileAvatarPreview = "";
      resetProfileUploadFeedback();
      resetProfileSaveFeedback();
      updateOnboardingState();
      render();
      return;
    }
    appState.auth.status = "signed_in";
    appState.auth.uid = fbUser.uid;
    appState.auth.phoneE164 = fbUser.phoneNumber || "";
    appState.userId = fbUser.uid;
    await syncUserDataFromCloud(fbUser.uid);
    if (!appState.onboarding.completed) {
      const seenTour = Boolean(appState.data.settings.onboarding_home_tour_seen);
      if (!seenTour) {
        appState.page = "home";
        appState.onboarding.tourActive = true;
        appState.onboarding.tourStep = 0;
      } else {
        appState.page = "profile";
        appState.profileSection = "onboarding";
        appState.onboardingStep = appState.onboarding.needsProfile ? 1 : 2;
      }
    }
    render();
  });
}

function localizeStatus(status) {
  const map = {
    active: { en: "Active", he: "פעיל" },
    assigned: { en: "Assigned", he: "מוקצה" },
    occupied: { en: "Occupied", he: "תפוס" },
    reserved_future: { en: "Reserved (Future)", he: "שמורה (עתידית)" },
    reserved_active: { en: "Reserved (Active)", he: "שמורה (פעילה)" },
    unavailable: { en: "Unavailable", he: "לא זמין" },
    under_review: { en: "Under Review", he: "בבדיקה" },
    completed: { en: "Completed", he: "הושלם" },
    pending: { en: "Pending", he: "ממתין" },
    failed: { en: "Failed", he: "נכשל" },
    confirmed: { en: "Confirmed", he: "מאושר" },
    maintenance: { en: "Maintenance", he: "תחזוקה" },
    closed: { en: "Closed", he: "סגור" },
    timeout: { en: "Timeout", he: "פג תוקף" },
    cancelled: { en: "Cancelled", he: "בוטל" },
    new: { en: "New", he: "חדש" },
    in_progress: { en: "In Progress", he: "בטיפול" },
    resolved: { en: "Resolved", he: "נפתר" },
    rejected: { en: "Rejected", he: "נדחה" },
    user: { en: "User", he: "משתמש" },
    admin: { en: "Admin", he: "אדמין" },
    medium: { en: "Medium", he: "בינונית" },
    high: { en: "High", he: "גבוהה" },
    low: { en: "Low", he: "נמוכה" },
    stroller: { en: "Stroller", he: "עגלת תינוק" },
    disabled: { en: "Disabled", he: "נכה" },
    pregnant: { en: "Pregnant", he: "בהריון" },
    elderly: { en: "Elderly", he: "מבוגר" },
    credit_card: { en: "Credit Card", he: "כרטיס אשראי" },
    apple_pay: { en: "Apple Pay", he: "אפל פיי" },
    google_pay: { en: "Google Pay", he: "גוגל פיי" },
    cash: { en: "Cash", he: "מזומן" },
  };
  const lang = getUiLanguage();
  return map[status]?.[lang] || status;
}

function localizeSpotType(type) {
  const map = {
    regular: t("regular"),
    disabled: t("disabled"),
    ev_charging: t("ev_charging"),
    wide: t("wide"),
    stroller: t("stroller"),
    vip: t("vip"),
  };
  return map[type] || type;
}

function localizeIssueType(type) {
  const normalized = type === "crooked_parking" ? "crooked_parking_by_other" : type === "damaged" ? "other" : type;
  const map = {
    crooked_parking_by_other: { en: "Someone parked crooked", he: "מישהו חנה עקום" },
    spot_too_small: { en: "Vehicle too large for spot", he: "הרכב גדול מדי לתא" },
    already_occupied: { en: "Spot already occupied", he: "חניה תפוסה" },
    blocked: { en: "Spot blocked", he: "חניה חסומה" },
    cant_find_spot: { en: "Can't find my spot", he: "לא מוצא את החניה" },
    other: { en: "Other", he: "אחר" },
  };
  const lang = getUiLanguage();
  return map[normalized]?.[lang] || normalized;
}

function localizeIssueResolutionAction(action) {
  return t(action || "logged_only");
}

function localizeVehicleSize(size) {
  const map = {
    small: t("size_small"),
    regular: t("size_regular"),
    large: t("size_large"),
    extra_large: t("size_xl"),
  };
  return map[size] || size;
}

const baseData = () => {
  const userId = "u_driver";
  const adminId = "u_admin";

  const spots = [];
  const floors = [];
  const lots = [];
  const usedSingleSpotSerials = new Set();
  const rowLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const imagePool = [
    "https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1517142089942-ba376ce32a2e?auto=format&fit=crop&w=1200&q=80",
  ];
  const cityCenters = [
    { city: "Tel Aviv", lat: 32.0853, lng: 34.7818 },
    { city: "Ramat Gan", lat: 32.0823, lng: 34.8100 },
    { city: "Herzliya", lat: 32.1663, lng: 34.8436 },
    { city: "Petah Tikva", lat: 32.0840, lng: 34.8878 },
    { city: "Rishon LeZion", lat: 31.9730, lng: 34.7925 },
  ];

  for (let i = 1; i <= 50; i++) {
    const cityRef = cityCenters[(i - 1) % cityCenters.length];
    const lotId = `lot_${i}`;
    const floorsCount = 1 + (i % 4);
    const hourly = 12 + (i % 9);
    const is24h = i % 3 === 0;
    const lat = cityRef.lat + (Math.floor((i - 1) / 5) * 0.008 - 0.03) + (i % 5) * 0.002;
    const lng = cityRef.lng + ((i % 7) - 3) * 0.003;
    let lotTotal = 0;
    const segment_type = i % 10 === 1 || i % 10 === 2 ? "municipal_blue_white" : i % 10 === 3 || i % 10 === 4 ? "private_hourly" : "structured";
    const operator_type = segment_type === "private_hourly" ? "private_host" : segment_type === "municipal_blue_white" ? "municipal_manager" : "lot_manager";
    const operator_user_id = operator_type === "private_host" ? userId : adminId;
    const serial_code_4 = isSingleSpotSupplySegment(segment_type) ? allocateUniqueSerialCode(lotId, usedSingleSpotSerials) : null;

    lots.push({
      id: lotId,
      name: isSingleSpotSupplySegment(segment_type) ? serial_code_4 : `SpaceLy Lot ${i}`,
      serial_code_4: serial_code_4 || undefined,
      address: `${10 + i} Demo Avenue`,
      city: cityRef.city,
      location: { lat, lng },
      total_spots: 0,
      available_spots: 0,
      floors_count: floorsCount,
      status: i % 13 === 0 ? "maintenance" : "active",
      segment_type,
      operator_type,
      operator_user_id,
      is_bookable: true,
      entry_mode: segment_type === "structured" ? "lpr_auto" : "manual_start",
      exit_mode: segment_type === "structured" ? "lpr_auto" : "manual_end",
      pricing: {
        hourly_rate: hourly,
        daily_max: Math.max(65, hourly * 5),
        first_hour_rate: Math.max(10, hourly - 3),
        grace_period_minutes: 10,
      },
      operating_hours: { open: "06:00", close: "23:59", is_24h: is24h },
      amenities: ["Elevator", "Security", ...(i % 2 ? ["EV Charging"] : []), ...(i % 5 ? [] : ["Car Wash"])],
      image_url: imagePool[i % imagePool.length],
      assignment_timeout_minutes: 10,
      reservation_grace_minutes: 15,
    });

    for (let floorNum = 1; floorNum <= floorsCount; floorNum++) {
      const floorId = `floor_${i}_${floorNum}`;
      const rows = 4 + ((i + floorNum) % 3);
      const cols = 8 + ((i + floorNum) % 5);
      const floorTotal = rows * cols;
      lotTotal += floorTotal;

      floors.push({
        id: floorId,
        parking_lot_id: lotId,
        floor_number: floorNum,
        floor_name: floorNum === 1 ? "Ground" : `Floor ${floorNum}`,
        total_spots: floorTotal,
        available_spots: floorTotal,
        map_layout: "grid",
        points_of_interest: [
          { type: "elevator", weight: 1.0 },
          { type: "entrance", weight: 1.2 },
          { type: "exit", weight: 1.1 },
        ],
      });

      let spotCounter = 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let spotType = "regular";
          if (r === 0 && c < 2) spotType = "disabled";
          else if (r === 0 && c >= cols - 2) spotType = "ev_charging";
          else if (r === rows - 1 && c === 0) spotType = "vip";
          else if (r === rows - 1 && c === cols - 1) spotType = "wide";
          else if (r === 1 && c === cols - 1) spotType = "stroller";

          spots.push({
            id: `${floorId}_s_${spotCounter}`,
            parking_lot_id: lotId,
            floor_id: floorId,
            spot_code: `F${floorNum}-${rowLetters[r]}${String(c + 1).padStart(2, "0")}`,
            row_letter: rowLetters[r],
            spot_number: c + 1,
            position: { row: r, col: c },
            spot_type: spotType,
            status: "available",
            current_vehicle_id: null,
            current_session_id: null,
            distance_score: c + 1 + r * 0.2 + floorNum * 0.4,
            assignment_expires_at: null,
            reservation_id: null,
          });
          spotCounter++;
        }
      }
    }

    const lot = lots[lots.length - 1];
    lot.total_spots = lotTotal;
    lot.available_spots = lotTotal;
  }

  addRabinDemoLots({
    parkingLots: lots,
    floors,
    parkingSpots: spots,
  });

  return {
    users: [
      { id: userId, email: "driver@spacely.demo", full_name: "Noa Driver", role: "user", created_date: nowIso() },
      { id: adminId, email: "admin@spacely.demo", full_name: "Avi Admin", role: "admin", created_date: nowIso() },
    ],
    vehicles: [
      {
        id: "veh_1",
        owner_id: userId,
        license_plate: "123-45-678",
        manufacturer: "Tesla",
        model: "Model 3",
        year: 2024,
        color: "White",
        vehicle_size: "regular",
        is_electric: true,
        special_conditions: ["disabled"],
        is_active: true,
        is_default: true,
        nickname: "Main EV",
      },
      {
        id: "veh_2",
        owner_id: userId,
        license_plate: "987-65-432",
        manufacturer: "Kia",
        model: "Picanto",
        year: 2021,
        color: "Blue",
        vehicle_size: "small",
        is_electric: false,
        special_conditions: [],
        is_active: true,
        is_default: false,
        nickname: "City Car",
      },
    ],
    parkingLots: lots,
    floors,
    parkingSpots: spots,
    parkingSessions: [],
    reservations: [],
    payments: [],
    notifications: [],
    issueReports: [],
    auditLogs: [],
    settings: {
      default_pricing: { hourly_rate: 16, daily_max: 90, first_hour_rate: 12 },
      assignment_timeout_minutes: 10,
      reservation_grace_minutes: 15,
      ui_language: "he",
      ui_theme: "blue",
      profile_phone: "054-1234567",
      home_mode_default: "nearby",
      home_mode_last: "nearby",
      home_view_mode_last: "map",
      home_segment_filters: [...SUPPLY_SEGMENTS],
      home_last_selected_lot_id: null,
      planned_destination: null,
      favorite_lot_ids: [],
      onboarding_home_tour_seen: false,
      onboarding_completed_at: null,
    },
  };
};

function addRabinDemoLots(data) {
  if (!data || !Array.isArray(data.parkingLots) || !Array.isArray(data.floors) || !Array.isArray(data.parkingSpots)) return;

  const rowLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const imagePool = [
    "https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1517142089942-ba376ce32a2e?auto=format&fit=crop&w=1200&q=80",
  ];
  const rabinLots = [
    { id: "lot_rabin_1", name: "Rabin Square North", address: "12 Ibn Gabirol St", lat: 32.08095, lng: 34.78035, hourly: 18, available: 22 },
    { id: "lot_rabin_2", name: "Rabin Square East", address: "8 Frishman St", lat: 32.08045, lng: 34.78155, hourly: 20, available: 16 },
    { id: "lot_rabin_3", name: "Rabin City Hall Parking", address: "4 Malchei Israel St", lat: 32.08135, lng: 34.78085, hourly: 19, available: 28 },
    { id: "lot_rabin_4", name: "Gan HaIr Parking", address: "71 Ibn Gabirol St", lat: 32.07995, lng: 34.78095, hourly: 21, available: 13 },
    { id: "lot_rabin_5", name: "Rabin Square West", address: "3 Ben Gurion Blvd", lat: 32.08065, lng: 34.77955, hourly: 17, available: 24 },
  ];
  const usedSingleSpotSerials = new Set(
    data.parkingLots
      .filter((l) => isSingleSpotSupplySegment(l))
      .map((l) => getLotDisplayCode(l))
      .filter(Boolean)
  );
  const privateLots = Array.from({ length: 10 }).map((_, i) => ({
    id: `lot_rabin_private_${i + 1}`,
    serial_code_4: allocateUniqueSerialCode(`lot_rabin_private_${i + 1}`, usedSingleSpotSerials),
    address: `${20 + i} Frishman St`,
    lat: 32.08035 + (i % 5) * 0.00038,
    lng: 34.77995 + Math.floor(i / 5) * 0.00042,
    hourly: 18 + (i % 3),
    available: 1,
    segment_type: "private_hourly",
    operator_type: "private_host",
    operator_user_id: "u_driver",
    rows: 1,
    cols: 1,
  }));
  const blueWhiteLots = Array.from({ length: 10 }).map((_, i) => ({
    id: `lot_rabin_blue_${i + 1}`,
    serial_code_4: allocateUniqueSerialCode(`lot_rabin_blue_${i + 1}`, usedSingleSpotSerials),
    address: `${8 + i} Ben Gurion Blvd`,
    lat: 32.08025 + (i % 5) * 0.00036,
    lng: 34.78045 + Math.floor(i / 5) * 0.0004,
    hourly: 12,
    available: 1,
    segment_type: "municipal_blue_white",
    operator_type: "municipal_manager",
    operator_user_id: "u_admin",
    rows: 1,
    cols: 1,
  }));
  const rabinAllLots = [...rabinLots.map((x) => ({ ...x, segment_type: "structured", operator_type: "lot_manager", operator_user_id: "u_admin", rows: 5, cols: 8 })), ...privateLots, ...blueWhiteLots];
  const existingLotIds = new Set(data.parkingLots.map((l) => l.id));

  rabinAllLots.forEach((cfg, idx) => {
    if (existingLotIds.has(cfg.id)) return;
    const floorId = `floor_${cfg.id}_1`;
    const rows = Number(cfg.rows || 5);
    const cols = Number(cfg.cols || 8);
    const total = rows * cols;
    const availableTarget = Math.max(0, Math.min(total, cfg.available));
    data.parkingLots.push({
      id: cfg.id,
      name: isSingleSpotSupplySegment(cfg.segment_type || "structured") ? cfg.serial_code_4 : cfg.name,
      serial_code_4: cfg.serial_code_4,
      address: cfg.address,
      city: "Tel Aviv",
      location: { lat: cfg.lat, lng: cfg.lng },
      total_spots: total,
      available_spots: availableTarget,
      floors_count: 1,
      status: "active",
      segment_type: cfg.segment_type || "structured",
      operator_type: cfg.operator_type || "lot_manager",
      operator_user_id: cfg.operator_user_id || "u_admin",
      is_bookable: true,
      entry_mode: (cfg.segment_type || "structured") === "structured" ? "lpr_auto" : "manual_start",
      exit_mode: (cfg.segment_type || "structured") === "structured" ? "lpr_auto" : "manual_end",
      pricing: {
        hourly_rate: cfg.hourly,
        daily_max: Math.max(70, cfg.hourly * 5),
        first_hour_rate: Math.max(12, cfg.hourly - 3),
        grace_period_minutes: 10,
      },
      operating_hours: { open: "00:00", close: "23:59", is_24h: true },
      amenities: ["Elevator", "Security", "EV Charging"],
      image_url: imagePool[idx % imagePool.length],
      assignment_timeout_minutes: 10,
      reservation_grace_minutes: 15,
    });

    data.floors.push({
      id: floorId,
      parking_lot_id: cfg.id,
      floor_number: 1,
      floor_name: "Ground",
      total_spots: total,
      available_spots: availableTarget,
      map_layout: "grid",
      points_of_interest: [
        { type: "elevator", weight: 1.0 },
        { type: "entrance", weight: 1.2 },
        { type: "exit", weight: 1.1 },
      ],
    });

    let counter = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let spotType = "regular";
        if (r === 0 && c < 2) spotType = "disabled";
        else if (r === 0 && c >= cols - 2) spotType = "ev_charging";
        else if (r === rows - 1 && c === cols - 1) spotType = "wide";
        const isAvailable = counter <= availableTarget;
        data.parkingSpots.push({
          id: `${floorId}_s_${counter}`,
          parking_lot_id: cfg.id,
          floor_id: floorId,
          spot_code: `F1-${rowLetters[r]}${String(c + 1).padStart(2, "0")}`,
          row_letter: rowLetters[r],
          spot_number: c + 1,
          position: { row: r, col: c },
          spot_type: spotType,
          status: isAvailable ? "available" : "occupied",
          current_vehicle_id: null,
          current_session_id: null,
          distance_score: c + 1 + r * 0.2,
          assignment_expires_at: null,
          reservation_id: null,
        });
        counter++;
      }
    }
  });
}

const appState = {
  mode: "driver",
  userId: "u_driver",
  auth: {
    status: "loading",
    uid: null,
    phoneE164: null,
    step: "phone",
    phoneInput: "",
    otpInput: "",
    loading: false,
    error: "",
    info: "",
  },
  onboarding: {
    needsProfile: false,
    needsVehicle: false,
    completed: false,
    homeTourSeen: false,
    tourActive: false,
    tourStep: 0,
  },
  onboardingStep: 1,
  adminId: "u_admin",
  page: "home",
  adminPage: "dashboard",
  adminIssueFilter: "all",
  selectedLotId: "lot_1",
  selectedFloorId: "floor_1_1",
  lotModalId: null,
  activeSheet: null,
  profileSection: "menu",
  addVehicleExpanded: false,
  editVehicleId: null,
  editVehicleReturnSection: "vehicles",
  profileAvatarPreview: "",
  profileImageUpload: {
    status: "idle",
    progress: 0,
    message: "",
  },
  profileSaveFeedback: {
    status: "idle",
    message: "",
  },
  issueMenuOpen: false,
  releaseConfirmOpen: false,
  reserveConfirmOpen: false,
  reserveLotId: null,
  homeUnifiedMode: true,
  homeCarouselIndex: 0,
  homeSelectedLotId: null,
  homeLocationMode: "current",
  homeViewMode: "map",
  homeMode: "nearby",
  homeSort: "proximity",
  homeSegmentFilters: [...SUPPLY_SEGMENTS],
  plannedSort: "proximity",
  plannedDestination: null,
  plannedArrivalOffsetMin: 15,
  plannedSearchQuery: "",
  plannedSearchError: "",
  plannedSuggestions: [],
  plannedSuggestionsOpen: false,
  homeSearchIntroDone: false,
  homeSearchIntroScheduled: false,
  plannedSearchLoading: false,
  plannedSearchDebounce: null,
  homeCarouselScrollDebounce: null,
  placesSessionToken: `session_${Math.random().toString(36).slice(2)}`,
  plannedPredictions: {},
  selectedCompareLotId: null,
  compareLotIds: [],
  searchVehicleId: null,
  userLocation: null,
  locationError: "",
  locationRequested: false,
  data: loadData(),
};

appState.plannedDestination = null;
appState.data.settings.planned_destination = null;
appState.plannedSearchQuery = t("current_location_token");
appState.homeViewMode = appState.data.settings.home_view_mode_last === "list" ? "list" : "map";
const legacySegment = SUPPLY_SEGMENTS.includes(appState.data.settings.home_segment_filter) ? [appState.data.settings.home_segment_filter] : null;
appState.homeSegmentFilters = Array.isArray(appState.data.settings.home_segment_filters)
  ? appState.data.settings.home_segment_filters.filter((x, i, arr) => SUPPLY_SEGMENTS.includes(x) && arr.indexOf(x) === i)
  : legacySegment || [...SUPPLY_SEGMENTS];
appState.homeSelectedLotId = appState.data.settings.home_last_selected_lot_id || null;
if (appState.data.settings?.planned_destination && isInIsraelBounds(appState.data.settings.planned_destination)) {
  appState.plannedDestination = appState.data.settings.planned_destination;
  appState.plannedSearchQuery = appState.plannedDestination.name || t("destination_placeholder");
}
updateOnboardingState();

const driverDataService = (() => {
  const listeners = new Set();
  let realtimeTimer = null;

  const normalizeSegment = (segment) => (SUPPLY_SEGMENTS.includes(segment) ? segment : "structured");

  const toSupplyItem = (lot) => ({
    ...lot,
    segment_type: normalizeSegment(lotSegmentType(lot)),
    hourly_rate: Number(lot?.pricing?.hourly_rate || 0),
    daily_max: Number(lot?.pricing?.daily_max || 0),
    is_active: lot.status === "active",
  });

  const emit = (event) => {
    listeners.forEach((cb) => {
      try {
        cb(event);
      } catch {}
    });
  };

  const tickRealtime = () => {
    const candidates = appState.data.parkingLots.filter((l) => l.status === "active");
    if (!candidates.length) return;
    const lot = candidates[Math.floor(Math.random() * candidates.length)];
    const lotSpots = appState.data.parkingSpots.filter((s) => s.parking_lot_id === lot.id && !s.current_session_id && !s.reservation_id);
    if (!lotSpots.length) return;
    const available = lotSpots.filter((s) => s.status === "available");
    const occupied = lotSpots.filter((s) => s.status === "occupied");
    const canDecrease = available.length > 0;
    const canIncrease = occupied.length > 0;
    const changeDown = canDecrease && (!canIncrease || Math.random() > 0.5);
    if (changeDown) {
      const spot = available[Math.floor(Math.random() * available.length)];
      spot.status = "occupied";
    } else if (canIncrease) {
      const spot = occupied[Math.floor(Math.random() * occupied.length)];
      spot.status = "available";
    }
    if (Math.random() < 0.12) {
      const drift = Math.random() > 0.5 ? 1 : -1;
      lot.pricing.hourly_rate = Math.max(6, Math.min(45, Number(lot.pricing.hourly_rate || 0) + drift));
    }
    normalizeSpots();
    emit({
      lot_id: lot.id,
      available_spots: lot.available_spots,
      hourly_rate: Number(lot?.pricing?.hourly_rate || 0),
      updated_at: nowIso(),
    });
  };

  const ensureRealtime = () => {
    if (realtimeTimer || !listeners.size) return;
    realtimeTimer = setInterval(tickRealtime, 25000);
  };

  const stopRealtimeIfNeeded = () => {
    if (listeners.size || !realtimeTimer) return;
    clearInterval(realtimeTimer);
    realtimeTimer = null;
  };

  return {
    getParkingSupply(filters = {}) {
      const segments = Array.isArray(filters.segments)
        ? filters.segments.filter((x, i, arr) => SUPPLY_SEGMENTS.includes(x) && arr.indexOf(x) === i)
        : filters.segment && filters.segment !== "all"
          ? [normalizeSegment(filters.segment)]
          : [];
      const includeInactive = Boolean(filters.includeInactive);
      let lots = appState.data.parkingLots.filter((lot) => (includeInactive ? true : lot.status === "active"));
      if (segments.length) lots = lots.filter((lot) => segments.includes(lotSegmentType(lot)));
      if (!segments.length && Array.isArray(filters.segments)) lots = [];
      return lots.map(toSupplyItem);
    },
    getLotDetails(lotId) {
      const lot = appState.data.parkingLots.find((l) => l.id === lotId);
      return lot ? toSupplyItem(lot) : null;
    },
    startParking(payload) {
      return appActions.simulateLprEntry(payload?.lotId);
    },
    reserveParking(payload) {
      appState.reserveLotId = payload?.lotId || null;
      return appActions.confirmSaveParking();
    },
    releaseReservedParking(reservationId) {
      if (reservationId) {
        const exists = appState.data.reservations.some((r) => r.id === reservationId);
        if (!exists) return null;
      }
      return appActions.releaseReservedParking();
    },
    endParking(sessionId) {
      if (sessionId) {
        const session = appState.data.parkingSessions.find((s) => s.id === sessionId);
        if (!session) return null;
      }
      return appActions.manualExit();
    },
    subscribeAvailability(callback) {
      if (typeof callback !== "function") return () => {};
      listeners.add(callback);
      ensureRealtime();
      return () => {
        listeners.delete(callback);
        stopRealtimeIfNeeded();
      };
    },
  };
})();

async function fetchGoogleAutocomplete(query) {
  const lang = getUiLanguage();
  const url = `/api/places-autocomplete?q=${encodeURIComponent(query)}&lang=${encodeURIComponent(lang)}&sessionToken=${encodeURIComponent(appState.placesSessionToken)}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

async function fetchGooglePlaceDetails(placeId) {
  const lang = getUiLanguage();
  const url = `/api/place-details?placeId=${encodeURIComponent(placeId)}&lang=${encodeURIComponent(lang)}&sessionToken=${encodeURIComponent(appState.placesSessionToken)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  if (typeof data.lat !== "number" || typeof data.lng !== "number") return null;
  return {
    name: data.address || data.name || "",
    lat: data.lat,
    lng: data.lng,
  };
}

async function loadGoogleMapsScript() {
  if (googleMapsReady && window.google?.maps) return true;
  if (googleMapsLoading) return googleMapsLoading;
  googleMapsLoading = (async () => {
    try {
      const response = await fetch("/api/maps-config");
      if (!response.ok) return false;
      const config = await response.json();
      const apiKey = String(config?.apiKey || "").trim();
      if (!apiKey) return false;
      if (window.google?.maps) {
        googleMapsReady = true;
        return true;
      }
      await new Promise((resolve, reject) => {
        const callbackName = "__spacelyGoogleMapsReady";
        window[callbackName] = () => {
          googleMapsReady = true;
          resolve();
          try {
            delete window[callbackName];
          } catch {}
        };
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=${
          getUiLanguage() === "he" ? "he" : "en"
        }&region=IL&callback=${callbackName}`;
        script.async = true;
        script.defer = true;
        script.onerror = () => reject(new Error("google_maps_script_failed"));
        document.head.appendChild(script);
      });
      if (!window.markerClusterer?.MarkerClusterer && !window.MarkerClusterer) {
        await new Promise((resolve) => {
          const clusterScript = document.createElement("script");
          clusterScript.src = "https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js";
          clusterScript.async = true;
          clusterScript.defer = true;
          clusterScript.onload = () => resolve();
          clusterScript.onerror = () => resolve();
          document.head.appendChild(clusterScript);
        });
      }
      return Boolean(window.google?.maps);
    } catch {
      return false;
    } finally {
      googleMapsLoading = null;
    }
  })();
  return googleMapsLoading;
}

function setMapCenter(lat, lng, zoom = 13) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  let nextZoom = zoom;
  if (
    Number.isFinite(nextZoom) &&
    appState.mode === "driver" &&
    appState.page === "home" &&
    isInIsraelBounds(appState.plannedDestination)
  ) {
    nextZoom = Math.max(14, Number(nextZoom));
  }
  if (mapProvider === "google" && mapInstance?.setCenter) {
    mapInstance.setCenter({ lat, lng });
    if (Number.isFinite(nextZoom)) mapInstance.setZoom(nextZoom);
    applyHomeMapViewportBias();
    return;
  }
  if (mapInstance?.setView) {
    mapInstance.setView([lat, lng], Number.isFinite(nextZoom) ? nextZoom : 13);
    applyHomeMapViewportBias();
  }
}

function getHomeMapViewportBiasY() {
  if (!(appState.mode === "driver" && appState.page === "home")) return 0;
  const mapEl = document.getElementById("map");
  if (!mapEl) return 0;
  const mapRect = mapEl.getBoundingClientRect();
  if (!mapRect.height) return 0;
  const searchOverlay = document.querySelector(".home-search-overlay");
  const carouselSheet = document.querySelector(".home-carousel-sheet");
  const topBound = searchOverlay ? Math.max(0, searchOverlay.getBoundingClientRect().bottom - mapRect.top + 6) : 0;
  const bottomBound = carouselSheet ? Math.max(topBound + 40, carouselSheet.getBoundingClientRect().top - mapRect.top - 6) : mapRect.height;
  const activeCenterY = (topBound + bottomBound) / 2;
  const centerY = mapRect.height / 2;
  return Math.round(activeCenterY - centerY);
}

function applyHomeMapViewportBias() {
  const biasY = getHomeMapViewportBiasY();
  if (!biasY || !mapInstance) return;
  const panY = -biasY;
  if (mapProvider === "google" && mapInstance.panBy) {
    mapInstance.panBy(0, panY);
    return;
  }
  if (mapInstance.panBy) {
    mapInstance.panBy([0, panY], { animate: true, duration: 0.25 });
  }
}

function captureHomeViewport() {
  if (!(appState.mode === "driver" && appState.page === "home")) return;
  if (mapProvider === "google" && mapInstance?.getCenter) {
    const center = mapInstance.getCenter();
    if (!center) return;
    homeViewportSnapshot = {
      lat: center.lat(),
      lng: center.lng(),
      zoom: Number(mapInstance.getZoom?.() || 13),
    };
    return;
  }
  if (mapInstance?.getCenter) {
    const center = mapInstance.getCenter();
    if (!center) return;
    homeViewportSnapshot = {
      lat: Number(center.lat),
      lng: Number(center.lng),
      zoom: Number(mapInstance.getZoom?.() || 13),
    };
  }
}

function restoreHomeCarouselPosition() {
  if (!(appState.mode === "driver" && appState.page === "home")) return;
  const lotId = appState.homeSelectedLotId;
  if (!lotId) return;
  const card = document.getElementById(`home-carousel-card-${lotId}`);
  if (!card) return;
  card.scrollIntoView({ behavior: "auto", inline: "start", block: "nearest" });
}

function getHomeSelectedLot() {
  const lots = getHomeCarouselLots();
  if (!lots.length) return null;
  if (!appState.homeSelectedLotId) return null;
  return lots.find((lot) => lot.id === appState.homeSelectedLotId) || null;
}

function syncHomeCarouselSelection() {
  const lots = getHomeCarouselLots();
  if (!lots.length) {
    appState.homeSelectedLotId = null;
    appState.homeCarouselIndex = 0;
    return;
  }
  if (!appState.homeSelectedLotId) {
    appState.homeCarouselIndex = 0;
    return;
  }
  const existing = lots.find((lot) => lot.id === appState.homeSelectedLotId);
  if (!existing) {
    appState.homeSelectedLotId = null;
    appState.homeCarouselIndex = 0;
    return;
  }
  appState.homeCarouselIndex = lots.findIndex((lot) => lot.id === existing.id) + 1;
}

function animateMapToLotAndUser(activeLot) {
  if (!activeLot?.location || !mapInstance) return;
  const lotPoint = { lat: Number(activeLot.location.lat), lng: Number(activeLot.location.lng) };
  if (!Number.isFinite(lotPoint.lat) || !Number.isFinite(lotPoint.lng)) return;

  const targetZoom = DESTINATION_FOCUS_ZOOM;

  if (mapProvider === "google") {
    if (mapInstance?.panTo) mapInstance.panTo(lotPoint);
    else if (mapInstance?.setCenter) mapInstance.setCenter(lotPoint);

    if (mapInstance?.getZoom && mapInstance?.setZoom) {
      const currentZoom = Number(mapInstance.getZoom() || targetZoom);
      if (Math.abs(currentZoom - targetZoom) >= 1) {
        if (googleZoomAnimTimer) clearTimeout(googleZoomAnimTimer);
        const step = currentZoom < targetZoom ? 1 : -1;
        let zoom = Math.round(currentZoom);
        const finalZoom = Math.round(targetZoom);
        const tick = () => {
          if (!mapInstance || mapProvider !== "google") return;
          if (zoom === finalZoom) return;
          zoom += step;
          mapInstance.setZoom(zoom);
          if (zoom !== finalZoom) googleZoomAnimTimer = setTimeout(tick, 80);
        };
        googleZoomAnimTimer = setTimeout(tick, 90);
      }
    }
    setTimeout(() => applyHomeMapViewportBias(), 120);
    return;
  }

  if (mapInstance?.flyTo) {
    mapInstance.flyTo([lotPoint.lat, lotPoint.lng], targetZoom, { duration: 0.9, easeLinearity: 0.2 });
    setTimeout(() => applyHomeMapViewportBias(), 160);
    return;
  }
  if (mapInstance?.setView) {
    mapInstance.setView([lotPoint.lat, lotPoint.lng], targetZoom, { animate: true, duration: 0.8 });
    setTimeout(() => applyHomeMapViewportBias(), 140);
  }
}

function setHomeCarouselActiveCard(lotId) {
  const cards = Array.from(document.querySelectorAll(".home-carousel-card.lot"));
  cards.forEach((card) => {
    const isActive = lotId && card.getAttribute("data-lot-id") === lotId;
    card.classList.toggle("active", Boolean(isActive));
  });
}

function resetMapInstance() {
  if (mapProvider === "google") {
    if (googleClusterer?.clearMarkers) googleClusterer.clearMarkers();
    googleClusterer = null;
    googleMarkers.forEach((m) => m.setMap(null));
    googleMarkers = [];
    if (googleUserMarker) {
      googleUserMarker.setMap(null);
      googleUserMarker = null;
    }
    if (googleDestinationMarker) {
      googleDestinationMarker.setMap(null);
      googleDestinationMarker = null;
    }
    if (googleActiveHaloMarker) {
      googleActiveHaloMarker.setMap(null);
      googleActiveHaloMarker = null;
    }
    mapInstance = null;
    return;
  }
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
  userLocationMarker = null;
}

function updateGoogleHomeMarkerSelection() {
  if (mapProvider !== "google" || !Array.isArray(googleMarkers)) return;
  const isHomeUnified = appState.mode === "driver" && appState.page === "home";
  if (!isHomeUnified) {
    if (googleActiveHaloMarker) googleActiveHaloMarker.setMap(null);
    return;
  }
  let hasActive = false;
  googleMarkers.forEach((marker) => {
    const lotId = marker.__lotId;
    const fillColor = marker.__fillColor || "#16a34a";
    const isActive = lotId && appState.homeSelectedLotId === lotId;
    marker.setIcon(
      isActive
        ? buildGoogleMarkerIcon("#1d4ed8", 29, { strokeColor: "#facc15", strokeWeight: 4 })
        : buildGoogleMarkerIcon(fillColor, 17)
    );
    marker.setZIndex(isActive ? 2000 : 1000);
    marker.setLabel({
      text: String(marker.__spots ?? ""),
      color: "#ffffff",
      fontSize: isActive ? "14px" : "12px",
      fontWeight: "700",
    });
    if (isActive) {
      hasActive = true;
      const pos = marker.getPosition?.();
      if (pos && mapInstance) {
        if (!googleActiveHaloMarker) {
          googleActiveHaloMarker = new window.google.maps.Marker({
            map: mapInstance,
            clickable: false,
            zIndex: 1900,
            icon: buildGoogleMarkerIcon("#93c5fd", 42, {
              strokeColor: "#2563eb",
              strokeWeight: 1,
              fillOpacity: 0.22,
            }),
          });
        } else {
          googleActiveHaloMarker.setMap(mapInstance);
        }
        googleActiveHaloMarker.setPosition(pos);
      }
    }
  });
  if (!hasActive && googleActiveHaloMarker) googleActiveHaloMarker.setMap(null);
}

async function geocodeWithGoogleAddress(query) {
  if (!window.google?.maps?.Geocoder) return null;
  return new Promise((resolve) => {
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode(
      {
        address: query,
        region: "IL",
        componentRestrictions: { country: "IL" },
      },
      (results, status) => {
        if (status !== "OK" || !Array.isArray(results) || !results.length) {
          resolve(null);
          return;
        }
        const top = results[0];
        const loc = top.geometry?.location;
        if (!loc) {
          resolve(null);
          return;
        }
        resolve({
          name: top.formatted_address || query,
          lat: loc.lat(),
          lng: loc.lng(),
        });
      }
    );
  });
}

function bindGoogleAutocompleteInput() {
  if (!window.google?.maps?.places?.Autocomplete) return;
  const input = document.getElementById("home-search-input");
  if (!input || input.dataset.googleBound === "1") return;
  input.dataset.googleBound = "1";
  const syncPacContainer = () => {
    const row = document.querySelector(".home-map-search-row");
    const pac = document.querySelector(".pac-container");
    if (!row || !pac) return;
    const rect = row.getBoundingClientRect();
    const left = Math.max(12, Math.round(rect.left));
    const width = Math.max(220, Math.round(rect.width));
    pac.style.left = `${left}px`;
    pac.style.width = `${width}px`;
    pac.style.right = "auto";
    pac.style.maxWidth = `calc(100vw - ${left + 12}px)`;
  };
  input.addEventListener("focus", () => setTimeout(syncPacContainer, 0));
  input.addEventListener("input", () => setTimeout(syncPacContainer, 0));
  window.addEventListener("resize", syncPacContainer);
  const autocomplete = new window.google.maps.places.Autocomplete(input, {
    fields: ["place_id", "name", "formatted_address", "geometry"],
    componentRestrictions: { country: "il" },
    types: ["geocode"],
  });
  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;
    const dest = {
      name: place.formatted_address || place.name || input.value || "",
      lat: loc.lat(),
      lng: loc.lng(),
    };
    if (!isInIsraelBounds(dest)) {
      appState.plannedSearchError = t("destination_not_found");
      appState.plannedDestination = null;
      appState.data.settings.planned_destination = null;
      render();
      return;
    }
    appState.plannedDestination = dest;
    appState.plannedSearchQuery = dest.name;
    appState.plannedSearchError = "";
    appState.plannedSuggestions = [];
    appState.plannedSuggestionsOpen = false;
    appState.data.settings.planned_destination = dest;
    appState.selectedCompareLotId = null;
    appState.homeSelectedLotId = null;
    appState.homeCarouselIndex = 0;
    appState.data.settings.home_last_selected_lot_id = null;
    persist();
    setMapCenter(dest.lat, dest.lng, 17);
    render();
  });
  setTimeout(syncPacContainer, 0);
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return baseData();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.parkingLots) || parsed.parkingLots.length < 50) {
      const fresh = baseData();
      fresh.settings.ui_language = parsed?.settings?.ui_language === "en" ? "en" : "he";
      fresh.settings.ui_theme = parsed?.settings?.ui_theme || "blue";
      return fresh;
    }
    if (!parsed.settings) parsed.settings = {};
    if (!parsed.settings.ui_language) parsed.settings.ui_language = "he";
    if (!parsed.settings.ui_theme) parsed.settings.ui_theme = "blue";
    if (!parsed.settings.profile_phone) parsed.settings.profile_phone = "054-1234567";
    if (!parsed.settings.home_mode_default) parsed.settings.home_mode_default = "nearby";
    if (!parsed.settings.home_mode_last) parsed.settings.home_mode_last = parsed.settings.home_mode_default;
    if (!parsed.settings.home_view_mode_last) parsed.settings.home_view_mode_last = "map";
    if (!Array.isArray(parsed.settings.home_segment_filters)) {
      parsed.settings.home_segment_filters = SUPPLY_SEGMENTS.includes(parsed.settings.home_segment_filter)
        ? [parsed.settings.home_segment_filter]
        : [...SUPPLY_SEGMENTS];
    }
    parsed.settings.home_segment_filters = parsed.settings.home_segment_filters
      .filter((x, i, arr) => SUPPLY_SEGMENTS.includes(x) && arr.indexOf(x) === i);
    if (!parsed.settings.home_segment_filters.length) parsed.settings.home_segment_filters = [...SUPPLY_SEGMENTS];
    if (!Object.prototype.hasOwnProperty.call(parsed.settings, "home_last_selected_lot_id")) parsed.settings.home_last_selected_lot_id = null;
    if (!Array.isArray(parsed.settings.favorite_lot_ids)) parsed.settings.favorite_lot_ids = [];
    if (!Object.prototype.hasOwnProperty.call(parsed.settings, "onboarding_home_tour_seen")) parsed.settings.onboarding_home_tour_seen = false;
    if (!Object.prototype.hasOwnProperty.call(parsed.settings, "onboarding_completed_at")) parsed.settings.onboarding_completed_at = null;
    if (Array.isArray(parsed.parkingLots)) {
      const usedSingleSpotSerials = new Set();
      parsed.parkingLots.forEach((lot) => {
        lot.segment_type = lotSegmentType(lot);
        if (!lot.operator_type) {
          lot.operator_type = lot.segment_type === "private_hourly" ? "private_host" : lot.segment_type === "municipal_blue_white" ? "municipal_manager" : "lot_manager";
        }
        if (!lot.operator_user_id) lot.operator_user_id = lot.operator_type === "private_host" ? "u_driver" : "u_admin";
        if (typeof lot.is_bookable !== "boolean") lot.is_bookable = true;
        if (!lot.entry_mode) lot.entry_mode = lot.segment_type === "structured" ? "lpr_auto" : "manual_start";
        if (!lot.exit_mode) lot.exit_mode = lot.segment_type === "structured" ? "lpr_auto" : "manual_end";
        if (isSingleSpotSupplySegment(lot)) {
          if (!lot.serial_code_4) {
            lot.serial_code_4 = allocateUniqueSerialCode(lot.id || lot.name, usedSingleSpotSerials);
          } else {
            let code = toFourDigitSerial(String(lot.serial_code_4).replace(/\D/g, ""));
            let guard = 0;
            while (usedSingleSpotSerials.has(code) && guard < 9000) {
              code = toFourDigitSerial(Number(code) + 1);
              guard++;
            }
            usedSingleSpotSerials.add(code);
            lot.serial_code_4 = code;
          }
          lot.name = lot.serial_code_4;
        }
      });
    }
    if (Array.isArray(parsed.reservations)) {
      parsed.reservations.forEach((r) => {
        const status = String(r.hold_fee_status || "pending");
        if (!r.hold_fee_status) r.hold_fee_status = status;
        const amountNum = Number(r.hold_fee_amount);
        if ((!Number.isFinite(amountNum) || amountNum <= 0) && status === "pending" && Number(r.prepaid_amount || 0) > 0) {
          r.hold_fee_amount = 10;
        }
      });
    }
    addRabinDemoLots(parsed);
    return parsed;
  } catch {
    return baseData();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.data));
}

function addAudit(action_type, actor_type, target_type, target_id, details = {}) {
  appState.data.auditLogs.unshift({
    id: uid("audit"),
    action_type,
    actor_id: actor_type === "admin" ? appState.adminId : getCurrentUid() || "guest",
    actor_type,
    target_type,
    target_id,
    parking_lot_id: details.parking_lot_id || null,
    details,
    previous_state: details.previous_state || null,
    new_state: details.new_state || null,
    ip_address: "127.0.0.1",
    user_agent: navigator.userAgent,
    created_at: nowIso(),
  });
}

function notify(user_id, type, title, message, metadata = {}, link = "") {
  appState.data.notifications.unshift({
    id: uid("noti"),
    user_id,
    title,
    message,
    type,
    is_read: false,
    link,
    metadata,
    created_at: nowIso(),
  });
}

function getLotById(id) {
  return appState.data.parkingLots.find((l) => l.id === id);
}

function getDefaultVehicle() {
  const uid = getCurrentUid();
  if (!uid) return null;
  return appState.data.vehicles.find((v) => v.owner_id === uid && v.is_default && v.is_active);
}

function getSearchVehicle() {
  const uid = getCurrentUid();
  if (!uid) return null;
  const vehicles = appState.data.vehicles.filter((v) => v.owner_id === uid && v.is_active);
  const selected = vehicles.find((v) => v.id === appState.searchVehicleId);
  if (selected) return selected;
  const def = getDefaultVehicle();
  if (def) {
    appState.searchVehicleId = def.id;
    return def;
  }
  const first = vehicles[0] || null;
  if (first) appState.searchVehicleId = first.id;
  return first;
}

function distanceMeters(a, b) {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isInIsraelBounds(point) {
  if (!point) return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= 29.0 && lat <= 33.9 && lng >= 34.0 && lng <= 36.6;
}

function normalizeSpots() {
  for (const floor of appState.data.floors) {
    const floorSpots = appState.data.parkingSpots.filter((s) => s.floor_id === floor.id);
    floor.total_spots = floorSpots.length;
    floor.available_spots = floorSpots.filter((s) => s.status === "available").length;
  }
  for (const lot of appState.data.parkingLots) {
    const lotSpots = appState.data.parkingSpots.filter((s) => s.parking_lot_id === lot.id);
    lot.total_spots = lotSpots.length;
    lot.available_spots = lotSpots.filter((s) => s.status === "available").length;
  }
}

function checkTimeouts() {
  const now = Date.now();
  let changed = false;
  appState.data.parkingSessions.forEach((s) => {
    if (s.status !== "assigned") return;
    const spot = appState.data.parkingSpots.find((x) => x.id === s.spot_id);
    if (!spot?.assignment_expires_at) return;
    if (new Date(spot.assignment_expires_at).getTime() < now) {
      s.status = "timeout";
      spot.status = "available";
      spot.current_session_id = null;
      spot.current_vehicle_id = null;
      spot.assignment_expires_at = null;
      changed = true;
      addAudit("SESSION_TIMEOUT", "system", "ParkingSession", s.id, {
        parking_lot_id: s.parking_lot_id,
      });
      notify(s.user_id, "parking_expiring", localizeStatus("timeout"), `Session ${s.id}`);
    }
  });

  appState.data.reservations.forEach((r) => {
    if (r.status !== "confirmed" || r.actual_arrival) return;
    if (new Date(r.grace_period_end).getTime() >= now) return;
    r.status = "no_show";
    const spot = appState.data.parkingSpots.find((s) => s.id === r.spot_id);
    if (spot) {
      spot.status = "available";
      spot.reservation_id = null;
      spot.current_vehicle_id = null;
      spot.current_session_id = null;
      spot.assignment_expires_at = null;
    }
    const charged = chargeReservationHoldFee(r, { reason: "timeout_no_show", duration_minutes: 30 });
    if (charged) {
      notify(r.user_id, "payment_success", t("reserved_parking"), t("reservation_expired_fee"));
    }
    addAudit("RESERVATION_NO_SHOW", "system", "Reservation", r.id, {
      parking_lot_id: r.parking_lot_id,
      reservation_id: r.id,
      new_state: { status: "no_show", hold_fee_status: r.hold_fee_status || "pending" },
    });
    changed = true;
  });

  if (changed) {
    normalizeSpots();
    if (appState.page === "reserved-parking" && !activeReservationHoldForUser()) appState.page = "home";
    persist();
  }
  return changed;
}

function updateLiveParkingTimers() {
  if (appState.mode !== "driver") return;
  const now = nowIso();
  if (appState.page === "parking-lot-details") {
    const lotId = appState.selectedLotId;
    const inlineState = lotId ? getLotInlineParkingState(lotId) : null;
    if (inlineState?.mode === "reserved_here" && inlineState.reservation) {
      const remainSec = Math.max(0, secondsBetween(now, inlineState.reservation.grace_period_end));
      const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
      const ss = String(remainSec % 60).padStart(2, "0");
      const fee = Number(inlineState.reservation.hold_fee_amount || 10);
      const timeEl = document.getElementById("inline-reserved-timer-time");
      const costEl = document.getElementById("inline-reserved-timer-cost");
      if (timeEl) timeEl.textContent = `${mm}:${ss}`;
      if (costEl) costEl.textContent = `${t("parking_hold_fee_label")}: ${money(fee).replace("ILS ", "₪")}`;
      return;
    }
    if (inlineState?.mode === "active_here" && inlineState.session) {
      const start = inlineState.session.parking_start_time || inlineState.session.assignment_time;
      const durationSec = secondsBetween(start, now);
      const hh = String(Math.floor(durationSec / 3600)).padStart(2, "0");
      const mm = String(Math.floor((durationSec % 3600) / 60)).padStart(2, "0");
      const ss = String(durationSec % 60).padStart(2, "0");
      const est = estimateCost(inlineState.session, now);
      const timeEl = document.getElementById("inline-active-timer-time");
      const costEl = document.getElementById("inline-active-timer-cost");
      if (timeEl) timeEl.textContent = `${hh}:${mm}:${ss}`;
      if (costEl) costEl.textContent = `${t("estimated_cost")}: ${money(est.total)}`;
      return;
    }
  }
  if (appState.page === "reserved-parking") {
    const reservation = activeReservationHoldForUser();
    if (!reservation) return;
    const remainSec = Math.max(0, secondsBetween(now, reservation.grace_period_end));
    const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
    const ss = String(remainSec % 60).padStart(2, "0");
    const timeEl = document.getElementById("reserved-timer-time");
    if (timeEl) timeEl.textContent = `${mm}:${ss}`;
    return;
  }
  if (appState.page === "active-parking") {
    const session = activeSessionForUser();
    if (!session) return;
    const start = session.parking_start_time || session.assignment_time;
    const durationSec = secondsBetween(start, now);
    const hh = String(Math.floor(durationSec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((durationSec % 3600) / 60)).padStart(2, "0");
    const ss = String(durationSec % 60).padStart(2, "0");
    const est = estimateCost(session, now);
    const timeEl = document.getElementById("active-timer-time");
    const costEl = document.getElementById("active-timer-cost");
    if (timeEl) timeEl.textContent = `${hh}:${mm}:${ss}`;
    if (costEl) costEl.textContent = `${t("estimated_cost")}: ${money(est.total)}`;
  }
}

function spotEligible(spot, vehicle, opts = {}) {
  if (spot.status !== "available") return false;
  if (opts.excludeSpotId && spot.id === opts.excludeSpotId) return false;
  if (opts.requiredType && opts.requiredType !== "regular" && spot.spot_type !== opts.requiredType) return false;
  if (vehicle.vehicle_size === "extra_large" && !["wide", "vip"].includes(spot.spot_type)) return false;
  if (vehicle.vehicle_size === "large" && spot.spot_type === "small") return false;
  if (vehicle.is_electric && opts.needs_charging && spot.spot_type !== "ev_charging") return false;
  if (vehicle.special_conditions?.includes("disabled") && !["disabled", "vip"].includes(spot.spot_type)) return false;
  if (vehicle.special_conditions?.includes("stroller") && !["stroller", "regular", "wide"].includes(spot.spot_type)) return false;
  return true;
}

function assignSpot(parking_lot_id, vehicle, opts = {}) {
  const floorsIndex = Object.fromEntries(appState.data.floors.map((f) => [f.id, f.floor_number]));
  const preferredOrder = Array.isArray(opts.preferredTypes) ? opts.preferredTypes : [];
  const prefRank = (spotType) => {
    const idx = preferredOrder.indexOf(spotType);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const candidates = appState.data.parkingSpots
    .filter((s) => s.parking_lot_id === parking_lot_id)
    .filter((s) => spotEligible(s, vehicle, opts))
    .sort((a, b) => {
      const p = prefRank(a.spot_type) - prefRank(b.spot_type);
      if (p !== 0) return p;
      const d = a.distance_score - b.distance_score;
      if (d !== 0) return d;
      const f = floorsIndex[a.floor_id] - floorsIndex[b.floor_id];
      if (f !== 0) return f;
      return a.row_letter.localeCompare(b.row_letter);
    });

  return candidates[0] || null;
}

function estimateCost(session, exitTimeIso) {
  const lot = getLotById(session.parking_lot_id);
  const pricing = lot.pricing;
  const start = session.parking_start_time || session.assignment_time;
  const duration = minutesBetween(start, exitTimeIso);
  let base = 0;
  if (duration <= 60) {
    base = pricing.first_hour_rate;
  } else {
    base = Math.ceil(duration / 60) * pricing.hourly_rate;
  }
  base = Math.min(base, pricing.daily_max);
  const extra = session.needs_charging ? 8 : 0;
  const discount = duration > 240 ? 5 : 0;
  return {
    duration_minutes: duration,
    base_rate: base,
    extra_charges: extra,
    extra_items: [],
    discounts: discount,
    total: Math.max(0, base + extra - discount),
  };
}

function parkingHoldExtraItem(amount = 10) {
  return {
    code: "parking_hold_fee",
    label: t("parking_hold_fee_label"),
    amount,
    source: "reservation",
  };
}

function chargeReservationHoldFee(reservation, opts = {}) {
  if (!reservation) return null;
  const currentStatus = reservation.hold_fee_status || "pending";
  if (currentStatus !== "pending") return null;
  const rawAmount = Number(reservation.hold_fee_amount);
  const holdFeeAmount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 10;
  if (holdFeeAmount <= 0) return null;
  const feePaymentId = uid("pay");
  appState.data.payments.unshift({
    id: feePaymentId,
    user_id: reservation.user_id,
    session_id: null,
    reservation_id: reservation.id,
    parking_lot_id: reservation.parking_lot_id,
    amount: holdFeeAmount,
    currency: "ILS",
    status: "completed",
    payment_method: "credit_card",
    card_last_four: "4242",
    transaction_id: `txn_${Math.floor(Math.random() * 1e8)}`,
    receipt_url: "",
    retry_count: 0,
    failure_reason: "",
    refund_amount: 0,
    refund_reason: "",
    is_debt: false,
    breakdown: {
      duration_minutes: Number(opts.duration_minutes || 0),
      base_rate: 0,
      extra_charges: holdFeeAmount,
      extra_items: [parkingHoldExtraItem(holdFeeAmount)],
      discounts: 0,
      total: holdFeeAmount,
    },
    created_at: nowIso(),
  });
  reservation.hold_fee_amount = holdFeeAmount;
  reservation.hold_fee_status = "charged_no_show";
  addAudit("RESERVATION_NO_SHOW_FEE_CHARGED", "system", "Reservation", reservation.id, {
    parking_lot_id: reservation.parking_lot_id,
    reservation_id: reservation.id,
    payment_id: feePaymentId,
    amount: holdFeeAmount,
    reason: opts.reason || "reservation_hold",
  });
  return { paymentId: feePaymentId, amount: holdFeeAmount };
}

function activeSessionForUser() {
  const uid = getCurrentUid();
  if (!uid) return null;
  return appState.data.parkingSessions.find(
    (s) => s.user_id === uid && ["assigned", "active"].includes(s.status)
  );
}

function activeReservationHoldForUser() {
  const uid = getCurrentUid();
  if (!uid) return null;
  const now = Date.now();
  return appState.data.reservations.find(
    (r) =>
      r.user_id === uid &&
      Number(r.hold_fee_amount || 0) > 0 &&
      r.status === "confirmed" &&
      !r.actual_arrival &&
      new Date(r.grace_period_end).getTime() > now
  );
}

function activeParkingContextForUser() {
  const session = activeSessionForUser();
  if (session) {
    const lot = getLotById(session.parking_lot_id);
    return { type: "session", session, reservation: null, lot, lotId: session.parking_lot_id, segment: lotSegmentType(lot) };
  }
  const reservation = activeReservationHoldForUser();
  if (reservation) {
    const lot = getLotById(reservation.parking_lot_id);
    return { type: "reservation", session: null, reservation, lot, lotId: reservation.parking_lot_id, segment: lotSegmentType(lot) };
  }
  return null;
}

function getLotInlineParkingState(lotId) {
  const lot = getLotById(lotId);
  const segment = lotSegmentType(lot);
  const context = activeParkingContextForUser();
  if (!context) return { mode: "idle", segment, reservation: null, session: null };
  if (context.lotId === lotId) {
    if (context.type === "session") return { mode: "active_here", segment, reservation: null, session: context.session };
    return { mode: "reserved_here", segment, reservation: context.reservation, session: null };
  }
  return { mode: "blocked_other", segment, reservation: context.reservation, session: context.session, activeLotId: context.lotId };
}

function compactSpotCode(spot) {
  if (!spot) return "N/A";
  const floor = Number(String(spot.floor_id || "").split("_").pop() || 0);
  const spotNum = Number(spot.spot_number || 0);
  if (floor > 0 && spotNum > 0) return `${floor}${String(spotNum).padStart(2, "0")}`;
  return String(spot.spot_code || "N/A").replace(/[^\d]/g, "") || (spot.spot_code || "N/A");
}

function buildTextNavigation(lot, spot, entryName) {
  const floor = Number(String(spot?.floor_id || "").split("_").pop() || 1);
  const walk = 80 + ((spot?.spot_number || 8) % 7) * 15;
  const turn = spot?.position?.col > 3 ? "ימינה" : "שמאלה";
  return [
    `${entryName}: היכנס לחניון והמשך ישר.`,
    `לאחר הכניסה פנה ${turn}.`,
    `אחרי כ-${walk} מטרים פנה ${turn === "ימינה" ? "שמאלה" : "ימינה"} ורד לקומה -${floor}.`,
    `המשך לפי הסימון עד לחניה ${compactSpotCode(spot)}.`,
  ];
}

function issueNeedsImmediateFilter(issueType) {
  return ["already_occupied", "blocked", "crooked_parking_by_other", "crooked_parking"].includes(issueType);
}

function resolveIssueWithPolicy(session, issueType) {
  const normalizedType = issueType === "crooked_parking" ? "crooked_parking_by_other" : issueType === "damaged" ? "other" : issueType;
  const now = Date.now();
  const lot = getLotById(session.parking_lot_id);
  const currentSpot = appState.data.parkingSpots.find((s) => s.id === session.spot_id);
  const vehicle = appState.data.vehicles.find((v) => v.id === session.vehicle_id);
  const responseMs = 400 + Math.floor(Math.random() * 2400);
  const startedAt = now;

  let resolutionAction = "logged_only";
  let priority = issueNeedsImmediateFilter(normalizedType) ? "high" : "medium";
  let alt = null;
  let message = localizeIssueType(normalizedType);

  if (normalizedType === "cant_find_spot") {
    const targetSpot = currentSpot || appState.data.parkingSpots.find((s) => s.id === session.spot_id);
    session.navigation_steps = buildTextNavigation(lot, targetSpot, session.entry_name || t("primary_entry"));
    session.navigation_steps.push(`${t("call_support")}: ${appState.data.settings.profile_phone}`);
    resolutionAction = "guidance_updated";
    priority = "medium";
    message = t("issue_guidance_updated");
  } else if (["already_occupied", "crooked_parking_by_other", "blocked", "spot_too_small"].includes(normalizedType)) {
    const preferredTypes = normalizedType === "spot_too_small" ? ["wide", "vip", "regular"] : undefined;
    alt = vehicle
      ? assignSpot(session.parking_lot_id, vehicle, {
          needs_charging: session.needs_charging,
          preferredTypes,
          excludeSpotId: session.spot_id,
        })
      : null;

    if (alt && currentSpot) {
      currentSpot.status = "under_review";
      currentSpot.current_session_id = null;
      currentSpot.current_vehicle_id = null;
      alt.status = "occupied";
      alt.current_session_id = session.id;
      alt.current_vehicle_id = session.vehicle_id;
      session.spot_id = alt.id;
      session.assigned_spot_code = compactSpotCode(alt);
      session.navigation_steps = buildTextNavigation(lot, alt, session.entry_name || t("primary_entry"));
      resolutionAction = "reassigned";
      message = t("issue_reassigned_msg").replace("{spot}", compactSpotCode(alt));
    } else {
      resolutionAction = "escalated_no_spot";
      message = normalizedType === "spot_too_small" ? t("issue_no_wide_alternative") : t("issue_no_alternative");
      priority = "high";
    }
  } else {
    resolutionAction = "logged_only";
    priority = "medium";
    message = localizeIssueType(normalizedType);
  }

  return {
    normalizedType,
    priority,
    resolutionAction,
    alternativeSpot: alt,
    oldSpotId: currentSpot?.id || session.spot_id || null,
    oldSpotCode: compactSpotCode(currentSpot),
    newSpotId: alt?.id || null,
    newSpotCode: alt ? compactSpotCode(alt) : null,
    responseTimeMs: Math.min(3000, Math.max(1, Date.now() - startedAt + responseMs)),
    slaTargetSec: ["already_occupied", "blocked"].includes(normalizedType) ? 2 : ["crooked_parking_by_other", "spot_too_small"].includes(normalizedType) ? 3 : 0,
    message,
  };
}

function latestPendingPaymentForUser() {
  const uid = getCurrentUid();
  if (!uid) return null;
  const sid = [...appState.data.parkingSessions]
    .filter((s) => s.user_id === uid && s.status === "completed")
    .sort((a, b) => new Date(b.exit_time || 0) - new Date(a.exit_time || 0))[0]?.id;
  if (!sid) return null;
  return appState.data.payments.find((p) => p.session_id === sid && p.status !== "completed") || null;
}

const appActions = {
  switchMode(mode) {
    appState.mode = mode;
    appState.page = "home";
    appState.adminPage = "dashboard";
    render();
  },

  navigate(page) {
    if (appState.onboarding?.tourActive && page !== "home") {
      appState.page = "home";
      render();
      return;
    }
    appState.activeSheet = null;
    appState.releaseConfirmOpen = false;
    appState.reserveConfirmOpen = false;
    appState.issueMenuOpen = false;
    if (page !== "profile") appState.profileSection = "menu";
    if (page === "profile" && appState.auth.status === "signed_in" && !appState.onboarding.completed) {
      appState.profileSection = "onboarding";
    }
    appState.page = page;
    if (page === "home") {
      appState.homeCarouselIndex = 0;
      appState.homeSelectedLotId = null;
      appState.data.settings.home_last_selected_lot_id = null;
      appState.homeSearchIntroDone = false;
      appState.homeSearchIntroScheduled = false;
      if (!appState.userLocation) appState.locationRequested = false;
    }
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  openPrimaryParkingView() {
    const context = activeParkingContextForUser();
    if (!context) {
      appActions.navigate("home");
      return;
    }
    const isInline = ["private_hourly", "municipal_blue_white"].includes(context.segment);
    if (isInline) {
      appState.selectedLotId = context.lotId;
      appState.lotModalId = null;
      appState.activeSheet = null;
      appState.page = "parking-lot-details";
      render();
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    appActions.navigate(context.type === "reservation" ? "reserved-parking" : "active-parking");
  },

  navigateAdmin(page) {
    appState.adminPage = page;
    render();
  },

  selectLot(lotId) {
    appState.selectedLotId = lotId;
    if (appState.mode === "driver" && appState.page === "home") {
      const lots = getHomeCarouselLots();
      const idx = lots.findIndex((lot) => lot.id === lotId);
      if (idx >= 0) {
        appState.homeSelectedLotId = lotId;
        appState.homeCarouselIndex = idx + 1;
        appState.data.settings.home_last_selected_lot_id = lotId;
      }
      captureHomeViewport();
      appState.lotModalId = lotId;
      appState.activeSheet = "lot-details";
      persist();
      render();
      return;
    }
    appState.page = "parking-lot-details";
    appState.activeSheet = null;
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  openLotModal(lotId) {
    appState.selectedLotId = lotId;
    appState.page = "parking-lot-details";
    appState.activeSheet = null;
    render();
  },

  closeLotModal() {
    appState.lotModalId = null;
    appState.activeSheet = null;
    lotSheetDragState = null;
    const container = document.getElementById("lot-details-sheet-container");
    if (container) {
      container.remove();
      document.body.classList.remove("sheet-open");
      return;
    }
    render();
  },

  startLotSheetDrag(event, fromSheet = false) {
    const card = document.getElementById("lot-details-sheet");
    if (!card) return;
    const target = event?.target;
    if (target?.closest?.("button, input, select, textarea, a, label")) return;
    if (fromSheet) {
      const scrollHost = target?.closest?.(".sheet-scroll");
      if (scrollHost && scrollHost.scrollTop > 0) return;
    }
    const startY = event?.clientY ?? (event?.touches?.[0]?.clientY ?? 0);
    lotSheetDragState = { startY, card, deltaY: 0 };
    card.style.transition = "none";
    const backdrop = document.getElementById("lot-sheet-backdrop");
    const onMove = (ev) => {
      if (!lotSheetDragState) return;
      const currentY = ev?.clientY ?? (ev?.touches?.[0]?.clientY ?? lotSheetDragState.startY);
      const deltaY = Math.max(0, currentY - lotSheetDragState.startY);
      lotSheetDragState.deltaY = deltaY;
      lotSheetDragState.card.style.transform = `translateY(${deltaY}px)`;
      if (backdrop) {
        const alpha = Math.max(0.14, 0.58 - deltaY / 700);
        backdrop.style.background = `rgba(17, 24, 39, ${alpha.toFixed(3)})`;
      }
    };
    const onEnd = () => {
      if (!lotSheetDragState) return;
      const { deltaY } = lotSheetDragState;
      const closeThreshold = Math.min(220, Math.max(120, (card.offsetHeight || 0) * 0.24));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (deltaY > closeThreshold) {
        appActions.closeLotModal();
        return;
      }
      if (backdrop) backdrop.style.background = "";
      card.style.transition = "transform 180ms ease-out";
      card.style.transform = "translateY(0)";
      lotSheetDragState = null;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onEnd, { passive: true });
    window.addEventListener("pointercancel", onEnd, { passive: true });
  },

  openSheet(sheet) {
    appState.lotModalId = null;
    appState.activeSheet = sheet;
    if (sheet === "profile") {
      appState.profileSection = appState.auth.status === "signed_in" && !appState.onboarding.completed ? "onboarding" : "menu";
    }
    render();
  },

  closeSheet() {
    appState.lotModalId = null;
    appState.activeSheet = null;
    appState.profileSection = "menu";
    render();
  },

  openProfileSection(section) {
    if (appState.auth.status !== "signed_in" && section !== "menu") {
      appState.profileSection = "menu";
      render();
      return;
    }
    if (appState.auth.status === "signed_in" && !appState.onboarding.completed && section !== "menu" && section !== "onboarding") {
      appState.profileSection = "onboarding";
      render();
      return;
    }
    appState.profileSection = section;
    appState.addVehicleExpanded = false;
    appState.editVehicleId = null;
    render();
  },

  backProfileMenu() {
    if (appState.profileSection === "vehicle-edit") {
      appState.profileSection = appState.editVehicleReturnSection || "vehicles";
      appState.editVehicleId = null;
      appState.addVehicleExpanded = false;
      render();
      return;
    }
    appState.profileSection = appState.onboarding.completed ? "menu" : "onboarding";
    appState.addVehicleExpanded = false;
    appState.editVehicleId = null;
    render();
  },

  setAuthPhoneInput(value) {
    appState.auth.phoneInput = String(value || "");
    appState.auth.error = "";
    appState.auth.info = "";
  },

  setAuthOtpInput(value) {
    appState.auth.otpInput = String(value || "").replace(/\D/g, "").slice(0, 6);
    appState.auth.error = "";
  },

  async sendAuthOtp(formEl) {
    const fd = new FormData(formEl);
    const phone = String(fd.get("phone") || appState.auth.phoneInput || "");
    appState.auth.loading = true;
    appState.auth.error = "";
    appState.auth.info = "";
    render();
    try {
      const sent = await authService.sendOtp(phone);
      appState.auth.phoneInput = phone;
      appState.auth.phoneE164 = sent.phoneE164;
      appState.auth.step = "otp";
      appState.auth.info = t("auth_sms_sent");
    } catch (err) {
      const code = String(err?.code || err?.message || "");
      if (code === "invalid_phone") {
        appState.auth.error = t("auth_invalid_phone");
      } else if (code.includes("auth/invalid-phone-number")) {
        appState.auth.error = t("auth_invalid_phone");
      } else {
        appState.auth.error = `${t("auth_service_unavailable")} (${code || "unknown"})`;
      }
    } finally {
      appState.auth.loading = false;
      render();
    }
  },

  async verifyAuthOtp(formEl) {
    const fd = new FormData(formEl);
    const otp = String(fd.get("otp") || appState.auth.otpInput || "");
    appState.auth.loading = true;
    appState.auth.error = "";
    appState.auth.info = "";
    render();
    try {
      await authService.verifyOtp(otp);
      appState.auth.step = "phone";
      appState.auth.otpInput = "";
      appState.auth.info = t("auth_welcome");
    } catch (err) {
      const code = String(err?.code || err?.message || "");
      if (code === "invalid_otp" || code.includes("auth/invalid-verification-code")) {
        appState.auth.error = t("auth_invalid_otp");
      } else {
        appState.auth.error = `${t("auth_service_unavailable")} (${code || "unknown"})`;
      }
    } finally {
      appState.auth.loading = false;
      render();
    }
  },

  resetAuthStep() {
    appState.auth.step = "phone";
    appState.auth.otpInput = "";
    appState.auth.error = "";
    appState.auth.info = "";
    render();
  },

  async signOutAuth() {
    appState.auth.loading = true;
    render();
    try {
      await authService.signOut();
    } finally {
      appState.auth.loading = false;
      render();
    }
  },

  goCompleteProfile() {
    appState.page = "profile";
    appState.profileSection = appState.onboarding.completed ? "personal" : "onboarding";
    if (!appState.onboarding.completed) appState.onboardingStep = 1;
    render();
  },

  goCompleteVehicle() {
    appState.page = "profile";
    appState.profileSection = appState.onboarding.completed ? "vehicles" : "onboarding";
    if (!appState.onboarding.completed) appState.onboardingStep = 2;
    render();
  },

  startHomeTour() {
    if (appState.auth.status !== "signed_in" || appState.onboarding.completed) return;
    appState.page = "home";
    appState.onboarding.tourActive = true;
    appState.onboarding.tourStep = 0;
    render();
  },

  nextHomeTourStep() {
    const maxStep = 3;
    if (!appState.onboarding.tourActive) return;
    if (appState.onboarding.tourStep >= maxStep) {
      appActions.finishHomeTour();
      return;
    }
    appState.onboarding.tourStep += 1;
    render();
  },

  skipHomeTour() {
    appState.data.settings.onboarding_home_tour_seen = true;
    appState.onboarding.homeTourSeen = true;
    appState.onboarding.tourActive = false;
    appState.onboarding.tourStep = 0;
    persist();
    appActions.openOnboarding();
  },

  finishHomeTour() {
    appState.data.settings.onboarding_home_tour_seen = true;
    appState.onboarding.homeTourSeen = true;
    appState.onboarding.tourActive = false;
    appState.onboarding.tourStep = 0;
    persist();
    if (!appState.onboarding.completed) {
      appActions.openOnboarding();
      return;
    }
    render();
  },

  openOnboarding() {
    appState.page = "profile";
    appState.activeSheet = null;
    appState.profileSection = "onboarding";
    appState.onboardingStep = appState.onboarding.needsProfile ? 1 : 2;
    render();
  },

  onboardingPrevStep() {
    appState.onboardingStep = Math.max(1, Number(appState.onboardingStep || 1) - 1);
    render();
  },

  async setProfileImageFromInput(inputEl) {
    const uid = getCurrentUid();
    if (!uid) return;
    const file = inputEl?.files?.[0];
    if (!file) return;
    const tempObjectUrl = URL.createObjectURL(file);
    appState.profileAvatarPreview = tempObjectUrl;
    setProfileUploadFeedback("uploading", `${t("profile_image_uploading")} 0%`, 0);
    render();
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (!event?.lengthComputable) return;
      const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
      setProfileUploadFeedback("uploading", `${t("profile_image_uploading")} ${percent}%`, percent);
      render();
    };
    reader.onerror = () => {
      setProfileUploadFeedback("error", t("profile_image_upload_failed"), 0);
      render();
      if (tempObjectUrl) URL.revokeObjectURL(tempObjectUrl);
      if (inputEl) inputEl.value = "";
    };
    reader.onload = async () => {
      const src = String(reader.result || "");
      if (!src) {
        setProfileUploadFeedback("error", t("profile_image_upload_failed"), 0);
        render();
        if (inputEl) inputEl.value = "";
        return;
      }
      try {
        const user = appState.data.users.find((u) => u.id === uid);
        if (user) user.avatar_url = src;
        appState.profileAvatarPreview = src;
        setProfileUploadFeedback("uploading", `${t("profile_image_uploading")} 100%`, 100);
        render();
        await profileService.upsertProfile(uid, {
          phone_e164: normalizeIsraeliPhone(appState.data.settings.profile_phone) || appState.auth.phoneE164 || "",
          full_name: user?.full_name || "",
          email: user?.email || "",
          avatar_url: src,
        });
        persist();
        setProfileUploadFeedback("success", t("profile_image_saved"), 100);
        render();
      } catch {
        setProfileUploadFeedback("error", t("profile_image_upload_failed"), 0);
        render();
      } finally {
        if (tempObjectUrl) URL.revokeObjectURL(tempObjectUrl);
        if (inputEl) inputEl.value = "";
      }
    };
    reader.readAsDataURL(file);
  },

  triggerProfileImageUpload(inputId = "onboarding-avatar-file") {
    const input = document.getElementById(inputId);
    if (input) input.click();
  },

  async saveOnboardingProfile(formEl) {
    const ok = await appActions.savePersonalDetails(formEl, { silent: false, keepSection: "onboarding" });
    if (!ok) return;
    if (!appState.onboarding.needsProfile) {
      appState.onboardingStep = 2;
    }
    render();
  },

  async saveOnboardingVehicle(formEl) {
    await appActions.addVehicle(formEl, { silent: false, keepSection: "onboarding" });
  },

  completeOnboarding() {
    const checklist = getOnboardingChecklist();
    if (!checklist.profileOk) {
      alert(t("onboarding_missing_profile"));
      return;
    }
    if (!checklist.vehicleOk) {
      alert(t("onboarding_missing_vehicle"));
      return;
    }
    appState.data.settings.onboarding_completed_at = nowIso();
    updateOnboardingState();
    persist();
    appState.profileSection = "menu";
    appState.page = "home";
    render();
  },

  toggleAddVehicleForm() {
    if (appState.editVehicleId && appState.addVehicleExpanded) {
      appState.editVehicleId = null;
      appState.addVehicleExpanded = false;
      render();
      return;
    }
    appState.addVehicleExpanded = !appState.addVehicleExpanded;
    render();
  },

  startEditVehicle(vehicleId, returnSection = null) {
    const uid = getCurrentUid();
    const vehicle = appState.data.vehicles.find((v) => v.id === vehicleId && v.owner_id === uid && v.is_active);
    if (!vehicle) return;
    appState.editVehicleId = vehicleId;
    appState.addVehicleExpanded = false;
    appState.editVehicleReturnSection = returnSection || (!appState.onboarding.completed ? "onboarding" : "vehicles");
    if (!appState.onboarding.completed) appState.onboardingStep = 2;
    appState.profileSection = "vehicle-edit";
    render();
  },

  cancelEditVehicle() {
    appState.editVehicleId = null;
    appState.addVehicleExpanded = false;
    render();
  },

  async savePersonalDetails(formEl, options = {}) {
    const uid = getCurrentUid();
    if (!uid) {
      alert(t("auth_required_action"));
      return false;
    }
    setProfileSaveFeedback("saving", t("profile_saving"));
    render();
    const fd = new FormData(formEl);
    const fullName = String(fd.get("full_name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    if (!fullName) {
      setProfileSaveFeedback("error", t("full_name_required"));
      render();
      if (!options.silent) alert(t("full_name_required"));
      return false;
    }
    if (!email) {
      setProfileSaveFeedback("error", t("email_required"));
      render();
      if (!options.silent) alert(t("email_required"));
      return false;
    }
    if (!isValidEmail(email)) {
      setProfileSaveFeedback("error", t("email_invalid"));
      render();
      if (!options.silent) alert(t("email_invalid"));
      return false;
    }
    try {
      const user = appState.data.users.find((u) => u.id === uid);
      if (user) {
        user.full_name = fullName;
        user.email = email;
        user.avatar_url = String(user.avatar_url || appState.profileAvatarPreview || "").trim();
      }
      appState.data.settings.profile_phone =
        String(fd.get("phone") || appState.data.settings.profile_phone || appState.auth.phoneE164 || "").replace(/^\+972/, "0");
      await profileService.upsertProfile(uid, {
        phone_e164: normalizeIsraeliPhone(appState.data.settings.profile_phone) || appState.auth.phoneE164 || "",
        full_name: user?.full_name || "",
        email: user?.email || "",
        avatar_url: user?.avatar_url || "",
      });
      updateOnboardingState();
      if (appState.onboarding.completed) {
        appState.data.settings.onboarding_completed_at = appState.data.settings.onboarding_completed_at || nowIso();
      }
      persist();
      if (options.keepSection) {
        appState.profileSection = options.keepSection;
      } else {
        appState.profileSection = appState.onboarding.completed ? "menu" : "onboarding";
      }
      setProfileSaveFeedback("success", t("personal_details_saved"));
      render();
      return true;
    } catch {
      setProfileSaveFeedback("error", t("profile_save_failed"));
      render();
      return false;
    }
  },

  navigateToLot(lotId) {
    const lot = getLotById(lotId);
    if (!lot) return;
    const url = `https://waze.com/ul?ll=${lot.location.lat},${lot.location.lng}&navigate=yes`;
    window.open(url, "_blank", "noopener,noreferrer");
  },

  locateUser() {
    appState.locationRequested = true;
    if (!navigator.geolocation) {
      appState.locationError = t("location_unavailable");
      render();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const locatedPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        if (!isInIsraelBounds(locatedPoint)) {
          appState.userLocation = null;
          appState.locationError = t("location_unavailable");
          appState.locationRequested = false;
          render();
          return;
        }
        appState.userLocation = locatedPoint;
        appState.locationError = "";
        if (!appState.plannedDestination) {
          appState.plannedSearchQuery = t("current_location_token");
        }
        setMapCenter(appState.userLocation.lat, appState.userLocation.lng, HOME_COMFORT_ZOOM);
        render();
      },
      (err) => {
        appState.locationError = err.code === 1 ? t("location_denied") : t("location_unavailable");
        // Keep this true so render() won't auto-trigger locate in a loop after an error.
        appState.locationRequested = true;
        render();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 }
    );
  },

  recenterUser() {
    if (appState.userLocation) {
      appState.plannedDestination = null;
      appState.plannedSearchQuery = "";
      appState.plannedSearchError = "";
      appState.plannedSuggestions = [];
      appState.plannedSuggestionsOpen = false;
      appState.homeSelectedLotId = null;
      appState.homeCarouselIndex = 0;
      appState.data.settings.planned_destination = null;
      appState.data.settings.home_last_selected_lot_id = null;
      persist();
      setMapCenter(appState.userLocation.lat, appState.userLocation.lng, HOME_COMFORT_ZOOM);
      render();
      return;
    }
    appActions.locateUser();
  },

  setSearchVehicle(vehicleId) {
    const uid = getCurrentUid();
    if (!uid) return;
    const vehicle = appState.data.vehicles.find((v) => v.id === vehicleId && v.owner_id === uid && v.is_active);
    if (!vehicle) return;
    appState.searchVehicleId = vehicleId;
    render();
  },

  setHomeSort(sortKey) {
    appState.homeSort = sortKey === "availability" ? "availability" : "proximity";
    render();
  },

  setHomeSegmentFilter(segment) {
    if (!SUPPLY_SEGMENTS.includes(segment)) return;
    captureHomeViewport();
    const current = Array.isArray(appState.homeSegmentFilters) ? [...appState.homeSegmentFilters] : [...SUPPLY_SEGMENTS];
    const idx = current.indexOf(segment);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(segment);
    appState.homeSegmentFilters = current;
    appState.data.settings.home_segment_filters = [...current];
    const filteredLots = getHomeCarouselLots();
    const stillSelected = appState.homeSelectedLotId && filteredLots.some((lot) => lot.id === appState.homeSelectedLotId);
    if (stillSelected) {
      const nextIdx = filteredLots.findIndex((lot) => lot.id === appState.homeSelectedLotId);
      appState.homeCarouselIndex = nextIdx >= 0 ? nextIdx + 1 : 0;
      appState.data.settings.home_last_selected_lot_id = appState.homeSelectedLotId;
    } else {
      appState.homeSelectedLotId = null;
      appState.homeCarouselIndex = 0;
      appState.data.settings.home_last_selected_lot_id = null;
    }
    persist();
    render();
  },

  setHomeViewMode(mode) {
    const next = mode === "list" ? "list" : "map";
    appState.homeViewMode = next;
    appState.data.settings.home_view_mode_last = next;
    persist();
    render();
  },

  focusHomeLot(lotId, shouldScroll = false, rerender = true) {
    const lots = getHomeCarouselLots();
    const idx = lots.findIndex((lot) => lot.id === lotId);
    if (idx < 0) return;
    appState.homeSelectedLotId = lotId;
    appState.homeCarouselIndex = idx + 1;
    appState.data.settings.home_last_selected_lot_id = lotId;
    persist();
    if (rerender) render();
    else {
      setHomeCarouselActiveCard(lotId);
      updateGoogleHomeMarkerSelection();
    }
    const activeLot = lots[idx];
    setTimeout(() => {
      animateMapToLotAndUser(activeLot);
      if (shouldScroll) {
        const cardEl = document.getElementById(`home-carousel-card-${lotId}`);
        if (cardEl) cardEl.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      }
    }, 40);
  },

  onHomeCarouselScroll(el) {
    if (!el) return;
    if (appState.homeCarouselScrollDebounce) clearTimeout(appState.homeCarouselScrollDebounce);
    appState.homeCarouselScrollDebounce = setTimeout(() => {
      const cards = Array.from(el.querySelectorAll(".home-carousel-card"));
      if (!cards.length) return;
      const targetCenter = el.scrollLeft + el.clientWidth / 2;
      let best = null;
      let bestDiff = Number.MAX_SAFE_INTEGER;
      cards.forEach((card) => {
        const center = card.offsetLeft + card.clientWidth / 2;
        const diff = Math.abs(center - targetCenter);
        if (diff < bestDiff) {
          best = card;
          bestDiff = diff;
        }
      });
      if (!best) return;
      const lotId = best.getAttribute("data-lot-id");
      const idx = Number(best.getAttribute("data-index") || 0);
      appState.homeCarouselIndex = Number.isFinite(idx) ? idx : 0;
      if (!lotId) {
        const anchor = getHomeCarouselAnchor();
        if (anchor) {
          const zoom = isInIsraelBounds(appState.plannedDestination) ? 17 : appState.userLocation ? 16 : 15;
          setMapCenter(anchor.lat, anchor.lng, zoom);
        }
        appState.homeSelectedLotId = null;
        setHomeCarouselActiveCard(null);
        updateGoogleHomeMarkerSelection();
        return;
      }
      if (lotId === appState.homeSelectedLotId) return;
      appActions.focusHomeLot(lotId, false, false);
    }, 90);
  },

  requireDefaultVehicleInProfile() {
    appState.activeSheet = null;
    appState.page = "profile";
    appState.profileSection = appState.onboarding.completed ? "vehicles" : "onboarding";
    if (!appState.onboarding.completed) appState.onboardingStep = 2;
    alert(t("default_vehicle_set_in_profile"));
    render();
  },

  handleSearchInput(q) {
    const value = String(q || "");
    appState.plannedSearchQuery = value;
    appState.plannedSearchError = "";
    if (appState.plannedDestination && value !== appState.plannedDestination.name) {
      appState.plannedDestination = null;
      appState.data.settings.planned_destination = null;
      persist();
    }
    appState.plannedSuggestions = [];
    appState.plannedSuggestionsOpen = false;
    appState.plannedSearchLoading = false;
  },

  focusSearchInput(currentValue = "") {
    if (String(currentValue || "").trim() === t("current_location_token")) {
      appState.plannedSearchQuery = "";
    }
    appState.plannedSearchError = "";
    appState.plannedSuggestions = [];
    appState.plannedSuggestionsOpen = false;
  },

  async setPlannedSearchQuery(q) {
    const value = String(q || "");
    appState.plannedSearchQuery = value;
    appState.plannedSearchError = "";
    if (appState.plannedDestination && value !== appState.plannedDestination.name) {
      appState.plannedDestination = null;
      appState.data.settings.planned_destination = null;
      persist();
    }
    if (appState.plannedSearchDebounce) clearTimeout(appState.plannedSearchDebounce);
    if (value.trim().length < 2 || value === t("current_location_token")) {
      appState.plannedSuggestions = [];
      appState.plannedSearchLoading = false;
      appState.plannedSuggestionsOpen = false;
      render();
      return;
    }
    const seq = ++plannedSearchSeq;
    appState.plannedSearchLoading = true;
    appState.plannedSuggestionsOpen = true;
    render();
    appState.plannedSearchDebounce = setTimeout(async () => {
      const local = searchDestinations(value).map((x) => ({ placeId: "", name: x.name, lat: x.lat, lng: x.lng }));
      try {
        let remote = [];
        try {
          remote = await fetchGoogleAutocomplete(value);
        } catch {
          remote = [];
        }
        if (seq !== plannedSearchSeq) return;
        const merged = [...remote, ...local]
          .filter((s) => s && s.name)
          .filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i)
          .slice(0, 6);
        appState.plannedSuggestions = merged;
        appState.plannedSearchLoading = false;
        appState.plannedSuggestionsOpen = true;
        render();
      } catch {
        if (seq !== plannedSearchSeq) return;
        appState.plannedSuggestions = local.slice(0, 6);
        appState.plannedSearchLoading = false;
        appState.plannedSuggestionsOpen = true;
        render();
      }
    }, 260);
  },

  async applyPlannedDestination() {
    const q = String(appState.plannedSearchQuery || "").trim();
    if (!q || q === t("current_location_token")) {
      appActions.useCurrentLocationAnchor();
      return;
    }
    if (window.google?.maps) {
      const geocoded = await geocodeWithGoogleAddress(q);
      if (geocoded && isInIsraelBounds(geocoded)) {
        appState.plannedDestination = geocoded;
        appState.plannedSearchQuery = geocoded.name;
        appState.plannedSearchError = "";
        appState.plannedSuggestions = [];
        appState.plannedSuggestionsOpen = false;
        appState.data.settings.planned_destination = geocoded;
        appState.selectedCompareLotId = null;
        appState.homeSelectedLotId = null;
        appState.homeCarouselIndex = 0;
        appState.data.settings.home_last_selected_lot_id = null;
        persist();
        setMapCenter(geocoded.lat, geocoded.lng, 17);
        render();
        return;
      }
    }
    let topSuggestion = Array.isArray(appState.plannedSuggestions) ? appState.plannedSuggestions[0] : null;
    if (!topSuggestion && q.length >= 2) {
      let remote = [];
      try {
        remote = await fetchGoogleAutocomplete(q);
      } catch {
        remote = [];
      }
      const local = searchDestinations(q).map((x) => ({ placeId: "", name: x.name, lat: x.lat, lng: x.lng }));
      const merged = [...remote, ...local]
        .filter((s) => s && s.name)
        .filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i);
      topSuggestion = merged[0] || null;
    }
    if (topSuggestion?.placeId) {
      const fromGoogle = await fetchGooglePlaceDetails(topSuggestion.placeId);
      if (fromGoogle && isInIsraelBounds(fromGoogle)) {
        appState.plannedDestination = fromGoogle;
        appState.plannedSearchQuery = fromGoogle.name;
        appState.plannedSearchError = "";
        appState.plannedSuggestions = [];
        appState.plannedSuggestionsOpen = false;
        appState.data.settings.planned_destination = fromGoogle;
        appState.selectedCompareLotId = null;
        appState.homeSelectedLotId = null;
        appState.homeCarouselIndex = 0;
        appState.data.settings.home_last_selected_lot_id = null;
        persist();
        setMapCenter(fromGoogle.lat, fromGoogle.lng, 17);
        render();
        return;
      }
    } else if (topSuggestion && Number.isFinite(topSuggestion.lat) && Number.isFinite(topSuggestion.lng)) {
      const fromFallback = {
        name: topSuggestion.name || q,
        lat: Number(topSuggestion.lat),
        lng: Number(topSuggestion.lng),
      };
      if (!isInIsraelBounds(fromFallback)) {
        appState.plannedDestination = null;
        appState.data.settings.planned_destination = null;
        appState.plannedSearchError = t("destination_not_found");
        appState.plannedSuggestions = [];
        appState.plannedSuggestionsOpen = false;
        persist();
        render();
        return;
      }
      appState.plannedDestination = fromFallback;
      appState.plannedSearchQuery = fromFallback.name;
      appState.plannedSearchError = "";
      appState.plannedSuggestions = [];
      appState.plannedSuggestionsOpen = false;
      appState.data.settings.planned_destination = fromFallback;
      appState.selectedCompareLotId = null;
      appState.homeSelectedLotId = null;
      appState.homeCarouselIndex = 0;
      appState.data.settings.home_last_selected_lot_id = null;
      persist();
      setMapCenter(fromFallback.lat, fromFallback.lng, 17);
      render();
      return;
    }
    const resolved = resolveDestinationFromFreeText(appState.plannedSearchQuery);
    if (!resolved || !isInIsraelBounds(resolved)) {
      appState.plannedDestination = null;
      appState.data.settings.planned_destination = null;
      appState.plannedSearchError = t("destination_not_found");
      appState.plannedSuggestions = [];
      appState.plannedSuggestionsOpen = false;
      persist();
      render();
      return;
    }
    appState.plannedDestination = resolved;
    appState.plannedSearchQuery = resolved.name;
    appState.plannedSearchError = "";
    appState.plannedSuggestions = [];
    appState.plannedSuggestionsOpen = false;
    appState.data.settings.planned_destination = resolved;
    appState.selectedCompareLotId = null;
    appState.homeSelectedLotId = null;
    appState.homeCarouselIndex = 0;
    appState.data.settings.home_last_selected_lot_id = null;
    persist();
    setMapCenter(resolved.lat, resolved.lng, 17);
    render();
  },

  async selectPlannedSuggestion(raw) {
    let item = null;
    try {
      item = JSON.parse(decodeURIComponent(raw));
    } catch {
      item = null;
    }
    if (!item) return;
    if (item.placeId) {
      const fromGoogle = await fetchGooglePlaceDetails(item.placeId);
      if (fromGoogle && isInIsraelBounds(fromGoogle)) {
        appState.plannedDestination = fromGoogle;
        appState.plannedSearchQuery = fromGoogle.name;
        appState.plannedSuggestions = [];
        appState.plannedSuggestionsOpen = false;
        appState.plannedSearchError = "";
        appState.data.settings.planned_destination = fromGoogle;
        appState.selectedCompareLotId = null;
        appState.homeSelectedLotId = null;
        appState.homeCarouselIndex = 0;
        appState.data.settings.home_last_selected_lot_id = null;
        persist();
        setMapCenter(fromGoogle.lat, fromGoogle.lng, 17);
        render();
        return;
      }
    }
    if (typeof item.lat === "number" && typeof item.lng === "number") {
      const dest = { name: item.name, lat: item.lat, lng: item.lng };
      if (!isInIsraelBounds(dest)) {
        appState.plannedSearchError = t("destination_not_found");
        appState.plannedDestination = null;
        appState.data.settings.planned_destination = null;
        render();
        return;
      }
      appState.plannedDestination = dest;
      appState.plannedSearchQuery = dest.name;
      appState.plannedSuggestions = [];
      appState.plannedSuggestionsOpen = false;
      appState.plannedSearchError = "";
      appState.data.settings.planned_destination = dest;
      appState.selectedCompareLotId = null;
      appState.homeSelectedLotId = null;
      appState.homeCarouselIndex = 0;
      appState.data.settings.home_last_selected_lot_id = null;
      persist();
      setMapCenter(dest.lat, dest.lng, 17);
      render();
      return;
    }
    appActions.applyPlannedDestination();
  },

  selectPlannedDestination(name, lat, lng) {
    const dest = { name, lat: Number(lat), lng: Number(lng) };
    if (!isInIsraelBounds(dest)) {
      appState.plannedSearchError = t("destination_not_found");
      appState.plannedDestination = null;
      appState.data.settings.planned_destination = null;
      render();
      return;
    }
    appState.plannedDestination = dest;
    appState.plannedSearchQuery = dest.name;
    appState.data.settings.planned_destination = dest;
    appState.homeSelectedLotId = null;
    appState.homeCarouselIndex = 0;
    appState.data.settings.home_last_selected_lot_id = null;
    persist();
    setMapCenter(dest.lat, dest.lng, 17);
    render();
  },

  clearPlannedDestination() {
    appState.plannedDestination = null;
    appState.plannedSearchQuery = t("current_location_token");
    appState.plannedSearchError = "";
    appState.plannedSuggestions = [];
    appState.plannedSuggestionsOpen = false;
    appState.data.settings.planned_destination = null;
    appState.selectedCompareLotId = null;
    if (!appState.userLocation) appActions.locateUser();
    persist();
    render();
  },

  setPlannedArrivalOffset(min) {
    const valid = [15, 30, 60];
    appState.plannedArrivalOffsetMin = valid.includes(Number(min)) ? Number(min) : 15;
    render();
  },

  useCurrentLocationAnchor() {
    appState.plannedDestination = null;
    appState.plannedSearchQuery = "";
    appState.plannedSearchError = "";
    appState.plannedSuggestions = [];
    appState.plannedSuggestionsOpen = false;
    appState.data.settings.planned_destination = null;
    appState.selectedCompareLotId = null;
    appState.homeSelectedLotId = null;
    appState.homeCarouselIndex = 0;
    appState.data.settings.home_last_selected_lot_id = null;
    if (!appState.userLocation) appActions.locateUser();
    persist();
    render();
  },

  setComparePrimary(lotId) {
    appActions.selectLot(lotId);
  },

  setPlannedSort(sortKey) {
    appState.plannedSort = ["proximity", "predicted", "price"].includes(sortKey) ? sortKey : "proximity";
    render();
  },

  toggleIssueMenu() {
    appState.issueMenuOpen = !appState.issueMenuOpen;
    render();
  },

  openReserveConfirm(lotId) {
    const guard = canStartOrReserve();
    if (!guard.ok) {
      alert(authGuardMessage(guard.reason));
      if (guard.reason === "signed_out") {
        appState.page = "profile";
        appState.profileSection = "menu";
        render();
      } else if (guard.reason === "profile_incomplete") {
        appState.page = "profile";
        appState.profileSection = "onboarding";
        render();
      } else if (guard.reason === "no_default_vehicle") {
        appActions.requireDefaultVehicleInProfile();
      }
      return;
    }
    const lot = getLotById(lotId);
    if (lot && lotSegmentType(lot) === "municipal_blue_white") {
      alert(t("save_not_available_municipal"));
      return;
    }
    if (appState.activeSheet === "lot-details") {
      appState.activeSheet = null;
      appState.lotModalId = null;
    }
    appState.reserveLotId = lotId;
    appState.reserveConfirmOpen = true;
    render();
  },

  closeReserveConfirm() {
    appState.reserveConfirmOpen = false;
    appState.reserveLotId = null;
    render();
  },

  releaseReservedParking() {
    const reservation = activeReservationHoldForUser();
    if (!reservation) {
      alert(t("destination_empty"));
      return;
    }
    const spot = appState.data.parkingSpots.find((s) => s.id === reservation.spot_id);
    if (spot) {
      spot.status = "available";
      spot.reservation_id = null;
      spot.current_vehicle_id = null;
      spot.current_session_id = null;
      spot.assignment_expires_at = null;
    }
    const charged = chargeReservationHoldFee(reservation, { reason: "driver_release", duration_minutes: 0 });
    reservation.status = "cancelled";
    reservation.cancellation_reason = "released_by_driver";
    addAudit("RESERVATION_RELEASED_BY_DRIVER", "user", "Reservation", reservation.id, {
      parking_lot_id: reservation.parking_lot_id,
      reservation_id: reservation.id,
      new_state: { status: "cancelled", hold_fee_status: reservation.hold_fee_status || "pending" },
    });
    notify(getCurrentUid(), "system", t("release_parking"), charged ? t("reservation_release_fee") : t("reserved_release_done"));
    normalizeSpots();
    persist();
    const lot = getLotById(reservation.parking_lot_id);
    if (["private_hourly", "municipal_blue_white"].includes(lotSegmentType(lot))) {
      appState.selectedLotId = reservation.parking_lot_id;
      appState.activeSheet = null;
      appState.lotModalId = null;
      appState.page = "parking-lot-details";
    } else {
      appState.page = "home";
    }
    render();
  },

  confirmSaveParking() {
    const guard = canStartOrReserve();
    if (!guard.ok) {
      appState.reserveConfirmOpen = false;
      appState.reserveLotId = null;
      appState.activeSheet = null;
      appState.lotModalId = null;
      alert(authGuardMessage(guard.reason));
      if (guard.reason === "profile_incomplete") {
        appState.page = "profile";
        appState.profileSection = "onboarding";
      }
      if (guard.reason === "signed_out") {
        appState.page = "profile";
        appState.profileSection = "menu";
      }
      render();
      return;
    }
    const uid = getCurrentUid();
    if (!uid) return;
    const lotId = appState.reserveLotId || appState.selectedLotId;
    const lot = getLotById(lotId);
    if (!lot || lot.status !== "active") return;
    if (lotSegmentType(lot) === "municipal_blue_white") {
      appState.reserveConfirmOpen = false;
      appState.reserveLotId = null;
      alert(t("save_not_available_municipal"));
      render();
      return;
    }
    const existingHold = activeReservationHoldForUser();
    if (existingHold) {
      appState.reserveConfirmOpen = false;
      appState.page = "reserved-parking";
      render();
      return;
    }
    const vehicle = getDefaultVehicle();
    if (!vehicle) {
      appState.reserveConfirmOpen = false;
      appActions.requireDefaultVehicleInProfile();
      return;
    }
    const spot = assignSpot(lotId, vehicle, { needs_charging: false });
    if (!spot) return;

    const reservationId = uid("res");
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 60000);
    spot.status = "reserved_active";
    spot.reservation_id = reservationId;
    spot.current_vehicle_id = vehicle.id;

    appState.data.reservations.unshift({
      id: reservationId,
      parking_lot_id: lotId,
      spot_id: spot.id,
      vehicle_id: vehicle.id,
      user_id: uid,
      status: "confirmed",
      scheduled_start: now.toISOString(),
      scheduled_end: end.toISOString(),
      grace_period_end: end.toISOString(),
      actual_arrival: null,
      prepaid_amount: 10,
      hold_fee_amount: 10,
      hold_fee_status: "pending",
      payment_id: null,
      cancellation_reason: "",
      refund_amount: 0,
      needs_charging: false,
      spot_type_requested: "regular",
      navigation_steps: buildTextNavigation(lot, spot, t("primary_entry")),
    });

    addAudit("RESERVATION_CREATED", "user", "Reservation", reservationId, {
      parking_lot_id: lotId,
      spot_id: spot.id,
      new_state: { status: "confirmed", hold_minutes: 30, fee: 10 },
    });
    notify(getCurrentUid(), "reservation_reminder", t("reserved_parking"), `${t("spot")}: ${isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : compactSpotCode(spot)}`);
    normalizeSpots();
    persist();
    appState.reserveConfirmOpen = false;
    appState.reserveLotId = null;
    if (lotSegmentType(lot) === "private_hourly") {
      appState.selectedLotId = lotId;
      appState.activeSheet = null;
      appState.lotModalId = null;
      appState.page = "parking-lot-details";
    } else {
      appState.activeSheet = null;
      appState.lotModalId = null;
      appState.page = "reserved-parking";
    }
    render();
  },

  quickReportIssue(issueType) {
    const session = activeSessionForUser();
    if (!session) return;
    const lot = getLotById(session.parking_lot_id);
    const policy = resolveIssueWithPolicy(session, issueType);
    const issueId = uid("issue");
    appState.data.issueReports.unshift({
      id: issueId,
      parking_lot_id: session.parking_lot_id,
      spot_id: policy.oldSpotId,
      session_id: session.id,
      reporter_id: getCurrentUid(),
      issue_type: policy.normalizedType,
      description: localizeIssueType(policy.normalizedType),
      photos: [],
      status: "new",
      priority: policy.priority,
      assigned_to: policy.resolutionAction === "logged_only" ? null : appState.adminId,
      resolution_notes: policy.message,
      resolved_at: null,
      alternative_spot_id: policy.newSpotId,
      resolution_action: policy.resolutionAction,
      response_time_ms: policy.responseTimeMs,
      sla_target_sec: policy.slaTargetSec,
      created_at: nowIso(),
    });
    addAudit("ISSUE_REPORTED", "user", "IssueReport", issueId, {
      parking_lot_id: session.parking_lot_id,
      issue_type: policy.normalizedType,
      old_spot_id: policy.oldSpotId,
      old_spot_code: policy.oldSpotCode,
      new_spot_id: policy.newSpotId,
      new_spot_code: policy.newSpotCode,
      resolution_action: policy.resolutionAction,
      response_time_ms: policy.responseTimeMs,
      sla_target_sec: policy.slaTargetSec,
    });
    notify(getCurrentUid(), "issue_update", t("report_issue"), policy.message);
    notify(
      appState.adminId,
      "issue_update",
      t("issue_reports"),
      `${lot?.name || ""} • ${localizeIssueType(policy.normalizedType)} • ${localizeIssueResolutionAction(policy.resolutionAction)}`
    );
    appState.issueMenuOpen = false;
    normalizeSpots();
    persist();
    render();
  },

  openSupportCall() {
    const number = (appState.data.settings.profile_phone || "").replace(/[^\d+]/g, "");
    if (!number) return;
    window.open(`tel:${number}`, "_self");
  },

  openReleaseConfirm() {
    appState.releaseConfirmOpen = true;
    render();
  },

  closeReleaseConfirm() {
    appState.releaseConfirmOpen = false;
    render();
  },

  confirmReleaseParking() {
    const session = activeSessionForUser();
    if (!session) return;
    const spot = appState.data.parkingSpots.find((s) => s.id === session.spot_id);
    if (!spot) {
      alert(t("no_spot_released"));
      return;
    }
    const releasedSpot = compactSpotCode(spot);
    // Release current spot for next driver while keeping billing/session active until exit event.
    spot.status = "available";
    spot.current_session_id = null;
    spot.current_vehicle_id = null;
    spot.assignment_expires_at = null;
    session.spot_id = null;
    session.navigation_instructions = `${t("assigned_spot")}: ${releasedSpot}`;
    addAudit("SPOT_RELEASED_BY_DRIVER", "user", "ParkingSession", session.id, {
      parking_lot_id: session.parking_lot_id,
      released_spot: releasedSpot,
    });
    notify(getCurrentUid(), "system", t("release_parking"), t("release_parking_done"));
    appState.releaseConfirmOpen = false;
    persist();
    render();
  },

  simulateExit() {
    appActions.manualExit();
  },

  endParkingInline(lotId) {
    const state = getLotInlineParkingState(lotId);
    if (state.mode !== "active_here") {
      alert(t("parking_guard_other_lot_active"));
      return;
    }
    appActions.manualExit();
  },

  startParkingAtLot(lotId) {
    const guard = canStartOrReserve();
    if (!guard.ok && guard.reason !== "existing_active") {
      alert(authGuardMessage(guard.reason));
      if (guard.reason === "profile_incomplete") {
        appState.page = "profile";
        appState.profileSection = "onboarding";
      } else if (guard.reason === "signed_out") {
        appState.page = "profile";
        appState.profileSection = "menu";
      } else if (guard.reason === "no_default_vehicle") {
        appActions.requireDefaultVehicleInProfile();
      }
      render();
      return;
    }
    appActions.simulateLprEntry(lotId);
  },

  simulateLprEntry(lotId) {
    const uid = getCurrentUid();
    const guard = canStartOrReserve();
    if (!uid || (!guard.ok && guard.reason !== "existing_active")) {
      alert(authGuardMessage(guard.reason));
      if (guard.reason === "profile_incomplete") {
        appState.page = "profile";
        appState.profileSection = "onboarding";
      } else if (guard.reason === "signed_out") {
        appState.page = "profile";
        appState.profileSection = "menu";
      } else if (guard.reason === "no_default_vehicle") {
        appActions.requireDefaultVehicleInProfile();
      }
      render();
      return;
    }
    try {
      checkTimeouts();
    } catch {
      // keep flow resilient for demo
    }
    const activeSession = activeSessionForUser();
    const holdReservation = activeReservationHoldForUser();
    appState.reserveConfirmOpen = false;
    if (activeSession) {
      alert(t("existing_parking_block"));
      const activeLot = getLotById(activeSession.parking_lot_id);
      if (["private_hourly", "municipal_blue_white"].includes(lotSegmentType(activeLot))) {
        appState.selectedLotId = activeSession.parking_lot_id;
        appState.page = "parking-lot-details";
      } else {
        appState.page = "active-parking";
      }
      render();
      return;
    }
    if (holdReservation && holdReservation.parking_lot_id !== lotId) {
      alert(t("existing_parking_block"));
      const holdLot = getLotById(holdReservation.parking_lot_id);
      if (["private_hourly", "municipal_blue_white"].includes(lotSegmentType(holdLot))) {
        appState.selectedLotId = holdReservation.parking_lot_id;
        appState.page = "parking-lot-details";
      } else {
        appState.page = "reserved-parking";
      }
      render();
      return;
    }
    const vehicle = getDefaultVehicle();
    if (!vehicle) {
      appActions.requireDefaultVehicleInProfile();
      return;
    }
    const lot = getLotById(lotId);
    if (!lot || lot.status !== "active") {
      return;
    }
    const segment = lotSegmentType(lot);
    const isStructured = segment === "structured";
    if (holdReservation && holdReservation.parking_lot_id === lotId) {
      const heldSpot = appState.data.parkingSpots.find((s) => s.id === holdReservation.spot_id);
      if (!heldSpot) return;
      const sessionId = uid("session");
      const assignedAt = nowIso();
      holdReservation.status = "active";
      holdReservation.actual_arrival = assignedAt;
      heldSpot.status = "occupied";
      heldSpot.current_session_id = sessionId;
      heldSpot.current_vehicle_id = vehicle.id;
      heldSpot.assignment_expires_at = null;

      appState.data.parkingSessions.unshift({
        id: sessionId,
        parking_lot_id: lotId,
        spot_id: heldSpot.id,
        vehicle_id: vehicle.id,
        user_id: uid,
        license_plate: vehicle.license_plate,
        status: "active",
        is_guest: false,
        entry_time: assignedAt,
        assignment_time: assignedAt,
        parking_start_time: assignedAt,
        exit_time: null,
        manual_exit: false,
        needs_charging: false,
        total_amount: 0,
        payment_status: "pending",
        payment_id: null,
        reservation_id: holdReservation.id,
        entry_name: t("primary_entry"),
        assigned_spot_code: getAssignedDisplayCode(holdReservation, lot) || compactSpotCode(heldSpot),
        navigation_instructions: `${t("arrive")}: ${heldSpot.spot_code}`,
        navigation_steps: buildTextNavigation(lot, heldSpot, t("primary_entry")),
      });

      normalizeSpots();
      notify(getCurrentUid(), "parking_assigned", localizeStatus("active"), `${isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : heldSpot.spot_code} • ${lot.address}`);
      addAudit(isStructured ? "LPR_ENTRY_IDENTIFIED" : "PARKING_STARTED_MANUAL", isStructured ? "system" : "user", "ParkingSession", sessionId, {
        parking_lot_id: lotId,
        spot_id: heldSpot.id,
        vehicle_id: vehicle.id,
        reservation_id: holdReservation.id,
        new_state: { status: "active" },
      });
      persist();
      appState.issueMenuOpen = false;
      if (isStructured) appState.page = "active-parking";
      else {
        appState.selectedLotId = lotId;
        appState.activeSheet = null;
        appState.lotModalId = null;
        appState.page = "parking-lot-details";
      }
      render();
      return;
    }
    // LPR entry should assign any suitable spot; charging spot is optional unless explicitly requested.
    let spot = assignSpot(lotId, vehicle, { needs_charging: false });
    if (!spot) {
      // Relax constraints for demo so flow can continue.
      spot = assignSpot(lotId, { ...vehicle, special_conditions: [], is_electric: false }, { needs_charging: false });
    }
    if (!spot) {
      return;
    }

    const sessionId = uid("session");
    const assignedAt = nowIso();
    const entryName = isStructured ? ((spot.position?.col || 0) < 4 ? t("primary_entry") : t("secondary_entry")) : t("navigate");
    const navigationSteps = buildTextNavigation(lot, spot, entryName);
    spot.status = "occupied";
    spot.current_session_id = sessionId;
    spot.current_vehicle_id = vehicle.id;
    spot.assignment_expires_at = null;

    appState.data.parkingSessions.unshift({
      id: sessionId,
      parking_lot_id: lotId,
      spot_id: spot.id,
      vehicle_id: vehicle.id,
      user_id: uid,
      license_plate: vehicle.license_plate,
      status: "active",
      is_guest: false,
      entry_time: assignedAt,
      assignment_time: assignedAt,
      parking_start_time: assignedAt,
      exit_time: null,
      manual_exit: false,
      needs_charging: false,
      total_amount: 0,
      payment_status: "pending",
      payment_id: null,
      reservation_id: null,
      entry_name: entryName,
      assigned_spot_code: getAssignedDisplayCode(null, lot) || compactSpotCode(spot),
      navigation_instructions: `${entryName} • ${lot.name}`,
      navigation_steps: navigationSteps,
    });

    normalizeSpots();
    notify(getCurrentUid(), "parking_assigned", localizeStatus("active"), `${isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : spot.spot_code} • ${lot.address}`);
    addAudit(isStructured ? "LPR_ENTRY_IDENTIFIED" : "PARKING_STARTED_MANUAL", isStructured ? "system" : "user", "ParkingSession", sessionId, {
      parking_lot_id: lotId,
      spot_id: spot.id,
      vehicle_id: vehicle.id,
      new_state: { status: "active" },
    });
    persist();
    appState.issueMenuOpen = false;
    if (isStructured) appState.page = "active-parking";
    else {
      appState.selectedLotId = lotId;
      appState.activeSheet = null;
      appState.lotModalId = null;
      appState.page = "parking-lot-details";
    }
    render();
  },

  confirmArrival() {
    const session = activeSessionForUser();
    if (!session || session.status !== "assigned") return;
    const spot = appState.data.parkingSpots.find((s) => s.id === session.spot_id);
    session.status = "active";
    session.parking_start_time = nowIso();
    spot.status = "occupied";
    spot.assignment_expires_at = null;
    addAudit("SESSION_ACTIVATED", "user", "ParkingSession", session.id, {
      parking_lot_id: session.parking_lot_id,
    });
    notify(getCurrentUid(), "system", t("active_parking"), `${t("spot")}: ${spot.spot_code}`);
    persist();
    render();
  },

  manualExit() {
    const session = activeSessionForUser();
    if (!session) return;
    const spot = appState.data.parkingSpots.find((s) => s.id === session.spot_id);
    const exitTime = nowIso();
    const calc = estimateCost(session, exitTime);
    const reservation = session.reservation_id ? appState.data.reservations.find((r) => r.id === session.reservation_id) : null;
    if (reservation && (reservation.hold_fee_status || "pending") === "pending") {
      const holdFeeAmount = Number(reservation.hold_fee_amount || 10);
      calc.extra_charges += holdFeeAmount;
      calc.extra_items = Array.isArray(calc.extra_items) ? calc.extra_items : [];
      calc.extra_items.push(parkingHoldExtraItem(holdFeeAmount));
      calc.total = Math.max(0, calc.base_rate + calc.extra_charges - calc.discounts);
      reservation.hold_fee_status = "charged_in_session";
      addAudit("RESERVATION_FEE_INCLUDED_IN_SESSION", "system", "Reservation", reservation.id, {
        parking_lot_id: session.parking_lot_id,
        reservation_id: reservation.id,
        session_id: session.id,
        amount: holdFeeAmount,
      });
    }
    const paymentId = uid("pay");
    session.status = "completed";
    session.manual_exit = true;
    session.exit_time = exitTime;
    session.total_amount = calc.total;
    session.payment_status = "pending";
    session.payment_id = paymentId;

    appState.data.payments.unshift({
      id: paymentId,
      user_id: getCurrentUid(),
      session_id: session.id,
      reservation_id: session.reservation_id,
      parking_lot_id: session.parking_lot_id,
      amount: calc.total,
      currency: "ILS",
      status: "pending",
      payment_method: "credit_card",
      card_last_four: "4242",
      transaction_id: null,
      receipt_url: "",
      retry_count: 0,
      failure_reason: "",
      refund_amount: 0,
      refund_reason: "",
      is_debt: false,
      breakdown: calc,
      created_at: nowIso(),
    });

    if (spot) {
      spot.status = "available";
      spot.current_session_id = null;
      spot.current_vehicle_id = null;
      spot.assignment_expires_at = null;
    }

    normalizeSpots();
    addAudit("SESSION_EXIT_MANUAL", "user", "ParkingSession", session.id, {
      parking_lot_id: session.parking_lot_id,
      new_state: { status: "completed", amount: calc.total },
    });
    notify(getCurrentUid(), "payment_success", t("payment_summary"), `${t("total")}: ${money(calc.total)}`);
    persist();
    appState.page = "payment-summary";
    render();
  },

  payNow(paymentId, method) {
    const payment = appState.data.payments.find((p) => p.id === paymentId);
    if (!payment) return;
    payment.payment_method = method || payment.payment_method;
    payment.status = "completed";
    payment.transaction_id = `txn_${Math.floor(Math.random() * 1e8)}`;
    payment.receipt_url = "https://example.com/receipt/demo";

    const session = appState.data.parkingSessions.find((s) => s.id === payment.session_id);
    if (session) session.payment_status = "completed";

    addAudit("PAYMENT_COMPLETED", "user", "Payment", payment.id, {
      parking_lot_id: payment.parking_lot_id,
      amount: payment.amount,
    });
    notify(getCurrentUid(), "payment_success", localizeStatus("completed"), `${t("pay_now")}: ${money(payment.amount)}`);
    persist();
    appState.page = "home";
    render();
  },

  failPayment(paymentId) {
    const payment = appState.data.payments.find((p) => p.id === paymentId);
    if (!payment) return;
    payment.status = "failed";
    payment.retry_count += 1;
    payment.failure_reason = "Insufficient funds";
    payment.is_debt = true;

    const session = appState.data.parkingSessions.find((s) => s.id === payment.session_id);
    if (session) session.payment_status = "failed";

    notify(getCurrentUid(), "payment_failed", localizeStatus("failed"), t("debt"));
    addAudit("PAYMENT_FAILED", "system", "Payment", payment.id, {
      parking_lot_id: payment.parking_lot_id,
      amount: payment.amount,
    });
    persist();
    render();
  },

  createReservation(formEl) {
    const fd = new FormData(formEl);
    const parking_lot_id = fd.get("parking_lot_id");
    const scheduled_start = fd.get("scheduled_start");
    const scheduled_end = fd.get("scheduled_end");
    const spot_type_requested = fd.get("spot_type_requested") || "regular";
    const needs_charging = fd.get("needs_charging") === "on";

    if (!parking_lot_id || !scheduled_start || !scheduled_end) {
      alert(t("fill_required"));
      return;
    }

    const vehicle = getDefaultVehicle();
    if (!vehicle) {
      appActions.requireDefaultVehicleInProfile();
      return;
    }

    const lot = getLotById(parking_lot_id);
    const spot = assignSpot(parking_lot_id, vehicle, { requiredType: spot_type_requested, needs_charging });
    if (!spot) {
      alert(t("reservation_no_spot"));
      return;
    }

    const resId = uid("res");
    const prepaid = 12;
    const grace = new Date(new Date(scheduled_start).getTime() + lot.reservation_grace_minutes * 60000).toISOString();

    spot.status = "reserved_future";
    spot.reservation_id = resId;

    appState.data.reservations.unshift({
      id: resId,
      parking_lot_id,
      spot_id: spot.id,
      vehicle_id: vehicle.id,
      user_id: getCurrentUid(),
      status: "confirmed",
      scheduled_start: new Date(scheduled_start).toISOString(),
      scheduled_end: new Date(scheduled_end).toISOString(),
      grace_period_end: grace,
      actual_arrival: null,
      prepaid_amount: prepaid,
      hold_fee_amount: 0,
      hold_fee_status: "charged_in_session",
      payment_id: null,
      cancellation_reason: "",
      refund_amount: 0,
      needs_charging,
      spot_type_requested,
    });

    normalizeSpots();
    notify(getCurrentUid(), "reservation_reminder", localizeStatus("confirmed"), `${spot.spot_code} • ${t("booking_fee")}: ${money(prepaid)}`);
    addAudit("RESERVATION_CREATED", "user", "Reservation", resId, {
      parking_lot_id,
      spot_id: spot.id,
    });
    persist();
    formEl.reset();
    render();
  },

  activateReservation(reservationId) {
    const reservation = appState.data.reservations.find((r) => r.id === reservationId);
    if (!reservation || !["confirmed", "pending"].includes(reservation.status)) return;

    const spot = appState.data.parkingSpots.find((s) => s.id === reservation.spot_id);
    if (!spot) return;

    reservation.status = "active";
    reservation.actual_arrival = nowIso();
    spot.status = "reserved_active";

    const sessionId = uid("session");
    appState.data.parkingSessions.unshift({
      id: sessionId,
      parking_lot_id: reservation.parking_lot_id,
      spot_id: reservation.spot_id,
      vehicle_id: reservation.vehicle_id,
      user_id: reservation.user_id,
      license_plate: appState.data.vehicles.find((v) => v.id === reservation.vehicle_id)?.license_plate || "",
      status: "active",
      is_guest: false,
      entry_time: nowIso(),
      assignment_time: nowIso(),
      parking_start_time: nowIso(),
      exit_time: null,
      manual_exit: false,
      needs_charging: reservation.needs_charging,
      total_amount: 0,
      payment_status: "pending",
      payment_id: null,
      reservation_id: reservation.id,
      navigation_instructions: `${t("arrive")}: ${spot.spot_code}`,
    });

    addAudit("RESERVATION_ACTIVATED", "user", "Reservation", reservation.id, {
      parking_lot_id: reservation.parking_lot_id,
    });
    notify(getCurrentUid(), "parking_assigned", localizeStatus("active"), `${t("spot")}: ${spot.spot_code}`);
    persist();
    appState.page = "active-parking";
    render();
  },

  submitIssue(formEl) {
    const session = activeSessionForUser();
    if (!session) return;
    const fd = new FormData(formEl);
    const issue_type = fd.get("issue_type");
    const description = fd.get("description");
    const photosRaw = fd.get("photos") || "";
    const photos = String(photosRaw)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (!issue_type || !description) {
      alert(t("issue_required"));
      return;
    }

    const issueId = uid("issue");
    const policy = resolveIssueWithPolicy(session, issue_type);
    const issue = {
      id: issueId,
      parking_lot_id: session.parking_lot_id,
      spot_id: policy.oldSpotId,
      session_id: session.id,
      reporter_id: getCurrentUid(),
      issue_type: policy.normalizedType,
      description,
      photos,
      status: "new",
      priority: policy.priority,
      assigned_to: policy.resolutionAction === "logged_only" ? null : appState.adminId,
      resolution_notes: policy.message,
      resolved_at: null,
      alternative_spot_id: policy.newSpotId,
      resolution_action: policy.resolutionAction,
      response_time_ms: policy.responseTimeMs,
      sla_target_sec: policy.slaTargetSec,
      created_at: nowIso(),
    };

    appState.data.issueReports.unshift(issue);
    notify(getCurrentUid(), "issue_update", t("report_issue"), policy.message);
    notify(
      appState.adminId,
      "issue_update",
      t("issue_reports"),
      `${localizeIssueType(policy.normalizedType)} • ${session.parking_lot_id} • ${localizeIssueResolutionAction(policy.resolutionAction)}`
    );
    addAudit("ISSUE_REPORTED", "user", "IssueReport", issueId, {
      parking_lot_id: session.parking_lot_id,
      issue_type: policy.normalizedType,
      old_spot_id: policy.oldSpotId,
      old_spot_code: policy.oldSpotCode,
      new_spot_id: policy.newSpotId,
      new_spot_code: policy.newSpotCode,
      resolution_action: policy.resolutionAction,
      response_time_ms: policy.responseTimeMs,
      sla_target_sec: policy.slaTargetSec,
    });
    normalizeSpots();
    persist();
    formEl.reset();
    render();
  },

  markRead(notificationId) {
    const uid = getCurrentUid();
    if (!uid) return;
    const n = appState.data.notifications.find((x) => x.id === notificationId && x.user_id === uid);
    if (n) n.is_read = true;
    persist();
    render();
  },

  markAllRead() {
    const uid = getCurrentUid();
    if (!uid) return;
    appState.data.notifications
      .filter((n) => n.user_id === uid)
      .forEach((n) => {
        n.is_read = true;
      });
    persist();
    render();
  },

  toggleFavoriteLot(lotId) {
    const lot = getLotById(lotId);
    if (!lot) return;
    if (!Array.isArray(appState.data.settings.favorite_lot_ids)) appState.data.settings.favorite_lot_ids = [];
    const ids = appState.data.settings.favorite_lot_ids;
    const idx = ids.indexOf(lotId);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.unshift(lotId);
    persist();
    render();
  },

  async addVehicle(formEl, options = {}) {
    const userUid = getCurrentUid();
    if (!userUid) {
      alert(t("auth_required_action"));
      return;
    }
    const fd = new FormData(formEl);
    const licensePlate = String(fd.get("license_plate") || "").trim();
    if (!licensePlate) {
      if (!options.silent) alert(t("license_plate_required"));
      return;
    }
    const manufacturer = String(fd.get("manufacturer") || "").trim();
    const color = String(fd.get("color") || "white").trim().toLowerCase();
    const requestedDefault = fd.get("is_default") === "on";
    const editingId = String(fd.get("vehicle_id") || "").trim();
    const existingVehicle = editingId
      ? appState.data.vehicles.find((v) => v.id === editingId && v.owner_id === userUid && v.is_active)
      : null;
    const vehicle = {
      id: existingVehicle?.id || uid("veh"),
      owner_id: userUid,
      license_plate: licensePlate,
      manufacturer: manufacturer || "Unknown",
      model: "",
      year: new Date().getFullYear(),
      color: color || "white",
      vehicle_size: String(fd.get("vehicle_size") || "regular"),
      is_electric: fd.get("is_electric") === "on",
      special_conditions: fd.getAll("special_conditions"),
      is_active: true,
      is_default: existingVehicle
        ? requestedDefault
        : requestedDefault || appState.data.vehicles.filter((v) => v.owner_id === userUid && v.is_active).length === 0,
      nickname: fd.get("nickname") || "",
    };
    if (existingVehicle) {
      Object.assign(existingVehicle, vehicle);
    } else {
      appState.data.vehicles.push(vehicle);
    }
    await vehicleService.upsert(userUid, {
      ...vehicle,
      owner_uid: userUid,
    });
    if (vehicle.is_default) {
      appState.data.vehicles
        .filter((v) => v.owner_id === userUid)
        .forEach((v) => {
          v.is_default = v.id === vehicle.id;
        });
      await vehicleService.setDefault(userUid, vehicle.id);
    }
    updateOnboardingState();
    if (appState.onboarding.completed) {
      appState.data.settings.onboarding_completed_at = appState.data.settings.onboarding_completed_at || nowIso();
    }
    addAudit(existingVehicle ? "VEHICLE_UPDATED" : "VEHICLE_CREATED", "user", "Vehicle", vehicle.id, {});
    persist();
    if (!existingVehicle) formEl.reset();
    if (existingVehicle) {
      appState.profileSection = options.keepSection || appState.editVehicleReturnSection || "vehicles";
      appState.editVehicleId = null;
      appState.addVehicleExpanded = false;
      alert(t("vehicle_saved"));
    } else {
      appState.editVehicleId = null;
      if (options.keepSection !== "onboarding") appState.addVehicleExpanded = false;
      if (options.keepSection) appState.profileSection = options.keepSection;
    }
    render();
  },

  async setDefaultVehicle(vehicleId) {
    const userUid = getCurrentUid();
    if (!userUid) return;
    appState.data.vehicles
      .filter((v) => v.owner_id === userUid)
      .forEach((v) => {
        v.is_default = v.id === vehicleId;
      });
    await vehicleService.setDefault(userUid, vehicleId);
    updateOnboardingState();
    if (appState.onboarding.completed) {
      appState.data.settings.onboarding_completed_at = appState.data.settings.onboarding_completed_at || nowIso();
    }
    persist();
    render();
  },

  adminSetIssueStatus(issueId, status) {
    const issue = appState.data.issueReports.find((i) => i.id === issueId);
    if (!issue) return;
    issue.status = status;
    issue.resolution_notes = status === "resolved" ? localizeStatus("resolved") : issue.resolution_notes;
    if (status === "resolved") issue.resolved_at = nowIso();
    addAudit("ISSUE_STATUS_UPDATED", "admin", "IssueReport", issue.id, {
      parking_lot_id: issue.parking_lot_id,
      new_state: { status },
    });
    notify(issue.reporter_id, "issue_update", t("issue_reports"), `${localizeIssueType(issue.issue_type)} • ${localizeStatus(status)}`);
    persist();
    render();
  },

  setAdminIssueFilter(filterKey) {
    appState.adminIssueFilter = filterKey === "urgent" ? "urgent" : "all";
    render();
  },

  adminChangeSpotStatus(spotId, status) {
    const spot = appState.data.parkingSpots.find((s) => s.id === spotId);
    if (!spot) return;
    const prev = spot.status;
    spot.status = status;
    if (status === "available") {
      spot.current_vehicle_id = null;
      spot.current_session_id = null;
      spot.reservation_id = null;
      spot.assignment_expires_at = null;
    }
    normalizeSpots();
    addAudit("SPOT_STATUS_CHANGED", "admin", "ParkingSpot", spotId, {
      parking_lot_id: spot.parking_lot_id,
      previous_state: { status: prev },
      new_state: { status },
    });
    persist();
    render();
  },

  adminLotStatus(lotId, status) {
    const lot = getLotById(lotId);
    if (!lot) return;
    lot.status = status;
    addAudit("PARKING_LOT_STATUS_CHANGED", "admin", "ParkingLot", lotId, {
      parking_lot_id: lotId,
      new_state: { status },
    });
    persist();
    render();
  },

  adminUserRole(userId, role) {
    const user = appState.data.users.find((u) => u.id === userId);
    if (!user) return;
    user.role = role;
    addAudit("USER_ROLE_CHANGED", "admin", "User", userId, { new_state: { role } });
    persist();
    render();
  },

  updateSettings(formEl) {
    const fd = new FormData(formEl);
    appState.data.settings.default_pricing.hourly_rate = Number(fd.get("hourly_rate"));
    appState.data.settings.default_pricing.daily_max = Number(fd.get("daily_max"));
    appState.data.settings.default_pricing.first_hour_rate = Number(fd.get("first_hour_rate"));
    appState.data.settings.assignment_timeout_minutes = Number(fd.get("assignment_timeout_minutes"));
    appState.data.settings.reservation_grace_minutes = Number(fd.get("reservation_grace_minutes"));
    addAudit("SETTINGS_UPDATED", "admin", "SystemSettings", "settings", {});
    persist();
    render();
  },

  addSpot(formEl) {
    const fd = new FormData(formEl);
    const floor_id = fd.get("floor_id");
    const row_letter = fd.get("row_letter");
    const spot_number = Number(fd.get("spot_number"));
    const spot_type = fd.get("spot_type");
    const floor = appState.data.floors.find((f) => f.id === floor_id);
    if (!floor) return;
    const id = uid("spot");
    appState.data.parkingSpots.push({
      id,
      parking_lot_id: floor.parking_lot_id,
      floor_id,
      spot_code: `F${floor.floor_number}-${row_letter}${String(spot_number).padStart(2, "0")}`,
      row_letter,
      spot_number,
      position: { row: row_letter.charCodeAt(0) - 65, col: spot_number - 1 },
      spot_type,
      status: "available",
      current_vehicle_id: null,
      current_session_id: null,
      distance_score: spot_number,
      assignment_expires_at: null,
      reservation_id: null,
    });
    normalizeSpots();
    addAudit("SPOT_CREATED", "admin", "ParkingSpot", id, { parking_lot_id: floor.parking_lot_id });
    persist();
    render();
  },

  resetDemo() {
    if (!confirm(t("reset_confirm"))) return;
    const currentLanguage = getUiLanguage();
    const currentTheme = getUiTheme();
    appState.data = baseData();
    appState.data.settings.ui_language = currentLanguage;
    appState.data.settings.ui_theme = currentTheme;
    appState.page = "home";
    appState.adminPage = "dashboard";
    appState.selectedLotId = "lot_1";
    appState.selectedFloorId = "floor_1_1";
    appState.userLocation = null;
    appState.locationError = "";
    appState.locationRequested = false;
    persist();
    render();
  },

  setLanguage(language) {
    appState.data.settings.ui_language = language === "he" ? "he" : "en";
    persist();
    render();
  },

  setTheme(theme) {
    const valid = ["blue", "purple", "emerald", "orange", "rose", "indigo", "teal", "slate"];
    appState.data.settings.ui_theme = valid.includes(theme) ? theme : "blue";
    persist();
    render();
  },
};

window.appActions = appActions;

function headerUnreadCount() {
  const uid = getCurrentUid();
  if (!uid) return 0;
  return appState.data.notifications.filter((n) => n.user_id === uid && !n.is_read).length;
}

function lotColor(available) {
  if (available > 10) return "green";
  if (available > 0) return "yellow";
  return "red";
}

function segmentStyle(segment) {
  const seg = lotSegmentType({ segment_type: segment });
  if (seg === "municipal_blue_white") {
    return {
      leafletClass: "segment-municipal",
      googleColor: "#2563eb",
      badgeClass: "segment-municipal",
    };
  }
  if (seg === "private_hourly") {
    return {
      leafletClass: "segment-private",
      googleColor: "#f59e0b",
      badgeClass: "segment-private",
    };
  }
  return {
    leafletClass: "segment-structured",
    googleColor: "#16a34a",
    badgeClass: "segment-structured",
  };
}

function navIcon(name) {
  const icons = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
    map: '<path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
    star: '<path d="m12 3 2.9 5.88 6.5.95-4.7 4.58 1.1 6.49L12 17.8l-5.8 3.1 1.1-6.49-4.7-4.58 6.5-.95z"/>',
    vehicles: '<rect x="3" y="8" width="18" height="8" rx="2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    parking: '<path d="M7 21V3h7a4 4 0 1 1 0 8H7"/>',
    payments: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
    notifications: '<path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    wallet: '<path d="M3 7h18a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 10V6a2 2 0 0 1 2-2h12"/><circle cx="16" cy="12.5" r="1.2"/>',
    support: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 4 2c-.8.5-1.5 1-1.5 2"/><circle cx="12" cy="16.5" r=".5"/>',
    chevron: '<path d="m14 7-5 5 5 5"/>',
  };
  return `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ""}</svg>`;
}

function renderDriverNav() {
  const items = [
    ["home", t("nav_home")],
    ["notifications", t("nav_notifications")],
    ["profile", t("nav_profile")],
  ];
  return `
    <div class="item stack" style="margin-bottom:8px">
      <button class="btn" onclick="appActions.switchMode('admin')">${t("switch_to_admin")}</button>
      <button class="btn" onclick="appActions.resetDemo()">${t("reset_demo")}</button>
      <div class="muted">${t("unread")}: ${headerUnreadCount()}</div>
    </div>
    <div class="nav-title">${t("nav_driver")}</div>
    ${items
      .map(
        ([id, label]) =>
          `<button class="nav-btn ${appState.page === id ? "active" : ""}" onclick="appActions.navigate('${id}')">${label}</button>`
      )
      .join("")}
  `;
}

function renderAdminNav() {
  const items = [
    ["dashboard", t("nav_dashboard")],
    ["parking-lots", t("nav_parking_lots")],
    ["parking-map", t("nav_parking_map")],
    ["issues", t("nav_issues")],
    ["users", t("nav_users")],
    ["audit-log", t("nav_audit_log")],
    ["settings", t("nav_settings")],
    ["edit-floor", t("nav_edit_floor")],
  ];
  return `
    <div class="item stack" style="margin-bottom:8px">
      <button class="btn" onclick="appActions.switchMode('driver')">${t("switch_to_driver")}</button>
      <button class="btn" onclick="appActions.resetDemo()">${t("reset_demo")}</button>
    </div>
    <div class="nav-title">${t("nav_admin")}</div>
    ${items
      .map(
        ([id, label]) =>
          `<button class="nav-btn ${appState.adminPage === id ? "active" : ""}" onclick="appActions.navigateAdmin('${id}')">${label}</button>`
      )
      .join("")}
  `;
}

function renderRankTagLabel(tag) {
  if (tag === "nearest") return t("rank_nearest");
  if (tag === "cheapest") return t("rank_cheapest");
  if (tag === "most_available") return t("rank_most_available");
  return t("rank_nearby");
}

function renderCompareMiniCard(lot, anchor, showRankTag = false) {
  if (!lot) return "";
  const distance = formatDistance(distanceMeters(anchor, lot.location));
  const distanceCompact = distance.replace(/\s+/g, "");
  const available = lot.__pred?.predicted_available_spots ?? lot.available_spots;
  const hourly = Math.round(Number(lot.pricing.hourly_rate) || 0);
  const addressLine = String(lot.address || "").split(",")[0];
  const segment = lotSegmentType(lot);
  const isStructured = segment === "structured";
  const displayTitle = isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : lot.name;
  return `
    <button class="compare-card" onclick="appActions.selectLot('${lot.id}')">
      <div class="compare-head">
        <div class="compare-title">${displayTitle}</div>
        <div class="compare-subtitle">${addressLine}</div>
        ${showRankTag ? `<span class="home-list-tag">${renderRankTagLabel(lot.__rankTag)}</span>` : ""}
      </div>
      <div class="compare-metrics">
        ${isStructured ? `<span class="compare-dot" title="${t("available_spots")}">🅿<b>${available}</b></span>` : ""}
        <span class="compare-dot" title="${t("hourly")}">₪<b>${hourly}</b></span>
        <span class="compare-dot" title="${t("distance_label")}">📍<b>${distanceCompact}</b></span>
      </div>
    </button>
  `;
}

function renderHomeTopSearchBar() {
  const rawQuery = appState.plannedDestination?.name || appState.plannedSearchQuery || "";
  const q = rawQuery === t("current_location_token") ? "" : rawQuery;
  const showNoLocationCta = !appState.userLocation;
  const introClass = appState.homeSearchIntroDone ? "" : "home-search-intro";
  return `
    <div class="home-search-overlay ${introClass}" data-tour="search">
      <form class="home-map-search-row" onsubmit="event.preventDefault(); appActions.applyPlannedDestination()">
        <input id="home-search-input" class="planned-destination-input" dir="${getUiLanguage() === "he" ? "rtl" : "ltr"}" value="${q}" onfocus="appActions.focusSearchInput(this.value)" oninput="appActions.handleSearchInput(this.value)" placeholder="${t("search_where_placeholder")}" />
      </form>
      <div class="home-segment-chips" data-tour="filters">
        ${SUPPLY_SEGMENTS.map((segment) => `
          <button class="home-segment-chip ${appState.homeSegmentFilters.includes(segment) ? "active" : ""}" onclick="appActions.setHomeSegmentFilter('${segment}')">
            ${t(`segment_${segment}`)}
          </button>
        `).join("")}
      </div>
      ${appState.plannedSearchError ? `<div class="planned-search-error">${appState.plannedSearchError}</div>` : ""}
      ${
        showNoLocationCta
          ? `<div class="home-location-inline">
              <span>${t("location_address_mode_hint")}</span>
              <button class="btn" onclick="appActions.locateUser()">${t("enable_location_cta")}</button>
            </div>`
          : ""
      }
    </div>
  `;
}

function renderHomeCoachMarks() {
  if (!appState.onboarding?.tourActive || appState.page !== "home") return "";
  const steps = [
    { title: t("search_where_placeholder"), text: t("home_tour_step_search"), top: "84px" },
    { title: t("sort_by"), text: t("home_tour_step_filters"), top: "164px" },
    { title: t("home_map_compare_title"), text: t("home_tour_step_cards"), top: "58%" },
    { title: t("nav_profile"), text: t("home_tour_step_nav"), top: "calc(100% - 240px)" },
  ];
  const idx = Math.min(steps.length - 1, Math.max(0, Number(appState.onboarding.tourStep || 0)));
  const step = steps[idx];
  const isLast = idx === steps.length - 1;
  return `
    <div class="home-tour-overlay" onclick="event.stopPropagation()">
      <div class="home-tour-focus" style="top:${step.top}">
        <div class="home-tour-arrow">↓</div>
        <div class="home-tour-card">
          <div class="home-tour-title">${step.title}</div>
          <div class="home-tour-text">${step.text}</div>
          <div class="home-tour-actions">
            <button class="btn" onclick="appActions.skipHomeTour()">${t("home_tour_skip")}</button>
            <button class="btn primary" onclick="${isLast ? "appActions.finishHomeTour()" : "appActions.nextHomeTourStep()"}">
              ${isLast ? t("home_tour_finish") : t("home_tour_next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderHomeBottomCarousel() {
  const anchor = getHomeCarouselAnchor();
  const lots = getHomeCarouselLots();
  const introCard = `
    <div class="home-carousel-card intro" data-index="0">
      <div class="home-carousel-intro-title">${t("home_intro_title")}</div>
      <div class="home-carousel-intro-subtitle">${t("home_intro_subtitle")}</div>
      <div class="home-carousel-intro-glow"></div>
    </div>
  `;
  if (!anchor || !lots.length) {
    return `
      <div class="home-carousel-sheet" data-tour="cards">
        <div class="home-carousel-track">
          ${introCard}
          <div class="home-carousel-card empty" data-index="1">
            <div class="muted">${t("no_lots_found_for_anchor")}</div>
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div class="home-carousel-sheet" data-tour="cards">
      <div class="home-carousel-track" onscroll="appActions.onHomeCarouselScroll(this)">
        ${introCard}
        ${lots
          .map((lot, idx) => {
            const dist = formatDistance(lot.distance_meters).replace(/\s+/g, "");
            const segment = lotSegmentType(lot);
            const isStructured = segment === "structured";
            const segmentBadgeClass = segmentStyle(segment).badgeClass;
            const displayTitle = isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : lot.name;
            return `
              <button id="home-carousel-card-${lot.id}" class="home-carousel-card lot ${appState.homeSelectedLotId === lot.id ? "active" : ""}" data-index="${idx + 1}" data-lot-id="${lot.id}" onclick="appActions.selectLot('${lot.id}')">
                <div class="home-lot-media">
                  <img src="${lot.image_url || "https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=400&q=80"}" alt="${lot.name}" />
                </div>
                <div class="compare-head home-lot-content">
                  <div class="compare-title">${displayTitle}</div>
                  <div class="compare-subtitle">${String(lot.address || "").split(",")[0]}</div>
                  <div class="home-lot-badges">
                    <span class="lot-badge segment ${segmentBadgeClass}">${t(`segment_${segment}`)}</span>
                    ${isStructured ? `<span class="lot-badge spots">${lot.available_spots_display} ${t("available_spots")}</span>` : ""}
                    <span class="lot-badge distance">${dist}</span>
                    <span class="lot-badge price">₪${Math.round(lot.hourly_rate)} ${t("hourly")}</span>
                  </div>
                </div>
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderHomeUnified() {
  return `
    <section class="home-unified-shell">
      <div class="home-map-layer map-shell home-map-shell home-map-full">
        <div id="map"></div>
        ${renderHomeTopSearchBar()}
        <button class="map-locate-btn" onclick="appActions.recenterUser()" title="${t("locating")}">⌖</button>
        ${renderHomeCoachMarks()}
      </div>
      ${renderHomeBottomCarousel()}
    </section>
  `;
}

function renderHome() {
  return `
    <section class="home-screen">
      ${renderHomeUnified()}
    </section>
  `;
}

function renderFavorites() {
  const favoriteIds = Array.isArray(appState.data.settings.favorite_lot_ids) ? appState.data.settings.favorite_lot_ids : [];
  const favorites = favoriteIds
    .map((id) => getLotById(id))
    .filter((lot) => lot && lot.status === "active");
  return `
    <div class="card">
      <div class="page-topbar">
        <span></span>
        <h2>${t("nav_favorites")}</h2>
        <span></span>
      </div>
      <div class="list">
        ${
          favorites.length
            ? favorites
                .map((lot) => {
                  const dist = formatDistance(distanceMeters(getHomeAnchorPoint(), lot.location)).replace(/\s+/g, "");
                  const hourly = Math.round(Number(lot?.pricing?.hourly_rate || 0));
                  const displayTitle = isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : lot.name;
                  return `
                    <button class="home-carousel-card lot favorites-lot-card" onclick="appActions.selectLot('${lot.id}')">
                      <div class="home-lot-media">
                        <img src="${lot.image_url || "https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=400&q=80"}" alt="${lot.name}" />
                      </div>
                      <div class="compare-head home-lot-content">
                        <div class="compare-title">${displayTitle}</div>
                        <div class="compare-subtitle">${String(lot.address || "").split(",")[0]}</div>
                        <div class="home-lot-badges">
                          <span class="lot-badge segment ${segmentStyle(lotSegmentType(lot)).badgeClass}">${t(`segment_${lotSegmentType(lot)}`)}</span>
                          ${lotSegmentType(lot) === "structured" ? `<span class="lot-badge spots">${lot.available_spots} ${t("available_spots")}</span>` : ""}
                          <span class="lot-badge distance">${dist}</span>
                          <span class="lot-badge price">₪${hourly} ${t("hourly")}</span>
                        </div>
                      </div>
                    </button>
                  `;
                })
                .join("")
            : `<div class="item muted">${t("destination_empty")}</div>`
        }
      </div>
    </div>
  `;
}

function renderDriverBottomNav() {
  const context = activeParkingContextForUser();
  const hasActiveParking = Boolean(context);
  const primaryInline = hasActiveParking && ["private_hourly", "municipal_blue_white"].includes(context.segment);
  const firstTarget = hasActiveParking ? (primaryInline ? "parking-lot-details" : context.type === "reservation" ? "reserved-parking" : "active-parking") : "home";
  const items = [
    {
      key: "primary",
      target: firstTarget,
      label: hasActiveParking ? t("active_parking") : t("nav_map"),
      icon: hasActiveParking ? "parking" : "map",
      highlighted: hasActiveParking,
    },
    { key: "notifications", target: "notifications", label: t("nav_notifications"), icon: "notifications" },
    { key: "favorites", target: "favorites", label: t("nav_favorites"), icon: "star" },
    { key: "profile", target: "profile", label: t("nav_profile"), icon: "profile" },
  ];
  return `
    <nav class="driver-bottom-nav" data-tour="nav">
      ${items
        .map((item) => {
          const isActive =
            item.key === "primary"
              ? hasActiveParking
                ? primaryInline
                  ? appState.page === "parking-lot-details" && appState.selectedLotId === context?.lotId
                  : appState.page === "active-parking" || appState.page === "reserved-parking"
                : appState.page === "home"
              : appState.page === item.target;
          return `
            <button class="driver-bottom-nav-item ${isActive ? "active" : ""} ${item.highlighted ? "active-parking-cta" : ""}" onclick="${item.key === "primary" && hasActiveParking ? "appActions.openPrimaryParkingView()" : `appActions.navigate('${item.target}')`}">
              ${navIcon(item.icon)}
              <span>${item.label}</span>
            </button>
          `;
        })
        .join("")}
    </nav>
  `;
}

function renderLotDetails() {
  const lot = driverDataService.getLotDetails(appState.selectedLotId) || driverDataService.getParkingSupply({ includeInactive: true })[0];
  if (!lot) return `<div class="card">${t("no_lot_found")}</div>`;
  appState.selectedLotId = lot.id;
  const segment = lotSegmentType(lot);
  const isStructured = segment === "structured";
  const canReserve = segment !== "municipal_blue_white";
  const inlineEligible = ["private_hourly", "municipal_blue_white"].includes(segment);
  const inlineState = getLotInlineParkingState(lot.id);
  const favoriteIds = Array.isArray(appState.data.settings.favorite_lot_ids) ? appState.data.settings.favorite_lot_ids : [];
  const isFavorite = favoriteIds.includes(lot.id);
  const segmentLabel = t(`segment_${segment}`);
  const segmentBadgeClass = segmentStyle(segment).badgeClass;
  const displayTitle = isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : lot.name;
  const genericLotImage = "https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=1400&q=80";
  const lotSpots = appState.data.parkingSpots.filter((s) => s.parking_lot_id === lot.id && s.status === "available");
  const regularSpots = lotSpots.filter((s) => ["regular", "wide", "stroller", "vip"].includes(s.spot_type)).length;
  const disabledSpots = lotSpots.filter((s) => s.spot_type === "disabled").length;
  const electricSpots = lotSpots.filter((s) => s.spot_type === "ev_charging").length;
  const entries = [
    { name: t("primary_entry"), detail: lot.address, available: Math.max(1, Math.round(lot.available_spots * 0.65)) },
    { name: t("secondary_entry"), detail: `${Number(String(lot.address).match(/\d+/)?.[0] || 10) + 2} ${lot.city}`, available: Math.max(1, Math.round(lot.available_spots * 0.35)) },
  ];
  let inlineTimerBlock = "";
  if (inlineEligible && inlineState.mode === "reserved_here" && inlineState.reservation) {
    const remainSec = Math.max(0, secondsBetween(nowIso(), inlineState.reservation.grace_period_end));
    const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
    const ss = String(remainSec % 60).padStart(2, "0");
    const fee = Number(inlineState.reservation.hold_fee_amount || 10);
    inlineTimerBlock = `
      <div class="card lot-inline-timer lot-inline-timer-reserved">
        <div class="lot-inline-timer-title">${t("inline_reserved_title")}</div>
        <div id="inline-reserved-timer-time" class="lot-inline-time">${mm}:${ss}</div>
        <div id="inline-reserved-timer-cost" class="lot-inline-cost">${t("parking_hold_fee_label")}: ${money(fee).replace("ILS ", "₪")}</div>
        <div class="muted">${t("save_parking_emphasis")}</div>
      </div>
    `;
  } else if (inlineEligible && inlineState.mode === "active_here" && inlineState.session) {
    const start = inlineState.session.parking_start_time || inlineState.session.assignment_time;
    const durationSec = secondsBetween(start, nowIso());
    const hh = String(Math.floor(durationSec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((durationSec % 3600) / 60)).padStart(2, "0");
    const ss = String(durationSec % 60).padStart(2, "0");
    const est = estimateCost(inlineState.session, nowIso());
    inlineTimerBlock = `
      <div class="card lot-inline-timer lot-inline-timer-active">
        <div class="lot-inline-timer-title">${t("inline_active_title")}</div>
        <div id="inline-active-timer-time" class="lot-inline-time">${hh}:${mm}:${ss}</div>
        <div id="inline-active-timer-cost" class="lot-inline-cost">${t("estimated_cost")}: ${money(est.total)}</div>
      </div>
    `;
  } else if (inlineEligible && inlineState.mode === "blocked_other") {
    inlineTimerBlock = `<div class="card"><div class="muted">${t("parking_guard_other_lot_active")}</div></div>`;
  }

  const quickActions = isStructured
    ? `<div class="lot-quick-actions lot-quick-actions-2">
        <button class="btn lot-quick-btn" onclick="appActions.openReserveConfirm('${lot.id}')">
          <span class="lot-quick-icon">⏱</span>
          <span>${t("save_parking")}</span>
        </button>
        <button class="btn primary lot-quick-btn" onclick="appActions.startParkingAtLot('${lot.id}')">
          <span class="lot-quick-icon">${navIcon("parking")}</span>
          <span>${t("lpr_entry")}</span>
        </button>
      </div>`
    : `<div class="lot-quick-actions lot-quick-actions-${segment === "private_hourly" ? "3" : "2"}">
        ${
          segment === "private_hourly"
            ? `<button class="btn lot-quick-btn" ${inlineState.mode === "blocked_other" || inlineState.mode === "active_here" ? "disabled" : ""} onclick="${inlineState.mode === "reserved_here" ? "appActions.releaseReservedParking()" : `appActions.openReserveConfirm('${lot.id}')`}">
                <span class="lot-quick-icon">⏱</span>
                <span>${inlineState.mode === "reserved_here" ? t("release_reserved") : t("save_parking")}</span>
              </button>`
            : ""
        }
        <button class="btn lot-quick-btn" onclick="appActions.navigateToLot('${lot.id}')">
          <span class="lot-quick-icon">${navIcon("map")}</span>
          <span>${t("navigate")}</span>
        </button>
        <button class="btn primary lot-quick-btn" ${inlineState.mode === "blocked_other" ? "disabled" : ""} onclick="${inlineState.mode === "active_here" ? `appActions.endParkingInline('${lot.id}')` : `appActions.startParkingAtLot('${lot.id}')`}">
          <span class="lot-quick-icon">${navIcon("parking")}</span>
          <span>${inlineState.mode === "active_here" ? t("end_parking") : t("start_parking_manual")}</span>
        </button>
      </div>`;
  return `
    <div class="lot-hero" style="background-image:url('${genericLotImage}')">
      <div class="lot-hero-overlay">
        <button class="lot-fav-star ${isFavorite ? "active" : ""}" onclick="appActions.toggleFavoriteLot('${lot.id}')" aria-label="${isFavorite ? t("remove_favorite") : t("add_favorite")}">${isFavorite ? "★" : "☆"}</button>
        <span class="lot-hero-segment-badge ${segmentBadgeClass}">${segmentLabel}</span>
        <h2>${displayTitle}</h2>
        <div>${lot.address}, ${lot.city}</div>
      </div>
    </div>
    ${quickActions}
    ${inlineTimerBlock}
    ${
      isStructured
        ? `<div class="card">
      <h3>${t("available_spots")}</h3>
      <div class="lot-stats-grid">
        <div class="lot-stat-row"><span>${t("floor_regular")}</span><strong>${regularSpots}</strong></div>
        <div class="lot-stat-row"><span>${t("floor_disabled")}</span><strong>${disabledSpots}</strong></div>
        <div class="lot-stat-row"><span>${t("floor_electric")}</span><strong>${electricSpots}</strong></div>
      </div>
    </div>`
        : ""
    }
    <div class="card">
      <h3>${t("pricing")}</h3>
      <div class="lot-stats-grid">
        <div class="lot-stat-row"><span>${t("first_hour")}</span><strong>${money(lot.pricing.first_hour_rate).replace("ILS ", "₪")}</strong></div>
        <div class="lot-stat-row"><span>${t("every_15_minutes")}</span><strong>${money(Math.max(3, Math.round(lot.pricing.hourly_rate / 4))).replace("ILS ", "₪")}</strong></div>
        <div class="lot-stat-row"><span>${t("daily_max")}</span><strong class="lot-highlight">${money(lot.pricing.daily_max).replace("ILS ", "₪")}</strong></div>
      </div>
    </div>
    ${
      isStructured
        ? `<div class="card">
      <div class="row"><h3>${t("lot_entries")}</h3><span class="muted">${entries.length}</span></div>
      <div class="list">
        ${entries.map((e) => `
          <div class="item entry-card">
            <div class="row">
              <div>
                <strong>${e.name}</strong>
                <div class="muted">${e.detail}</div>
              </div>
              <span class="pill green">${e.available} ${t("available_spots")}</span>
            </div>
            <button class="btn primary entry-nav-btn" onclick="appActions.navigateToLot('${lot.id}')">${t("navigate")}</button>
          </div>
        `).join("")}
      </div>
    </div>`
        : ""
    }
  `;
}

function renderReservedParking() {
  checkTimeouts();
  const reservation = activeReservationHoldForUser();
  if (!reservation) {
    return `
      <div class="card">
        <h2>${t("reserved_parking")}</h2>
        <p class="muted">${t("destination_empty")}</p>
        <button class="btn" onclick="appActions.navigate('home')">${t("go_home")}</button>
      </div>
    `;
  }
  const lot = getLotById(reservation.parking_lot_id);
  const spot = appState.data.parkingSpots.find((s) => s.id === reservation.spot_id);
  const assignedCode = isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : compactSpotCode(spot);
  const remainSec = Math.max(0, secondsBetween(nowIso(), reservation.grace_period_end));
  const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
  const ss = String(remainSec % 60).padStart(2, "0");

  return `
    <div class="active-hero">
      <div class="active-hero-inner">
        <div class="active-hero-welcome">${t("reserved_parking")}</div>
        <div class="assigned-parking-label">${t("reserved_spot_label")}</div>
        <div class="assigned-spot-pill"><strong>${assignedCode}</strong></div>
      </div>
    </div>
    <div class="timer-sticky timer-under-hero">
      <div id="reserved-timer-time" class="timer-sticky-time">${mm}:${ss}</div>
      <div id="reserved-timer-cost" class="timer-sticky-cost">${t("reserved_timer")} • ${money(10)}</div>
    </div>
    <div style="margin-bottom:12px">
      <button class="btn primary" onclick="appActions.navigateToLot('${lot.id}')">${t("navigate")}</button>
    </div>
    <div class="card">
      <div class="row">
        <strong>${t("reserved_until")}</strong>
        <span class="muted">${fmt(reservation.grace_period_end)}</span>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" onclick="appActions.startParkingAtLot('${lot.id}')">${lot && lotSegmentType(lot) === "structured" ? t("simulate_entry") : t("start_parking_manual")}</button>
      </div>
      <div style="margin-top:12px">
        <button class="btn danger reserved-release-btn" onclick="appActions.releaseReservedParking()">${t("release_parking")}</button>
      </div>
    </div>
  `;
}

function renderActiveParking() {
  checkTimeouts();
  const uid = getCurrentUid();
  const session = activeSessionForUser();
  if (!session) {
    const activeReservation = appState.data.reservations.find((r) => r.user_id === uid && r.status === "confirmed");
    return `
      <div class="card">
        <h2>${t("active_parking")}</h2>
        <p class="muted">${t("no_active_session")}</p>
        ${
          activeReservation
            ? `<div class="item">
                <div><strong>${t("upcoming_reservation")}:</strong> ${activeReservation.id}</div>
                <div class="muted">${t("start")}: ${fmt(activeReservation.scheduled_start)}</div>
                <button class="btn primary" style="margin-top:8px" onclick="appActions.activateReservation('${activeReservation.id}')">${t("arrive_with_reservation")}</button>
              </div>`
            : ""
        }
        <button class="btn" onclick="appActions.navigate('home')">${t("go_home")}</button>
      </div>
    `;
  }

  const lot = getLotById(session.parking_lot_id);
  const isStructured = lotSegmentType(lot) === "structured";
  const spot = appState.data.parkingSpots.find((s) => s.id === session.spot_id);
  const assignedSpot = session.assigned_spot_code || (isSingleSpotSupplySegment(lot) ? getLotDisplayCode(lot) : compactSpotCode(spot));
  const start = session.parking_start_time || session.assignment_time;
  const durationSec = secondsBetween(start, nowIso());
  const hh = String(Math.floor(durationSec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((durationSec % 3600) / 60)).padStart(2, "0");
  const ss = String(durationSec % 60).padStart(2, "0");
  const est = estimateCost(session, nowIso());
  const steps = isStructured
    ? (Array.isArray(session.navigation_steps) && session.navigation_steps.length
        ? session.navigation_steps
        : [session.navigation_instructions || `${t("navigation")}`])
    : [];

  return `
    <div class="active-hero">
      <div class="active-hero-inner">
        <div class="active-hero-welcome">${t("welcome_title")}</div>
        <div class="assigned-parking-label">${t("your_parking_label")}</div>
        <div class="assigned-spot-pill"><strong>${assignedSpot || "N/A"}</strong></div>
      </div>
    </div>
    <div class="timer-sticky timer-under-hero">
      <div id="active-timer-time" class="timer-sticky-time">${hh}:${mm}:${ss}</div>
      <div id="active-timer-cost" class="timer-sticky-cost">${t("estimated_cost")}: ${money(est.total)}</div>
    </div>
    <div class="card">
      ${
        isStructured
          ? `<h3>${t("textual_navigation")}</h3>
      <div class="list">
        ${steps
          .map(
            (s, i) => `<div class="nav-step"><span class="nav-step-num">${i + 1}</span><span>${s}</span></div>`
          )
          .join("")}
      </div>`
          : ""
      }
      <div class="stack" style="margin-top:12px">
        <button class="btn warn" onclick="appActions.toggleIssueMenu()">${t("report_issue_quick")}</button>
        ${
          appState.issueMenuOpen
            ? `<div class="issue-options">
                <div class="muted">${t("choose_issue_type")}</div>
                <div class="muted issue-auto-note">${t("issue_auto_reassign_info")}</div>
                <div class="issue-options-grid">
                  <button class="btn" onclick="appActions.quickReportIssue('already_occupied')">${localizeIssueType("already_occupied")}</button>
                  <button class="btn" onclick="appActions.quickReportIssue('crooked_parking_by_other')">${localizeIssueType("crooked_parking_by_other")}</button>
                  <button class="btn" onclick="appActions.quickReportIssue('blocked')">${localizeIssueType("blocked")}</button>
                  <button class="btn" onclick="appActions.quickReportIssue('spot_too_small')">${localizeIssueType("spot_too_small")}</button>
                  <button class="btn" onclick="appActions.quickReportIssue('cant_find_spot')">${localizeIssueType("cant_find_spot")}</button>
                  <button class="btn" onclick="appActions.quickReportIssue('other')">${localizeIssueType("other")}</button>
                </div>
                <button class="btn" style="margin-top:8px" onclick="appActions.openSupportCall()">${t("call_support")}</button>
              </div>`
            : ""
        }
        <button class="btn danger" onclick="appActions.openReleaseConfirm()">${t("release_parking")}</button>
        <button class="btn primary" onclick="appActions.simulateExit()">${t("simulate_exit")}</button>
      </div>
    </div>
  `;
}

function renderVehicles() {
  const uid = getCurrentUid();
  const vehicles = appState.data.vehicles.filter((v) => v.owner_id === uid);
  return `
    <div class="card">
      <h2>${t("my_vehicles")}</h2>
      <div class="list">
        ${vehicles
          .map(
            (v) => `<div class="item">
              <div class="row">
                <div>
                  <strong>${vehicleDisplayName(v)}</strong>
                  <div class="muted">${vehicleColorLabel(v.color)} • ${v.license_plate} • ${localizeVehicleSize(v.vehicle_size)}</div>
                  <div class="muted">${v.is_electric ? t("electric") : t("fuel")} ${v.special_conditions.length ? `• ${v.special_conditions.map((c) => localizeStatus(c)).join(", ")}` : ""}</div>
                </div>
                <div>
                  ${v.is_default ? `<span class="pill green">${t("default_vehicle")}</span>` : `<button class="btn" onclick="appActions.setDefaultVehicle('${v.id}')">${t("set_default")}</button>`}
                </div>
              </div>
            </div>`
          )
          .join("")}
      </div>
    </div>
    <div class="card">
      <h3>${t("add_vehicle")}</h3>
      <form onsubmit="event.preventDefault(); appActions.addVehicle(this)">
        ${renderVehicleInputFields()}
        <div><button class="btn primary" type="submit">${t("add_vehicle")}</button></div>
      </form>
    </div>
  `;
}

function renderPayments() {
  const uid = getCurrentUid();
  const pays = appState.data.payments.filter((p) => p.user_id === uid);
  return `
    <div class="card">
      <h2>${t("payment_history")}</h2>
      <div class="list">
        ${
          pays.length
            ? pays
                .map((p) => {
                  const lot = getLotById(p.parking_lot_id);
                  const color = p.status === "completed" ? "green" : p.status === "failed" ? "red" : "yellow";
                  return `<div class="item">
                    <div class="row">
                      <div>
                        <strong>${lot?.name || p.parking_lot_id}</strong>
                        <div class="muted">${fmt(p.created_at)} • ${p.breakdown.duration_minutes} ${t("minutes_short")}</div>
                      </div>
                      <span class="pill ${color}">${localizeStatus(p.status)}</span>
                    </div>
                    <div class="row" style="margin-top:8px">
                      <div>${money(p.amount)} (${localizeStatus(p.payment_method)})</div>
                      <div>${p.is_debt ? `<span class="pill red">${t("debt")}</span>` : ""}</div>
                    </div>
                    ${
                      Array.isArray(p.breakdown?.extra_items) && p.breakdown.extra_items.length
                        ? `<div class="muted" style="margin-top:6px">${p.breakdown.extra_items.map((x) => `${x.label}: ${money(x.amount)}`).join(" • ")}</div>`
                        : ""
                    }
                  </div>`;
                })
                .join("")
            : `<div class="item muted">${t("no_payments")}</div>`
        }
      </div>
    </div>
  `;
}

function renderNotifications() {
  const uid = getCurrentUid();
  const notifications = appState.data.notifications.filter((n) => n.user_id === uid);
  return `
    <div class="page-topbar">
      <span></span>
      <h2>${t("notifications")}</h2>
      <button class="topbar-action" onclick="appActions.markAllRead()">${t("mark_all_read")}</button>
    </div>
    <div class="card">
      <div class="list">
        ${
          notifications.length
            ? notifications
                .map(
                  (n) => `<div class="item">
                  <div class="row">
                    <div>
                      <strong>${n.title}</strong> ${n.is_read ? "" : `<span class="pill blue">${t("new_badge")}</span>`}
                      <div class="muted">${n.message}</div>
                      <div class="muted">${fmt(n.created_at)} • ${n.type}</div>
                    </div>
                    ${n.is_read ? "" : `<button class="btn" onclick="appActions.markRead('${n.id}')">${t("read")}</button>`}
                  </div>
                </div>`
                )
                .join("")
            : `<div class="item muted">${t("no_notifications")}</div>`
        }
      </div>
    </div>
  `;
}

function renderPaymentSummary() {
  const pending = latestPendingPaymentForUser();
  if (!pending) {
    return `<div class="card"><h2>${t("payment_summary")}</h2><p class="muted">${t("no_pending_payment")}</p></div>`;
  }
  const session = appState.data.parkingSessions.find((s) => s.id === pending.session_id);
  const lot = getLotById(pending.parking_lot_id);
  const extraItems = Array.isArray(pending.breakdown?.extra_items) ? pending.breakdown.extra_items : [];
  return `
    <div class="card">
      <h2>${t("payment_summary")}</h2>
      <div class="item stack">
        <div><strong>${t("lot")}:</strong> ${lot?.name || pending.parking_lot_id}</div>
        <div><strong>${t("entry")}:</strong> ${fmt(session?.entry_time || pending.created_at)}</div>
        <div><strong>${t("exit")}:</strong> ${fmt(session?.exit_time || pending.created_at)}</div>
        <div><strong>${t("duration")}:</strong> ${pending.breakdown.duration_minutes} ${t("minutes_short")}</div>
      </div>
      <div class="item stack" style="margin-top:10px">
        <div>${t("base_rate")}: ${money(pending.breakdown.base_rate)}</div>
        <div>${t("extra_charges")}: ${money(pending.breakdown.extra_charges)}</div>
        ${
          extraItems.length
            ? `<div class="stack" style="margin-top:4px">
                ${extraItems.map((x) => `<div class="muted">• ${x.label}: ${money(x.amount)}</div>`).join("")}
              </div>`
            : ""
        }
        <div>${t("discounts")}: -${money(pending.breakdown.discounts)}</div>
        <hr style="border:none;border-top:1px solid var(--line);width:100%" />
        <div><strong>${t("total")}: ${money(pending.amount)}</strong></div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn" onclick="appActions.failPayment('${pending.id}')">${t("simulate_failure")}</button>
        <button class="btn primary" onclick="appActions.payNow('${pending.id}', 'credit_card')">${t("pay_now")}</button>
      </div>
    </div>
  `;
}

function renderReserveParking() {
  const uid = getCurrentUid();
  const reservations = appState.data.reservations.filter((r) => r.user_id === uid);
  return `
    <div class="card">
      <h2>${t("reserve_parking")}</h2>
      <form onsubmit="event.preventDefault(); appActions.createReservation(this)">
        <select name="parking_lot_id" required>
          <option value="">${t("select_lot")}</option>
          ${appState.data.parkingLots.map((l) => `<option value="${l.id}">${l.name}</option>`).join("")}
        </select>
        <input type="datetime-local" name="scheduled_start" required />
        <input type="datetime-local" name="scheduled_end" required />
        <select name="spot_type_requested">
          <option value="regular">${t("regular")}</option>
          <option value="disabled">${t("disabled")}</option>
          <option value="ev_charging">${t("ev_charging")}</option>
          <option value="wide">${t("wide")}</option>
          <option value="stroller">${t("stroller")}</option>
          <option value="vip">${t("vip")}</option>
        </select>
        <label><input type="checkbox" name="needs_charging" /> ${t("needs_charging")}</label>
        <div class="muted">${t("booking_fee")}: ${money(12)}</div>
        <div><button class="btn primary" type="submit">${t("reserve_prepay")}</button></div>
      </form>
    </div>
    <div class="card">
      <h3>${t("my_reservations")}</h3>
      <div class="list">
        ${
          reservations.length
            ? reservations
                .map((r) => {
                  const lot = getLotById(r.parking_lot_id);
                  const spot = appState.data.parkingSpots.find((s) => s.id === r.spot_id);
                  return `<div class="item">
                    <div class="row">
                      <div>
                        <strong>${lot?.name || r.parking_lot_id}</strong>
                        <div class="muted">${fmt(r.scheduled_start)} - ${fmt(r.scheduled_end)}</div>
                        <div class="muted">${t("spot")} ${spot?.spot_code || r.spot_id} • ${localizeStatus(r.status)}</div>
                      </div>
                      ${
                        r.status === "confirmed"
                          ? `<button class="btn primary" onclick="appActions.activateReservation('${r.id}')">${t("arrive")}</button>`
                          : ""
                      }
                    </div>
                  </div>`;
                })
                .join("")
            : `<div class="item muted">${t("no_reservations")}</div>`
        }
      </div>
    </div>
  `;
}

function renderProfileMenuContent() {
  if (appState.auth.status === "loading") {
    return `<div class="card"><div class="muted">${t("auth_loading")}</div></div>`;
  }
  if (appState.auth.status !== "signed_in" || !getCurrentUid()) {
    return `
      <div class="card auth-card">
        <h3>${t("auth_phone_title")}</h3>
        <p class="muted">${t("auth_phone_subtitle")}</p>
        ${
          appState.auth.step === "phone"
            ? `<form onsubmit="event.preventDefault(); appActions.sendAuthOtp(this)">
                <input name="phone" value="${appState.auth.phoneInput || ""}" oninput="appActions.setAuthPhoneInput(this.value)" placeholder="${t("auth_phone_placeholder")}" />
                <button class="btn primary" type="submit" ${appState.auth.loading ? "disabled" : ""}>${t("auth_send_code")}</button>
              </form>`
            : `<form onsubmit="event.preventDefault(); appActions.verifyAuthOtp(this)">
                <input name="otp" value="${appState.auth.otpInput || ""}" oninput="appActions.setAuthOtpInput(this.value)" placeholder="${t("auth_otp_placeholder")}" />
                <div class="row">
                  <button class="btn" type="button" onclick="appActions.resetAuthStep()">${t("auth_change_phone")}</button>
                  <button class="btn primary" type="submit" ${appState.auth.loading ? "disabled" : ""}>${t("auth_verify_code")}</button>
                </div>
              </form>`
        }
        ${appState.auth.error ? `<div class="muted auth-error">${appState.auth.error}</div>` : ""}
        ${appState.auth.info ? `<div class="muted auth-info">${appState.auth.info}</div>` : ""}
      </div>
    `;
  }
  const user = appState.data.users.find((u) => u.id === getCurrentUid());
  const fullName = user?.full_name || "Driver";
  const email = user?.email || "driver@example.com";
  const phone = appState.data.settings.profile_phone || "";
  const avatarUrl = String(appState.profileAvatarPreview || user?.avatar_url || "").trim();
  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const menuItems = [
    ["vehicle_management", "vehicles", "vehicles"],
    ["payment_methods", "payment-methods", "payments"],
    ["invoices", "invoices", "file"],
    ["subscriptions_benefits", "subscriptions", "wallet"],
    ["support", "support", "support"],
  ];
  return `
    ${
      !appState.onboarding.completed
        ? `<div class="card onboarding-alert">
            <button class="btn primary" onclick="appActions.openOnboarding()">${t("onboarding_complete_start")}</button>
          </div>`
        : ""
    }
    <div class="profile-user-card">
      <div class="profile-user-top">
        <div class="profile-avatar">${avatarUrl ? `<img src="${avatarUrl}" alt="${fullName}" />` : initials || "U"}</div>
        <div>
          <div class="profile-user-name">${fullName}</div>
          <div class="profile-user-meta">${email}</div>
          <div class="profile-user-meta">${phone}</div>
        </div>
      </div>
      <button class="btn primary profile-edit-btn" onclick="appActions.openProfileSection('personal')">${t("edit_personal_details")}</button>
    </div>
    <div class="profile-menu-list">
      ${menuItems
        .map(
          ([label, key, icon]) => `
            <button class="profile-menu-item" onclick="appActions.openProfileSection('${key}')">
              <span class="profile-menu-chevron">${navIcon("chevron")}</span>
              <span class="profile-menu-label">${t(label)}</span>
              <span class="profile-menu-icon">${navIcon(icon)}</span>
            </button>`
        )
        .join("")}
    </div>
    <div class="card">
      <button class="btn profile-signout-btn" onclick="appActions.signOutAuth()">${t("auth_signout")}</button>
    </div>
  `;
}

function profileSectionLabel(section) {
  const map = {
    onboarding: t("onboarding_title"),
    "vehicle-edit": t("edit_vehicle"),
    personal: t("personal_details"),
    vehicles: t("vehicle_management"),
    "payment-methods": t("payment_methods"),
    invoices: t("invoices"),
    subscriptions: t("subscriptions_benefits"),
    support: t("support"),
  };
  return map[section] || "";
}

function renderProfileFeedback() {
  const upload = appState.profileImageUpload || { status: "idle", progress: 0, message: "" };
  const save = appState.profileSaveFeedback || { status: "idle", message: "" };
  const showUpload = upload.status !== "idle";
  const showSave = save.status !== "idle";
  if (!showUpload && !showSave) return "";
  return `
    <div class="profile-feedback-stack">
      ${
        showUpload
          ? `
        <div class="profile-feedback-line ${upload.status}">
          <span>${upload.message || ""}</span>
          ${upload.status === "uploading" ? `<strong>${Math.round(Number(upload.progress) || 0)}%</strong>` : ""}
        </div>
        ${
          upload.status === "uploading"
            ? `<div class="profile-upload-progress"><span style="width:${Math.round(Number(upload.progress) || 0)}%"></span></div>`
            : ""
        }
      `
          : ""
      }
      ${showSave ? `<div class="profile-feedback-line ${save.status}">${save.message || ""}</div>` : ""}
    </div>
  `;
}

function renderOnboardingSection() {
  const uid = getCurrentUid();
  const user = appState.data.users.find((u) => u.id === uid) || {};
  const checklist = getOnboardingChecklist();
  const vehicles = appState.data.vehicles.filter((v) => v.owner_id === uid && v.is_active);
  const editingVehicle = appState.editVehicleId ? vehicles.find((v) => v.id === appState.editVehicleId) : null;
  const step = Number(appState.onboardingStep || 1);
  const avatarUrl = String(appState.profileAvatarPreview || user?.avatar_url || "").trim();
  const initials = String(user?.full_name || "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (step === 1) {
    return `
      <div class="card onboarding-card">
        <h3>${t("onboarding_title")}</h3>
        <p class="muted">${t("onboarding_step_personal")}</p>
        <form onsubmit="event.preventDefault(); appActions.saveOnboardingProfile(this)">
          <input id="onboarding-avatar-file" type="file" accept="image/*" class="hidden-file-input" onchange="appActions.setProfileImageFromInput(this)" />
          <button class="avatar-upload-square" type="button" onclick="appActions.triggerProfileImageUpload('onboarding-avatar-file')">
            ${avatarUrl ? `<img src="${avatarUrl}" alt="${user?.full_name || "profile"}" />` : `<span>${initials || "U"}</span>`}
          </button>
          ${renderProfileFeedback()}
          <input name="full_name" value="${user?.full_name || ""}" placeholder="${t("full_details")}" required />
          <input name="email" value="${user?.email || ""}" placeholder="email@example.com" required />
          <input name="phone" value="${appState.data.settings.profile_phone || ""}" placeholder="${t("onboarding_phone_locked")}" readonly />
          <label><strong>${t("language")}</strong></label>
          <select onchange="appActions.setLanguage(this.value)">
            <option value="en" ${getUiLanguage() === "en" ? "selected" : ""}>English</option>
            <option value="he" ${getUiLanguage() === "he" ? "selected" : ""}>עברית</option>
          </select>
          <button class="btn primary" type="submit">${t("onboarding_next")}</button>
        </form>
      </div>
    `;
  }
  return `
    <div class="card onboarding-card">
      <h3>${t("onboarding_title")}</h3>
      <p class="muted">${t("onboarding_step_vehicle")}</p>
      <div class="vehicle-select-list">
        ${
          vehicles.length
            ? vehicles
                .map(
                  (v) => `
          <button class="vehicle-select-card ${v.is_default ? "selected" : ""}" onclick="appActions.startEditVehicle('${v.id}', 'onboarding')">
            <span class="vehicle-select-check ${v.is_default ? "active" : ""}">✓</span>
            <div class="vehicle-select-main">
              <strong>${vehicleDisplayName(v)}</strong>
              <div>${v.license_plate}</div>
            </div>
            <span class="pill ${v.is_default ? "green" : "blue"}">${v.is_default ? t("default_vehicle") : t("set_default")}</span>
          </button>`
                )
                .join("")
            : `<div class="item muted">${t("onboarding_missing_vehicle")}</div>`
        }
      </div>
      <div class="add-vehicle-form-wrap onboarding-add-vehicle-wrap">
        <form onsubmit="event.preventDefault(); appActions.saveOnboardingVehicle(this)">
          ${renderVehicleInputFields(editingVehicle)}
          <button class="btn primary" type="submit">${editingVehicle ? t("save_vehicle_changes") : t("add_vehicle")}</button>
        </form>
      </div>
    </div>
    <div class="card onboarding-status-card">
      <div class="onboarding-status-line ${checklist.profileOk ? "done" : ""}">
        ${checklist.profileOk ? "✓" : "•"} ${checklist.profileOk ? t("onboarding_ready") : t("onboarding_missing_profile")}
      </div>
      <div class="onboarding-status-line ${checklist.vehicleOk ? "done" : ""}">
        ${checklist.vehicleOk ? "✓" : "•"} ${checklist.vehicleOk ? t("onboarding_ready") : t("onboarding_missing_vehicle")}
      </div>
      <button class="btn primary onboarding-complete-btn" ${checklist.canComplete ? "" : "disabled"} onclick="appActions.completeOnboarding()">
        ${t("onboarding_complete_start")}
      </button>
      <button class="btn" type="button" onclick="appActions.onboardingPrevStep()">${t("onboarding_back")}</button>
    </div>
  `;
}

function renderProfileSectionContent(sectionOverride = null) {
  const section = sectionOverride || appState.profileSection || "menu";
  const user = appState.data.users.find((u) => u.id === getCurrentUid());

  if (appState.auth.status !== "signed_in" || !getCurrentUid()) {
    return renderProfileMenuContent();
  }

  if (section === "onboarding") {
    return renderOnboardingSection();
  }

  if (section === "personal") {
    const avatarUrl = String(appState.profileAvatarPreview || user?.avatar_url || "").trim();
    const initials = String(user?.full_name || "U")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    return `
      <div class="card">
        <form onsubmit="event.preventDefault(); appActions.savePersonalDetails(this)">
          <input id="profile-avatar-file" type="file" accept="image/*" class="hidden-file-input" onchange="appActions.setProfileImageFromInput(this)" />
          <button class="avatar-upload-square" type="button" onclick="appActions.triggerProfileImageUpload('profile-avatar-file')">
            ${avatarUrl ? `<img src="${avatarUrl}" alt="${user?.full_name || "profile"}" />` : `<span>${initials || "U"}</span>`}
          </button>
          ${renderProfileFeedback()}
          <label>${t("full_details")}</label>
          <input name="full_name" value="${user?.full_name || ""}" required />
          <input name="email" value="${user?.email || ""}" placeholder="email@example.com" required />
          <input name="phone" value="${appState.data.settings.profile_phone || ""}" placeholder="${t("phone")}" readonly />
          <label><strong>${t("language")}</strong></label>
          <select onchange="appActions.setLanguage(this.value)">
            <option value="en" ${getUiLanguage() === "en" ? "selected" : ""}>English</option>
            <option value="he" ${getUiLanguage() === "he" ? "selected" : ""}>עברית</option>
          </select>
          <button class="btn primary" type="submit">${t("save")}</button>
        </form>
      </div>
    `;
  }

  if (section === "vehicle-edit") {
    const uid = getCurrentUid();
    const vehicle = appState.data.vehicles.find((v) => v.id === appState.editVehicleId && v.owner_id === uid && v.is_active);
    if (!vehicle) {
      appState.profileSection = appState.editVehicleReturnSection || "vehicles";
      return renderProfileSectionContent(appState.profileSection);
    }
    return `
      <div class="card">
        <h3>${t("edit_vehicle")}</h3>
        <form onsubmit="event.preventDefault(); appActions.addVehicle(this, { keepSection: appState.editVehicleReturnSection || 'vehicles' })">
          ${renderVehicleInputFields(vehicle)}
          <div><button class="btn primary" type="submit">${t("save_vehicle_changes")}</button></div>
        </form>
      </div>
    `;
  }

  if (section === "vehicles") {
    const uid = getCurrentUid();
    const vehicles = appState.data.vehicles.filter((v) => v.owner_id === uid && v.is_active);
    const editingVehicle = appState.editVehicleId ? vehicles.find((v) => v.id === appState.editVehicleId) : null;
    const kind = (v) => {
      if (v.is_electric) return t("electric_car");
      if (v.vehicle_size === "small") return t("hatchback");
      if (v.vehicle_size === "large" || v.vehicle_size === "extra_large") return t("suv");
      return t("sedan");
    };
    return `
      <div class="vehicle-management-head">
        <h3>${t("choose_vehicle_title")}</h3>
        <div class="muted">${t("choose_vehicle_subtitle")}</div>
      </div>
      <div class="vehicle-select-list">
        ${vehicles
          .map(
            (v) => `
            <button class="vehicle-select-card ${v.is_default ? "selected" : ""}" onclick="appActions.startEditVehicle('${v.id}', 'vehicles')">
              <span class="vehicle-select-check ${v.is_default ? "active" : ""}">✓</span>
              <div class="vehicle-select-main">
                <strong>${vehicleDisplayName(v)}</strong>
                <div>${v.license_plate}</div>
                <div class="muted">${vehicleColorLabel(v.color)} • ${kind(v)}</div>
              </div>
              <span class="pill ${v.is_default ? "green" : "blue"}">${v.is_default ? t("default_vehicle") : t("set_default")}</span>
            </button>`
          )
          .join("")}
      </div>
      <div class="add-vehicle-card">
        <button class="add-vehicle-toggle" onclick="appActions.toggleAddVehicleForm()">
          <span>${t("add_new_vehicle_card")}</span>
          <span>${appState.addVehicleExpanded ? "▾" : "▸"}</span>
        </button>
        ${
          appState.addVehicleExpanded
            ? `<div class="add-vehicle-form-wrap">
                <form onsubmit="event.preventDefault(); appActions.addVehicle(this); appActions.toggleAddVehicleForm();">
                  ${renderVehicleInputFields(editingVehicle)}
                  <div><button class="btn primary" type="submit">${editingVehicle ? t("save_vehicle_changes") : t("add_vehicle")}</button></div>
                  ${editingVehicle ? `<div><button class="btn" type="button" onclick="appActions.cancelEditVehicle()">${t("cancel_edit")}</button></div>` : ""}
                </form>
              </div>`
            : ""
        }
      </div>
    `;
  }

  if (section === "payment-methods") {
    return `
      <div class="card">
        <h3>${t("payment_methods")}</h3>
        <div class="item">${t("no_payment_methods")}</div>
        <button class="btn primary" style="margin-top:10px">${t("add_payment_method")}</button>
      </div>
    `;
  }

  if (section === "invoices") {
    return `
      ${renderPayments()}
    `;
  }

  if (section === "subscriptions") {
    return `
      <div class="card">
        <h3>${t("subscriptions_benefits")}</h3>
        <div class="item muted">${t("no_subscriptions")}</div>
      </div>
    `;
  }

  if (section === "support") {
    return `
      <div class="card">
        <h3>${t("support")}</h3>
        <div class="item">support@spacely.app</div>
      </div>
    `;
  }

  return renderProfileMenuContent();
}

function renderProfile() {
  if (appState.auth.status !== "signed_in" || !getCurrentUid()) {
    return `
      <div class="profile-breadcrumb">
        <span></span>
        <h2>${t("my_profile")}</h2>
        <span></span>
      </div>
      ${renderProfileMenuContent()}
    `;
  }
  const forceOnboarding = !appState.onboarding.completed && (!appState.profileSection || appState.profileSection === "menu");
  const section = forceOnboarding ? "onboarding" : appState.profileSection;
  const isMenu = section === "menu";
  const crumb = isMenu
    ? t("my_profile")
    : `${t("my_profile")} > ${profileSectionLabel(section)}`;
  return `
    <div class="profile-breadcrumb">
      ${
        isMenu ? `<span></span>` : `<button class="btn icon-only" onclick="appActions.backProfileMenu()" aria-label="${t("back_to_profile")}">←</button>`
      }
      <h2>${crumb}</h2>
      <span></span>
    </div>
    ${section === "menu" ? renderProfileMenuContent() : renderProfileSectionContent(section)}
  `;
}

function renderDriverSheet() {
  const sheet = appState.activeSheet;
  if (!sheet) return "";

  if (sheet === "notifications") {
    const uid = getCurrentUid();
    const notifications = appState.data.notifications.filter((n) => n.user_id === uid);
    return `
      <div class="modal-backdrop" onclick="appActions.closeSheet()">
        <div class="modal-card sheet-card" onclick="event.stopPropagation()">
          <div class="sheet-handle" onclick="appActions.closeSheet()"></div>
          <div class="sheet-head">
            <h2>${t("notifications")}</h2>
            <button class="btn" onclick="appActions.closeSheet()">${t("close")}</button>
          </div>
          <div class="muted sheet-hint">${t("drag_to_close")}</div>
          <div class="list sheet-scroll">
            ${
              notifications.length
                ? notifications
                    .map(
                      (n) => `<div class="item">
                        <div class="row">
                          <div>
                            <strong>${n.title}</strong> ${n.is_read ? "" : `<span class="pill blue">${t("new_badge")}</span>`}
                            <div class="muted">${n.message}</div>
                            <div class="muted">${fmt(n.created_at)}</div>
                          </div>
                          ${n.is_read ? "" : `<button class="btn" onclick="appActions.markRead('${n.id}')">${t("read")}</button>`}
                        </div>
                      </div>`
                    )
                    .join("")
                : `<div class="item muted">${t("no_notifications")}</div>`
            }
          </div>
          <div class="row" style="margin-top:12px">
            <button class="btn" onclick="appActions.markAllRead()">${t("mark_all_read")}</button>
          </div>
        </div>
      </div>
    `;
  }

  if (sheet === "profile") {
    const title =
      appState.profileSection === "menu"
        ? t("my_profile")
        : appState.profileSection === "vehicles"
          ? t("choose_vehicle_title")
          : t("personal_area");
    return `
      <div class="modal-backdrop" onclick="appActions.closeSheet()">
        <div class="modal-card sheet-card" onclick="event.stopPropagation()">
          <div class="sheet-handle" onclick="appActions.closeSheet()"></div>
          <div class="sheet-head">
            <h2>${title}</h2>
            <button class="btn icon-only" onclick="appActions.closeSheet()">✕</button>
          </div>
          <div class="muted sheet-hint">${t("drag_to_close")}</div>
          <div class="sheet-scroll">
            ${renderProfile()}
          </div>
        </div>
      </div>
    `;
  }

  if (sheet === "lot-details" && appState.lotModalId) {
    const lot = getLotById(appState.lotModalId);
    if (!lot) return "";
    return `
      <div id="lot-sheet-backdrop" class="modal-backdrop lot-sheet-backdrop" onclick="appActions.closeLotModal()">
        <div id="lot-details-sheet" class="modal-card sheet-card lot-details-sheet" onclick="event.stopPropagation()" onpointerdown="appActions.startLotSheetDrag(event, true)">
          <div class="sheet-handle lot-sheet-drag-handle" onpointerdown="appActions.startLotSheetDrag(event)"></div>
          <div class="sheet-scroll">
            ${renderLotDetails()}
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

function renderReleaseConfirmModal() {
  if (!appState.releaseConfirmOpen) return "";
  return `
    <div class="modal-backdrop" onclick="appActions.closeReleaseConfirm()">
      <div class="modal-card release-confirm-card" onclick="event.stopPropagation()">
        <h3>${t("release_confirm_title")}</h3>
        <p>${t("release_confirm_text")}</p>
        <p class="release-emphasis">${t("release_confirm_emphasis")}</p>
        <div class="row" style="margin-top:10px">
          <button class="btn" onclick="appActions.closeReleaseConfirm()">${t("cancel")}</button>
          <button class="btn danger" onclick="appActions.confirmReleaseParking()">${t("confirm_release")}</button>
        </div>
      </div>
    </div>
  `;
}

function renderReserveConfirmModal() {
  if (!appState.reserveConfirmOpen) return "";
  return `
    <div class="modal-backdrop" onclick="appActions.closeReserveConfirm()">
      <div class="modal-card release-confirm-card" onclick="event.stopPropagation()">
        <h3>${t("save_parking_title")}</h3>
        <p>${t("save_parking_text")}</p>
        <p class="release-emphasis">${t("save_parking_emphasis")}</p>
        <div class="row" style="margin-top:10px">
          <button class="btn" onclick="appActions.closeReserveConfirm()">${t("cancel")}</button>
          <button class="btn primary" onclick="appActions.confirmSaveParking()">${t("confirm_save_parking")}</button>
        </div>
      </div>
    </div>
  `;
}

function renderAdminDashboard() {
  const activeSessions = appState.data.parkingSessions.filter((s) => ["active", "assigned"].includes(s.status)).length;
  const openIssues = appState.data.issueReports.filter((i) => ["new", "in_progress"].includes(i.status)).length;
  const dailyRevenue = appState.data.payments
    .filter((p) => p.status === "completed" && new Date(p.created_at).toDateString() === new Date().toDateString())
    .reduce((sum, x) => sum + x.amount, 0);
  const occRate = Math.round(
    ((appState.data.parkingSpots.length - appState.data.parkingSpots.filter((s) => s.status === "available").length) /
      Math.max(1, appState.data.parkingSpots.length)) *
      100
  );

  return `
    <div class="grid-2">
      <div class="card kpi"><div class="muted">${t("overall_occupancy")}</div><div class="value">${occRate}%</div></div>
      <div class="card kpi"><div class="muted">${t("active_sessions")}</div><div class="value">${activeSessions}</div></div>
      <div class="card kpi"><div class="muted">${t("open_issues")}</div><div class="value">${openIssues}</div></div>
      <div class="card kpi"><div class="muted">${t("daily_revenue")}</div><div class="value">${money(dailyRevenue)}</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>${t("nav_parking_lots")}</h3>
        <div class="list">
          ${appState.data.parkingLots
            .map((l) => `<div class="item row"><span>${l.name}</span><span class="pill ${lotColor(l.available_spots)}">${l.available_spots}/${l.total_spots}</span></div>`)
            .join("")}
        </div>
      </div>
      <div class="card">
        <h3>${t("recent_audit_logs")}</h3>
        <div class="list">
          ${appState.data.auditLogs
            .slice(0, 8)
            .map((a) => `<div class="item"><strong>${a.action_type}</strong><div class="muted">${fmt(a.created_at)}</div></div>`)
            .join("") || `<div class="item muted">${t("no_logs")}</div>`}
        </div>
      </div>
    </div>
  `;
}

function renderAdminLots() {
  return `
    <div class="card">
      <h2>${t("nav_parking_lots")}</h2>
      <div class="list">
        ${appState.data.parkingLots
          .map(
            (l) => `<div class="item">
            <div class="row">
              <div>
                <strong>${l.name}</strong>
                <div class="muted">${l.address}, ${l.city}</div>
                <div class="muted">${l.available_spots}/${l.total_spots} ${t("available_spots")}</div>
              </div>
              <div>
                <select onchange="appActions.adminLotStatus('${l.id}', this.value)">
                  ${["active", "maintenance", "closed"].map((s) => `<option ${l.status === s ? "selected" : ""} value="${s}">${localizeStatus(s)}</option>`).join("")}
                </select>
              </div>
            </div>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderAdminMap() {
  const lotId = appState.selectedLotId;
  const floorId = appState.selectedFloorId;
  const floors = appState.data.floors.filter((f) => f.parking_lot_id === lotId);
  const spots = appState.data.parkingSpots.filter((s) => s.floor_id === floorId);

  return `
    <div class="card">
      <h2>${t("admin_parking_map")}</h2>
      <div class="row" style="margin-bottom:10px">
        <select onchange="appState.selectedLotId=this.value;appState.selectedFloorId=appState.data.floors.find(f=>f.parking_lot_id===this.value)?.id||appState.selectedFloorId;render();">
          ${appState.data.parkingLots.map((l) => `<option ${l.id === lotId ? "selected" : ""} value="${l.id}">${l.name}</option>`).join("")}
        </select>
        <select onchange="appState.selectedFloorId=this.value;render();">
          ${floors.map((f) => `<option ${f.id === floorId ? "selected" : ""} value="${f.id}">${f.floor_name}</option>`).join("")}
        </select>
      </div>
      <div class="floor-map">
        ${spots
          .map(
            (s) => `<div class="spot ${s.status}" title="${localizeSpotType(s.spot_type)}" onclick="const ns=prompt('${t("prompt_spot_status")} ${s.spot_code}: available/assigned/occupied/reserved_future/reserved_active/unavailable/under_review', '${s.status}'); if(ns) appActions.adminChangeSpotStatus('${s.id}', ns)">${s.spot_code}</div>`
          )
          .join("")}
      </div>
      <div class="muted" style="margin-top:10px">${t("legend")}: ${localizeStatus("available")}, ${localizeStatus("assigned")}, ${localizeStatus("occupied")}, ${localizeStatus("reserved_active")}, ${localizeStatus("unavailable")}, ${localizeStatus("under_review")}</div>
    </div>
  `;
}

function renderAdminIssues() {
  const allIssues = appState.data.issueReports;
  const issues =
    appState.adminIssueFilter === "urgent"
      ? allIssues.filter((i) => issueNeedsImmediateFilter(i.issue_type))
      : allIssues;
  return `
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <h2>${t("issue_reports")}</h2>
        <select onchange="appActions.setAdminIssueFilter(this.value)">
          <option value="all" ${appState.adminIssueFilter === "all" ? "selected" : ""}>${t("admin_issue_filter_all")}</option>
          <option value="urgent" ${appState.adminIssueFilter === "urgent" ? "selected" : ""}>${t("admin_issue_filter_urgent")}</option>
        </select>
      </div>
      <div class="list">
        ${
          issues.length
            ? issues
                .map((i) => {
                  const lot = getLotById(i.parking_lot_id);
                  return `<div class="item">
                    <div class="row">
                      <div>
                        <strong>${localizeIssueType(i.issue_type)}</strong> <span class="pill ${i.priority === "high" ? "red" : i.priority === "medium" ? "yellow" : "gray"}">${localizeStatus(i.priority)}</span>
                        <div class="muted">${lot?.name || i.parking_lot_id} • ${t("spot")} ${appState.data.parkingSpots.find((s) => s.id === i.spot_id)?.spot_code || i.spot_id}</div>
                        <div>${i.description}</div>
                        <div class="muted">${t("issue_resolution_action")}: ${localizeIssueResolutionAction(i.resolution_action)}</div>
                        <div class="muted">${t("response_time_ms")}: ${i.response_time_ms ?? "—"}</div>
                        <div class="muted">${i.photos.length ? `${t("photos")}: ${i.photos.join(", ")}` : t("no_photos")}</div>
                      </div>
                      <div>
                        <select onchange="appActions.adminSetIssueStatus('${i.id}', this.value)">
                          ${["new", "in_progress", "resolved", "rejected"].map((s) => `<option ${i.status === s ? "selected" : ""} value="${s}">${localizeStatus(s)}</option>`).join("")}
                        </select>
                      </div>
                    </div>
                  </div>`;
                })
                .join("")
            : `<div class="item muted">${t("no_issues")}</div>`
        }
      </div>
    </div>
  `;
}

function renderAdminUsers() {
  return `
    <div class="card">
      <h2>${t("users")}</h2>
      <div class="list">
        ${appState.data.users
          .map(
            (u) => `<div class="item row">
            <div>
              <strong>${u.full_name}</strong>
              <div class="muted">${u.email}</div>
            </div>
            <select onchange="appActions.adminUserRole('${u.id}', this.value)">
              ${["admin", "user"].map((r) => `<option ${u.role === r ? "selected" : ""} value="${r}">${localizeStatus(r)}</option>`).join("")}
            </select>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderAdminAudit() {
  return `
    <div class="card">
      <h2>${t("audit_log")}</h2>
      <div class="list">
        ${
          appState.data.auditLogs.length
            ? appState.data.auditLogs
                .map(
                  (a) => `<div class="item">
                  <div><strong>${a.action_type}</strong> ${t("by")} ${localizeStatus(a.actor_type)}</div>
                  <div class="muted">${t("target")}: ${a.target_type} ${a.target_id}</div>
                  <div class="muted">${fmt(a.created_at)}</div>
                </div>`
                )
                .join("")
            : `<div class="item muted">${t("no_audit_events")}</div>`
        }
      </div>
    </div>
  `;
}

function renderAdminSettings() {
  const s = appState.data.settings;
  return `
    <div class="card">
      <h2>${t("system_settings")}</h2>
      <form onsubmit="event.preventDefault(); appActions.updateSettings(this)">
        <h3>${t("default_pricing")}</h3>
        <input type="number" name="hourly_rate" value="${s.default_pricing.hourly_rate}" required />
        <input type="number" name="daily_max" value="${s.default_pricing.daily_max}" required />
        <input type="number" name="first_hour_rate" value="${s.default_pricing.first_hour_rate}" required />
        <h3>${t("timeout_settings")}</h3>
        <input type="number" name="assignment_timeout_minutes" value="${s.assignment_timeout_minutes}" required />
        <input type="number" name="reservation_grace_minutes" value="${s.reservation_grace_minutes}" required />
        <div><button class="btn primary" type="submit">${t("save_settings")}</button></div>
      </form>
    </div>
  `;
}

function renderAdminEditFloor() {
  return `
    <div class="card">
      <h2>${t("edit_floor_layout")}</h2>
      <form onsubmit="event.preventDefault(); appActions.addSpot(this)">
        <select name="floor_id" required>
          ${appState.data.floors.map((f) => `<option value="${f.id}">${getLotById(f.parking_lot_id)?.name} - ${f.floor_name}</option>`).join("")}
        </select>
        <input name="row_letter" placeholder="${t("row_letter")}" maxlength="1" required />
        <input name="spot_number" type="number" placeholder="${t("spot_number")}" required />
        <select name="spot_type" required>
          <option value="regular">${t("regular")}</option>
          <option value="disabled">${t("disabled")}</option>
          <option value="ev_charging">${t("ev_charging")}</option>
          <option value="wide">${t("wide")}</option>
          <option value="stroller">${t("stroller")}</option>
          <option value="vip">${t("vip")}</option>
        </select>
        <div><button class="btn primary" type="submit">${t("add_spot")}</button></div>
      </form>
    </div>
  `;
}

function renderDriverContent() {
  switch (appState.page) {
    case "home":
      return activeSessionForUser() ? renderActiveParking() : renderHome();
    case "reserved-parking":
      if (activeSessionForUser()) return renderActiveParking();
      if (activeReservationHoldForUser()) {
        const ctx = activeParkingContextForUser();
        if (ctx && ["private_hourly", "municipal_blue_white"].includes(ctx.segment)) {
          appState.selectedLotId = ctx.lotId;
          appState.page = "parking-lot-details";
          return renderLotDetails();
        }
      }
      return renderReservedParking();
    case "parking-lot-details":
      return renderLotDetails();
    case "active-parking":
      if (activeSessionForUser()) {
        const ctx = activeParkingContextForUser();
        if (ctx && ["private_hourly", "municipal_blue_white"].includes(ctx.segment)) {
          appState.selectedLotId = ctx.lotId;
          appState.page = "parking-lot-details";
          return renderLotDetails();
        }
      }
      return activeSessionForUser() ? renderActiveParking() : renderHome();
    case "notifications":
      return renderNotifications();
    case "favorites":
      return renderFavorites();
    case "payment-summary":
      return renderPaymentSummary();
    case "profile":
      return renderProfile();
    default:
      return activeSessionForUser() ? renderActiveParking() : renderHome();
  }
}

function renderAdminContent() {
  switch (appState.adminPage) {
    case "dashboard":
      return renderAdminDashboard();
    case "parking-lots":
      return renderAdminLots();
    case "parking-map":
      return renderAdminMap();
    case "issues":
      return renderAdminIssues();
    case "users":
      return renderAdminUsers();
    case "audit-log":
      return renderAdminAudit();
    case "settings":
      return renderAdminSettings();
    case "edit-floor":
      return renderAdminEditFloor();
    default:
      return renderAdminDashboard();
  }
}

function buildGoogleMarkerIcon(color, scale = 17, opts = {}) {
  if (!window.google?.maps?.SymbolPath) return undefined;
  return {
    path: window.google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: Number.isFinite(opts.fillOpacity) ? opts.fillOpacity : 1,
    strokeColor: opts.strokeColor || "#ffffff",
    strokeWeight: Number.isFinite(opts.strokeWeight) ? opts.strokeWeight : 2,
    scale,
  };
}

function renderLeafletMap(mapEl, mapCenter, zoom, visibleLots) {
  const isHomeUnified = appState.mode === "driver" && appState.page === "home";
  mapProvider = "leaflet";
  mapInstance = L.map(mapEl).setView([mapCenter.lat, mapCenter.lng], zoom);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  }).addTo(mapInstance);

  const clusterLayer =
    typeof L.markerClusterGroup === "function"
      ? L.markerClusterGroup({
          iconCreateFunction(cluster) {
            const totalSpots = cluster.getAllChildMarkers().reduce((sum, marker) => sum + (marker.options.availableSpots || 0), 0);
            return L.divIcon({
              html: `<div class="cluster-pin">${totalSpots}</div>`,
              className: "lot-cluster",
              iconSize: [46, 46],
              iconAnchor: [23, 23],
            });
          },
        })
      : L.layerGroup();
  visibleLots.forEach((lot) => {
    const spotsForPin = lot.__pred?.predicted_available_spots ?? lot.available_spots;
    const segmentMeta = segmentStyle(lotSegmentType(lot));
    const isActive = isHomeUnified && appState.homeSelectedLotId === lot.id;
    const icon = L.divIcon({
      html: `<div class="lot-pin ${segmentMeta.leafletClass} ${isActive ? "selected" : ""}">${spotsForPin}</div>`,
      className: "lot-pin-wrap",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    const marker = L.marker([lot.location.lat, lot.location.lng], {
      icon,
      availableSpots: spotsForPin,
    });
    marker.bindPopup(`<strong>${lot.name}</strong><br/>${spotsForPin} ${t("predicted_available")}`);
    marker.on("click", () => {
      if (isHomeUnified) {
        appActions.focusHomeLot(lot.id, true, false);
      } else {
        appActions.selectLot(lot.id);
      }
    });
    clusterLayer.addLayer(marker);
  });
  mapInstance.addLayer(clusterLayer);

  if (appState.userLocation && !appState.plannedDestination) {
    userLocationMarker = L.circleMarker([appState.userLocation.lat, appState.userLocation.lng], {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: "#3b82f6",
      fillOpacity: 1,
    }).addTo(mapInstance);
    userLocationMarker.bindPopup(t("locating"));
  }

  if (isInIsraelBounds(appState.plannedDestination)) {
    const destinationMarker = L.marker([appState.plannedDestination.lat, appState.plannedDestination.lng]).addTo(mapInstance);
    destinationMarker.bindPopup(appState.plannedDestination.name || t("destination_placeholder"));
  }
}

function renderGoogleMap(mapEl, mapCenter, zoom, visibleLots) {
  const isHomeUnified = appState.mode === "driver" && appState.page === "home";
  mapProvider = "google";
  mapInstance = new window.google.maps.Map(mapEl, {
    center: { lat: mapCenter.lat, lng: mapCenter.lng },
    zoom,
    gestureHandling: "greedy",
    disableDefaultUI: true,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });
  googleMarkers = [];
  const clusterCandidates = [];
  visibleLots.forEach((lot) => {
    const spotsForPin = lot.__pred?.predicted_available_spots ?? lot.available_spots;
    const segmentMeta = segmentStyle(lotSegmentType(lot));
    const fillColor = segmentMeta.googleColor;
    const isActive = isHomeUnified && appState.homeSelectedLotId === lot.id;
    const marker = new window.google.maps.Marker({
      position: { lat: lot.location.lat, lng: lot.location.lng },
      icon: buildGoogleMarkerIcon(isActive ? "#2563eb" : fillColor, isActive ? 22 : 17),
      label: {
        text: String(spotsForPin),
        color: "#ffffff",
        fontSize: isActive ? "13px" : "12px",
        fontWeight: "700",
      },
      title: `${lot.name} • ${spotsForPin}`,
      zIndex: isActive ? 2000 : 1000,
    });
    marker.__lotId = lot.id;
    marker.__fillColor = fillColor;
    marker.__spots = spotsForPin;
    marker.__segmentType = lotSegmentType(lot);
    marker.addListener("click", () => {
      if (isHomeUnified) {
        appActions.focusHomeLot(lot.id, true, false);
      } else {
        appActions.selectLot(lot.id);
      }
    });
    googleMarkers.push(marker);
    clusterCandidates.push(marker);
  });

  const ClustererCtor = window.markerClusterer?.MarkerClusterer || window.MarkerClusterer || null;
  if (ClustererCtor && clusterCandidates.length > 1) {
    googleClusterer = new ClustererCtor({
      map: mapInstance,
      markers: clusterCandidates,
      renderer: {
        render({ position, markers }) {
          const totalSpots = markers.reduce((sum, m) => sum + Number(m.__spots || 0), 0);
          const firstType = markers[0]?.__segmentType || "structured";
          const fillColor = segmentStyle(firstType).googleColor;
          return new window.google.maps.Marker({
            position,
            icon: buildGoogleMarkerIcon(fillColor, 24),
            label: {
              text: String(totalSpots),
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: "700",
            },
            zIndex: 3000 + totalSpots,
          });
        },
      },
    });
  } else {
    clusterCandidates.forEach((m) => m.setMap(mapInstance));
  }

  if (appState.userLocation && !appState.plannedDestination) {
    googleUserMarker = new window.google.maps.Marker({
      map: mapInstance,
      position: { lat: appState.userLocation.lat, lng: appState.userLocation.lng },
      icon: buildGoogleMarkerIcon("#2563eb", 9),
      title: t("current_location_token"),
    });
  }

  if (isInIsraelBounds(appState.plannedDestination)) {
    googleDestinationMarker = new window.google.maps.Marker({
      map: mapInstance,
      position: { lat: appState.plannedDestination.lat, lng: appState.plannedDestination.lng },
      title: appState.plannedDestination.name || t("destination_placeholder"),
    });
  }
  updateGoogleHomeMarkerSelection();
}

async function initMapIfNeeded() {
  const seq = ++mapInitSeq;
  const mapEl = document.getElementById("map");
  if (!mapEl) {
    resetMapInstance();
    return;
  }
  resetMapInstance();

  const isHomePage = appState.mode === "driver" && appState.page === "home";
  if (isHomePage) syncHomeCarouselSelection();
  const visibleLots = isHomePage ? getMapDisplayLots() : appState.data.parkingLots.filter((lot) => lot.status === "active" && lot.available_spots > 0);
  const firstLot = visibleLots[0] || appState.data.parkingLots[0];
  const anchor = getHomeAnchorPoint();
  const preserved = isHomePage && homeViewportSnapshot ? homeViewportSnapshot : null;
  const mapCenter = preserved || (isHomePage ? anchor : appState.userLocation || firstLot?.location || { lat: 32.087, lng: 34.78 });
  let finalZoom = preserved
    ? Math.max(11, Math.min(18, Number(preserved.zoom || 13)))
    : isHomePage
      ? appState.plannedDestination
        ? 17
        : 13
      : appState.userLocation
        ? 13
        : 11;
  if (isHomePage && isInIsraelBounds(appState.plannedDestination)) finalZoom = Math.max(14, finalZoom);
  homeViewportSnapshot = null;

  const googleReady = await loadGoogleMapsScript();
  if (seq !== mapInitSeq) return;

  if (googleReady && window.google?.maps) {
    renderGoogleMap(mapEl, mapCenter, finalZoom, visibleLots);
    bindGoogleAutocompleteInput();
    return;
  }
  renderLeafletMap(mapEl, mapCenter, finalZoom, visibleLots);
}

function ensureDriverRealtimeSync() {
  if (availabilityUnsubscribe) return;
  availabilityUnsubscribe = driverDataService.subscribeAvailability((event) => {
    if (appState.mode !== "driver") return;
    // Keep home map fully stable: avoid periodic full re-renders from mock realtime ticks.
    if (appState.page === "home") return;
    if (appState.page === "parking-lot-details" && appState.selectedLotId === event.lot_id) {
      render();
    }
  });
}

function render() {
  const preserveScroll =
    appState.mode === "driver" &&
    (appState.page === "active-parking" || appState.page === "reserved-parking" || Boolean(activeSessionForUser()));
  const pageTransitionClass = preserveScroll ? "" : "page-transition";
  normalizeSpots();
  const lang = getUiLanguage();
  const theme = getUiTheme();
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  document.body.setAttribute("data-theme", theme);
  document.body.classList.toggle("sheet-open", appState.mode === "driver" && appState.activeSheet === "lot-details");
  appState.homeLocationMode = appState.userLocation ? "current" : "address";
  if (
    appState.mode === "driver" &&
    appState.page === "home" &&
    !appState.plannedDestination &&
    !appState.userLocation &&
    !appState.locationRequested &&
    !appState.locationError
  ) {
    setTimeout(() => appActions.locateUser(), 0);
  }
  if (
    appState.mode === "driver" &&
    appState.page === "home" &&
    !appState.homeSearchIntroDone &&
    !appState.homeSearchIntroScheduled
  ) {
    appState.homeSearchIntroScheduled = true;
    setTimeout(() => {
      appState.homeSearchIntroDone = true;
      appState.homeSearchIntroScheduled = false;
      if (appState.mode === "driver" && appState.page === "home") render();
    }, 1700);
  }
  const app = document.getElementById("app");
  ensureDriverRealtimeSync();
  const isDriverHome = appState.mode === "driver" && appState.page === "home" && !activeSessionForUser();
  app.innerHTML = `
    <div class="app-shell ${appState.mode === "driver" ? "driver-shell" : "admin-shell"} ${isDriverHome ? "home-overlay-shell" : ""}">
      <header class="header ${isDriverHome ? "header-home-overlay" : ""}">
        <div class="brand brand-center">
          <strong>${t("app_title")}</strong>
        </div>
      </header>
      <div class="layout ${appState.mode === "driver" ? "driver-layout" : "admin-layout"}">
        ${
          appState.mode === "admin"
            ? `<aside class="sidebar">${renderAdminNav()}</aside>`
            : ""
        }
        <main class="content ${appState.mode === "driver" ? "driver-content" : ""} ${appState.mode === "driver" && appState.page === "home" && !activeSessionForUser() ? "home-unified-content" : ""}">
          <div class="${pageTransitionClass}">
            ${appState.mode === "driver" ? renderDriverContent() : renderAdminContent()}
          </div>
        </main>
      </div>
      ${appState.mode === "driver" ? renderDriverBottomNav() : ""}
      ${appState.mode === "driver" ? renderDriverSheet() : ""}
      ${appState.releaseConfirmOpen ? renderReleaseConfirmModal() : ""}
      ${appState.reserveConfirmOpen ? renderReserveConfirmModal() : ""}
      <datalist id="vehicle-manufacturers-list">
        ${VEHICLE_MANUFACTURERS.map((m) => `<option value="${m}"></option>`).join("")}
      </datalist>
    </div>
  `;
  initMapIfNeeded();
  bindGoogleAutocompleteInput();
  if (appState.mode === "driver" && appState.page === "home") {
    setTimeout(() => restoreHomeCarouselPosition(), 0);
  }
}

render();
bootstrapAuth();
setInterval(() => {
  const changed = checkTimeouts();
  if (changed) {
    render();
    return;
  }
  updateLiveParkingTimers();
}, 1000);
