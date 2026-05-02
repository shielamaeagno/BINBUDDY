/* ====================================================
   BINBUDDY - APP ENGINE (Workflow-Driven Backend Logic)
   ==================================================== */

const STORAGE_KEY = "binbuddy-state-v2";
const SESSION_KEY = "binbuddy-session-v1";
const API_BASE = (typeof window !== "undefined" && window.BINBUDDY_API_BASE) || "/api";
const TOKEN_KEY = "binbuddy-jwt";

/** Align with server `passwordPolicy`: 8–128 chars, letters + numbers. */
const AUTH_PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
const AUTH_PHONE_REGEX = /^(\+63\d{10}|\d{10,11})$/;

function validateRegisterPasswordClient(pw) {
  if (!AUTH_PASSWORD_REGEX.test(pw)) {
    return "Password must be 8–128 characters and include at least one letter and one number.";
  }
  return "";
}

function validateLoginPasswordPresence(pw) {
  if (!pw || typeof pw !== "string") return "Password is required.";
  if (pw.length > 128) return "Password is too long.";
  return "";
}

function validateRegisterPhoneClient(phoneNumber) {
  const phone = String(phoneNumber || "").trim();
  if (!phone) return "Phone number is required.";
  if (!AUTH_PHONE_REGEX.test(phone)) {
    return "Phone number must be numeric and can use +63 format.";
  }
  return "";
}

function validateRegisterAddressClient(address) {
  if (!address || !String(address).trim()) return "Address is required.";
  return "";
}

function sanitizeRegisterName(email, derived) {
  const raw = (derived || "").trim() || email.split("@")[0].replace(/[.@]+/g, " ").trim() || "User";
  return raw.slice(0, 100);
}

function summarizeApiValidationMessage(data) {
  const errs = data?.errors;
  if (!Array.isArray(errs) || errs.length === 0) return null;
  const row = errs.find(e => e && typeof e.msg === "string" && e.msg.trim());
  return row ? row.msg : null;
}

function setViewportAuthLock(locked) {
  document.getElementById("app")?.classList.toggle("bb-auth-lock", !!locked);
}

let apiMode = false;
let adminAnalyticsCache = null;

/** Path routes (SPA, requires server to serve index for these paths when using HTTP) */
const ROUTES = { LOGIN: "/login", DASHBOARD: "/dashboard" };
let detachedLoginPhase = null;
let suppressSplashTransitions = false;

function pathRoutingEnabled() {
  try {
    const p = window.location.protocol;
    return p === "http:" || p === "https:";
  } catch (_e) {
    return false;
  }
}

function normalizePath(forPath) {
  try {
    let p =
      forPath != null ? String(forPath).replace(/\/+$/, "") || "/" : String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
    if (p.endsWith("/index.html")) p = "/";
    return p;
  } catch (_e) {
    return "/";
  }
}

function setDashboardPhaseVisible(visible) {
  const dash = document.getElementById("mount-dashboard-phase");
  if (!dash) return;
  dash.hidden = !visible;
  if (visible) {
    dash.removeAttribute("aria-hidden");
    dash.removeAttribute("inert");
  } else {
    dash.setAttribute("aria-hidden", "true");
    dash.setAttribute("inert", "");
  }
}

function dashboardScreensDeactivateAll() {
  document.querySelectorAll("#mount-dashboard-phase .screen").forEach(el => el.classList.remove("active"));
}

function showSplashOnly() {
  setViewportAuthLock(true);
  document.querySelectorAll("#mount-login-phase .screen").forEach(el => el.classList.remove("active"));
  document.getElementById("screen-splash")?.classList.add("active");
}

function showLoginFormOnly() {
  setViewportAuthLock(true);
  document.querySelectorAll("#mount-login-phase .screen").forEach(el => el.classList.remove("active"));
  document.getElementById("screen-auth")?.classList.add("active");
}

function detachLoginPhase() {
  const el = document.getElementById("mount-login-phase");
  if (!el?.parentNode) return;
  detachedLoginPhase = el;
  el.remove();
}

function attachLoginPhase() {
  const app = document.getElementById("app");
  const dash = document.getElementById("mount-dashboard-phase");
  if (!app || !detachedLoginPhase) return;
  if (detachedLoginPhase.parentNode === app) return;
  app.insertBefore(detachedLoginPhase, dash);
}

function exitAuthenticatedMount() {
  setDashboardPhaseVisible(false);
  dashboardScreensDeactivateAll();
  attachLoginPhase();
  showLoginFormOnly();
}

function enterAuthenticatedMount() {
  detachLoginPhase();
  setDashboardPhaseVisible(true);
  setViewportAuthLock(false);
}

function historySyncAuthenticated(screen, replace = false) {
  const state = { screen, authenticated: true };
  if (!pathRoutingEnabled()) {
    window.history[replace ? "replaceState" : "pushState"](state, "", window.location.href.split("#")[0]);
    return;
  }
  window.history[replace ? "replaceState" : "pushState"](state, "", ROUTES.DASHBOARD);
}

function historySyncLogin() {
  const state = { screen: "auth", authenticated: false };
  if (!pathRoutingEnabled()) {
    window.history.replaceState(state, "", window.location.href.split("#")[0]);
    return;
  }
  window.history.replaceState(state, "", ROUTES.LOGIN);
}

function historySplashOnLoginRoute() {
  if (!pathRoutingEnabled()) return;
  window.history.replaceState({ screen: "splash", authenticated: false }, "", ROUTES.LOGIN);
}

function finalizeAuthenticatedEntry(firstScreen, { replaceHistory = true } = {}) {
  suppressSplashTransitions = true;
  enterAuthenticatedMount();
  const screen = firstScreen || "home";
  goTo(screen, { trackHistory: false, skipAuthenticatedHistory: true });
  historySyncAuthenticated(screen, replaceHistory);
}

function runInitialUrlRouting(_restoredFromToken) {
  const user = AuthService.currentUser();
  const path = normalizePath();

  if (user) {
    suppressSplashTransitions = true;
    let targetScreen =
      history.state && history.state.screen ? history.state.screen : RoleGuard.getHomeScreen(user.role);
    if (!RoleGuard.canAccess(user.role, targetScreen)) {
      targetScreen = RoleGuard.getHomeScreen(user.role);
    }
    finalizeAuthenticatedEntry(targetScreen, { replaceHistory: true });
    return;
  }

  setDashboardPhaseVisible(false);
  dashboardScreensDeactivateAll();
  attachLoginPhase();

  if (!pathRoutingEnabled()) {
    return;
  }

  if (path === ROUTES.DASHBOARD) {
    suppressSplashTransitions = true;
    window.history.replaceState({ screen: "auth", authenticated: false }, "", ROUTES.LOGIN);
    showLoginFormOnly();
    return;
  }

  /** Bookmarked `/login`: show split auth immediately (logged-in users already redirected above). */
  if (path === ROUTES.LOGIN && pathRoutingEnabled()) {
    suppressSplashTransitions = true;
    showLoginFormOnly();
    return;
  }

  if (path === "/") {
    if (pathRoutingEnabled()) {
      window.history.replaceState({ screen: "splash", authenticated: false }, "", ROUTES.LOGIN);
    }
    return;
  }

  window.history.replaceState({ screen: "splash", authenticated: false }, "", ROUTES.LOGIN);
}
const ROLE_ALIASES = {
  user: "household",
  household: "household",
  collector: "collector",
  admin: "admin"
};

const ROLE_HOME_SCREEN = {
  household: "home",
  collector: "collector",
  admin: "admin"
};

const ROLE_ALLOWED_SCREENS = {
  household: new Set([
    "home",
    "track",
    "guide",
    "rewards",
    "profile",
    "leaderboard",
    "notifications",
    "education",
    "about",
    "xml-viewer"
  ]),
  collector: new Set(["collector", "collector-profile"]),
  admin: new Set(["admin", "admin-profile"])
};

const BADGE_LEVELS = [
  { min: 0, label: "Eco Starter" },
  { min: 100, label: "Eco Supporter" },
  { min: 300, label: "Eco Champion" },
  { min: 700, label: "Eco Hero" }
];

const AppState = {
  currentScreen: "auth",
  role: "household",
  authMode: "login",
  logType: "bio",
  logQty: 1.0,
  currentUserId: null,
  currentUserName: null,
  users: [],
  logs: [],
  redemptions: [],
  notifications: []
};

function normalizeRole(role) {
  return ROLE_ALIASES[role] || "household";
}

const SessionManager = {
  save(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },
  load() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_err) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
  },
  clear() {
    sessionStorage.removeItem(SESSION_KEY);
  },
  clearAppCache() {
    localStorage.removeItem(STORAGE_KEY);
  },
  resetForFreshStart() {
    // Force login every app launch/reload.
    this.clear();
  }
};

const RoleGuard = {
  getAllowedScreens(role) {
    const normalizedRole = normalizeRole(role);
    return ROLE_ALLOWED_SCREENS[normalizedRole] || new Set([getRoleHomeScreen(normalizedRole)]);
  },
  getHomeScreen(role) {
    return getRoleHomeScreen(normalizeRole(role));
  },
  canAccess(role, screen) {
    return this.getAllowedScreens(role).has(screen);
  }
};

function handlePopNavigate() {
  const user = AuthService.currentUser();
  const path = normalizePath();
  const st = window.history.state || {};

  if (!user) {
    if (pathRoutingEnabled() && path === ROUTES.DASHBOARD) {
      window.history.replaceState({ screen: "auth", authenticated: false }, "", ROUTES.LOGIN);
    }
    exitAuthenticatedMount();
    dashboardScreensDeactivateAll();
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.classList.add("hidden");
    refreshUI();
    const ae = document.getElementById("screen-auth");
    if (ae) resetViewportScroll(ae);
    return;
  }

  if (pathRoutingEnabled() && path === ROUTES.LOGIN) {
    enterAuthenticatedMount();
    historySyncAuthenticated(RoleGuard.getHomeScreen(user.role), true);
  }

  let safe = st.screen || RoleGuard.getHomeScreen(user.role);
  if (!RoleGuard.canAccess(user.role, safe)) safe = RoleGuard.getHomeScreen(user.role);
  goTo(safe, { trackHistory: false, skipAuthenticatedHistory: true });
}

const HistoryGuard = {
  init() {
    window.addEventListener("popstate", handlePopNavigate);
  },
  push(screen) {
    if (!AuthService.currentUser()) return;
    historySyncAuthenticated(screen, false);
  },
  resetToLoginUrl() {
    historySyncLogin();
  }
};

function nowIso() {
  return new Date().toISOString();
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString();
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(t) {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = summarizeApiValidationMessage(data) || data.message;
    const err = new Error(detail || res.statusText || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function syncFromServer() {
  const token = getToken();
  if (!token) {
    apiMode = false;
    return false;
  }
  try {
    const me = await apiFetch("/auth/me");
    const user = me.user;
    AppState.currentUserId = user.id;
    AppState.currentUserName = user.name;
    AppState.role = normalizeRole(user.role);

    const logsData = await apiFetch("/logs");
    AppState.logs = logsData.logs || [];

    const notifData = await apiFetch("/notifications");
    AppState.notifications = (notifData.notifications || []).map(n => ({
      text: n.text,
      createdAt: n.createdAt || n.created_at
    }));

    if (normalizeRole(user.role) === "household") {
      const lb = await apiFetch("/leaderboard");
      const rows = lb.leaderboard || [];
      const mapped = rows.map(u => ({
        id: u.id,
        name: u.name,
        email: u.id === user.id ? user.email || "" : "",
        phoneNumber: u.id === user.id ? user.phoneNumber || "" : "",
        address: u.id === user.id ? user.address || "" : "",
        role: "household",
        ecoPoints: u.ecoPoints,
        streak: u.id === user.id ? user.streak : 0,
        badge: u.id === user.id ? user.badge : "Eco Starter",
        barangay: user.barangay || "Holy Spirit",
        password: ""
      }));
      if (!mapped.some(u => u.id === user.id)) {
        mapped.unshift({
          id: user.id,
          name: user.name,
          email: user.email || "",
          phoneNumber: user.phoneNumber || "",
          address: user.address || "",
          role: "household",
          ecoPoints: user.ecoPoints,
          streak: user.streak,
          badge: user.badge,
          barangay: user.barangay || "Holy Spirit",
          password: ""
        });
      } else {
        const idx = mapped.findIndex(u => u.id === user.id);
        if (idx >= 0) {
          mapped[idx] = {
            ...mapped[idx],
            ecoPoints: user.ecoPoints,
            streak: user.streak,
            badge: user.badge,
            email: user.email || "",
            phoneNumber: user.phoneNumber || "",
            address: user.address || ""
          };
        }
      }
      AppState.users = mapped;
    } else {
      AppState.users = [
        {
          id: user.id,
          name: user.name,
          email: user.email || "",
          phoneNumber: user.phoneNumber || "",
          address: user.address || "",
          role: user.role,
          ecoPoints: user.ecoPoints || 0,
          streak: user.streak || 0,
          badge: user.badge || "",
          barangay: user.barangay || "Holy Spirit",
          password: ""
        }
      ];
    }

    if (normalizeRole(user.role) === "admin") {
      adminAnalyticsCache = await apiFetch("/admin/analytics");
    } else {
      adminAnalyticsCache = null;
    }

    SessionManager.save({
      currentUserId: AppState.currentUserId,
      role: normalizeRole(AppState.role),
      name: AppState.currentUserName
    });

    apiMode = true;
    return true;
  } catch (e) {
    console.warn(e);
    apiMode = false;
    clearToken();
    clearSession();
    if (typeof clearRuntimeUserContext === "function") clearRuntimeUserContext();
    return false;
  }
}

function updateHomeStats() {
  const user = AuthService.currentUser();
  if (!user || normalizeRole(user.role) !== "household") return;
  const logs = AppState.logs.filter(l => l.userId === user.id);
  const today = new Date().toDateString();
  let petToday = 0;
  let hdpeToday = 0;
  logs.forEach(l => {
    if (new Date(l.createdAt).toDateString() !== today) return;
    if (l.type === "PET") petToday += Number(l.weight) || 0;
    if (l.type === "HDPE") hdpeToday += Number(l.weight) || 0;
  });
  const stats = document.querySelectorAll("#screen-home .stats-grid .stat-value");
  if (stats[0]) stats[0].innerHTML = `${petToday.toFixed(1)}<span style="font-size:0.8rem">kg</span>`;
  if (stats[1]) stats[1].innerHTML = `${hdpeToday.toFixed(1)}<span style="font-size:0.8rem">kg</span>`;
  if (stats[2]) stats[2].textContent = user.ecoPoints;
  if (stats[3]) stats[3].textContent = logs.length;

  const streakEl = document.querySelector("#screen-home .welcome-banner div[style*='text-align:right'] div[style*='font-size:1.8rem']");
  if (streakEl) streakEl.textContent = user.streak ?? 0;
}

function buildSeedState() {
  return {
    users: [
      {
        id: "USR001",
        name: "Maria Santos",
        email: "maria@email.com",
        password: "password123",
        role: "household",
        ecoPoints: 1245,
        streak: 7,
        badge: "Eco Champion",
        barangay: "Holy Spirit",
        phoneNumber: "09171234567",
        address: "Brgy. Holy Spirit, Lipa City"
      },
      {
        id: "COL001",
        name: "Roberto Cruz",
        email: "collector@email.com",
        password: "password123",
        role: "collector",
        ecoPoints: 0,
        streak: 0,
        badge: "Collector",
        barangay: "Holy Spirit",
        phoneNumber: "09171230000",
        address: "Brgy. Holy Spirit, Lipa City"
      },
      {
        id: "ADM001",
        name: "Brgy. Holy Spirit Admin",
        email: "admin@email.com",
        password: "password123",
        role: "admin",
        ecoPoints: 0,
        streak: 0,
        badge: "Admin",
        barangay: "Holy Spirit",
        phoneNumber: "09179990000",
        address: "Brgy. Holy Spirit, Lipa City"
      }
    ],
    logs: [
      {
        id: "LOG001",
        userId: "USR001",
        userName: "Maria Santos",
        type: "PET",
        weight: 1.2,
        createdAt: nowIso(),
        status: "Completed",
        verifiedBy: "COL001",
        completedAt: nowIso(),
        ecoPointsAwarded: 24
      },
      {
        id: "LOG002",
        userId: "USR001",
        userName: "Maria Santos",
        type: "HDPE",
        weight: 0.8,
        createdAt: nowIso(),
        status: "Pending",
        verifiedBy: null,
        completedAt: null,
        ecoPointsAwarded: 0
      }
    ],
    redemptions: [],
    notifications: []
  };
}

function persistState() {
  if (apiMode) return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      users: AppState.users,
      logs: AppState.logs,
      redemptions: AppState.redemptions,
      notifications: AppState.notifications
    })
  );
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = buildSeedState();
    AppState.users = seed.users;
    AppState.logs = seed.logs;
    AppState.redemptions = seed.redemptions;
    AppState.notifications = seed.notifications;
    persistState();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    AppState.users = parsed.users || [];
    AppState.logs = parsed.logs || [];
    AppState.redemptions = parsed.redemptions || [];
    AppState.notifications = parsed.notifications || [];
  } catch (_err) {
    const fallback = buildSeedState();
    AppState.users = fallback.users;
    AppState.logs = fallback.logs;
    AppState.redemptions = fallback.redemptions;
    AppState.notifications = fallback.notifications;
    persistState();
  }
}

function persistSession() {
  SessionManager.save({
    currentUserId: AppState.currentUserId,
    role: normalizeRole(AppState.role),
    name: AppState.currentUserName
  });
}

function clearSession() {
  AppState.currentUserId = null;
  AppState.currentUserName = null;
  AppState.role = "household";
  SessionManager.clear();
}

function loadSession() {
  const parsed = SessionManager.load();
  if (!parsed || !parsed.currentUserId) return;
  const user = AppState.users.find(u => u.id === parsed.currentUserId);
  if (!user) {
    SessionManager.clear();
    return;
  }
  const sessionRole = normalizeRole(parsed.role);
  const userRole = normalizeRole(user.role);
  if (sessionRole !== userRole) {
    SessionManager.clear();
    return;
  }
  AppState.currentUserId = user.id;
  AppState.currentUserName = user.name || "User";
  AppState.role = userRole;
}

function getRoleHomeScreen(role) {
  return ROLE_HOME_SCREEN[normalizeRole(role)] || "home";
}

const AuthService = {
  register(payload) {
    const { email, password, role } = payload;
    const pwErr = validateRegisterPasswordClient(password);
    if (pwErr) return { ok: false, message: pwErr };
    const phoneErr = validateRegisterPhoneClient(payload.phoneNumber);
    if (phoneErr) return { ok: false, message: phoneErr };
    const addressErr = validateRegisterAddressClient(payload.address);
    if (addressErr) return { ok: false, message: addressErr };
    const existing = AppState.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.role === role);
    if (existing) return { ok: false, message: "Account already exists for this role." };
    const idPrefix = role === "collector" ? "COL" : role === "admin" ? "ADM" : "USR";
    const id = `${idPrefix}${String(AppState.users.length + 1).padStart(3, "0")}`;
    const user = {
      id,
      name: (payload.name || email.split("@")[0].replace(/\./g, " ")).trim() || "User",
      email,
      password,
      role,
      ecoPoints: 0,
      streak: 0,
      badge: "Eco Starter",
      barangay: "Holy Spirit",
      phoneNumber: String(payload.phoneNumber || "").trim(),
      address: String(payload.address || "").trim()
    };
    AppState.users.push(user);
    persistState();
    return { ok: true, user };
  },
  login(payload) {
    const { email, password } = payload;
    const role = normalizeRole(payload.role);
    const user = AppState.users.find(
      u =>
        u.email.toLowerCase() === email.toLowerCase() &&
        u.password === password &&
        normalizeRole(u.role) === role
    );
    if (!user) return { ok: false, message: "Invalid credentials for selected role." };
    AppState.currentUserId = user.id;
    AppState.currentUserName = user.name || "User";
    AppState.role = normalizeRole(user.role);
    persistSession();
    return { ok: true, user };
  },
  currentUser() {
    return AppState.users.find(u => u.id === AppState.currentUserId) || null;
  }
};

const WasteLogService = {
  normalizeWasteType(rawType) {
    if (rawType === "PET" || rawType === "pet") return "PET";
    if (rawType === "HDPE" || rawType === "hdpe") return "HDPE";
    if (rawType === "bio") return "PET";
    if (rawType === "rec") return "HDPE";
    return null;
  },
  validate(weight, rawType, user) {
    if (!user) return "Login required.";
    const normalizedType = this.normalizeWasteType(rawType);
    if (!normalizedType) return "Waste type selection is required (PET or HDPE only).";
    if (weight === null || weight === undefined || Number.isNaN(weight)) return "Weight is required and must be numeric.";
    if (weight <= 0) return "Weight must be greater than zero.";
    return null;
  },
  createLog({ user, rawType, weight, logDate, photoPath }) {
    const log = {
      id: `LOG${String(Date.now()).slice(-6)}`,
      userId: user.id,
      userName: user.name,
      type: this.normalizeWasteType(rawType),
      weight: Number(weight.toFixed(2)),
      createdAt: nowIso(),
      logDate: logDate || nowIso(),
      status: "Pending",
      verifiedBy: null,
      completedAt: null,
      ecoPointsAwarded: 0,
      photoPath: photoPath || null
    };
    AppState.logs.unshift(log);
    AppState.notifications.unshift({
      text: `Log submitted (${log.type}, ${log.weight} kg). Status: Pending.`,
      createdAt: nowIso()
    });
    persistState();
    return log;
  }
};

const VerificationService = {
  verifyLog(logId, isVerified, collectorId) {
    const log = AppState.logs.find(l => l.id === logId);
    if (!log) return null;
    if (!isVerified) {
      log.status = "Pending";
      persistState();
      return log;
    }
    if (log.status === "Completed") return log;
    log.status = "Completed";
    log.verifiedBy = collectorId;
    log.completedAt = nowIso();
    log.ecoPointsAwarded = Math.round(log.weight * (log.type === "PET" ? 20 : 25));
    const user = AppState.users.find(u => u.id === log.userId);
    if (user) {
      user.ecoPoints += log.ecoPointsAwarded;
      user.streak += 1;
      user.badge = BADGE_LEVELS.reduce((acc, level) => (user.ecoPoints >= level.min ? level.label : acc), "Eco Starter");
      AppState.notifications.unshift({
        text: `Log ${log.id} completed. +${log.ecoPointsAwarded} EcoPoints awarded.`,
        createdAt: nowIso()
      });
    }
    persistState();
    return log;
  }
};

const RewardsService = {
  catalog() {
    return [
      { id: "RWD-LOAD-50", name: "Mobile Load", display: "₱50 Load", cost: 500 },
      { id: "RWD-VOUCH-100", name: "Voucher", display: "₱100 Voucher", cost: 1000 },
      { id: "RWD-GCASH-75", name: "GCash", display: "₱75 GCash", cost: 750 }
    ];
  },
  redeem(rewardId, user) {
    const reward = this.catalog().find(r => r.id === rewardId);
    if (!reward) return { ok: false, message: "Reward not found." };
    if (!user) return { ok: false, message: "Login required." };
    if (user.ecoPoints < reward.cost) return { ok: false, message: "Not enough EcoPoints." };
    user.ecoPoints -= reward.cost;
    AppState.redemptions.unshift({
      id: `RDM${Date.now()}`,
      userId: user.id,
      rewardId: reward.id,
      rewardName: reward.display,
      cost: reward.cost,
      createdAt: nowIso()
    });
    AppState.notifications.unshift({
      text: `Redeemed ${reward.display} for ${reward.cost} points.`,
      createdAt: nowIso()
    });
    persistState();
    return { ok: true, reward };
  }
};

const AnalyticsService = {
  metrics() {
    const total = AppState.logs.length;
    const completed = AppState.logs.filter(l => l.status === "Completed").length;
    const pending = total - completed;
    const totalCollectedKg = AppState.logs
      .filter(l => l.status === "Completed")
      .reduce((sum, l) => sum + l.weight, 0);
    const compliance = total > 0 ? Math.round((completed / total) * 100) : 0;
    const ecoPointsDistributed = AppState.logs.reduce((sum, l) => sum + (l.ecoPointsAwarded || 0), 0);
    return {
      totalLogs: total,
      completedLogs: completed,
      pendingLogs: pending,
      totalCollectedKg: Number(totalCollectedKg.toFixed(1)),
      compliance,
      ecoPointsDistributed
    };
  },
  weeklySeries() {
    const byDay = {};
    AppState.logs.forEach(log => {
      if (log.status !== "Completed") return;
      const day = new Date(log.createdAt).toLocaleDateString(undefined, { weekday: "short" });
      byDay[day] = (byDay[day] || 0) + log.weight;
    });
    const sequence = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return sequence.map(day => ({ day, val: Number((byDay[day] || 0).toFixed(1)) }));
  }
};

function resetViewportScroll(activeScreenEl) {
  const flush = () => {
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    const app = document.getElementById("app");
    if (app) app.scrollTop = 0;
    if (activeScreenEl && activeScreenEl.scrollTop !== undefined) {
      activeScreenEl.scrollTop = 0;
    }
  };
  flush();
  requestAnimationFrame(() => requestAnimationFrame(flush));
}

function initSplash(_restoredSession) {
  const splashScreen = document.getElementById("screen-splash");
  if (!splashScreen && !AuthService.currentUser()) {
    showLoginFormOnly();
    return;
  }
  if (!splashScreen) return;

  if (suppressSplashTransitions || AuthService.currentUser()) {
    return;
  }

  showSplashOnly();
  if (pathRoutingEnabled()) {
    historySplashOnLoginRoute();
  }

  setTimeout(() => {
    if (AuthService.currentUser()) return;

    showLoginFormOnly();
    if (pathRoutingEnabled()) {
      window.history.replaceState({ screen: "auth", authenticated: false }, "", ROUTES.LOGIN);
    }
    const ae = document.getElementById("screen-auth");
    if (ae) resetViewportScroll(ae);
  }, 1800);
}

function goTo(screen, options = {}) {
  const { trackHistory = true, skipAuthenticatedHistory = false } = options;
  const user = AuthService.currentUser();
  if (screen !== "auth" && screen !== "splash" && !user) {
    showToast("Please login first.");
    suppressSplashTransitions = true;
    exitAuthenticatedMount();
    goToAuthScreen(false);
    historySyncLogin();
    return;
  }
  if (user) {
    const userRole = normalizeRole(user.role);
    if (!RoleGuard.canAccess(userRole, screen)) {
      const safeScreen = RoleGuard.getHomeScreen(userRole);
      if (screen !== safeScreen) {
        showToast(`${userRole === "household" ? "User" : userRole} dashboard only.`);
      }
      screen = safeScreen;
    }
  } else if (screen !== "auth" && screen !== "splash") {
    screen = "auth";
  }
  if (screen === "auth") {
    logout(false);
    return;
  }

  const dash = document.getElementById("mount-dashboard-phase");
  dash?.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(`screen-${screen}`);
  if (!target || !dash || !dash.contains(target)) return;

  target.classList.add("active");
  AppState.currentScreen = screen;
  if (trackHistory && AuthService.currentUser() && !skipAuthenticatedHistory) {
    HistoryGuard.push(screen);
  }
  syncBottomNav(user, screen);
  const nav = document.getElementById("bottom-nav");
  if (nav) {
    const shouldHideNav = screen === "auth" || screen === "splash" || !user;
    nav.classList.toggle("hidden", shouldHideNav);
  }
  refreshUI();
  resetViewportScroll(target);
}

function syncBottomNav(user, screen) {
  const role = user ? normalizeRole(user.role) : null;
  document.querySelectorAll(".nav-item").forEach(btn => {
    const itemRole = btn.dataset.role || "household";
    const isRoleMatch = Boolean(role) && itemRole === role;
    btn.classList.toggle("hidden", !isRoleMatch);
    const action = btn.dataset.action || "";
    const targetScreen = btn.dataset.nav || "";
    const isActive = isRoleMatch && !action && targetScreen === screen;
    btn.classList.toggle("active", isActive);
  });
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

function openLogModal() {
  const user = AuthService.currentUser();
  if (!user || user.role !== "household") {
    showToast("Household login required.");
    return;
  }
  const modalDate = document.getElementById("modal-log-date");
  if (modalDate && !modalDate.value) {
    modalDate.value = todayInputValue();
  }
  document.getElementById("log-modal").classList.add("active");
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("active");
}

function updateQtyUI() {
  const qty = document.getElementById("qty-display");
  if (qty) qty.textContent = AppState.logQty.toFixed(1);
  const modalQty = document.getElementById("modal-qty");
  if (modalQty) modalQty.textContent = AppState.logQty.toFixed(1);
}

function setupWasteTypeSelectors() {
  const restrictChips = scopeSelector => {
    const chips = document.querySelectorAll(`${scopeSelector} .waste-chip`);
    chips.forEach(chip => {
      const type = chip.dataset.type;
      if (type === "bio") chip.textContent = "PET";
      if (type === "rec") chip.textContent = "HDPE";
      if (type === "res" || type === "spc") chip.style.display = "none";
    });
  };

  restrictChips("#manual-panel");
  restrictChips("#log-modal");

  const manualChips = document.querySelectorAll("#manual-panel .waste-chip");
  manualChips.forEach(chip => chip.classList.remove("active"));
  const defaultManual = document.querySelector("#manual-panel .waste-chip[data-type='bio']");
  if (defaultManual) defaultManual.classList.add("active");

  const modalChips = document.querySelectorAll("#log-modal .waste-chip");
  modalChips.forEach(chip => chip.classList.remove("active"));
  const defaultModal = document.querySelector("#log-modal .waste-chip[data-type='bio']");
  if (defaultModal) defaultModal.classList.add("active");

  AppState.logType = "bio";
}

function increaseQty() {
  AppState.logQty = Math.round((AppState.logQty + 0.1) * 10) / 10;
  updateQtyUI();
}

function decreaseQty() {
  AppState.logQty = Math.max(0.1, Math.round((AppState.logQty - 0.1) * 10) / 10);
  updateQtyUI();
}

function getManualInputWeight() {
  const qtyDisplay = document.getElementById("qty-display");
  const parsedQty = qtyDisplay ? Number.parseFloat(qtyDisplay.textContent) : AppState.logQty;
  return Number.isFinite(parsedQty) ? parsedQty : NaN;
}

function resolveLogDateValue() {
  const manualDate = document.getElementById("manual-log-date");
  const modalDate = document.getElementById("modal-log-date");
  const value = (modalDate?.value || manualDate?.value || "").trim();
  return value || todayInputValue();
}

function updatePhotoLabel(fileName) {
  const label = document.getElementById("manual-photo-label");
  if (!label) return;
  label.textContent = fileName ? `Selected: ${fileName}` : "Tap to add photo proof (JPG/PNG)";
}

async function readSelectedLogPhoto() {
  const manualInput = document.getElementById("manual-log-photo");
  const modalInput = document.getElementById("modal-log-photo");
  const file = (modalInput && modalInput.files && modalInput.files[0]) || (manualInput && manualInput.files && manualInput.files[0]) || null;
  if (!file) return { dataUrl: null, fileName: null };
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("Only JPG and PNG images are allowed.");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Image size must be 2MB or less.");
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read selected image."));
    reader.readAsDataURL(file);
  });
  return { dataUrl, fileName: file.name };
}

function resetLogInputs() {
  const notesEl = document.querySelector("#manual-panel textarea");
  const manualDate = document.getElementById("manual-log-date");
  const modalDate = document.getElementById("modal-log-date");
  const manualPhoto = document.getElementById("manual-log-photo");
  const modalPhoto = document.getElementById("modal-log-photo");
  if (notesEl) notesEl.value = "";
  if (manualDate) manualDate.value = todayInputValue();
  if (modalDate) modalDate.value = todayInputValue();
  if (manualPhoto) manualPhoto.value = "";
  if (modalPhoto) modalPhoto.value = "";
  updatePhotoLabel("");
}

function cancelLogSubmission() {
  if (!window.confirm("Are you sure you want to cancel?")) return;
  resetLogInputs();
  closeModal("log-modal");
}

async function submitLog() {
  const user = AuthService.currentUser();
  if (!user || user.role !== "household") {
    showToast("Only household users can submit logs.");
    return;
  }
  const weight = Number.isFinite(AppState.logQty) ? AppState.logQty : getManualInputWeight();
  const error = WasteLogService.validate(weight, AppState.logType, user);
  if (error) {
    showToast(error);
    return;
  }
  const notesEl = document.querySelector("#manual-panel textarea");
  const notes = notesEl ? notesEl.value.trim() : "";
  const logDate = resolveLogDateValue();
  let photoDataUrl = null;
  let photoFileName = null;
  try {
    const selected = await readSelectedLogPhoto();
    photoDataUrl = selected.dataUrl;
    photoFileName = selected.fileName;
  } catch (photoError) {
    showToast(photoError.message || "Invalid photo upload.");
    return;
  }

  if (apiMode && getToken()) {
    try {
      const payload = {
        wasteType: AppState.logType,
        weight,
        notes,
        logDate,
        photoDataUrl,
        photoFileName
      };
      const created = await apiFetch("/logs", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      closeModal("log-modal");
      openSuccessModal(created.log);
      resetLogInputs();
      await syncFromServer();
      refreshUI();
      return;
    } catch (e) {
      showToast(e.message || "Could not submit log.");
      return;
    }
  }
  const log = WasteLogService.createLog({
    user,
    rawType: AppState.logType,
    weight,
    logDate: new Date(logDate).toISOString(),
    photoPath: photoDataUrl || null
  });
  closeModal("log-modal");
  openSuccessModal(log);
  resetLogInputs();
  refreshUI();
}

function openSuccessModal(log) {
  const type = document.getElementById("success-type");
  const qty = document.getElementById("success-qty");
  const pts = document.getElementById("success-pts");
  if (type) type.textContent = log.type;
  if (qty) qty.textContent = `${log.weight} kg logged`;
  if (pts) pts.textContent = "Status: Pending";
  const modal = document.getElementById("success-modal");
  if (modal) modal.classList.add("active");
}

function renderRecentLogs() {
  const recent = document.getElementById("recent-logs");
  if (recent) {
    recent.innerHTML = AppState.logs.slice(0, 5).map(l => `
      <div class="card" style="margin-bottom:8px">
        <strong>${l.type}</strong><br/>
        ${l.weight} kg • <strong>${l.status}</strong><br/>
        <small>${formatDateTime(l.createdAt)}</small>
      </div>
    `).join("");
  }
  const history = document.getElementById("full-history");
  if (history) {
    history.innerHTML = AppState.logs.map(l => `
      <div class="card" style="margin-bottom:8px">
        <strong>${l.type}</strong><br/>
        ${l.weight} kg • <strong>${l.status}</strong>
        ${l.status === "Completed" ? `• +${l.ecoPointsAwarded} pts` : ""}<br/>
        <small>${formatDateTime(l.createdAt)}</small>
      </div>
    `).join("");
  }
}

function renderNotifications() {
  const el = document.getElementById("notif-list");
  if (!el) return;
  el.innerHTML = AppState.notifications.slice(0, 20).map(n => `
    <div class="card">
      ${n.text}<br/>
      <small>${formatDateTime(n.createdAt || n.created_at)}</small>
    </div>
  `).join("");
}

function renderLeaderboard() {
  const users = AppState.users
    .filter(u => u.role === "household")
    .slice()
    .sort((a, b) => b.ecoPoints - a.ecoPoints)
    .slice(0, 10);
  const el = document.getElementById("leaderboard-list");
  if (!el) return;
  el.innerHTML = users.map((u, i) => `
    <div class="card" style="display:flex;justify-content:space-between">
      <span>#${i + 1} ${u.name}</span>
      <strong>${u.ecoPoints} pts</strong>
    </div>
  `).join("");
}

function renderProfile() {
  const user = AuthService.currentUser();
  const name = document.getElementById("profile-name");
  const profileAddress = document.getElementById("profile-brgy");
  const pts = document.getElementById("profile-pts");
  const streak = document.getElementById("profile-streak");
  const badge = document.getElementById("eco-badge-pts");
  if (name) name.textContent = user ? (user.name || "User") : "User";
  if (profileAddress) profileAddress.textContent = user ? (user.address || "Address not set") : "Address not set";
  if (pts) pts.textContent = user ? user.ecoPoints : "0";
  if (streak) streak.textContent = user ? user.streak : "0";
  if (badge) badge.textContent = `⭐ ${user ? user.ecoPoints : 0} pts`;
  document.querySelectorAll(".ecopoints-value").forEach(el => {
    el.textContent = user ? user.ecoPoints : 0;
  });
}

function renderHomeGreeting() {
  const greeting = document.getElementById("home-greeting-name");
  if (!greeting) return;
  const user = AuthService.currentUser();
  const name = user ? (user.name || "User") : (AppState.currentUserName || "User");
  greeting.textContent = `Hi, ${name} 👋`;
}

function renderUserAddress() {
  const user = AuthService.currentUser();
  const homeAddress = document.getElementById("home-user-address");
  if (homeAddress) {
    homeAddress.textContent = user ? (user.address || "Address not set") : "Address not set";
  }
}

function renderCollectorView() {
  const list = document.getElementById("pickup-list");
  if (!list) return;
  const pendingFirst = AppState.logs.slice().sort((a, b) => (a.status === "Pending" ? -1 : 1));
  list.innerHTML = pendingFirst.map(log => `
    <div class="card" style="margin-bottom:10px">
      <strong>${log.userName}</strong> • ${log.type} • ${log.weight} kg<br/>
      <small>Status: <strong>${log.status}</strong></small>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-outline" onclick="handleCollectorDecision('${log.id}',false)">Not Verified</button>
        <button class="btn btn-primary" onclick="handleCollectorDecision('${log.id}',true)">Verify</button>
      </div>
    </div>
  `).join("");
  const metrics = AnalyticsService.metrics();
  const statValues = document.querySelectorAll("#screen-collector .stat-value");
  if (statValues[0]) statValues[0].textContent = metrics.totalLogs;
  if (statValues[1]) statValues[1].textContent = metrics.completedLogs;
  if (statValues[2]) statValues[2].textContent = metrics.totalLogs - metrics.completedLogs;
  if (statValues[3]) statValues[3].textContent = metrics.pendingLogs;
}

async function handleCollectorDecision(logId, isVerified) {
  const user = AuthService.currentUser();
  if (!user || user.role !== "collector") {
    showToast("Collector login required.");
    return;
  }
  if (apiMode && getToken()) {
    try {
      await apiFetch(`/logs/${encodeURIComponent(logId)}/verify`, {
        method: "PATCH",
        body: JSON.stringify({ approve: Boolean(isVerified) })
      });
      await syncFromServer();
      showToast(isVerified ? "Log marked as Completed." : "Status kept as Pending.");
      refreshUI();
      return;
    } catch (e) {
      showToast(e.message || "Verification failed.");
      return;
    }
  }
  const updated = VerificationService.verifyLog(logId, isVerified, user.id);
  if (!updated) {
    showToast("Log not found.");
    return;
  }
  showToast(isVerified ? "Log marked as Completed." : "Status kept as Pending.");
  refreshUI();
}

function renderAdminAnalytics() {
  if (apiMode && adminAnalyticsCache && adminAnalyticsCache.metrics) {
    const m = adminAnalyticsCache.metrics;
    const kpis = document.querySelectorAll("#screen-admin .kpi-card .kpi-value");
    if (kpis[0]) kpis[0].textContent = `${m.totalCollectedKg}kg`;
    if (kpis[1]) kpis[1].textContent = `${m.compliance}%`;
    if (kpis[2]) kpis[2].textContent = `${m.recyclingRate}%`;
    if (kpis[3]) kpis[3].textContent = `${m.activeHouseholds}`;

    const pointsNode = document.querySelector("#screen-admin .card.mb-12 .section-title + div");
    if (pointsNode) pointsNode.textContent = `${m.ecoPointsDistributed}`;

    const adminUsers = document.getElementById("admin-users");
    if (adminUsers && adminAnalyticsCache.topHouseholds) {
      adminUsers.innerHTML = adminAnalyticsCache.topHouseholds
        .map(
          u => `
      <div class="card" style="display:flex;justify-content:space-between">
        <span>#${u.rank} ${u.name}</span>
        <strong>${u.ecoPoints} pts</strong>
      </div>
    `
        )
        .join("");
    }

    const chart = document.getElementById("admin-chart");
    if (chart && adminAnalyticsCache.weeklyChart) {
      const data = adminAnalyticsCache.weeklyChart;
      const max = Math.max(...data.map(d => d.val), 1);
      chart.innerHTML = data
        .map(
          d => `
      <div class="chart-col">
        <div class="chart-val">${d.val}</div>
        <div class="chart-bar" style="height:${(d.val / max) * 80}px"></div>
        <div class="chart-label">${d.day}</div>
      </div>
    `
        )
        .join("");
    }
    return;
  }

  const metrics = AnalyticsService.metrics();
  const kpis = document.querySelectorAll("#screen-admin .kpi-card .kpi-value");
  if (kpis[0]) kpis[0].textContent = `${metrics.totalCollectedKg}kg`;
  if (kpis[1]) kpis[1].textContent = `${metrics.compliance}%`;
  if (kpis[2]) kpis[2].textContent = `${metrics.completedLogs}`;
  if (kpis[3]) kpis[3].textContent = `${AppState.users.filter(u => u.role === "household").length}`;

  const pointsNodeLocal =
    document.querySelector("#screen-admin .card.mb-12 .section-title + div") ||
    document.querySelector("#screen-admin .card .section-title + div");
  if (pointsNodeLocal) pointsNodeLocal.textContent = `${metrics.ecoPointsDistributed}`;

  const adminUsers = document.getElementById("admin-users");
  if (adminUsers) {
    const ranked = AppState.users
      .filter(u => u.role === "household")
      .slice()
      .sort((a, b) => b.ecoPoints - a.ecoPoints)
      .slice(0, 5);
    adminUsers.innerHTML = ranked.map((u, i) => `
      <div class="card" style="display:flex;justify-content:space-between">
        <span>#${i + 1} ${u.name}</span>
        <strong>${u.ecoPoints} pts</strong>
      </div>
    `).join("");
  }

  const chart = document.getElementById("admin-chart");
  if (chart) {
    const data = AnalyticsService.weeklySeries();
    const max = Math.max(...data.map(d => d.val), 1);
    chart.innerHTML = data.map(d => `
      <div class="chart-col">
        <div class="chart-val">${d.val}</div>
        <div class="chart-bar" style="height:${(d.val / max) * 80}px"></div>
        <div class="chart-label">${d.day}</div>
      </div>
    `).join("");
  }
}

function initGuide() {
  const el = document.getElementById("guide-items");
  if (!el) return;

  const PET = [
    "Soft drink bottles (Coke, Pepsi, etc.)",
    "Bottled water containers",
    "Energy drink bottles",
    "Cooking oil bottles",
    "Food-grade transparent containers",
    "Salad dressing bottles",
    "Peanut butter jars (PET type only)",
    "Juice bottles (clear plastic type)",
    "Disposable drink cups (PET plastic cups)",
    "Food packaging trays (clear PET type)",
    "Medicine syrup bottles (PET type)",
    "Single-use plastic beverage bottles"
  ];

  const HDPE = [
    "Milk jugs and juice bottles",
    "Shampoo and conditioner bottles",
    "Dishwashing liquid containers",
    "Laundry detergent bottles",
    "Bleach containers",
    "Household cleaning product bottles",
    "Plastic buckets and pails (HDPE type)",
    "Grocery bags (HDPE plastic bags)",
    "Plastic toys (hard plastic, HDPE type)",
    "Pipe and plumbing materials (HDPE pipes)",
    "Storage containers and jerry cans",
    "Cosmetic bottles (non-aerosol HDPE type)"
  ];

  const renderSection = (title, codeLabel, codeClass, items) => `
    <div class="card bb-guide-section">
      <div class="bb-guide-title-row">
        <div class="bb-guide-title">${title}</div>
        <div class="bb-guide-code ${codeClass}">${codeLabel}</div>
      </div>
      <div class="bb-guide-grid">
        ${items
          .map(
            (t) => `
          <div class="bb-guide-chip">
            ${t}
            <small>Tap chips above to log PET/HDPE</small>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;

  el.innerHTML =
    renderSection("PET (Polyethylene Terephthalate)", "Code 1 · PET", "pet", PET) +
    renderSection("HDPE (High-Density Polyethylene)", "Code 2 · HDPE", "hdpe", HDPE);
}

function initRecyclableChecker() {
  const input = document.getElementById("checker-input");
  const btn = document.getElementById("btn-check-waste");
  const out = document.getElementById("checker-result");
  if (!input || !btn || !out) return;

  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const hasAny = (text, words) => words.some((w) => text.includes(w));
  const uniq = (arr) => Array.from(new Set(arr));

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  }

  function fuzzyTokenScore(token, keyword) {
    if (!token || !keyword) return 0;
    if (token === keyword) return 6;
    if (keyword.includes(token) && token.length >= 3) return 4; // partial input: "styro" in "styrofoam"
    if (token.includes(keyword) && keyword.length >= 3) return 3; // phrase contains keyword
    if (token.length >= 4 && keyword.length >= 4 && levenshtein(token, keyword) <= 1) return 2; // basic typo tolerance
    return 0;
  }

  function phraseScore(qTokens, keywords) {
    let score = 0;
    for (const kw of keywords) {
      const kwNorm = norm(kw);
      const kwTokens = kwNorm.split(" ").filter(Boolean);
      if (kwTokens.length > 1) {
        // multi-word keyword: match across phrase
        const hit = kwTokens.every((t) => qTokens.some((qt) => fuzzyTokenScore(qt, t) > 0));
        if (hit) score += 4;
        continue;
      }
      const t = kwTokens[0];
      if (!t) continue;
      const best = Math.max(...qTokens.map((qt) => fuzzyTokenScore(qt, t)));
      score += best;
    }
    return score;
  }

  const NOT_REC = [
    { label: "Styrofoam", keys: ["styrofoam", "styro", "polystyrene", "foam"] },
    { label: "Sachet / multilayer", keys: ["sachet", "laminated", "multi layer", "multilayer", "foil pack"] },
    { label: "Tissue / napkin", keys: ["tissue", "napkin", "toilet paper"] },
    { label: "Food waste", keys: ["food waste", "leftover", "banana peel", "fruit peel"] },
    { label: "Contaminated paper cup", keys: ["paper cup", "coffee cup", "tea cup"] },
    { label: "Plastic straw / utensils", keys: ["straw", "spoon", "fork", "plastic utensil", "cutlery"] },
    { label: "Diapers / sanitary", keys: ["diaper", "sanitary", "pad"] }
  ];

  // Keyword sets include short inputs and common variants.
  const PET_KEYS = [
    "coke",
    "pepsi",
    "soda",
    "soft drink",
    "cola",
    "bottled water",
    "water",
    "water bottle",
    "energy drink",
    "gatorade",
    "sports drink",
    "cooking oil",
    "oil bottle",
    "salad dressing",
    "syrup bottle",
    "medicine syrup",
    "clear bottle",
    "transparent container",
    "pet bottle",
    "bottle",
    "drink",
    "drink cup",
    "clear tray",
    "food tray",
    "juice bottle"
  ];

  const HDPE_KEYS = [
    "shampoo",
    "conditioner",
    "dishwashing",
    "dish soap",
    "soap",
    "laundry",
    "detergent",
    "bleach",
    "gallon",
    "cleaning product",
    "milk jug",
    "jug",
    "jerry can",
    "bucket",
    "pail",
    "pipe",
    "plumbing",
    "toy",
    "grocery bag",
    "hdpe bag",
    "storage container",
    "container",
    "cosmetic bottle"
  ];

  function classify(raw) {
    const q = norm(raw);
    if (!q) return { kind: "empty" };
    if (q.length < 3) return { kind: "vague" };

    const qTokens = uniq(q.split(" ").filter(Boolean));
    const meaningful = qTokens.filter((t) => t.length >= 3);
    if (meaningful.length === 0) return { kind: "vague" };

    // Try non-recyclable first (stronger / safer).
    const notScores = NOT_REC.map((r) => ({
      label: r.label,
      score: phraseScore(meaningful, r.keys)
    })).sort((a, b) => b.score - a.score);
    if (notScores[0] && notScores[0].score >= 4) return { kind: "not", label: notScores[0].label };

    // Category scores (fuzzy / partial / light typo tolerance).
    let petScore = phraseScore(meaningful, PET_KEYS);
    let hdpeScore = phraseScore(meaningful, HDPE_KEYS);

    // Heuristic: if query mentions cleaning-related words, prefer HDPE; beverage-related, prefer PET.
    const beverageBoost = hasAny(q, ["coke", "pepsi", "cola", "soda", "juice", "water", "drink"]) ? 2 : 0;
    const cleaningBoost = hasAny(q, ["shampoo", "detergent", "bleach", "soap", "laundry", "dish"]) ? 2 : 0;
    petScore += beverageBoost;
    hdpeScore += cleaningBoost;

    if (petScore === 0 && hdpeScore === 0) return { kind: "unknown" };
    if (petScore === hdpeScore) {
      // If only "bottle" / "plastic" appears, ask for more detail.
      const generic = hasAny(q, ["plastic", "bottle", "container"]);
      if (generic && meaningful.length === 1) return { kind: "vague" };
      return { kind: "pet" };
    }
    return petScore > hdpeScore ? { kind: "pet" } : { kind: "hdpe" };
  }

  function render(raw) {
    const q = String(raw || "").trim();
    const res = classify(q);
    if (!q) {
      out.innerHTML = "";
      return;
    }

    if (res.kind === "vague") {
      out.innerHTML = `
        <div class="bb-classify">
          <div class="bb-classify-left"><strong>Try a more specific keyword.</strong> Example: "coke", "shampoo", "styro".</div>
          <div class="bb-pill not">Too vague</div>
        </div>
      `;
      return;
    }

    if (res.kind === "unknown") {
      out.innerHTML = `
        <div class="bb-classify">
          <div class="bb-classify-left"><strong>Item not recognized.</strong> Please try a more specific keyword.</div>
          <div class="bb-pill not">Unknown</div>
        </div>
      `;
      return;
    }

    if (res.kind === "not") {
      out.innerHTML = `
        <div class="bb-classify">
          <div class="bb-classify-left"><strong>${q}</strong> → Not Recyclable</div>
          <div class="bb-pill not">Not recyclable</div>
        </div>
      `;
      return;
    }

    if (res.kind === "pet") {
      out.innerHTML = `
        <div class="bb-classify">
          <div class="bb-classify-left"><strong>${q}</strong> → PET (Recyclable)</div>
          <div style="display:flex;gap:8px;align-items:center">
            <div class="bb-pill recyclable">Recyclable</div>
            <div class="bb-pill pet">PET</div>
          </div>
        </div>
      `;
      return;
    }

    out.innerHTML = `
      <div class="bb-classify">
        <div class="bb-classify-left"><strong>${q}</strong> → HDPE (Recyclable)</div>
        <div style="display:flex;gap:8px;align-items:center">
          <div class="bb-pill recyclable">Recyclable</div>
          <div class="bb-pill hdpe">HDPE</div>
        </div>
      </div>
    `;
  }

  let t = null;
  const schedule = () => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => render(input.value), 120);
  };

  input.addEventListener("input", schedule);
  btn.addEventListener("click", () => render(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      render(input.value);
    }
  });
}

function initRewards() {
  const grid = document.getElementById("rewards-grid");
  if (!grid) return;
  const paint = catalog => {
    grid.innerHTML = catalog
      .map(r => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div><strong>${r.display}</strong><br/><small>${r.cost} pts</small></div>
      <button class="btn btn-outline" onclick="redeemReward('${r.id}')">Redeem</button>
    </div>
  `)
      .join("");
  };
  if (apiMode && getToken()) {
    apiFetch("/rewards")
      .then(res => {
        paint(
          (res.rewards || []).map(r => ({
            id: r.id,
            display: r.display,
            cost: r.cost
          }))
        );
      })
      .catch(() => paint(RewardsService.catalog()));
    return;
  }
  paint(RewardsService.catalog());
}

async function redeemReward(rewardId) {
  const user = AuthService.currentUser();
  if (!user || user.role !== "household") {
    showToast("Only household users can redeem rewards.");
    return;
  }
  if (apiMode && getToken()) {
    try {
      const result = await apiFetch("/rewards/redeem", {
        method: "POST",
        body: JSON.stringify({ rewardId })
      });
      await syncFromServer();
      showToast(`Redeemed: ${result.reward.display}`);
      refreshUI();
      return;
    } catch (e) {
      showToast(e.message || "Redemption failed.");
      return;
    }
  }
  const result = RewardsService.redeem(rewardId, user);
  if (!result.ok) {
    showToast(result.message);
    return;
  }
  showToast(`Redeemed: ${result.reward.display}`);
  refreshUI();
}

function initAuth() {
  const loginBtn = document.getElementById("btn-login");
  const authForm = document.getElementById("auth-form");
  const authTabs = document.querySelectorAll(".auth-tab");
  const roleCards = document.querySelectorAll(".role-card");
  const authPrimaryButton = document.getElementById("btn-login");
  const screenAuth = document.getElementById("screen-auth");
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  const passwordToggleBtn = document.getElementById("auth-password-toggle");
  const phoneInput = document.getElementById("auth-phone-number");
  const addressInput = document.getElementById("auth-address");
  const emailError = document.getElementById("auth-email-error");
  const passwordError = document.getElementById("auth-password-error");
  const phoneError = document.getElementById("auth-phone-number-error");
  const addressError = document.getElementById("auth-address-error");

  const setFieldError = (inputEl, errorEl, message) => {
    if (!inputEl || !errorEl) return;
    const text = message ? String(message).trim() : "";
    errorEl.textContent = text;
    inputEl.classList.toggle("is-invalid", Boolean(text));
  };

  const clearInlineErrors = () => {
    setFieldError(emailInput, emailError, "");
    setFieldError(passwordInput, passwordError, "");
    setFieldError(phoneInput, phoneError, "");
    setFieldError(addressInput, addressError, "");
  };

  const syncPasswordAutocomplete = () => {
    if (passwordInput)
      passwordInput.setAttribute(
        "autocomplete",
        AppState.authMode === "register" ? "new-password" : "current-password"
      );
  };

  const syncAuthModeChrome = () => {
    if (screenAuth) screenAuth.classList.toggle("auth-mode-register", AppState.authMode === "register");
    syncPasswordAutocomplete();
  };

  const clearAuthFields = () => {
    if (emailInput) emailInput.value = "";
    if (passwordInput) passwordInput.value = "";
    if (phoneInput) phoneInput.value = "";
    if (addressInput) addressInput.value = "";
  };
  const focusAuthEmail = () => {
    if (emailInput) emailInput.focus();
  };
  window.clearAuthFields = clearAuthFields;
  window.focusAuthEmail = focusAuthEmail;
  clearAuthFields();
  clearInlineErrors();
  syncAuthModeChrome();

  emailInput?.addEventListener("input", () => setFieldError(emailInput, emailError, ""));
  passwordInput?.addEventListener("input", () => setFieldError(passwordInput, passwordError, ""));
  phoneInput?.addEventListener("input", () => setFieldError(phoneInput, phoneError, ""));
  addressInput?.addEventListener("input", () => setFieldError(addressInput, addressError, ""));

  passwordToggleBtn?.addEventListener("click", () => {
    if (!passwordInput) return;
    const reveal = passwordInput.type === "password";
    passwordInput.type = reveal ? "text" : "password";
    passwordToggleBtn.setAttribute("aria-pressed", String(reveal));
    passwordToggleBtn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    // Keep a single eye icon; indicate state via aria + subtle styling.
    passwordToggleBtn.textContent = "👁️";
    passwordToggleBtn.classList.toggle("is-revealed", reveal);
    passwordInput.focus();
  });

  authTabs.forEach((tab, idx) => {
    tab.addEventListener("click", () => {
      authTabs.forEach((t, i) => {
        t.classList.toggle("active", i === idx);
        t.setAttribute("aria-selected", String(i === idx));
      });
      AppState.authMode = idx === 1 ? "register" : "login";
      syncAuthModeChrome();
      clearInlineErrors();
      if (authPrimaryButton) {
        authPrimaryButton.textContent = AppState.authMode === "register" ? "Create BinBuddy Account" : "Login to BinBuddy";
      }
    });
  });

  roleCards.forEach(card => {
    card.addEventListener("click", () => {
      roleCards.forEach(c => {
        c.classList.remove("selected");
        c.setAttribute("aria-pressed", "false");
      });
      card.classList.add("selected");
      card.setAttribute("aria-pressed", "true");
      AppState.role = normalizeRole(card.dataset.role);
    });
  });

  const submitAuth = async () => {
    clearInlineErrors();
    const email = (emailInput ? emailInput.value : "").trim();
    const password = passwordInput ? passwordInput.value : "";
    const phoneNumber = (phoneInput ? phoneInput.value : "").trim();
    const address = (addressInput ? addressInput.value : "").trim();
    if (!email || !email.includes("@")) {
      setFieldError(emailInput, emailError, "Please enter a valid email address");
      emailInput?.focus();
      return;
    }
    if (email.includes(" ")) {
      setFieldError(emailInput, emailError, "Please enter a valid email address");
      emailInput?.focus();
      return;
    }

    const loginPwErr = validateLoginPasswordPresence(password);
    if (loginPwErr && AppState.authMode === "login") {
      setFieldError(passwordInput, passwordError, loginPwErr);
      passwordInput?.focus();
      return;
    }
    if (AppState.authMode === "register") {
      const phoneValidationError = validateRegisterPhoneClient(phoneNumber);
      if (phoneValidationError) {
        setFieldError(phoneInput, phoneError, phoneValidationError);
        phoneInput?.focus();
        return;
      }
      const addressValidationError = validateRegisterAddressClient(address);
      if (addressValidationError) {
        setFieldError(addressInput, addressError, addressValidationError);
        addressInput?.focus();
        return;
      }
      const rp = validateRegisterPasswordClient(password);
      if (rp) {
        setFieldError(passwordInput, passwordError, "Password must be at least 8 characters with letters and numbers");
        passwordInput?.focus();
        return;
      }
    }

    if (AppState.authMode === "register") {
      const registrationRole = normalizeRole(AppState.role);
      const displayName = sanitizeRegisterName(email);
      try {
        const reg = await apiFetch("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            name: displayName,
            role: registrationRole,
            phoneNumber,
            address
          })
        });
        setToken(reg.token);
        await syncFromServer();
        const regHome = getRoleHomeScreen(reg.user.role);
        finalizeAuthenticatedEntry(regHome, { replaceHistory: true });
        showToast(`Welcome, ${reg.user.name}`);
        return;
      } catch (e) {
        console.warn("[auth] register rejected or api failed — check server logs.", e?.message || e, e?.data || "");
        const reg = AuthService.register({
          email,
          password,
          name: displayName,
          role: registrationRole,
          phoneNumber,
          address
        });
        if (!reg.ok) {
          showToast(e.message || reg.message);
          return;
        }
        const locLogin = AuthService.login({ email, password, role: registrationRole });
        if (!locLogin.ok) {
          showToast(locLogin.message);
          return;
        }
        finalizeAuthenticatedEntry(getRoleHomeScreen(locLogin.user.role), { replaceHistory: true });
        showToast(`Welcome, ${locLogin.user.name}`);
        return;
      }
    }

    try {
      const login = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          role: normalizeRole(AppState.role)
        })
      });
      setToken(login.token);
      await syncFromServer();
      const targetScreen = getRoleHomeScreen(login.user.role);
      finalizeAuthenticatedEntry(targetScreen, { replaceHistory: true });
      showToast(`Welcome, ${login.user.name}`);
      return;
    } catch (e) {
      const loginFallback = AuthService.login({ email, password, role: normalizeRole(AppState.role) });
      if (!loginFallback.ok) {
        setFieldError(passwordInput, passwordError, "Incorrect password");
        showToast("Incorrect password");
        return;
      }
      const targetScreen = getRoleHomeScreen(loginFallback.user.role);
      finalizeAuthenticatedEntry(targetScreen, { replaceHistory: true });
      showToast(`Welcome, ${loginFallback.user.name}`);
    }
  };

  authForm?.addEventListener("submit", ev => {
    ev.preventDefault();
    submitAuth();
  });

  if (loginBtn) {
    loginBtn.addEventListener("click", ev => {
      ev.preventDefault();
      submitAuth();
    });
  }

}

function initAdminActions() {
  const exportBtn = document.getElementById("btn-export");
  if (!exportBtn) return;
  exportBtn.addEventListener("click", async () => {
    const user = AuthService.currentUser();
    if (!user || user.role !== "admin") {
      showToast("Admin access only.");
      return;
    }
    if (apiMode && getToken()) {
      try {
        const res = await fetch(`${API_BASE}/admin/export.csv`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        if (!res.ok) throw new Error("Export failed.");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "binbuddy-waste-logs.csv";
        a.click();
        URL.revokeObjectURL(url);
        showToast("CSV downloaded.");
        return;
      } catch (e) {
        showToast(e.message || "Export failed.");
        return;
      }
    }
    showToast("CSV export generated.");
  });
}

function initNavigation() {
  document.querySelectorAll(".nav-item").forEach(btn => {
    const navigate = () => {
      const action = btn.dataset.action;
      if (action === "logout") {
        logout();
        return;
      }
      const screen = btn.dataset.nav;
      if (screen) goTo(screen);
    };
    btn.addEventListener("click", navigate);
    btn.addEventListener(
      "touchend",
      e => {
        e.preventDefault();
        navigate();
      },
      { passive: false }
    );
  });

  const plus = document.getElementById("qty-plus");
  const minus = document.getElementById("qty-minus");
  if (plus) plus.addEventListener("click", increaseQty);
  if (minus) minus.addEventListener("click", decreaseQty);

  document.querySelectorAll("#manual-panel .waste-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      if (chip.style.display === "none") return;
      document.querySelectorAll("#manual-panel .waste-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      AppState.logType = chip.dataset.type;
    });
  });

  const submitBtn = document.getElementById("btn-submit-log");
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const user = AuthService.currentUser();
      if (!user || user.role !== "household") {
        showToast("Only household users can submit logs.");
        return;
      }
      const weight = getManualInputWeight();
      const error = WasteLogService.validate(weight, AppState.logType, user);
      if (error) {
        showToast(error);
        return;
      }
      AppState.logQty = weight;
      await submitLog();
    });
  }

  const manualDate = document.getElementById("manual-log-date");
  const modalDate = document.getElementById("modal-log-date");
  if (manualDate && !manualDate.value) manualDate.value = todayInputValue();
  if (modalDate && !modalDate.value) modalDate.value = todayInputValue();

  const manualPhoto = document.getElementById("manual-log-photo");
  const modalPhoto = document.getElementById("modal-log-photo");
  manualPhoto?.addEventListener("change", () => {
    const file = manualPhoto.files?.[0];
    updatePhotoLabel(file ? file.name : "");
  });
  modalPhoto?.addEventListener("change", () => {
    const file = modalPhoto.files?.[0];
    updatePhotoLabel(file ? file.name : "");
    if (manualPhoto && modalPhoto.files?.length) {
      manualPhoto.value = "";
    }
  });
}

function selectModalType(type, el) {
  const normalized = type === "bio" || type === "pet" || type === "PET"
    ? "bio"
    : type === "rec" || type === "hdpe" || type === "HDPE"
      ? "rec"
      : null;
  if (!normalized || !el || el.style.display === "none") {
    showToast("Please select PET or HDPE only.");
    return;
  }
  document.querySelectorAll("#log-modal .waste-chip").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  AppState.logType = normalized;
}

function refreshUI() {
  renderHomeGreeting();
  renderUserAddress();
  renderProfile();
  updateHomeStats();
  renderRecentLogs();
  renderNotifications();
  renderCollectorView();
  renderLeaderboard();
  renderAdminAnalytics();
  initRewards();
  persistState();
}

function clearRuntimeUserContext() {
  AppState.currentUserId = null;
  AppState.currentUserName = null;
  AppState.role = "household";
  AppState.currentScreen = "auth";
  AppState.logType = "bio";
  AppState.logQty = 1.0;
}

function logout(showMessage = true, requireConfirmation = false) {
  if (requireConfirmation && !window.confirm("Are you sure you want to logout?")) {
    return;
  }
  clearToken();
  apiMode = false;
  adminAnalyticsCache = null;
  SessionManager.clearAppCache();
  clearRuntimeUserContext();
  clearSession();
  loadState();
  suppressSplashTransitions = false;
  exitAuthenticatedMount();
  goToAuthScreen(false);
  if (window.clearAuthFields) window.clearAuthFields();
  if (window.focusAuthEmail) window.focusAuthEmail();
  historySyncLogin();
  if (showMessage) showToast("Logged out successfully.");
}

function goToAuthScreen(refresh = true) {
  document.querySelectorAll("#mount-login-phase .screen").forEach(el => el.classList.remove("active"));
  dashboardScreensDeactivateAll();
  const target = document.getElementById("screen-auth");
  if (target) target.classList.add("active");
  AppState.currentScreen = "auth";
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.remove("active");
    btn.classList.add("hidden");
  });
  const nav = document.getElementById("bottom-nav");
  if (nav) nav.classList.add("hidden");
  if (window.clearAuthFields) window.clearAuthFields();
  if (window.focusAuthEmail) window.focusAuthEmail();
  if (refresh) refreshUI();
  resetViewportScroll(target || document.getElementById("screen-auth"));
}

document.addEventListener("DOMContentLoaded", async () => {
  loadState();
  loadSession();
  HistoryGuard.init();

  let restored = false;
  if (getToken()) {
    restored = await syncFromServer();
  }

  runInitialUrlRouting(restored);

  initSplash(restored);
  setupWasteTypeSelectors();
  initNavigation();
  initAuth();
  initAdminActions();
  initGuide();
  initRecyclableChecker();
  updateQtyUI();
  resetLogInputs();
  refreshUI();
});

window.AppState = AppState;
window.goTo = goTo;
window.showToast = showToast;
window.openLogModal = openLogModal;
window.closeModal = closeModal;
window.submitLog = submitLog;
window.increaseQty = increaseQty;
window.decreaseQty = decreaseQty;
window.renderLeaderboard = renderLeaderboard;
window.renderNotifications = renderNotifications;
window.initGuide = initGuide;
window.initRewards = initRewards;
window.handleCollectorDecision = handleCollectorDecision;
window.redeemReward = redeemReward;
window.selectModalType = selectModalType;
window.logout = logout;
window.cancelLogSubmission = cancelLogSubmission;
