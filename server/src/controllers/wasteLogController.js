import { body, param, validationResult } from "express-validator";
import { createLog, listLogsForRole, listNotificationsForUser, verifyLog, getLeaderboard } from "../services/wasteLogService.js";

export const createLogValidators = [
  body("wasteType").isIn(["PET", "HDPE", "pet", "hdpe", "bio", "rec"]),
  body("weight").isFloat({ gt: 0 }),
  body("notes").optional().isString().isLength({ max: 2000 })
];

export function getLogs(req, res) {
  const logs = listLogsForRole(req.auth);
  return res.json({ ok: true, logs });
}

export function postLog(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ ok: false, message: "Invalid input.", errors: errors.array() });
  }
  if (req.auth.role !== "household") {
    return res.status(403).json({ ok: false, message: "Only household users can submit logs." });
  }
  const { wasteType, weight, notes } = req.body;
  try {
    const log = createLog(req.auth.sub, { wasteType, weight, notes });
    return res.status(201).json({ ok: true, log });
  } catch (e) {
    return res.status(400).json({ ok: false, message: e.message || "Could not create log." });
  }
}

export const verifyValidators = [param("logCode").isString().isLength({ min: 3, max: 32 }), body("approve").isBoolean()];

export function patchVerify(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ ok: false, message: "Invalid input.", errors: errors.array() });
  }
  const { logCode } = req.params;
  const { approve } = req.body;
  const result = verifyLog(logCode, req.auth.sub, approve);
  if (!result.ok) return res.status(404).json(result);
  return res.json(result);
}

export function getNotifications(req, res) {
  const items = listNotificationsForUser(req.auth.sub);
  return res.json({ ok: true, notifications: items });
}

export function getLeaderboardApi(req, res) {
  const leaderboard = getLeaderboard();
  return res.json({ ok: true, leaderboard });
}
