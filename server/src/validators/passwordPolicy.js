/** Strong-password rules for registration (aligned with frontend). Letters + digits, bounded length. */
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

export function isStrongPassword(value) {
  return typeof value === "string" && PASSWORD_REGEX.test(value);
}

export function registerPasswordErrorMessage() {
  return "Password must be 8–128 characters and include at least one letter and one number.";
}
