import { useEffect, useRef, useState } from 'react';
import './PreviewSession.css';

export function PreviewSession() {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const signingOut = useRef(false);

  useEffect(() => {
    let active = true;
    async function probe() {
      try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        if (!response.ok) return;
        const capability = await response.json();
        if (active && capability?.signOut === true) setSupported(true);
      } catch { /* Local servers do not provide preview sessions. */ }
    }
    void probe();
    return () => { active = false; };
  }, []);

  async function signOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign-out failed.');
      location.replace('/');
    } catch {
      setError(true);
      setBusy(false);
      signingOut.current = false;
    }
  }

  if (!supported) return null;
  return <div className="preview-session">
    <button type="button" onClick={signOut} disabled={busy} aria-describedby="preview-session-scope">{busy ? 'Signing out…' : 'Sign out'}</button>
    <span id="preview-session-scope">This browser only</span>
    {error && <span className="preview-session-error" role="alert">Could not sign out. Please try again.</span>}
  </div>;
}
