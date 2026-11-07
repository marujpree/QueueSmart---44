/* eslint-disable react/prop-types */
import { Navigate } from 'react-router-dom';

// who is signed in, saved by the login page
const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('queuesmart.user'));
  } catch {
    return null;
  }
};

// where each role lands after login
const homeFor = (user) => (user?.role === 'admin' ? '/admin' : '/dashboard');

// only lets a signed in person with the right role see a screen
// no role means any signed in person, wrong role goes to their own home
export default function RequireRole({ role, children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return children;
}
