const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email) {
  const value = email.trim();
  if (!value) return "Email is required.";
  if (value.length > 254) return "Email must be 254 characters or fewer.";
  if (!EMAIL_RE.test(value)) return "Enter a valid email address.";
  return "";
}

export function validatePassword(password) {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 72) return "Password must be 72 characters or fewer.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    return "Password needs at least one letter and one number.";
  return "";
}

export function validateConfirm(password, confirm) {
  if (!confirm) return "Please confirm your password.";
  if (password !== confirm) return "Passwords do not match.";
  return "";
}

export function validateName(name, label) {
  const value = name.trim();
  if (!value) return `${label} is required.`;
  if (value.length > 50) return `${label} must be 50 characters or fewer.`;
  if (!/^\p{L}[\p{L}\p{M} '.-]*$/u.test(value)) return `${label} can only contain letters, spaces, hyphens and apostrophes.`;
  return "";
}

// phone is optional
export function validatePhone(phone) {
  const value = phone.trim();
  if (!value) return "";
  if (value.length > 20) return "Phone must be 20 characters or fewer.";
  const digits = value.replace(/\D/g, "").length;
  if (!/^\+?[\d\s\-().]+$/.test(value) || digits < 7 || digits > 15) return "Enter a valid phone number.";
  return "";
}

export function validateFullName(name) {
  const value = name.trim();
  if (!value) return "Full name is required.";
  if ([...value].length > 100) return "Full name must be 100 characters or fewer.";
  if (!/^\p{L}[\p{L}\p{M} '.-]*$/u.test(value)) return "Full name can only contain letters, spaces, hyphens, apostrophes and periods.";
  return "";
}

