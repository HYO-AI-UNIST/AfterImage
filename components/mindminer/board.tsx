'use client';

import type { CSSProperties } from 'react';
import { EDGES, NODES } from '@/lib/game';
import type { GameEvent } from '@/lib/contracts';

interface BoardProps {
  mines?: string[];
  position?: string | null;
  allowedNodes?: string[];
  onNode?: (nodeId: string) => void;
  onEdge?: (edgeId: string) => void;
  selectedEdge?: string;
  event?: GameEvent | null;
  placement?: boolean;
  hintMode?: boolean;
  illustration?: boolean;
  disabled?: boolean;
}

export function Board({ mines = [], position, allowedNodes = [], onNode, onEdge, selectedEdge, event, placement, hintMode, illustration, disabled }: BoardProps) {
  const nodes = new Map(NODES.map(node => [node.id, node]));
  const top = NODES.find(node => node.goal)!;
  const bottom = NODES.filter(node => node.start);
  const left = bottom[0];
  const right = bottom[bottom.length - 1];
  const pawn = nodes.get(position ?? '');
  const moveFrom = event?.type === 'move' ? nodes.get(event.from ?? '') : undefined;
  const explosionEdge = EDGES.find(edge => edge.id === event?.edgeId);
  const explosionA = explosionEdge && nodes.get(explosionEdge.a);
  const explosionB = explosionEdge && nodes.get(explosionEdge.b);
  return (
    <svg className={`game-board ${illustration ? 'illustrated-board' : ''} ${hintMode ? 'hinting-board' : ''}`} viewBox="0 0 600 540" role="group" aria-label={placement ? '지뢰 배치판. 선분을 선택해 지뢰를 설치하세요.' : '삼각형 탐색판. 밑변에서 출발해 정상까지 이동하세요.'}>
      <path className="board-surface" d={`M${top.x} ${top.y} L${left.x} ${left.y} L${right.x} ${right.y} Z`} fill="var(--board-fill, #fafbf8)"/>
      {EDGES.map(edge => {
        const a = nodes.get(edge.a)!;
        const b = nodes.get(edge.b)!;
        const mined = mines.includes(edge.id);
        const selected = edge.id === selectedEdge;
        const enabled = !!onEdge && !edge.base && !disabled;
        return <g key={edge.id} className={`board-edge ${enabled ? 'edge-clickable' : ''} ${mined ? 'edge-mined' : ''} ${selected ? 'edge-selected' : ''}`}>
          <line className="edge-stroke" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? 'var(--gold, #956a21)' : mined ? 'var(--danger, #bc503c)' : 'var(--board-line, #537268)'} strokeWidth={selected || mined ? 4 : edge.base ? 3 : 2.5} strokeLinecap="round"/>
          {mined && <g className="mine-marker" transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`}><circle r="10" fill="var(--board-fill, #fafbf8)" stroke="var(--danger, #bc503c)" strokeWidth="1.8"/><path d="M-4-4l8 8m-8 0l8-8" stroke="var(--danger, #bc503c)" strokeWidth="2" strokeLinecap="round"/></g>}
          {enabled && <line className="edge-target" x1={a.x + (b.x-a.x)*.19} y1={a.y + (b.y-a.y)*.19} x2={b.x - (b.x-a.x)*.19} y2={b.y - (b.y-a.y)*.19} stroke="transparent" strokeWidth="44" pointerEvents="stroke" tabIndex={0} role="button" aria-pressed={placement ? mined : undefined} aria-label={`선분 ${edge.id}${placement ? mined ? ', 지뢰 제거' : ', 지뢰 설치' : ', 힌트 확인'}`} onClick={() => onEdge(edge.id)} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();onEdge(edge.id);}}}/>}
        </g>;
      })}
      {NODES.map(node => {
        const allowed = allowedNodes.includes(node.id) && !!onNode && !disabled;
        return <g key={node.id} className={`board-node ${allowed ? 'node-clickable' : ''}`}>
          {allowed && <circle className="node-halo" cx={node.x} cy={node.y} r="16" fill="var(--accent, #255e48)" fillOpacity=".08" stroke="var(--accent, #255e48)" strokeOpacity=".5"/>}
          <circle className="node-circle" cx={node.x} cy={node.y} r={node.goal ? 10 : node.start ? 6.5 : 5} fill={node.goal ? 'var(--gold, #956a21)' : node.start ? 'var(--accent, #255e48)' : 'var(--board-fill, #fafbf8)'} stroke={node.goal ? 'var(--gold, #956a21)' : 'var(--board-line, #537268)'} strokeWidth="2.3"/>
          {node.goal && <><path d={`M${node.x} ${node.y-6}l4.5 6-4.5 6-4.5-6z`} fill="#fff"/><text x={node.x} y={node.y-27} textAnchor="middle" className="board-label board-goal">정상</text></>}
          {node.start && <text x={node.x} y={node.y+33} textAnchor="middle" className="board-label">{node.col + 1}</text>}
          {allowed && <circle className="node-target" cx={node.x} cy={node.y} r="35" fill="transparent" role="button" tabIndex={0} aria-label={node.start && !position ? `출발점 ${node.col + 1}에서 시작` : `${node.row + 1}행 ${node.col + 1}열로 이동`} onClick={() => onNode(node.id)} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();onNode(node.id);}}}/>}
        </g>;
      })}
      {pawn && <g key={moveFrom ? event?.id : 'still'} className={`board-pawn ${moveFrom ? 'is-moving' : ''}`} style={moveFrom ? {'--pawn-from-x': `${moveFrom.x}px`, '--pawn-from-y': `${moveFrom.y}px`, '--pawn-to-x': `${pawn.x}px`, '--pawn-to-y': `${pawn.y}px`} as CSSProperties : undefined} transform={`translate(${pawn.x} ${pawn.y})`}><ellipse cy="4" rx="13" ry="6" fill="var(--accent, #255e48)" opacity=".12"/><path d="M-10 2L-6-12H6L10 2Q0 10-10 2" fill="var(--accent, #255e48)" stroke="#fff" strokeWidth="2"/><circle cy="-16" r="6" fill="var(--accent, #255e48)" stroke="#fff" strokeWidth="2"/></g>}
      {illustration && <g className="illustrated-pawn" transform={`translate(${bottom[1].x} ${bottom[1].y})`}><ellipse cy="5" rx="16" ry="7" fill="var(--accent, #255e48)" opacity=".12"/><path d="M-12 1L-7-18H7L12 1Q0 12-12 1" fill="var(--accent, #255e48)" stroke="#fff" strokeWidth="2"/><circle cy="-24" r="8" fill="var(--accent, #255e48)" stroke="#fff" strokeWidth="2"/></g>}
      {event?.type === 'explosion' && explosionA && explosionB && <g className="explosion" transform={`translate(${(explosionA.x + explosionB.x)/2} ${(explosionA.y + explosionB.y)/2})`}><circle r="25" fill="var(--danger, #bc503c)" fillOpacity=".12" stroke="var(--danger, #bc503c)" strokeWidth="2"/><path d="M-12-12l24 24m-24 0l24-24M0-30v9M0 21v9M-30 0h9M21 0h9" stroke="var(--danger, #bc503c)" strokeWidth="3" strokeLinecap="round"/></g>}
    </svg>
  );
}
