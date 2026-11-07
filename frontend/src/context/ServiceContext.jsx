import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api';

// context
const ServiceContext = createContext(null);

// cleans up fields before saving
export function ServiceProvider({ children }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queueLengths, setQueueLengths] = useState({});
  const { pathname } = useLocation();
  // Invalidate older reads when saving so a delayed response cannot undo a save.
  const requestVersion = useRef(0);
  const pendingWrites = useRef(0);

  const refreshQueueLengths = useCallback(async list => {
    try {
      const summaries = await Promise.all(list.map(s => apiGet(`/queues/${s.id}/summary`)));
      setQueueLengths(Object.fromEntries(summaries.map(s => [s.serviceId, s.waiting])));
    } catch {
      // keep the last counts
    }
  }, []);

  const refreshServices = useCallback(async () => {
    if (pendingWrites.current) return;
    const version = ++requestVersion.current;
    try {
      const data = await apiGet('/services');
      if (version === requestVersion.current) {
        setServices(data.services);
        setError('');
        refreshQueueLengths(data.services);
      }
    } catch (err) {
      if (version === requestVersion.current) setError(err.message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [refreshQueueLengths]);

  useEffect(() => {
    refreshServices();
    // Other browsers get admin changes without needing a manual reload.
    const timer = window.setInterval(refreshServices, 5000);
    window.addEventListener('focus', refreshServices);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshServices);
      requestVersion.current += 1;
    };
  }, [pathname, refreshServices]);

  const saveService = async (id, values) => {
    pendingWrites.current += 1;
    requestVersion.current += 1;
    try {
      const { service } = id === null
        ? await apiPost('/services', values)
        : await apiPatch(`/services/${id}`, values);
      setServices(previous => previous.some(s => s.id === service.id)
        ? previous.map(s => s.id === service.id ? service : s)
        : [...previous, service]);
      return service;
    } finally {
      pendingWrites.current -= 1;
      requestVersion.current += 1;
      setLoading(false);
      // Refresh the complete list, including changes made by another admin.
      refreshServices();
    }
  };

  const getServiceById = id => services.find(s => s.id === Number(id));
  const addService = values => saveService(null, values);
  const updateService = (id, values) => saveService(id, values);
  const toggleServiceOpen = async id => {
    // Read the latest status rather than toggling an outdated browser copy.
    const { service } = await apiGet(`/services/${id}`);
    return updateService(id, { isOpen: !service.isOpen });
  };
  const removeService = async id => {
    pendingWrites.current += 1;
    requestVersion.current += 1;
    try {
      const result = await apiDelete(`/services/${id}`);
      setServices(previous => previous.filter(s => s.id !== Number(id)));
      return result;
    } finally {
      pendingWrites.current -= 1;
      requestVersion.current += 1;
      setLoading(false);
      refreshServices();
    }
  };
  // waiting count from the last refresh
  const getQueueLength = id => queueLengths[id] ?? 0;

  return (
    <ServiceContext.Provider value={{ services, loading, error, refreshServices,
      getServiceById, addService, updateService,
      toggleServiceOpen, getQueueLength, removeService }}>
      {children}
    </ServiceContext.Provider>
  );
}

export function useServices() {
  const context = useContext(ServiceContext);
  if (context === null) throw new Error('useServices must be used inside a <ServiceProvider>');
  return context;
}