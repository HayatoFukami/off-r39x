// A synthetic stand-in for a QR (UI mock only, SEC-QR-012 / 013). The seed is input to drawing and
// nothing else: it is never written as text or into an attribute. The picture is not a decodable code.

const SIZE = 25;
const QUIET = 2;
const FINDER = 7;

/** A small deterministic generator (xorshift32) driven by the characters of the seed. */
function pseudoRandom(matrixSeed: string): () => number {
  let state = 0x9e3779b9;
  for (let i = 0; i < matrixSeed.length; i += 1) {
    state = Math.imul(state ^ matrixSeed.charCodeAt(i), 0x01000193) >>> 0;
  }
  if (state === 0) state = 0x1;
  return (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function inFinder(row: number, col: number): boolean {
  const corner = (r: number, c: number): boolean => r >= 0 && r < FINDER && c >= 0 && c < FINDER;
  return (
    corner(row, col) || corner(row, col - (SIZE - FINDER)) || corner(row - (SIZE - FINDER), col)
  );
}

function finderCell(row: number, col: number): boolean {
  const r = row < FINDER ? row : row - (SIZE - FINDER);
  const c = col < FINDER ? col : col - (SIZE - FINDER);
  const edge = r === 0 || r === FINDER - 1 || c === 0 || c === FINDER - 1;
  const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
  return edge || core;
}

function buildCells(matrixSeed: string): { row: number; col: number }[] {
  const next = pseudoRandom(matrixSeed);
  const cells: { row: number; col: number }[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const on = inFinder(row, col) ? finderCell(row, col) : next() % 2 === 0;
      if (on) cells.push({ row, col });
    }
  }
  return cells;
}

export function QrPlaceholder({ matrixSeed, label }: { matrixSeed: string; label: string }) {
  const total = SIZE + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      className="block size-56 max-w-full"
    >
      <rect width={total} height={total} className="fill-background" />
      {buildCells(matrixSeed).map((cell) => (
        <rect
          key={`${cell.row}-${cell.col}`}
          x={cell.col + QUIET}
          y={cell.row + QUIET}
          width={1}
          height={1}
          className="fill-foreground"
        />
      ))}
    </svg>
  );
}
