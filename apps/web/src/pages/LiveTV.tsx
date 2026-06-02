import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LiveChannel, LiveProgram } from '@whatson/shared';
import { api, resolveArtworkUrl } from '@/lib/api';
import { LiveVideoPlayer } from '@/components/LiveVideoPlayer';

interface ProgramPair {
  now?: LiveProgram;
  next?: LiveProgram;
}

function buildEpgIndex(programs: LiveProgram[]): Map<string, ProgramPair> {
  const nowMs = Date.now();
  const byChannel = new Map<string, LiveProgram[]>();
  for (const p of programs) {
    if (!p.channelId) continue;
    const list = byChannel.get(p.channelId) || [];
    list.push(p);
    byChannel.set(p.channelId, list);
  }
  const out = new Map<string, ProgramPair>();
  for (const [chId, list] of byChannel) {
    list.sort((a, b) => a.startMs - b.startMs);
    const now = list.find((p) => p.startMs <= nowMs && nowMs < p.endMs);
    const next = list.find((p) => p.startMs > nowMs);
    out.set(chId, { now, next });
  }
  return out;
}

export default function LiveTV() {
  const [tuning, setTuning] = useState<LiveChannel | null>(null);

  const channelsQuery = useQuery({
    queryKey: ['live', 'tuner-channels'],
    queryFn: () => api.getLiveTunerChannels('all'),
  });

  const channels = channelsQuery.data ?? [];
  const channelIds = useMemo(() => channels.map((c) => c.id), [channels]);

  const epgQuery = useQuery({
    queryKey: ['live', 'epg', channelIds.join(',')],
    queryFn: () => api.getLiveEpg(channelIds, 4),
    enabled: channelIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const epgIndex = useMemo(() => buildEpgIndex(epgQuery.data ?? []), [epgQuery.data]);

  if (channelsQuery.isLoading) {
    return <p className="px-6 py-10 text-text-muted">Loading channels…</p>;
  }

  if (channelsQuery.error) {
    return (
      <p className="px-6 py-10 text-red-400">
        Couldn't load channels: {(channelsQuery.error as Error).message}
      </p>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="px-6 py-10 max-w-2xl">
        <h2 className="text-xl font-bold mb-2">No live channels</h2>
        <p className="text-text-muted">
          Configure a tuner under <code className="text-primary">/setup → Tuners</code> on
          your backend. HDHomeRun is supported today; Plex / Jellyfin / Emby Live TV
          land in a follow-up.
        </p>
      </div>
    );
  }

  return (
    <div className="py-6 px-6">
      <h2 className="text-2xl font-bold mb-1">Live TV</h2>
      <p className="text-text-muted text-sm mb-4">{channels.length} channels</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {channels.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            programs={epgIndex.get(ch.id)}
            onClick={() => setTuning(ch)}
          />
        ))}
      </div>

      {tuning && (
        <LiveVideoPlayer
          channel={tuning}
          onClose={() => setTuning(null)}
        />
      )}
    </div>
  );
}

function ChannelCard({
  channel,
  programs,
  onClick,
}: {
  channel: LiveChannel;
  programs: ProgramPair | undefined;
  onClick: () => void;
}) {
  const hasLogo = !!channel.logoUrl;
  return (
    <button
      onClick={onClick}
      className="flex bg-surface border border-card-border rounded-lg overflow-hidden h-32 hover:border-primary focus:border-primary focus:outline-none transition-colors text-left"
    >
      {/* Logo / fallback column */}
      <div className="flex-shrink-0 w-32 sm:w-40 flex items-center justify-center bg-black/40 p-2 border-r border-card-border">
        {hasLogo ? (
          <img
            src={resolveArtworkUrl(channel.logoUrl!)}
            alt={channel.name}
            className="max-w-full max-h-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="text-center">
            <div className="text-2xl font-extrabold text-text">{channel.number || ''}</div>
            <div className="text-xs text-text-secondary mt-1 truncate">
              {channel.callSign || channel.name}
            </div>
          </div>
        )}
      </div>

      {/* Info column */}
      <div className="flex-1 min-w-0 p-3 flex flex-col">
        <div className="flex items-center gap-2 mb-1">
          {channel.number && (
            <span className="text-sm font-bold text-primary">{channel.number}</span>
          )}
          <span className="text-sm font-bold text-text truncate flex-1">
            {channel.name || ''}
          </span>
          {channel.hd && (
            <span className="px-1.5 py-0.5 text-[10px] font-extrabold bg-primary text-black rounded">
              HD
            </span>
          )}
        </div>
        {programs?.now ? (
          <>
            <div className="text-[10px] font-bold text-text-secondary mt-1">NOW</div>
            <div className="text-sm text-primary truncate">{programs.now.title}</div>
          </>
        ) : null}
        {programs?.next ? (
          <>
            <div className="text-[10px] font-bold text-text-muted mt-1">NEXT</div>
            <div className="text-xs text-text-secondary truncate">{programs.next.title}</div>
          </>
        ) : null}
      </div>
    </button>
  );
}
