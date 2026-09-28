export interface LocalQrProps {
  matrix: boolean[][];
  label: string;
}

export function LocalQr({ matrix, label }: LocalQrProps) {
  const size = matrix.length;
  return (
    <svg className="invite-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      {matrix.map((row, y) =>
        row.map((dark, x) => dark && <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />),
      )}
    </svg>
  );
}
