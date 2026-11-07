/* eslint-disable react/prop-types */
import { NavLink } from 'react-router-dom';
import Logo from './Logo';
import NotificationBell from './NotificationBell';
import '../user.css';

const tabs = [
  ['/dashboard', 'Home'],
  ['/join', 'Join a queue'],
  ['/status', 'My place'],
  ['/profile', 'My profile'],
  ['/history', 'My visits'],
];

// shared header + page frame for the user-facing screens
export default function UserShell({ eyebrow, title, subtitle, children }) {
  return (
    <div className="qs">
      <header className="qs-header">
        <div className="qs-wrap qs-header-row">
          <Logo />
          <NotificationBell />
        </div>
      </header>

      <div className="qs-wrap">
        <nav className="qs-tabs" aria-label="User navigation">
          {tabs.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>

        <section className="qs-hero">
          {eyebrow && <p className="qs-eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {subtitle && <p className="qs-sub">{subtitle}</p>}
        </section>

        {children}
      </div>
    </div>
  );
}
