import { useIsDemo } from '@/lib/demo';

/** Slim strip shown while browsing the public read-only demo server. */
export function DemoBanner() {
  const demo = useIsDemo();
  if (!demo) return null;
  return (
    <div className="bg-surface border-b border-primary text-sm text-center px-4 py-1.5 flex items-center justify-center gap-4">
      <span>
        <span className="text-primary font-semibold">Read-only demo</span>
        {' · '}
        <a href="https://whatsontv.net" className="underline hover:text-primary">
          Get What&apos;s On TV
        </a>
      </span>
      <a href="/credits" className="text-text-muted underline hover:text-text">
        Credits
      </a>
    </div>
  );
}
