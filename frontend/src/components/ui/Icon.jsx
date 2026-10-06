/**
 * Minimal hand-drawn icon set — zero extra dependency, so the
 * design stays consistent without pulling in an icon library.
 * Add a new icon by adding an SVG path to `paths` below, then use
 * <Icon name="yourName" />. Swap this for a library like
 * lucide-react later if you need a much bigger icon set.
 */
const paths = {
  cart: 'M3 3h2l.4 2M7 13h10l3.6-8H6.2M7 13L5.4 5M7 13l-1.2 4h11.4M9 20a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z',
  star: 'M12 2l2.9 6.5 7.1.6-5.4 4.7 1.7 6.9L12 17l-6.3 3.7 1.7-6.9L2 9.1l7.1-.6L12 2z',
  search: 'M11 4a7 7 0 104.2 12.6l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0011 4zm0 2a5 5 0 110 10 5 5 0 010-10z',
  user: 'M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z',
  truck: 'M3 6h11v8H3zM14 10h4l3 3v1h-7zM6 19a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4z',
  shield: 'M12 2l8 3.5v5.3c0 5-3.4 8.9-8 10.2-4.6-1.3-8-5.2-8-10.2V5.5L12 2z',
  headset: 'M12 3a8 8 0 00-8 8v5a2 2 0 002 2h1v-7H5v0a7 7 0 0114 0v0h-2v7h1a2 2 0 002-2v-5a8 8 0 00-8-8z',
  arrowRight: 'M4 12h14m0 0l-5-5m5 5l-5 5',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'M6 6l12 12M18 6L6 18',
  image: 'M4 5h16v14H4V5z M9 10.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z M4.5 17l4.5-5.5 3 3.5 2.5-3 5 5.5',
};

const Icon = ({ name, size = 20, strokeWidth = 1.8, className = '' }) => {
  const d = paths[name];
  if (!d) return null;
  const filled = name === 'star';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
};

export default Icon;
