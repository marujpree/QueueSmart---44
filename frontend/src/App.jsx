import { Navigate, Route, Routes } from 'react-router-dom';
import RequireRole from './components/RouteGuards';
import Login from './pages/Login';
import Register from './pages/Register';
import UserDashboard from './pages/UserDashboard';
import JoinQueue from './pages/JoinQueue';
import QueueStatus from './pages/QueueStatus';
import History from './pages/History';
import Profile from './pages/Profile';
import AdminDashboard from './pages/AdminDashboard';
import ServiceManagement from './pages/ServiceManagement';
import QueueManagement from './pages/QueueManagement';

export default function App() {
  return (
    <>
      <main className="container">
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* User screens */}
          <Route path="/dashboard" element={<RequireRole role="user"><UserDashboard /></RequireRole>} />
          <Route path="/join" element={<RequireRole role="user"><JoinQueue /></RequireRole>} />
          <Route path="/status" element={<RequireRole role="user"><QueueStatus /></RequireRole>} />
          <Route path="/profile" element={<RequireRole role="user"><Profile /></RequireRole>} />
          <Route path="/history" element={<RequireRole role="user"><History /></RequireRole>} />

          {/* Admin screens */}
          <Route path="/admin" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
          <Route path="/admin/services" element={<RequireRole role="admin"><ServiceManagement /></RequireRole>} />
          <Route path="/admin/queues" element={<RequireRole role="admin"><QueueManagement /></RequireRole>} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    </>
  );
}
