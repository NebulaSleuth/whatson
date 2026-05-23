import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Home' },
  { to: '/tv', label: 'TV Shows' },
  { to: '/movies', label: 'Movies' },
  { to: '/sports', label: 'Sports' },
  { to: '/library', label: 'Library' },
  { to: '/search', label: 'Search' },
  { to: '/settings', label: 'Settings' },
];

export function TopBar() {
  return (
    <header className="sticky top-0 z-40 bg-surface border-b border-card-border">
      <nav className="flex items-center gap-2 px-6 h-16">
        <span className="text-primary font-bold text-lg mr-4">Whats On</span>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              [
                'px-4 py-2 text-sm font-semibold rounded transition-colors',
                isActive
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text',
              ].join(' ')
            }
          >
            {tab.label}
          </NavLink>
        ))}
        <div className="ml-auto text-text-secondary text-sm">
          <Clock />
        </div>
      </nav>
    </header>
  );
}

function Clock() {
  // Tiny ticking clock — matches the mobile TopBar clock UX.
  const [now, setNow] = useStateNow();
  return <span>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>;
}

import { useEffect, useState } from 'react';
function useStateNow(): [Date, () => void] {
  const [d, setD] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setD(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return [d, () => setD(new Date())];
}
