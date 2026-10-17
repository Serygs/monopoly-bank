export interface LocalQrProps {
  matrix: boolean[][];
  label: string;
}

/*
 * `invite-qr` keeps `shape-rendering` and the `rect` fill (`currentColor`) in `features.css`
 * (SVG-specific). The code sits on a white tile with a 32px quiet zone and black modules
 * (`--mb-color-qr-modules`), whatever the colour mode; it scales down on narrow sheets and keeps
 * the quiet zone.
 */
const tileClass =
  'inline-block w-[min(100%,288px)] rounded-compact bg-qr-background p-8 text-qr-modules';
const qrClass = 'invite-qr block aspect-square h-auto w-full max-w-[224px] mx-auto';

export function LocalQr({ matrix, label }: LocalQrProps) {
  const size = matrix.length;
  return (
    <div className={tileClass}>
      <svg className={qrClass} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        {matrix.map((row, y) =>
          row.map((dark, x) => dark && <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />),
        )}
      </svg>
    </div>
  );
}
