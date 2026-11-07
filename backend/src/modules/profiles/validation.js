const { validatePhone } = require("../auth/validation");

const FULL_NAME_MAX = 100;
const validateFullName = (value) => {
  if (typeof value !== "string") return "Full name must be text.";
  if (!value.trim()) return "Full name is required.";
  if ([...value.trim()].length > FULL_NAME_MAX) return "Full name must be 100 characters or fewer.";
  if (!/^\p{L}[\p{L}\p{M} '.-]*$/u.test(value.trim())) return "Full name can only contain letters, spaces, hyphens, apostrophes and periods.";
  return "";
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validatePreferences = (value) => {
  if (!isObject(value)) return "Preferences must be an object.";
  if (Object.keys(value).some((key) => key !== "contactMethod")) return "Unknown preference. Only contactMethod is supported.";
  if (Object.hasOwn(value, "contactMethod") && !["email", "phone"].includes(value.contactMethod)) {
    return "Preferred contact method must be email or phone.";
  }
  return "";
};

// PATCH accepts only supplied fields. Empty phone clears it; {} clears preferences.
const validateProfile = (body) => {
  if (!isObject(body)) return { body: "Send a profile object." };
  const fields = Object.create(null);
  const allowed = ["fullName", "phone", "preferences"];
  if (!Object.keys(body).length) fields.body = "Send at least one profile field.";
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fields[key] = key === "email" ? "Email is managed by your account and cannot be edited here." : "This field cannot be edited.";
  }
  if (Object.hasOwn(body, "fullName")) fields.fullName = validateFullName(body.fullName);
  if (Object.hasOwn(body, "phone")) fields.phone = validatePhone(body.phone);
  if (Object.hasOwn(body, "preferences")) fields.preferences = validatePreferences(body.preferences);
  return Object.fromEntries(Object.entries(fields).filter(([, message]) => message));
};

module.exports = { FULL_NAME_MAX, isObject, validateFullName, validatePreferences, validateProfile };
