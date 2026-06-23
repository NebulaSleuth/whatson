/**
 * Built-in avatar catalog for Whats On users. SVGs are inline so they
 * always ship with the API binary — no static file dependency.
 *
 * Style: simple geometric face on a 200x200 viewbox, solid background
 * colour, no fine detail. Plays well at any size from a 40px list cell
 * up to a 280px tvOS picker tile.
 */
export interface AvatarEntry {
  key: string;
  label: string;
  /** Background colour as a CSS hex string. */
  bg: string;
  /** Emoji character drawn over the background. */
  emoji: string;
  /** Server-rendered SVG, served at the avatars/<key>.svg endpoint. */
  svg: string;
}

function avatar(bg: string, face: string, label: string, key: string): AvatarEntry {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">` +
    `<rect width="200" height="200" rx="32" fill="${bg}"/>` +
    `<text x="100" y="140" font-size="120" text-anchor="middle" font-family="-apple-system,Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif">${face}</text>` +
    `</svg>`;
  return { key, label, bg, emoji: face, svg };
}

export const AVATARS: AvatarEntry[] = [
  avatar('#E5A00D', '🦊', 'Fox',     'fox'),
  avatar('#7B61FF', '🦉', 'Owl',     'owl'),
  avatar('#22C55E', '🐸', 'Frog',    'frog'),
  avatar('#0EA5E9', '🐳', 'Whale',   'whale'),
  avatar('#EC4899', '🦄', 'Unicorn', 'unicorn'),
  avatar('#F59E0B', '🐯', 'Tiger',   'tiger'),
  avatar('#10B981', '🐲', 'Dragon',  'dragon'),
  avatar('#8B5CF6', '🐺', 'Wolf',    'wolf'),
  avatar('#EF4444', '🦁', 'Lion',    'lion'),
  avatar('#14B8A6', '🐼', 'Panda',   'panda'),
  avatar('#F97316', '🐱', 'Cat',     'cat'),
  avatar('#3B82F6', '🐶', 'Dog',     'dog'),
  avatar('#A855F7', '🐰', 'Bunny',   'bunny'),
  avatar('#06B6D4', '🐧', 'Penguin', 'penguin'),
  avatar('#84CC16', '🦖', 'Dino',    'dino'),
  avatar('#64748B', '🤖', 'Robot',   'robot'),
];

const DEFAULT_AVATAR = AVATARS[0];

export function getAvatar(key: string): AvatarEntry {
  return AVATARS.find((a) => a.key === key) || DEFAULT_AVATAR;
}

export function listAvatars(): Array<{ key: string; label: string; bg: string; emoji: string; url: string }> {
  return AVATARS.map((a) => ({
    key: a.key,
    label: a.label,
    bg: a.bg,
    emoji: a.emoji,
    url: `/api/whatson-users/avatars/${a.key}.svg`,
  }));
}
