import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "binbuddy.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schemaPath = path.join(__dirname, "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf8");
db.exec(schema);

function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return;

  const hash = (p) => bcrypt.hashSync(p, 10);

  const insertUser = db.prepare(`
    INSERT INTO users (user_code, full_name, email, password_hash, role, eco_points, streak_days, level, barangay)
    VALUES (@user_code, @full_name, @email, @password_hash, @role, @eco_points, @streak_days, @level, @barangay)
  `);

  insertUser.run({
    user_code: "USR001",
    full_name: "Maria Santos",
    email: "maria@email.com",
    password_hash: hash("password123"),
    role: "household",
    eco_points: 1245,
    streak_days: 7,
    level: "Eco Champion",
    barangay: "Holy Spirit"
  });
  insertUser.run({
    user_code: "COL001",
    full_name: "Roberto Cruz",
    email: "collector@email.com",
    password_hash: hash("password123"),
    role: "collector",
    eco_points: 0,
    streak_days: 0,
    level: null,
    barangay: "Holy Spirit"
  });
  insertUser.run({
    user_code: "ADM001",
    full_name: "Brgy. Holy Spirit Admin",
    email: "admin@email.com",
    password_hash: hash("password123"),
    role: "admin",
    eco_points: 0,
    streak_days: 0,
    level: null,
    barangay: "Holy Spirit"
  });

  const u1 = db.prepare("SELECT id FROM users WHERE user_code = ?").get("USR001");
  const col = db.prepare("SELECT id FROM users WHERE user_code = ?").get("COL001");

  db.prepare(`
    INSERT INTO waste_logs (log_code, user_id, waste_type, weight, status, verified_by, eco_points_awarded, completed_at)
    VALUES ('LOG001', ?, 'PET', 1.2, 'completed', ?, 24, datetime('now'))
  `).run(u1.id, col.id);

  db.prepare(`
    INSERT INTO waste_logs (log_code, user_id, waste_type, weight, status, eco_points_awarded)
    VALUES ('LOG002', ?, 'HDPE', 0.8, 'pending', 0)
  `).run(u1.id);

  db.prepare(`
    INSERT INTO rewards (reward_code, name, display_label, points_required, category) VALUES
    ('RWD-LOAD-50', 'Mobile Load', '₱50 Load', 500, 'load'),
    ('RWD-VOUCH-100', 'Voucher', '₱100 Voucher', 1000, 'voucher'),
    ('RWD-GCASH-75', 'GCash', '₱75 GCash', 750, 'gcash')
  `).run();
}

seedIfEmpty();
