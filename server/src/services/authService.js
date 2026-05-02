import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { signToken } from "../middleware/auth.js";
import { toPublicUser, badgeFromPoints } from "./userMapper.js";
import { normalizeRoleInput, isCanonicalRole } from "./roleNormalize.js";

const AUTH_LOG = process.env.BINBUDDY_AUTH_LOG !== "false";

function authLog(event, detail) {
  if (!AUTH_LOG) return;
  try {
    console.info(`[auth] ${event}`, detail);
  } catch {
    /* ignore */
  }
}

function getUserByEmail(email) {
  /** Parameter-bound query — not string-interpolated (SQL injection safe). */
  return db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email.trim());
}

function nextUserCode(role) {
  const prefix = role === "collector" ? "COL" : role === "admin" ? "ADM" : "USR";
  const row = db.prepare(`SELECT user_code FROM users WHERE user_code LIKE ? ORDER BY user_code DESC LIMIT 1`).get(`${prefix}%`);
  if (!row) return `${prefix}001`;
  const n = Number.parseInt(row.user_code.slice(3), 10) || 0;
  return `${prefix}${String(n + 1).padStart(3, "0")}`;
}

export function register({ email, password, name, role: roleRaw }) {
  const role = normalizeRoleInput(roleRaw);
  if (!role || !isCanonicalRole(role)) {
    authLog("register_rejected", { reason: "invalid_role", roleRaw: typeof roleRaw === "string" ? roleRaw.slice(0, 32) : roleRaw });
    return { ok: false, message: "Invalid role. Use user, collector, or admin." };
  }

  const existing = getUserByEmail(email);
  if (existing) {
    authLog("register_rejected", { reason: "duplicate_email" });
    return { ok: false, message: "An account with this email already exists." };
  }
  const user_code = nextUserCode(role);
  const full_name = (name || email.split("@")[0].replace(/\./g, " ") || "User").trim();
  const password_hash = bcrypt.hashSync(password, 10);
  const level = role === "household" ? badgeFromPoints(0) : null;

  db.prepare(
    `INSERT INTO users (user_code, full_name, email, password_hash, role, eco_points, streak_days, level, barangay)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'Holy Spirit')`
  ).run(user_code, full_name, email.trim().toLowerCase(), password_hash, role, level);

  const user = db.prepare("SELECT * FROM users WHERE user_code = ?").get(user_code);
  authLog("register_ok", { user_code, role });
  const token = signToken({
    sub: user.id,
    code: user.user_code,
    role: user.role,
    email: user.email
  });
  return { ok: true, token, user: toPublicUser(user) };
}

export function login({ email, password, role: roleRaw }) {
  const requestedRole = normalizeRoleInput(roleRaw);
  if (!requestedRole || !isCanonicalRole(requestedRole)) {
    authLog("login_rejected", { reason: "invalid_role", roleRaw: typeof roleRaw === "string" ? roleRaw.slice(0, 32) : roleRaw });
    return { ok: false, message: "Invalid role. Use user, collector, or admin." };
  }

  const user = getUserByEmail(email);
  if (!user) {
    authLog("login_rejected", { reason: "unknown_email" });
    return { ok: false, message: "Invalid credentials for selected role." };
  }

  const storedRole = normalizeRoleInput(user.role);
  if (storedRole !== requestedRole) {
    authLog("login_rejected", {
      reason: "role_mismatch",
      requested: requestedRole,
      stored: storedRole || user.role
    });
    return { ok: false, message: "Invalid credentials for selected role." };
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    authLog("login_rejected", { reason: "bad_password", role: requestedRole });
    return { ok: false, message: "Invalid credentials for selected role." };
  }
  const token = signToken({
    sub: user.id,
    code: user.user_code,
    role: user.role,
    email: user.email
  });
  authLog("login_ok", { user_code: user.user_code, role: user.role });
  return { ok: true, token, user: toPublicUser(user) };
}

export function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function guestLoginAsDemoHousehold() {
  const user = db.prepare("SELECT * FROM users WHERE user_code = ?").get("USR001");
  if (!user) return { ok: false, message: "Demo user not available." };
  const token = signToken({
    sub: user.id,
    code: user.user_code,
    role: user.role,
    email: user.email
  });
  return { ok: true, token, user: toPublicUser(user) };
}
