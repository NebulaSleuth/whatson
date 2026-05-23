import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setAuthKey } from '@/lib/api';

export default function PairDevice() {
  const navigate = useNavigate();
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState('Requesting pair code…');
  const pollHandle = useRef<number | null>(null);

  async function start() {
    try {
      const res = await api.pairStart('Web');
      setCode(res.code);
      setStatus('Waiting for the admin to enter this code…');
      pollHandle.current = window.setInterval(poll, 3000);
    } catch (e) {
      setStatus(`Couldn't request a pair code: ${(e as Error).message}`);
    }
  }

  async function poll() {
    if (!code) return;
    try {
      const res = await api.pairPoll(code);
      if (res.status === 'paired' && res.authKey) {
        if (pollHandle.current) window.clearInterval(pollHandle.current);
        setAuthKey(res.authKey);
        navigate('/', { replace: true });
      } else if (res.status === 'expired') {
        if (pollHandle.current) window.clearInterval(pollHandle.current);
        setStatus('Code expired. Click Refresh to get a new one.');
        setCode(null);
      }
    } catch (e) {
      console.warn('pair poll error', e);
    }
  }

  useEffect(() => {
    start();
    return () => {
      if (pollHandle.current) window.clearInterval(pollHandle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-arm polling whenever a new code lands.
  useEffect(() => {
    if (!code) return;
    if (pollHandle.current) window.clearInterval(pollHandle.current);
    pollHandle.current = window.setInterval(poll, 3000);
    return () => {
      if (pollHandle.current) window.clearInterval(pollHandle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-xl w-full p-6 text-center">
        <h1 className="text-3xl font-bold text-primary mb-2">Pair this device</h1>
        <p className="text-text-secondary mb-6">
          Open <code className="text-primary">/setup</code> in another browser tab, sign in as
          admin, then enter this code under Security &amp; Devices → Pair a new device.
        </p>
        <div className="text-6xl font-bold tracking-[0.3em] my-10">{code ?? '······'}</div>
        <p className="text-text-muted">{status}</p>
        <button
          onClick={start}
          className="mt-6 px-6 py-2 bg-primary text-black font-semibold rounded hover:bg-primary/90"
        >
          Refresh code
        </button>
      </div>
    </div>
  );
}
