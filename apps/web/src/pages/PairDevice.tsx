import { useEffect, useRef, useState } from 'react';
import { api, setAuthKey } from '@/lib/api';

export default function PairDevice() {
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState('Requesting pair code…');
  const pollHandle = useRef<number | null>(null);

  async function requestCode() {
    setCode(null);
    setStatus('Requesting pair code…');
    try {
      const res = await api.pairStart('Web');
      setCode(res.code);
      setStatus('Waiting for the admin to enter this code…');
    } catch (e) {
      setStatus(`Couldn't request a pair code: ${(e as Error).message}`);
    }
  }

  // Kick off the first request on mount.
  useEffect(() => {
    requestCode();
    return () => {
      if (pollHandle.current) window.clearInterval(pollHandle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the backend while we have an active code. Putting the
  // interval and the poll body together in one effect avoids stale-
  // closure bugs around `code` — every re-arm uses the latest value.
  useEffect(() => {
    if (!code) return;

    async function poll() {
      try {
        const res = await api.pairPoll(code!);
        if (res.status === 'completed' && res.key) {
          if (pollHandle.current) window.clearInterval(pollHandle.current);
          setAuthKey(res.key);
          // Hard reload — new auth header on every future request,
          // and React Query starts fresh.
          window.location.replace('/');
        } else if (res.status === 'expired') {
          if (pollHandle.current) window.clearInterval(pollHandle.current);
          setStatus('Code expired. Click Refresh to get a new one.');
          setCode(null);
        }
      } catch (e) {
        // Backend returns 410 when the code's gone — fetchApi turns
        // that into a thrown Error.
        if (e instanceof Error && /expired/i.test(e.message)) {
          if (pollHandle.current) window.clearInterval(pollHandle.current);
          setStatus('Code expired. Click Refresh to get a new one.');
          setCode(null);
        } else {
          console.warn('pair poll error', e);
        }
      }
    }

    // Fire one poll immediately so the user doesn't wait 3 seconds
    // after entering the code, then settle into the polling cadence.
    poll();
    pollHandle.current = window.setInterval(poll, 3000);
    return () => {
      if (pollHandle.current) window.clearInterval(pollHandle.current);
    };
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
          onClick={requestCode}
          className="mt-6 px-6 py-2 bg-primary text-black font-semibold rounded hover:bg-primary/90"
        >
          Refresh code
        </button>
      </div>
    </div>
  );
}
