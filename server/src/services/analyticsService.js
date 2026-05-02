import { db } from "../db.js";

export function adminMetrics() {
  const totalLogs = db.prepare(`SELECT COUNT(*) AS c FROM waste_logs`).get().c;
  const completed = db.prepare(`SELECT COUNT(*) AS c FROM waste_logs WHERE status = 'completed'`).get().c;
  const pending = totalLogs - completed;
  const kgRow = db
    .prepare(`SELECT COALESCE(SUM(weight), 0) AS kg FROM waste_logs WHERE status = 'completed'`)
    .get();
  const totalCollectedKg = Number(Number(kgRow.kg).toFixed(1));
  const compliance = totalLogs > 0 ? Math.round((completed / totalLogs) * 100) : 0;
  const ptsRow = db.prepare(`SELECT COALESCE(SUM(eco_points_awarded), 0) AS p FROM waste_logs`).get();
  const ecoPointsDistributed = ptsRow.p || 0;
  const households = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'household'`).get().c;

  const petKg =
    db
      .prepare(`SELECT COALESCE(SUM(weight),0) AS k FROM waste_logs WHERE status='completed' AND waste_type='PET'`)
      .get().k || 0;
  const hdpeKg =
    db
      .prepare(`SELECT COALESCE(SUM(weight),0) AS k FROM waste_logs WHERE status='completed' AND waste_type='HDPE'`)
      .get().k || 0;
  const recTotal = petKg + hdpeKg;
  const totalKgAll =
    db.prepare(`SELECT COALESCE(SUM(weight),0) AS k FROM waste_logs WHERE status='completed'`).get().k || 0;
  const recyclingRate =
    totalKgAll > 0 ? Math.round(((petKg + hdpeKg) / totalKgAll) * 100) : 0;

  return {
    totalLogs,
    completedLogs: completed,
    pendingLogs: pending,
    totalCollectedKg,
    compliance,
    ecoPointsDistributed,
    activeHouseholds: households,
    recyclingRate,
    completedCountForDisplay: completed
  };
}

export function weeklySeries() {
  const rows = db
    .prepare(
      `
    SELECT strftime('%w', completed_at) AS dow, SUM(weight) AS w
    FROM waste_logs
    WHERE status = 'completed' AND completed_at IS NOT NULL
    GROUP BY dow
  `
    )
    .all();

  const map = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
  const sequence = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const byDay = {};
  rows.forEach((r) => {
    const label = map[r.dow];
    byDay[label] = (byDay[label] || 0) + Number(r.w || 0);
  });

  const fallback = db
    .prepare(
      `
    SELECT strftime('%w', created_at) AS dow, SUM(weight) AS w
    FROM waste_logs
    WHERE status = 'completed'
    GROUP BY dow
  `
    )
    .all();
  if (Object.keys(byDay).length === 0) {
    fallback.forEach((r) => {
      const label = map[r.dow];
      byDay[label] = (byDay[label] || 0) + Number(r.w || 0);
    });
  }

  const vals = sequence.map((day) => Number((byDay[day] || 0).toFixed(1)));
  return sequence.map((day, i) => ({ day, val: vals[i] }));
}
