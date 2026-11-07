import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import UserDashboard from './pages/UserDashboard';
import JoinQueue from './pages/JoinQueue';
import QueueStatus from './pages/QueueStatus';
import History from './pages/History';
import Profile from './pages/profile';
import AdminDashboard from './pages/AdminDashboard';
import ServiceManagement from './pages/ServiceManagement';
import QueueManagement from './pages/QueueManagement';

export default function App() {
  return (
    <>
      <Navbar />
      <main className="container">
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* User screens */}
          <Route path="/dashboard" element={<UserDashboard />} />
          <Route path="/join" element={<JoinQueue />} />
          <Route path="/status" element={<QueueStatus />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/history" element={<History />} />

          {/* Admin screens */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/services" element={<ServiceManagement />} />
          <Route path="/admin/queues" element={<QueueManagement />} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    </>
  );
}
