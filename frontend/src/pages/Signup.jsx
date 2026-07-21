import React, { useState } from 'react';
import { signup } from '../services/authService';
import { useAuth } from '../contexts/AuthContext';
import '../styles/Auth.css';

function Signup({ onSwitchToLogin, onSwitchToJoin }) {
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const { setUser } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    const result = await signup(email, nickname, password);
    if (result.success) {
      setUser(result.user);
      setSuccessMsg(`Welcome! Your family code is: ${result.familyCode}`);
      setTimeout(() => {
        // Navigation will be handled by App.jsx detecting user is set
      }, 1000);
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Create Family Account</h1>
        <p className="subtitle">Start a new shopping list for your family</p>

        {error && <div className="error-message">{error}</div>}
        {successMsg && <div className="success-message">{successMsg}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="nickname">Your Name</label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
              placeholder="e.g., Sarah"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div className="auth-footer">
          <p>Already have an account? <button type="button" className="link-btn" onClick={onSwitchToLogin}>Sign in</button></p>
          <p>Have a family code? <button type="button" className="link-btn" onClick={onSwitchToJoin}>Join family</button></p>
        </div>
      </div>
    </div>
  );
}

export default Signup;
