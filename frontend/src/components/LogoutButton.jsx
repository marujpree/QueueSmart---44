import { useNavigate } from 'react-router-dom';

// forgets who is signed in and goes back to the login page
export default function LogoutButton() {
  const navigate = useNavigate();

  const logout = () => {
    try {
      localStorage.removeItem('queuesmart.user');
    } catch {
      // storage blocked, nothing to clear
    }
    navigate('/login', { replace: true });
  };

  return (
    <button type="button" className="qs-logout" onClick={logout}>Log out</button>
  );
}
