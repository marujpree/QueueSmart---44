// Service Management
// A2 requirements for this screen:
//  - Create / edit services
//  - Name (required, max 100 chars), Description (required)
//  - Expected duration in minutes (required)
//  - Priority: low / medium / high
import { useState } from "react";
import AdminShell from "../components/AdminShell";
import { useServices } from "../context/ServiceContext";
import { useNotifications } from "../context/NotificationContext";
import ServiceForm from "../components/ServiceForm";
import ServiceLoadStatus from "../components/ServiceLoadStatus";
import "./ServiceManagement.css";

export default function ServiceManagement() {
  const { services, loading, error, getQueueLength, getServiceById, addService, updateService, removeService } = useServices();
  const { addNotification } = useNotifications();

  // success message shown above table after saving
  const [banner, setBanner] = useState(null);

  // list, create, or edit screen
  const [mode, setMode] = useState("list");

  // id of service being edited
  const [editingId, setEditingId] = useState(null);

  // opening the form hides old banner
  const startCreate = () => {
    setBanner(null);
    setEditingId(null);
    setMode("create");
  };

  const startEdit = (id) => {
    setBanner(null);
    setEditingId(id);
    setMode("edit");
  };

  // back to table and forget editing
  const backToList = () => {
    setEditingId(null);
    setMode("list");
  };

  // the form validates, this saves
  const handleSave = async (values) => {
    const isCreating = mode === "create";

    if (isCreating) {
      await addService(values);
    } else {
      await updateService(editingId, values);
    }

    // admin notification
    addNotification({
      audience: "admin",
      type: "status_change",
      title: isCreating ? "Service created" : "Service updated",
      message: `${values.name} was saved.`,
    });

    // sends success banner
    setBanner(`${values.name} was ${isCreating ? "created" : "updated"}.`);
    backToList();
  };

  const handleDelete = async () => {
    const service = getServiceById(editingId);
    if (!window.confirm(`Delete ${service.name}? This cannot be undone.`)) return;
    await removeService(editingId);
    setBanner(`${service.name} was deleted.`);
    backToList();
  };

  // the service being edited
  const editingService = mode === "edit" ? getServiceById(editingId) : null;

  return (
    <AdminShell
          title="Service Management"
          subtitle="Create and edit the services students can queue for."
        >
          <ServiceLoadStatus />
          {mode === "list" ? (
            <>
              {/* success banner after save */}
              {banner && (
                <div className="qs-admin-feedback" role="status">
                  <span>{banner}</span>
                  <button
                    type="button"
                    className="qs-admin-dismiss"
                    aria-label="Dismiss message"
                    onClick={() => setBanner(null)}
                  >
                    &times;
                  </button>
                </div>
              )}
              
              <div className="qs-admin-toolbar">
                <h2 className="qs-h2">Your services</h2>
                <button type="button" className="qs-btn qs-btn-small" onClick={startCreate} disabled={loading || Boolean(error)}>
                  + New service
                </button>
              </div>
              
              {services.length === 0 ? (
                !loading && !error &&
                <p className="qs-card qs-pad qs-admin-empty">No services yet. Click &quot;+ New service&quot; to add one.</p>
              ) : (
                // sideways scroll on table
                <div className="qs-card qs-pad">
                  <div className="qs-admin-table-wrap" role="region" aria-label="Services" tabIndex={0}>
                    <table className="qs-table qs-admin-service-table">
                      <thead>
                        <tr>
                          <th scope="col">Service</th>
                          <th scope="col">Duration</th>
                          <th scope="col">Priority</th>
                          <th scope="col">Status</th>
                          <th scope="col">Queue</th>
                          <th scope="col">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {services.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <span className="qs-admin-name">{s.name}</span>
                              {/* title shows in full on hover */}
                              <span className="qs-admin-desc" title={s.description}>
                              {s.description}
                              </span>
                            </td>
                            <td>{s.durationMinutes} min</td>
                            <td><span className="qs-pill">{s.priority}</span></td>
                            <td><span className={`qs-pill${s.isOpen ? " ok" : ""}`}>{s.isOpen ? "Open" : "Closed"}</span></td>
                            <td>{getQueueLength(s.id)}</td>
                            <td>
                              <button type="button" className="qs-btn qs-btn-small" onClick={() => startEdit(s.id)}>
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            mode === "edit" && !editingService ? (
              // edit service not found case
              <div className="qs-card qs-pad">
                <p>That service could not be found.</p>
                <button type="button" className="qs-btn qs-btn-small" onClick={backToList}>
                  Back
                </button>
              </div>
            ) : (
              // fresh form each time
              <section className="qs-card qs-pad qs-admin-form" aria-label={mode === "create" ? "Create service" : "Edit service"}>
                <ServiceForm
                  key={editingId ?? "new"}
                  service={editingService}
                  existingServices={services}
                  onSave={handleSave}
                  onCancel={backToList}
                  onDelete={mode === "edit" ? handleDelete : undefined}
                />
              </section>
            )
          )}
        </AdminShell>
  );
}
