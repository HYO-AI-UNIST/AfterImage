import type { BoardEdge, BoardNode } from './contracts.ts';

export interface BoardGeometry {
  nodes: BoardNode[];
  edges: BoardEdge[];
  starts: string[];
  goal: string;
  edgeLookup: Map<string, BoardEdge>;
}

const boards = new Map<number, BoardGeometry>();

export const edgeId = (a: string, b: string): string => [a, b].sort().join('~');

/** Subdivide the same triangle so every difficulty fits the same viewport. */
export function getBoard(gridSize = 4): BoardGeometry {
  if (!Number.isInteger(gridSize) || gridSize < 3 || gridSize > 6) {
    throw new RangeError('삼각형의 변은 3~6등분으로 설정해주세요.');
  }
  const existing = boards.get(gridSize);
  if (existing) return existing;

  const stepX = 460 / gridSize;
  const stepY = 398 / gridSize;
  const nodes: BoardNode[] = Array.from({ length: gridSize + 1 }, (_, row) =>
    Array.from({ length: row + 1 }, (_, col) => ({
      id: `${row}-${col}`,
      row,
      col,
      x: 300 - row * stepX / 2 + col * stepX,
      y: 72 + row * stepY,
      start: row === gridSize,
      goal: row === 0,
    })),
  ).flat();
  const edges: BoardEdge[] = nodes.flatMap((node) => {
    const destinations: string[] = [];
    if (node.col < node.row) destinations.push(`${node.row}-${node.col + 1}`);
    if (node.row < gridSize) destinations.push(`${node.row + 1}-${node.col}`, `${node.row + 1}-${node.col + 1}`);
    return destinations.map((b) => ({ id: edgeId(node.id, b), a: node.id, b, base: node.row === gridSize }));
  });
  const board: BoardGeometry = {
    nodes,
    edges,
    starts: nodes.filter((node) => node.start).map((node) => node.id),
    goal: '0-0',
    edgeLookup: new Map(edges.map((edge) => [edge.id, edge])),
  };
  boards.set(gridSize, board);
  return board;
}

// Existing demo and integrations retain the original four-division board.
export const { nodes: NODES, edges: EDGES, starts: STARTS, goal: GOAL } = getBoard();

/** At most half of the mineable segments may contain a mine (rounded down). */
export function maxMines(gridSize = 4): number {
  return Math.floor(getBoard(gridSize).edges.filter((edge) => !edge.base).length / 2);
}

/** Validate legal placement and reachability, including travel along the base. */
export function hasSafePath(mines: string[], gridSize = 4): boolean {
  const { edges, starts, goal, edgeLookup } = getBoard(gridSize);
  if (!Array.isArray(mines) || mines.some((id) => typeof id !== 'string' || !edgeLookup.has(id) || edgeLookup.get(id)!.base)) {
    return false;
  }
  const blocked = new Set(mines);
  const visited = new Set(starts);
  const queue = [...starts];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === goal) return true;
    for (const edge of edges) {
      if (blocked.has(edge.id)) continue;
      const next = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
      if (next && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Preserve one randomly chosen descending path before scattering mines. */
export function randomBoard(random: () => number = Math.random, gridSize = 4): string[] {
  const { edges } = getBoard(gridSize);
  const safe = new Set<string>();
  let col = 0;
  for (let row = 0; row < gridSize; row += 1) {
    const nextCol = col + (random() < 0.5 ? 0 : 1);
    safe.add(edgeId(`${row}-${col}`, `${row + 1}-${nextCol}`));
    col = nextCol;
  }
  const mines = edges.filter((edge) => !edge.base && !safe.has(edge.id) && random() < 0.48).map((edge) => edge.id);
  // Shuffle before clipping so dense draws do not favor the first/top edges.
  for (let index = mines.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [mines[index], mines[other]] = [mines[other], mines[index]];
  }
  return mines.slice(0, maxMines(gridSize));
}
