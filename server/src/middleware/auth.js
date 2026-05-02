import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-in-production";

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d", algorithm: "HS256" });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, message: "Authentication required." });
  }
  try {
    req.auth = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: "Invalid or expired session." });
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ ok: false, message: "Authentication required." });
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ ok: false, message: "Insufficient permissions." });
    }
    return next();
  };
}
