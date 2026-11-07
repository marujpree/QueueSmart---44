import { NavLink } from "react-router-dom"; 
import Logo from "./Logo";
import NotificationBell from "./NotificationBell";
import LogoutButton from "./LogoutButton";
import '../user.css';
import '../admin.css';

export default function AdminShell({ eyebrow = 'Administration', title, subtitle, children}) {
    return (
       <div className="qs qs-admin">
         <header className="qs-header">
           <div className="qs-wrap qs-header-row">
             <NavLink to="/admin" className="qs-admin-logo" aria-label="QueueSmart admin overview">
               <Logo />
             </NavLink>
             <span className="qs-tagline">Admin workspace</span>
             <div className="qs-header-actions">
               <NotificationBell />
               <LogoutButton />
             </div>
           </div>
         </header>
         <main className="qs-wrap">
           <nav className="qs-tabs" aria-label="Admin navigation">
             <NavLink to="/admin" end>Overview</NavLink>
             <NavLink to="/admin/services">Service Management</NavLink>
             <NavLink to="/admin/queues">Queue Management</NavLink>
           </nav>
           <div className="qs-hero">
             <p className="qs-eyebrow">{eyebrow}</p>
             <h1>{title}</h1>
             {subtitle && <p className="qs-sub">{subtitle}</p>}
           </div>
           <div className="qs-admin-content">{children}</div>
         </main>
       </div>
    ); 
}