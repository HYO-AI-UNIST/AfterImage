import test from 'node:test';
import assert from 'node:assert/strict';
import { EDGES, GOAL, NODES, STARTS, edgeId, getBoard, hasSafePath, maxMines, randomBoard } from '../lib/geometry.ts';

test('the default geometry retains the original board coordinates and aliases', () => {
  const board = getBoard();
  assert.equal(board, getBoard(4));
  assert.equal(NODES, board.nodes);
  assert.equal(EDGES, board.edges);
  assert.equal(STARTS, board.starts);
  assert.equal(GOAL, board.goal);
  for (const node of NODES) {
    assert.equal(node.x, 300 - node.row * 57.5 + node.col * 115);
    assert.equal(node.y, 72 + node.row * 99.5);
  }
});

for (const size of [3, 4, 5, 6]) {
  test(`${size} divisions have a connected triangle, matching unit edges and an unminable base`, () => {
    const board = getBoard(size);
    assert.equal(board.nodes.length, (size + 1) * (size + 2) / 2);
    assert.equal(board.edges.length, 3 * size * (size + 1) / 2);
    assert.equal(board.edgeLookup.size, board.edges.length);
    assert.equal(board.edges.filter((edge) => edge.base).length, size);
    assert.deepEqual(board.starts, Array.from({ length: size + 1 }, (_, col) => `${size}-${col}`));
    assert.equal(board.nodes.filter((node) => node.goal).length, 1);
    assert.equal(board.nodes.find((node) => node.id === board.goal)?.y, 72);
    assert.equal(board.nodes.find((node) => node.id === `${size}-0`)?.x, 70);
    assert.equal(board.nodes.find((node) => node.id === `${size}-${size}`)?.x, 530);
    assert.ok(board.nodes.filter((node) => node.start).every((node) => node.y === 470));

    const nodes = new Map(board.nodes.map((node) => [node.id, node]));
    const adjacency = new Map(board.nodes.map((node) => [node.id, new Set<string>()]));
    for (const edge of board.edges) {
      const a = nodes.get(edge.a)!;
      const b = nodes.get(edge.b)!;
      assert.ok(a && b);
      assert.equal(edge.id, edgeId(b.id, a.id));
      assert.equal(board.edgeLookup.get(edge.id), edge);
      assert.equal(edge.base, a.start && b.start);
      assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 460 / size) < 0.15);
      adjacency.get(a.id)!.add(b.id);
      adjacency.get(b.id)!.add(a.id);
    }
    const reachable = new Set([board.goal]);
    for (const node of reachable) for (const neighbor of adjacency.get(node)!) reachable.add(neighbor);
    assert.equal(reachable.size, board.nodes.length);
    assert.equal(adjacency.get(board.goal)!.size, 2);
    assert.equal(adjacency.get(`${size}-0`)!.size, 2);
    assert.equal(adjacency.get(`${size}-${size}`)!.size, 2);
  });

  test(`${size} divisions reject illegal mines and detect a route that requires backtracking`, () => {
    const board = getBoard(size);
    assert.equal(hasSafePath([], size), true);
    assert.equal(hasSafePath(['not-an-edge'], size), false);
    assert.equal(hasSafePath([edgeId(`${size + 1}-0`, `${size + 1}-1`)], size), false);
    assert.equal(hasSafePath(null as unknown as string[], size), false);
    for (const edge of board.edges.filter((entry) => entry.base)) assert.equal(hasSafePath([edge.id], size), false);
    assert.equal(hasSafePath([edgeId('0-0', '1-0'), edgeId('0-0', '1-1')], size), false);
    const cutRow = Math.floor(size / 2);
    const crossSection = board.edges.filter((edge) => {
      const a = board.nodes.find((node) => node.id === edge.a)!;
      const b = board.nodes.find((node) => node.id === edge.b)!;
      return a.row === cutRow && b.row === cutRow + 1;
    }).map((edge) => edge.id);
    assert.equal(hasSafePath(crossSection, size), false);

    // Only one entry from the base remains open. Its route must move back down
    // from row one to row two before it can reach the other side of the peak.
    const route = [
      ...Array.from({ length: size - 1 }, (_, index) => `${size - index}-0`),
      '1-0', '2-1', '1-1', '0-0',
    ];
    const safe = new Set(route.slice(1).map((node, index) => edgeId(route[index], node)));
    const mines = board.edges.filter((edge) => !edge.base && !safe.has(edge.id)).map((edge) => edge.id);
    assert.equal(hasSafePath(mines, size), true);
    assert.equal(hasSafePath([...mines, edgeId('1-0', '2-1')], size), false);
  });

  test(`${size} divisions generate legal random boards with a guaranteed route`, () => {
    let seed = 17 + size;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const board = getBoard(size);
    for (let trial = 0; trial < 100; trial += 1) {
      const mines = randomBoard(random, size);
      assert.equal(new Set(mines).size, mines.length);
      assert.ok(mines.length <= maxMines(size));
      assert.equal(hasSafePath(mines, size), true);
      assert.ok(mines.every((mine) => board.edgeLookup.has(mine) && !board.edgeLookup.get(mine)!.base));
    }
    // Adversarially dense draws still respect the cap without blocking the path.
    const dense = randomBoard(() => 0, size);
    assert.equal(dense.length, maxMines(size));
    assert.ok(hasSafePath(dense, size));
    assert.deepEqual(randomBoard(() => 0.999999, size), []);
  });
}

test('mine limits use half the non-base segments rounded down at every difficulty', () => {
  assert.equal(maxMines(), 13);
  for (const [size, expected] of [[3, 7], [4, 13], [5, 20], [6, 28]]) {
    assert.equal(maxMines(size), expected);
    const mineable = getBoard(size).edges.filter((edge) => !edge.base).length;
    assert.ok(expected <= mineable / 2 && expected + 1 > mineable / 2);
  }
});

test('unsupported grid sizes are rejected before geometry is generated', () => {
  for (const size of [0, 2, 7, 3.5, NaN, Infinity]) assert.throws(() => getBoard(size), RangeError);
});
