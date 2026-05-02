import { db } from "../db.js";
import { toPublicUser, badgeFromPoints } from "./userMapper.js";

function rowToLog(row) {
  if (!row) return null;
  return {
    id: row.log_code,
    userId: row.user_user_code,
    userName: row.user_full_name,
    type: row.waste_type,
    weight: Number(row.weight),
    createdAt: row.created_at,
    status: row.status === "completed" ? "Completed" : "Pending",
    verifiedBy: row.verifier_code || null,
    completedAt: row.completed_at || null,
    ecoPointsAwarded: row.eco_points_awarded || 0
  };
}

const listSql = `
  SELECT wl.*, u.user_code AS user_user_code, u.full_name AS user_full_name,
         vu.user_code AS verifier_code
  FROM waste_logs wl
  JOIN users u ON u.id = wl.user_id
  LEFT JOIN users vu ON vu.id = wl.verified_by
`;

export function listLogsForRole(auth) {
  if (auth.role === "household") {
    const rows = db.prepare(`${listSql} WHERE wl.user_id = ? ORDER BY wl.created_at DESC`).all(auth.sub);
    return rows.map(rowToLog);
  }
  const rows = db.prepare(`${listSql} ORDER BY wl.created_at DESC`).all();
  return rows.map(rowToLog);
}

export function listNotificationsForUser(userId) {
  return db
    .prepare(
      `SELECT message, created_at FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 50`
    )
    .all(userId)
    .map((n) => ({ text: n.message, createdAt: n.created_at || n.createdAt }));
}

function nextLogCode() {
  const row = db.prepare(`SELECT log_code FROM waste_logs ORDER BY id DESC LIMIT 1`).get();
  if (!row) return `LOG${Date.now().toString().slice(-6)}`;
  return `LOG${Date.now().toString().slice(-8)}`;
}

export function createLog(userId, { wasteType, weight, notes }) {
  const raw = String(wasteType || "").toLowerCase();
  const wt = raw === "hdpe" || raw === "rec" ? "HDPE" : "PET";
  const w = Math.round(Number(weight) * 100) / 100;
  if (!(w > 0)) throw new Error("Invalid weight");

  const log_code = nextLogCode();
  db.prepare(
    `INSERT INTO waste_logs (log_code, user_id, waste_type, weight, status, notes)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(log_code, userId, wt, w, notes || null);

  db.prepare(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`).run(
    userId,
    `Log submitted (${wt}, ${w} kg). Status: Pending.`
  );

  const row = db.prepare(`${listSql} WHERE wl.log_code = ?`).get(log_code);
  return rowToLog(row);
}

function pointsForLog(wasteType, weight) {
  const rate = wasteType === "PET" ? 20 : 25;
  return Math.round(weight * rate);
}

export function verifyLog(logCode, collectorUserId, approve) {
  const log = db.prepare(`${listSql} WHERE wl.log_code = ?`).get(logCode);
  if (!log) return { ok: false, message: "Log not found." };
  const householdId = log.user_id;

  if (!approve) {
    db.prepare(`UPDATE waste_logs SET status = 'pending', verified_by = NULL, eco_points_awarded = 0, completed_at = NULL WHERE log_code = ?`).run(logCode);
    const updated = db.prepare(`${listSql} WHERE wl.log_code = ?`).get(logCode);
    return { ok: true, log: rowToLog(updated) };
  }

  if (log.status === "completed") {
    const updated = db.prepare(`${listSql} WHERE wl.log_code = ?`).get(logCode);
    return { ok: true, log: rowToLog(updated) };
  }

  const pts = pointsForLog(log.waste_type, log.weight);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE waste_logs SET status = 'completed', verified_by = ?, eco_points_awarded = ?, completed_at = ?
     WHERE log_code = ?`
  ).run(collectorUserId, pts, now, logCode);

  const household = db.prepare("SELECT * FROM users WHERE id = ?").get(householdId);
  const newPoints = household.eco_points + pts;
  const newStreak = household.streak_days + 1;
  const newLevel = badgeFromPoints(newPoints);

  db.prepare(
    `UPDATE users SET eco_points = ?, streak_days = ?, level = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newPoints, newStreak, newLevel, householdId);

  db.prepare(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`).run(
    householdId,
    `Log ${logCode} completed. +${pts} EcoPoints awarded.`
  );

  const updated = db.prepare(`${listSql} WHERE wl.log_code = ?`).get(logCode);
  return { ok: true, log: rowToLog(updated) };
}

export function getLeaderboard() {
  const rows = db
    .prepare(
      `SELECT user_code, full_name, eco_points FROM users WHERE role = 'household' ORDER BY eco_points DESC LIMIT 10`
    )
    .all();
  return rows.map((r) => ({
    id: r.user_code,
    name: r.full_name,
    ecoPoints: r.eco_points
  }));
}
