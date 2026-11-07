import "./auth.css";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserPlus, User, Phone, Mail, Lock, Eye, EyeOff, ArrowRight, Info } from "lucide-react";
import { validateEmail, validatePassword, validateConfirm, validateName, validatePhone, validateFullName } from "../validation";
import { apiPost } from "../api";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validate = (values) => ({
    firstName: validateName(values.firstName, "First name"),
    lastName: validateName(values.lastName, "Last name"),
    phone: validatePhone(values.phone),
    email: validateEmail(values.email),
    password: validatePassword(values.password),
    confirm: validateConfirm(values.password, values.confirm),
  });

  // fields the user has already left once, these re-validate on every keystroke
  const [touched, setTouched] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    const next = { ...form, [name]: value };
    setForm(next);

    const fresh = validate(next);
    setErrors((er) => {
      const updated = { ...er };
      if (touched[name]) updated[name] = fresh[name];
      // confirm depends on password, so keep it in sync while typing
      if (name === "password" && touched.confirm) updated.confirm = fresh.confirm;
      return updated;
    });
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched((t) => ({ ...t, [name]: true }));
    setErrors((er) => ({ ...er, [name]: validate(form)[name] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");

    const errs = validate(form);
    setErrors(errs);
    setTouched(Object.fromEntries(Object.keys(form).map((key) => [key, true])));
    if (Object.values(errs).some(Boolean)) return;

    setLoading(true);
    try {
      await apiPost("/auth/register", {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
      navigate("/login");
    } catch (err) {
      if (err.fields) setErrors((er) => ({ ...er, ...err.fields }));
      setSubmitError(err.message);
    } finally {
      setLoading(false);
    }
  };

  
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-tabs">
          <Link to="/login" className="auth-tab">Sign in</Link>
          <Link to="/register" className="auth-tab active">Create account</Link>
        </div>

        <div className="auth-badge"><UserPlus size={18} /></div>
        <h1 className="auth-title">Create your account.</h1>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="firstName">First name <span className="required">*</span></label>
            <div className="input-wrap">
              <User className="icon-left" size={16} />
              <input
                id="firstName" name="firstName" type="text" autoComplete="given-name" placeholder="First name"
                value={form.firstName} onChange={handleChange} onBlur={handleBlur}
                aria-invalid={!!errors.firstName}
              />
            </div>
            {errors.firstName && <p className="error" role="alert">{errors.firstName}</p>}
          </div>

          <div className="field">
            <label htmlFor="lastName">Last name <span className="required">*</span></label>
            <div className="input-wrap">
              <User className="icon-left" size={16} />
              <input
                id="lastName" name="lastName" type="text" autoComplete="family-name" placeholder="Last name"
                value={form.lastName} onChange={handleChange} onBlur={handleBlur}
                aria-invalid={!!errors.lastName}
              />
            </div>
            {errors.lastName && <p className="error" role="alert">{errors.lastName}</p>}
          </div>

          <div className="field">
            <label htmlFor="email">Email address <span className="required">*</span></label>
            <div className="input-wrap">
              <Mail className="icon-left" size={16} />
              <input
                id="email" name="email" type="email" autoComplete="email"
                placeholder="you@example.com"
                value={form.email} onChange={handleChange} onBlur={handleBlur}
                aria-invalid={!!errors.email}
              />
            </div>
            <p className="hint">Your email is your username.</p>
            {errors.email && <p className="error" role="alert">{errors.email}</p>}
          </div>

          <div className="field">
            <label htmlFor="phone">Phone number <span className="hint">(optional)</span></label>
            <div className="input-wrap">
              <Phone className="icon-left" size={16} />
              <input
                id="phone" name="phone" type="tel" autoComplete="tel" placeholder="(713) 555-1234"
                value={form.phone} onChange={handleChange} onBlur={handleBlur}
                aria-invalid={!!errors.phone}
              />
            </div>
            {errors.phone && <p className="error" role="alert">{errors.phone}</p>}
          </div>

          <div className="field">
            <label htmlFor="password">Password <span className="required">*</span></label>
            <div className="input-wrap">
              <Lock className="icon-left" size={16} />
              <input
                id="password" name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Create a password"
                value={form.password} onChange={handleChange} onBlur={handleBlur}
                aria-invalid={!!errors.password}
              />
              <button
                type="button" className="toggle-visibility"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="hint">Minimum 8 characters with a letter and a number.</p>
            {errors.password && <p className="error" role="alert">{errors.password}</p>}
          </div>

          <div className="field">
            <label htmlFor="confirm">Confirm password <span className="required">*</span></label>
            <div className="input-wrap">
              <Lock className="icon-left" size={16} />
              <input
                id="confirm" name="confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={form.confirm} onChange={handleChange} onBlur={handleBlur}
                aria-invalid={!!errors.confirm}
              />
            </div>
            {errors.confirm && <p className="error" role="alert">{errors.confirm}</p>}
          </div>

          {submitError && <p className="error" role="alert">{submitError}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            <span>{loading ? "Creating account..." : "Create account"}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="auth-notice">
          <Info size={14} />
          <span>New accounts are regular user accounts. Your account and profile are saved.</span>
        </div>
      </div>
    </div>
  );
    
}
