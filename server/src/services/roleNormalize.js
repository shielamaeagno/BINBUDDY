/** Canonical roles stored in SQLite `users.role` CHECK constraint. */
export const CANONICAL_ROLES = ["household", "collector", "admin"];

/**
 * Normalize client/API role strings: trim, lowercase, map aliases → DB value.
 * UI uses "household"; requirements also allow "user" for the same tier.
 */
export function normalizeRoleInput(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === "user" || v === "household") return "household";
  if (v === "collector") return "collector";
  if (v === "admin") return "admin";
  return null;
}

export function isCanonicalRole(role) {
  return CANONICAL_ROLES.includes(role);
}
