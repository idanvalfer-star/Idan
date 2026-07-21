import React, { useState } from 'react';
import { joinFamily } from '../services/authService';
import { useAuth } from '../contexts/AuthContext';
import '../styles/Auth.css';

function JoinFamily({ onSwitchToSignup, onSwitchToLogin }) {
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [familyCode, setFamilyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { setUser } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await joinFamily(email, nickname, password, familyCode);
    if (result.success) {
      setUser(result.user);
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Join Family</h1>
        <p className="subtitle">Enter your family code to join the shopping list</p>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="familyCode">Family Code</label>
            <input
              id="familyCode"
              type="text"
              value={familyCode}
              onChange={(e) => setFamilyCode(e.target.value.toUpperCase())}
              required
              placeholder="e.g., ABC123"
              disabled={loading}
              maxLength="6"
            />
            <small>Ask a family member for the 6-character code</small>
          </div>

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
              placeholder="e.g., John"
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
            {loading ? 'Joining family...' : 'Join Family'}
          </button>
        </form>

        <div className="auth-footer">
          <p>Don't have a code? <button type="button" className="link-btn" onClick={onSwitchToSignup}>Create new family</button></p>
          <p>Already have an account? <button type="button" className="link-btn" onClick={onSwitchToLogin}>Sign in</button></p>
        </div>
      </div>
    </div>
  );
}

export default JoinFamily;
