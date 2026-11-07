import { NavLink } from 'react-router-dom';
import Logo from './Logo';

// Temporary nav showing every screen. Replace with role-based nav once auth exists.
const links = [
  ['/login', 'Login'],
  ['/register', 'Register'],
  ['/dashboard', 'User Dashboard'],
  ['/join', 'Join Queue'],
  ['/status', 'Queue Status'],
  ['/profile', 'My profile'],
  ['/history', 'History'],
  ['/admin', 'Admin Dashboard'],
  ['/admin/services', 'Service Management'],
  ['/admin/queues', 'Queue Management'],
];

export default function Navbar() {
  return (
    <nav className="navbar">
      <Logo size={20} />
      {links.map(([to, label]) => (
        <NavLink key={to} to={to}>{label}</NavLink>
      ))}
    </nav>
  );
}
