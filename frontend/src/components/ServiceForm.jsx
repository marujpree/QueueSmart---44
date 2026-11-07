import { useRef, useState } from "react";

// limits
const nameMax = 100;
const descriptionMax = 500;
const durationMin = 1;
const durationMax = 480;
const priorities = ["low", "medium", "high"];

// order fields appear in
const fieldOrder = ["name", "description", "durationMinutes", "priority"];

// all validation rules
function validateService(values, existingServices, editingId) {
  const errors = {};

  // trim first
  const name = values.name.trim();
  const description = values.description.trim();
  const duration = String(values.durationMinutes).trim();

  // name is required, max 100, and unique
  if (name === "") {
    errors.name = "Service name is required.";
  } else if (name.length > nameMax) {
    errors.name = `Service name must be ${nameMax} characters or less.`;
  } else {
    // skip the service being edited
    const taken = existingServices.some(
      (s) => s.id !== editingId && s.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (taken) errors.name = "A service with this name already exists.";
  }

  // description is required, max 500
  if (description === "") {
    errors.description = "Description is required.";
  } else if (description.length > descriptionMax) {
    errors.description = `Description must be ${descriptionMax} characters or less.`;
  }

  // duration is required, whole number, between 1 and 480
  const minutes = Number(duration);
  if (duration === "") {
    errors.durationMinutes = "Expected duration is required.";
  } else if (!Number.isInteger(minutes)) {
    errors.durationMinutes = "Expected duration must be a whole number of minutes.";
  } else if (minutes < durationMin || minutes > durationMax) {
    errors.durationMinutes = `Expected duration must be between ${durationMin} and ${durationMax} minutes.`;
  }

  // priority has to be one of the three options
  if (!priorities.includes(values.priority)) {
    errors.priority = "Choose a priority level.";
  }

  return errors;
}

export default function ServiceForm({ service, existingServices, onSave, onCancel, onDelete }) {
  const isEditing = Boolean(service);
  const editingId = isEditing ? service.id : null;

  // form values
  const [values, setValues] = useState({
    name: isEditing ? service.name : "",
    description: isEditing ? service.description : "",
    durationMinutes: isEditing ? String(service.durationMinutes) : "",
    priority: isEditing ? service.priority : "medium",
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [serverErrors, setServerErrors] = useState({});

  // fields blurred
  const [touched, setTouched] = useState({});

  // refs to every field
  const fieldRefs = {
    name: useRef(null),
    description: useRef(null),
    durationMinutes: useRef(null),
    priority: useRef(null),
  };

  // errors recalculated every render
  const errors = validateService(values, existingServices, editingId);

  // only show error if that field has been touched
  const visibleError = (field) => (touched[field] ? errors[field] : undefined);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setServerErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== name)));
    setSaveError('');
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  // leaving a field marks it as touched
  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleSubmit = async (e) => {
    // stop browser from reloading page
    e.preventDefault();
    if (saving) return;

    // on submit show every error at once
    setTouched({ name: true, description: true, durationMinutes: true, priority: true });

    // jump to first bad field when wrong
    const firstInvalid = fieldOrder.find((field) => errors[field]);
    if (firstInvalid) {
      fieldRefs[firstInvalid].current.focus();
      return;
    }

    // everything is valid
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        name: values.name.trim(),
        description: values.description.trim(),
        durationMinutes: Number(values.durationMinutes),
        priority: values.priority,
      });
    } catch (err) {
      setSaveError(err.message);
      setServerErrors(err.fields || {});
      const field = fieldOrder.find(key => err.fields?.[key]);
      if (field) fieldRefs[field].current?.focus();
    } finally {
      setSaving(false);
    }
  };

  // links each input to its counter and error text
  const nameError = visibleError("name");
  const descriptionError = visibleError("description");
  const durationError = visibleError("durationMinutes");
  const priorityError = visibleError("priority");

  // counters turn orange once at 90% of limit
  const nameNearLimit = values.name.length >= nameMax * 0.9;
  const descriptionNearLimit = values.description.length >= descriptionMax * 0.9;

  return (
    // turn off browser popups
    <form className="svc-form" onSubmit={handleSubmit} noValidate>
      <h2 className="svc-form-title">{isEditing ? "Edit service" : "New service"}</h2>

      {/* service name */}
      <div className="svc-field">
        <label htmlFor="svc-name">
          Service name <span className="svc-required" aria-hidden="true">*</span>
        </label>
        <input
          id="svc-name"
          name="name"
          type="text"
          disabled={saving}
          ref={fieldRefs.name}
          value={values.name}
          onChange={handleChange}
          onBlur={handleBlur}
          maxLength={nameMax}
          required
          aria-invalid={nameError ? "true" : "false"}
          aria-describedby="svc-name-count svc-name-error"
        />
        <div id="svc-name-count" className={nameNearLimit ? "svc-counter svc-counter-warn" : "svc-counter"}>
          {values.name.length} / {nameMax}
        </div>
        <p id="svc-name-error" className="svc-error">{nameError}</p>
      </div>

      {/* description */}
      <div className="svc-field">
        <label htmlFor="svc-description">
          Description <span className="svc-required" aria-hidden="true">*</span>
        </label>
        <textarea
          id="svc-description"
          name="description"
          rows={4}
          disabled={saving}
          ref={fieldRefs.description}
          value={values.description}
          onChange={handleChange}
          onBlur={handleBlur}
          maxLength={descriptionMax}
          required
          aria-invalid={descriptionError ? "true" : "false"}
          aria-describedby="svc-description-count svc-description-error"
        />
        <div
          id="svc-description-count"
          className={descriptionNearLimit ? "svc-counter svc-counter-warn" : "svc-counter"}
        >
          {values.description.length} / {descriptionMax}
        </div>
        <p id="svc-description-error" className="svc-error">{descriptionError}</p>
      </div>

      {/* expected duration */}
      <div className="svc-field">
        <label htmlFor="svc-duration">
          Expected duration (minutes) <span className="svc-required" aria-hidden="true">*</span>
        </label>
        <input
          id="svc-duration"
          name="durationMinutes"
          type="number"
          disabled={saving}
          ref={fieldRefs.durationMinutes}
          value={values.durationMinutes}
          onChange={handleChange}
          onBlur={handleBlur}
          min={durationMin}
          max={durationMax}
          step={1}
          required
          aria-invalid={durationError ? "true" : "false"}
          aria-describedby="svc-duration-error"
        />
        <p id="svc-duration-error" className="svc-error">{durationError}</p>
      </div>

      {/* priority level */}
      <div className="svc-field">
        <label htmlFor="svc-priority">Priority level</label>
        <select
          id="svc-priority"
          name="priority"
          disabled={saving}
          ref={fieldRefs.priority}
          value={values.priority}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-invalid={priorityError ? "true" : "false"}
          aria-describedby="svc-priority-error"
        >
          {priorities.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <p id="svc-priority-error" className="svc-error">{priorityError}</p>
      </div>
      
      {saveError && <p className="svc-error" role="alert">{saveError}</p>}
      <div className="svc-form-actions">
        {onDelete && (
          <button type = "button" className="svc-button" disabled={saving} onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className="svc-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="svc-button" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}