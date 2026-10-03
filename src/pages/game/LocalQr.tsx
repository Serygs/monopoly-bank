export interface LocalQrProps {
  matrix: boolean[][];
  label: string;
}

/*
 * `invite-qr` keeps `shape-rendering` and the `rect` fill in `features.css` (SVG-specific).
 * Below `md` the code scales down with the column instead of holding 136px.
 */
const qrClass =
  'invite-qr size-[136px] rounded-sm bg-qr-background p-[7px] text-surface-inverse max-md:h-auto max-md:w-[min(100%,176px)] max-md:justify-self-start';

export function LocalQr({ matrix, label }: LocalQrProps) {
  const size = matrix.length;
  return (
    <svg className={qrClass} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      {matrix.map((row, y) =>
        row.map((dark, x) => dark && <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />),
      )}
    </svg>
  );
}
