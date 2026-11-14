/** Timestamp to store in `updatedAt`. */
export function nowStamp(): string {
  return new Date().toISOString();
}

/**
 * Formats a stored `updatedAt` for display ("just now", "5 min ago", ...).
 * Older data stored free text such as "just now"; that is shown unchanged.
 */
export function formatUpdated(value: string, now = Date.now()): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} d ago`;
  return new Date(t).toLocaleDateString();
}
