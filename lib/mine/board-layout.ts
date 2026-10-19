import layout from './level-layout.json';

/** Keep the dressed four-division map, and the same outer triangle at every size. */
export function boardPosition(id: string, gridSize = 4): [number, number] {
    if (gridSize === 4 && id in layout.nodes) return layout.nodes[id as keyof typeof layout.nodes] as [number, number];
    const [row, col] = id.split('-').map(Number);
    return [(col - row / 2) * 14.4 / gridSize, -7.2 + row * 12.4707658145 / gridSize];
}
