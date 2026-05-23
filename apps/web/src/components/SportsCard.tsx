import type { SportsEvent } from '@whatson/shared';

interface Props {
  event: SportsEvent;
  onClick?: (event: SportsEvent) => void;
}

function isDarkHex(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length !== 6) return true;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.6;
}

function primaryColor(event: SportsEvent): string | null {
  if (!event.teamSport) return null;
  const followed = event.competitors.find((c) => c.isFollowed && c.primaryColor);
  if (followed?.primaryColor) return `#${followed.primaryColor}`;
  const home = event.competitors.find((c) => c.homeAway === 'home' && c.primaryColor);
  if (home?.primaryColor) return `#${home.primaryColor}`;
  return null;
}

function formatUpcomingTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round((eventDay - startOfToday) / (1000 * 60 * 60 * 24));
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dayDelta === 0) return time;
  if (dayDelta === 1) return `Tomorrow ${time}`;
  if (dayDelta > 1 && dayDelta < 7) {
    return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  }
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function SportsCard({ event, onClick }: Props) {
  const live = event.status === 'in';
  const upcoming = event.status === 'pre';
  const completed = event.status === 'post';
  const bg = !live && !completed ? primaryColor(event) : null;
  const cardBg = bg ?? '#1A1A1A';
  const textColor = bg && !isDarkHex(bg) ? '#000' : '#FFF';
  const showTeams = event.teamSport && event.competitors.length >= 2;

  return (
    <button
      type="button"
      onClick={() => onClick?.(event)}
      className="relative w-[340px] h-[160px] shrink-0 rounded-lg overflow-hidden text-left p-3 border-2 border-transparent hover:border-primary focus:border-primary focus:outline-none transition-colors"
      style={{ backgroundColor: cardBg, color: textColor }}
    >
      {live && primaryColor(event) && (
        <span className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: primaryColor(event)! }} />
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wide opacity-80">{event.leagueLabel}</span>
        {live && (
          <span className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-white" /> LIVE
          </span>
        )}
        {completed && (
          <span className="bg-primary/20 text-primary text-[10px] font-bold px-2 py-0.5 rounded">FINAL</span>
        )}
      </div>

      <div className="space-y-1">
        {showTeams ? (
          event.competitors.slice(0, 2).map((c) => {
            const winner = c.winner === true;
            const loser = completed && !winner && event.competitors.some((o) => o.winner === true);
            return (
              <div
                key={c.id}
                className="flex items-center gap-2"
                style={{ opacity: loser ? 0.55 : 1 }}
              >
                {c.logo ? (
                  <img src={c.logo} alt={c.name} className="w-5 h-5 object-contain" />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-black/20 inline-block" />
                )}
                <span
                  className={
                    'flex-1 truncate ' +
                    (winner && completed ? 'font-extrabold text-primary' : 'font-semibold')
                  }
                >
                  {(live || completed)
                    ? (c.abbreviation || c.shortName || c.name)
                    : (c.name || c.shortName || c.abbreviation || '')}
                </span>
                {(live || completed) && c.score != null && (
                  <span className={'font-bold tabular-nums ' + (winner && completed ? 'text-primary' : '')}>
                    {c.score}
                  </span>
                )}
              </div>
            );
          })
        ) : (
          <p className="font-semibold line-clamp-2">{event.title}</p>
        )}
      </div>

      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs">
        <span className="truncate" style={{ opacity: 0.85 }}>
          {live ? event.statusDetail : upcoming ? formatUpcomingTime(event.startsAt) || event.statusDetail : event.statusDetail}
        </span>
        {event.broadcast && (
          <span className="ml-2 px-2 py-0.5 rounded font-semibold bg-primary/20 text-primary">
            {event.broadcast}
          </span>
        )}
      </div>
    </button>
  );
}
