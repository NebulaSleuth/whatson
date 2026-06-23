import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  api, getRememberUser, setCurrentUserId, setCurrentUserKind, setRememberUser,
} from '@/lib/api';

interface WhatsOnUserCard {
  id: string;
  name: string;
  avatar: string;
  hasPin: boolean;
}

interface AvatarMeta {
  key: string;
  bg: string;
  emoji: string;
}

const FALLBACK_AVATAR: AvatarMeta = { key: 'default', bg: '#374151', emoji: '👤' };

export default function SelectWhatsOnUser() {
  const navigate = useNavigate();
  const [pinFor, setPinFor] = useState<WhatsOnUserCard | null>(null);
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState<boolean>(getRememberUser());

  const usersQ = useQuery({ queryKey: ['whatson-users'], queryFn: api.getWhatsOnUsers });
  const avatarsQ = useQuery({
    queryKey: ['whatson-avatars'],
    queryFn: api.getWhatsOnAvatars,
    staleTime: 60 * 60 * 1000,
  });

  function resolveAvatar(key: string): AvatarMeta {
    const a = (avatarsQ.data || []).find((x) => x.key === key);
    return a ? { key: a.key, bg: a.bg, emoji: a.emoji } : FALLBACK_AVATAR;
  }

  async function completeLogin(user: WhatsOnUserCard) {
    setRememberUser(remember);
    setCurrentUserKind('whatson', remember);
    setCurrentUserId(user.id, remember);
    navigate('/', { replace: true });
  }

  async function pick(user: WhatsOnUserCard) {
    setError(null);
    if (user.hasPin) {
      setPinFor(user);
      setPin('');
      return;
    }
    setSubmitting(true);
    try {
      await api.selectWhatsOnUser(user.id);
      await completeLogin(user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPin() {
    if (!pinFor || !pin) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.selectWhatsOnUser(pinFor.id, pin);
      await completeLogin(pinFor);
      setPinFor(null);
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        msg.toLowerCase().includes('pin') || msg.includes('401') || msg.toLowerCase().includes('unauthorized')
          ? 'Incorrect PIN. Please try again.'
          : msg,
      );
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-3xl w-full p-6">
        <h1 className="text-3xl font-bold text-primary mb-2">Who's Watching?</h1>
        <p className="text-text-muted mb-6">Choose your profile to continue.</p>

        {usersQ.isLoading && <p className="text-text-secondary">Loading users…</p>}
        {usersQ.error && <p className="text-red-400">{(usersQ.error as Error).message}</p>}
        {error && !pinFor && <p className="text-red-400 mb-4">{error}</p>}

        {usersQ.data && usersQ.data.length === 0 && (
          <p className="text-text-secondary">
            No users configured yet. Open the admin <code>/setup</code> page to add one.
          </p>
        )}

        {usersQ.data && usersQ.data.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {usersQ.data.map((u) => {
                const av = resolveAvatar(u.avatar);
                return (
                  <button
                    key={u.id}
                    onClick={() => pick(u)}
                    disabled={submitting}
                    className="bg-surface hover:bg-surface-hover border border-card-border rounded-lg p-4 flex flex-col items-center gap-3 transition-colors focus:outline-none focus:border-primary disabled:opacity-60"
                  >
                    <div
                      className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
                      style={{ backgroundColor: av.bg }}
                    >
                      {av.emoji}
                    </div>
                    <span className="font-semibold flex items-center gap-1">
                      {u.name}
                      {u.hasPin && <span aria-label="PIN required">🔒</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              Remember me on this browser
            </label>
          </>
        )}
      </div>

      {pinFor && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-6">
          <div className="bg-surface rounded-2xl p-8 w-full max-w-sm">
            <h2 className="text-xl font-bold mb-1">Enter PIN</h2>
            <p className="text-text-muted mb-4">{pinFor.name}</p>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitPin();
                if (e.key === 'Escape') { setPinFor(null); setPin(''); setError(null); }
              }}
              placeholder="••••"
              className="w-full text-center text-2xl tracking-[0.5em] bg-background border border-card-border rounded-lg py-3 mb-4 focus:outline-none focus:border-primary"
            />
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setPinFor(null); setPin(''); setError(null); }}
                className="px-4 py-2 rounded bg-card-border text-text"
              >
                Cancel
              </button>
              <button
                onClick={submitPin}
                disabled={!pin || submitting}
                className="px-4 py-2 rounded bg-primary text-black font-semibold disabled:opacity-60"
              >
                {submitting ? 'Signing in…' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
