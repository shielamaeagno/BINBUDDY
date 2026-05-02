import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import {
  registerValidators,
  postRegister,
  loginValidators,
  postLogin,
  getMe,
  postGuest
} from "../controllers/authController.js";
import {
  createLogValidators,
  getLogs,
  postLog,
  verifyValidators,
  patchVerify,
  getNotifications,
  getLeaderboardApi
} from "../controllers/wasteLogController.js";
import { getRewards, redeemValidators, postRedeem } from "../controllers/rewardController.js";
import { getAnalytics, exportCsv } from "../controllers/adminController.js";

const r = Router();

r.post("/auth/register", registerValidators, postRegister);
r.post("/auth/login", loginValidators, postLogin);
r.post("/auth/guest", postGuest);
r.get("/auth/me", requireAuth, getMe);

r.get("/logs", requireAuth, getLogs);
r.post("/logs", requireAuth, requireRoles("household"), createLogValidators, postLog);
r.patch("/logs/:logCode/verify", requireAuth, requireRoles("collector"), verifyValidators, patchVerify);

r.get("/notifications", requireAuth, getNotifications);
r.get("/leaderboard", requireAuth, getLeaderboardApi);

r.get("/rewards", requireAuth, getRewards);
r.post("/rewards/redeem", requireAuth, redeemValidators, postRedeem);

r.get("/admin/analytics", requireAuth, requireRoles("admin"), getAnalytics);
r.get("/admin/export.csv", requireAuth, requireRoles("admin"), exportCsv);

r.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not found." });
});

export default r;
