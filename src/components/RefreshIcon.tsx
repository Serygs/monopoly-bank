import type { RefreshControl } from '../hooks/useGameSync';

export function RefreshIcon({ state }: { state: RefreshControl['state'] }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={state === 'busy' ? 'animate-spin motion-reduce:animate-none' : undefined}
    >
      {state === 'done' ? (
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      ) : (
        <>
          <path d="M20 11a8 8 0 0 0-14.4-4.4L4 8" />
          <path d="M4 4v4h4" />
          <path d="M4 13a8 8 0 0 0 14.4 4.4L20 16" />
          <path d="M20 20v-4h-4" />
        </>
      )}
    </svg>
  );
}
