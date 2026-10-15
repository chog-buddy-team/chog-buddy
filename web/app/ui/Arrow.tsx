// Drawn arrows in one stroke weight (no unicode glyph icons).
export function Arrow({ dir = 'left' }: { dir?: 'left' | 'out' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" style={{ flex: 'none' }}>
      {dir === 'left' ? <path d="M12 7H2M6 3 2 7l4 4" /> : <path d="M4 10 10 4M5 4h5v5" />}
    </svg>
  );
}
