import { useState } from 'react';

export default function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter a username and password.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:3824/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginType: 'userpass', username, password })
      });

      const data = await response.json();

      if (data.success) {
        onLoginSuccess();
      } else {
        setError(data.error || 'Invalid credentials.');
      }
    } catch (err) {
      setError('Failed to connect to the server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>IdleTool</h1>
        <p style={styles.subtitle}>Enter your credentials to continue.</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            style={styles.input}
            disabled={isLoading}
          />
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={styles.input}
              disabled={isLoading}
            />
            <div style={styles.forgotRow}>
              <span style={styles.forgotLink}>Forgot your password?</span>
            </div>
          </div>

          {error && (
            <div style={styles.errorBox}>{error}</div>
          )}

          <button type="submit" disabled={isLoading} style={styles.loginBtn}>
            {isLoading ? (
              <span style={styles.btnContent}>
                <svg style={styles.spinner} viewBox="0 0 24 24" fill="none">
                  <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Logging in...
              </span>
            ) : (
              <span style={styles.btnContent}>Log In &nbsp;→</span>
            )}
          </button>
        </form>

      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0a0e17 0%, #0d1321 40%, #111827 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    background: 'rgba(17, 24, 39, 0.7)',
    backdropFilter: 'blur(20px)',
    borderRadius: '16px',
    border: '1px solid rgba(55, 65, 81, 0.4)',
    padding: '48px 40px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  title: {
    textAlign: 'center',
    color: '#fff',
    fontSize: '2rem',
    fontWeight: 700,
    fontStyle: 'italic',
    fontFamily: "'Georgia', 'Times New Roman', serif",
    margin: '0 0 12px 0',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '0.875rem',
    margin: '0 0 32px 0',
  },
  link: {
    color: '#22c55e',
    cursor: 'pointer',
    fontWeight: 500,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  input: {
    width: '100%',
    background: 'rgba(17, 24, 39, 0.6)',
    border: '1px solid rgba(55, 65, 81, 0.6)',
    borderRadius: '10px',
    padding: '14px 16px',
    color: '#e5e7eb',
    fontSize: '0.9rem',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  forgotRow: {
    textAlign: 'right',
    marginTop: '8px',
  },
  forgotLink: {
    color: '#22c55e',
    fontSize: '0.8rem',
    cursor: 'pointer',
    fontWeight: 500,
  },
  errorBox: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    color: '#f87171',
    padding: '12px 16px',
    borderRadius: '10px',
    fontSize: '0.85rem',
  },
  loginBtn: {
    width: '100%',
    background: '#111827',
    color: '#e5e7eb',
    border: '1px solid rgba(55, 65, 81, 0.6)',
    borderRadius: '10px',
    padding: '14px',
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s, border-color 0.2s',
    fontFamily: 'inherit',
  },
  btnContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  spinner: {
    width: '16px',
    height: '16px',
    animation: 'spin 1s linear infinite',
  },
  dividerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    margin: '28px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(55, 65, 81, 0.5)',
  },
  dividerText: {
    color: '#6b7280',
    fontSize: '0.8rem',
  },
  socialRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: '16px',
  },
  socialBtn: {
    width: '52px',
    height: '48px',
    background: 'rgba(17, 24, 39, 0.8)',
    border: '1px solid rgba(55, 65, 81, 0.5)',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
};
