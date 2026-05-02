import { body, validationResult } from "express-validator";
import { listRewards, redeem } from "../services/rewardService.js";
import { getUserById } from "../services/authService.js";
import { toPublicUser } from "../services/userMapper.js";

export function getRewards(req, res) {
  return res.json({ ok: true, rewards: listRewards() });
}

export const redeemValidators = [body("rewardId").isString().isLength({ min: 3, max: 64 })];

export function postRedeem(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ ok: false, message: "Invalid input.", errors: errors.array() });
  }
  if (req.auth.role !== "household") {
    return res.status(403).json({ ok: false, message: "Only household users can redeem rewards." });
  }
  const result = redeem(req.auth.sub, req.body.rewardId);
  if (!result.ok) return res.status(400).json(result);
  const user = getUserById(req.auth.sub);
  return res.json({ ...result, user: toPublicUser(user) });
}
