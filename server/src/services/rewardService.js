import { db } from "../db.js";
import { badgeFromPoints } from "./userMapper.js";

export function listRewards() {
  return db
    .prepare(`SELECT reward_code, name, display_label, points_required FROM rewards ORDER BY points_required`)
    .all()
    .map((r) => ({
      id: r.reward_code,
      name: r.name,
      display: r.display_label,
      cost: r.points_required
    }));
}

export function redeem(userId, rewardCode) {
  const reward = db.prepare(`SELECT * FROM rewards WHERE reward_code = ?`).get(rewardCode);
  if (!reward) return { ok: false, message: "Reward not found." };

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!user || user.role !== "household") {
    return { ok: false, message: "Only household users can redeem rewards." };
  }
  if (user.eco_points < reward.points_required) {
    return { ok: false, message: "Not enough EcoPoints." };
  }

  const newBal = user.eco_points - reward.points_required;
  db.prepare(`UPDATE users SET eco_points = ?, level = ?, updated_at = datetime('now') WHERE id = ?`).run(
    newBal,
    badgeFromPoints(newBal),
    userId
  );

  db.prepare(`INSERT INTO redemptions (user_id, reward_id, points_spent) VALUES (?, ?, ?)`).run(
    userId,
    reward.id,
    reward.points_required
  );

  db.prepare(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`).run(
    userId,
    `Redeemed ${reward.display_label} for ${reward.points_required} points.`
  );

  return {
    ok: true,
    reward: {
      id: reward.reward_code,
      display: reward.display_label,
      cost: reward.points_required
    },
    balanceAfter: newBal
  };
}
