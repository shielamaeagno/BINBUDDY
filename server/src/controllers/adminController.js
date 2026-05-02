import { adminMetrics, weeklySeries } from "../services/analyticsService.js";
import { db } from "../db.js";

export function getAnalytics(req, res) {
  const metrics = adminMetrics();
  const weekly = weeklySeries();
  const topUsers = db
    .prepare(
      `SELECT user_code, full_name, eco_points FROM users WHERE role = 'household' ORDER BY eco_points DESC LIMIT 5`
    )
    .all()
    .map((u, i) => ({
      rank: i + 1,
      id: u.user_code,
      name: u.full_name,
      ecoPoints: u.eco_points
    }));

  return res.json({
    ok: true,
    metrics,
    weeklyChart: weekly.map(({ day, val }) => ({ day, val })),
    topHouseholds: topUsers
  });
}

export function exportCsv(req, res) {
  const logs = db
    .prepare(
      `
    SELECT wl.log_code, u.user_code, u.full_name, wl.waste_type, wl.weight, wl.status, wl.eco_points_awarded, wl.created_at
    FROM waste_logs wl
    JOIN users u ON u.id = wl.user_id
    ORDER BY wl.created_at DESC
  `
    )
    .all();

  const header = "log_code,user_id,user_name,type_kg,weight,status,points,created_at\n";
  const lines = logs
    .map(
      (r) =>
        `${r.log_code},${r.user_code},"${String(r.full_name).replace(/"/g, '""')}",${r.waste_type},${r.weight},${r.status},${r.eco_points_awarded},${r.created_at}`
    )
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=binbuddy-waste-logs.csv");
  return res.send(header + lines);
}
