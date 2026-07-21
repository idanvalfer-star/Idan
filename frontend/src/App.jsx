import { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import Signup from './pages/Signup';
import Login from './pages/Login';
import JoinFamily from './pages/JoinFamily';
import './App.css';

function App() {
  const { user, loading } = useAuth();
  const [authPage, setAuthPage] = useState('signup');

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {authPage === 'signup' && (
          <Signup
            onSwitchToLogin={() => setAuthPage('login')}
            onSwitchToJoin={() => setAuthPage('join')}
          />
        )}
        {authPage === 'login' && (
          <Login
            onSwitchToSignup={() => setAuthPage('signup')}
            onSwitchToJoin={() => setAuthPage('join')}
          />
        )}
        {authPage === 'join' && (
          <JoinFamily
            onSwitchToSignup={() => setAuthPage('signup')}
            onSwitchToLogin={() => setAuthPage('login')}
          />
        )}
      </>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Welcome, {user.nickname}!</h1>
      <p>Family: {user.families?.family_name}</p>
      <p>Family Code: {user.families?.family_code}</p>
      <button onClick={() => window.location.reload()}>Logout</button>
    </div>
  );
}

export default App;
