import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import UserShell from "../components/UserShell";
import { apiGet, apiPatch } from "../api";
import { validateFullName, validatePhone } from "../validation";
import "./Profile.css";

const toForm = (profile) => ({ fullName: profile.fullName, email: profile.email, phone: profile.phone || "", contactMethod: profile.preferences.contactMethod || "" });

export default function Profile() {
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError("");
    apiGet("/profiles/me").then(({ profile }) => {
      if (active) setForm(toForm(profile));
    }).catch((err) => { if (active) setLoadError(err.message); });
    return () => { active = false; };
  }, [attempt]);

  const change = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors({});
    setSuccess("");
    setSubmitError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setSuccess("");
    setSubmitError("");
    const fields = { fullName: validateFullName(form.fullName), phone: validatePhone(form.phone) };
    if (form.contactMethod === "phone" && !form.phone.trim()) fields.phone = "Add a phone number before choosing phone as your preferred contact method.";
    setErrors(fields);
    if (Object.values(fields).some(Boolean)) return;
    setSaving(true);
    try {
      const { profile } = await apiPatch("/profiles/me", {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        preferences: form.contactMethod ? { contactMethod: form.contactMethod } : {},
      });
      setForm(toForm(profile));
      // Display cache only. The form always loads its data from the backend.
      try {
        const saved = JSON.parse(localStorage.getItem("queuesmart.user") || "null");
        if (saved?.id === profile.userId) localStorage.setItem("queuesmart.user", JSON.stringify({ ...saved, name: profile.fullName, email: profile.email, phone: profile.phone || "", preferences: profile.preferences }));
      } catch {
        // A display-cache failure must not turn a successful database save into an error.
      }
      setSuccess("Your profile has been saved.");
    } catch (err) {
      setErrors(err.fields || {});
      setSubmitError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <UserShell eyebrow="Your account" title="My profile" subtitle="Keep your details up to date for your next visit.">
      <div className="qs-card qs-pad profile-card">
        {loadError ? (
          <div role="alert"><p>{loadError}</p><Link to="/login">Sign in</Link>{" · "}<button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>
        ) : !form ? <p role="status">Loading your profile…</p> : (
          <form className="profile-form" onSubmit={submit} noValidate>
            <fieldset disabled={saving}>
              <label htmlFor="profile-name">Full name <span aria-hidden="true">*</span></label>
              <input id="profile-name" name="fullName" value={form.fullName} onChange={change} maxLength={100} required autoComplete="name" aria-invalid={!!errors.fullName} aria-describedby={errors.fullName ? "profile-name-error" : undefined} />
              {errors.fullName && <p id="profile-name-error" className="profile-error" role="alert">{errors.fullName}</p>}

              <label htmlFor="profile-email">Account email</label>
              <input id="profile-email" type="email" value={form.email} readOnly aria-describedby="profile-email-help" />
              <p id="profile-email-help" className="qs-muted">Your email is linked to your sign-in account.</p>

              <label htmlFor="profile-phone">Phone number (optional)</label>
              <input id="profile-phone" name="phone" type="tel" value={form.phone} onChange={change} maxLength={20} autoComplete="tel" placeholder="(713) 555-1234" aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "profile-phone-error" : undefined} />
              {errors.phone && <p id="profile-phone-error" className="profile-error" role="alert">{errors.phone}</p>}

              <label htmlFor="profile-contact">Preferred contact method</label>
              <select id="profile-contact" name="contactMethod" value={form.contactMethod} onChange={change} aria-invalid={!!errors.preferences}>
                <option value="">No preference</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </select>
              <p className="qs-muted">This saves your preference for future contact. It does not enable email or SMS alerts.</p>
              {errors.preferences && <p className="profile-error" role="alert">{errors.preferences}</p>}
              {submitError && <p className="profile-error" role="alert">{submitError}</p>}
              {success && <p role="status">{success}</p>}
              <button className="qs-btn" type="submit">{saving ? "Saving…" : "Save profile"}</button>
            </fieldset>
          </form>
        )}
      </div>
    </UserShell>
  );
}
