'use client';

import { useId } from 'react';
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
  const uid = useId().replaceAll(':', '');
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
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" x2=".8" y1="0" y2="1"><stop stopColor="#173c3d" stopOpacity=".75"/><stop offset="1" stopColor="#103031" stopOpacity=".22"/></linearGradient>
        <linearGradient id={`${uid}-edge`} gradientUnits="userSpaceOnUse" x1="70" y1="72" x2="530" y2="470"><stop stopColor="#dafbe3"/><stop offset="1" stopColor="#62a995"/></linearGradient>
        <radialGradient id={`${uid}-halo`}><stop stopColor="#90ebba" stopOpacity=".15"/><stop offset="1" stopColor="#90ebba" stopOpacity="0"/></radialGradient>
        <filter id={`${uid}-glow`}><feGaussianBlur stdDeviation="5"/></filter>
        <filter id={`${uid}-shadow`}><feDropShadow dx="0" dy="16" stdDeviation="16" floodColor="#000" floodOpacity=".3"/></filter>
      </defs>
      <ellipse cx="300" cy="325" rx="290" ry="210" fill={`url(#${uid}-halo)`}/>
      {illustration && <><circle className="orbit" cx="300" cy="285" r="237" fill="none" stroke="#80bdad" strokeOpacity=".11" strokeDasharray="3 10"/><circle cx="300" cy="285" r="193" fill="none" stroke="#80bdad" strokeOpacity=".06"/><path d="M32 110h18m-9-9v18M543 375h18m-9-9v18M484 105h10m-5-5v10" stroke="#8dbca5" strokeOpacity=".45"/></>}
      <path d={`M${top.x} ${top.y + 13} L${left.x} ${left.y + 13} L${right.x} ${right.y + 13} Z`} fill="#071b20" stroke="#294b45" strokeWidth="2"/>
      <path d={`M${top.x} ${top.y} L${left.x} ${left.y} L${right.x} ${right.y} Z`} fill={`url(#${uid}-fill)`} stroke="#89bba5" strokeOpacity=".55" strokeWidth="2" filter={`url(#${uid}-shadow)`}/>
      {EDGES.map(edge => {
        const a = nodes.get(edge.a)!;
        const b = nodes.get(edge.b)!;
        const mined = mines.includes(edge.id);
        const selected = edge.id === selectedEdge;
        const enabled = !!onEdge && !edge.base && !disabled;
        return <g key={edge.id} className={`board-edge ${enabled ? 'edge-clickable' : ''} ${mined ? 'edge-mined' : ''} ${selected ? 'edge-selected' : ''}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? '#f1ce87' : mined ? '#f39586' : `url(#${uid}-edge)`} strokeWidth={selected || mined ? 4 : edge.base ? 3 : 2} strokeOpacity={selected || mined ? 1 : illustration ? .74 : .65}/>
          {mined && <g transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`}><circle r="10" fill="#19262b" stroke="#f39586" strokeWidth="1.5"/><path d="M-4-4l8 8m-8 0l8-8" stroke="#f39586" strokeWidth="2"/></g>}
          {enabled && <line className="edge-target" x1={a.x + (b.x-a.x)*.19} y1={a.y + (b.y-a.y)*.19} x2={b.x - (b.x-a.x)*.19} y2={b.y - (b.y-a.y)*.19} stroke="transparent" strokeWidth="44" tabIndex={0} role="button" aria-label={`선분 ${edge.id}${placement ? mined ? ', 지뢰 제거' : ', 지뢰 설치' : ', 힌트 확인'}`} onClick={() => onEdge(edge.id)} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();onEdge(edge.id);}}}/>} 
        </g>;
      })}
      {NODES.map(node => {
        const allowed = allowedNodes.includes(node.id) && !!onNode && !disabled;
        return <g key={node.id} className={`board-node ${allowed ? 'node-clickable' : ''}`}>
          {allowed && <circle className="node-halo" cx={node.x} cy={node.y} r="15" fill="#a1e3bd" fillOpacity=".08" stroke="#b8e8c8" strokeOpacity=".4" strokeDasharray="2 3"/>}
          <circle cx={node.x} cy={node.y} r={node.goal ? 10 : node.start ? 6 : 4.5} fill={node.goal ? '#e9c57b' : node.start ? '#afd9b9' : '#accfbb'} stroke="#173731" strokeWidth="2"/>
          {node.goal && <><path d={`M${node.x} ${node.y-8}l6 8-6 8-6-8z`} fill="#fff0bf"/><text x={node.x} y={node.y-27} textAnchor="middle" className="board-label board-goal">SUMMIT</text></>}
          {node.start && <text x={node.x} y={node.y+33} textAnchor="middle" className="board-label">0{node.col + 1}</text>}
          {allowed && <circle cx={node.x} cy={node.y} r="35" fill="transparent" role="button" tabIndex={0} aria-label={node.start && !position ? `출발점 ${node.col + 1}에서 시작` : `${node.row + 1}행 ${node.col + 1}열로 이동`} onClick={() => onNode(node.id)} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();onNode(node.id);}}}/>}
        </g>;
      })}
      {pawn && <g key={moveFrom ? event?.id : 'still'} className={`board-pawn ${moveFrom ? 'is-moving' : ''}`} style={moveFrom ? {'--pawn-from-x': `${moveFrom.x}px`, '--pawn-from-y': `${moveFrom.y}px`, '--pawn-to-x': `${pawn.x}px`, '--pawn-to-y': `${pawn.y}px`} as React.CSSProperties : undefined} transform={`translate(${pawn.x} ${pawn.y})`}><ellipse cy="4" rx="13" ry="7" fill="#000" opacity=".3"/><path d="M-10 2L-6-12H6L10 2Q0 10-10 2" fill="#a4efc6" stroke="#e1ffe8" strokeWidth="2"/><circle cy="-16" r="6" fill="#e4ffec"/><circle r="24" fill="none" stroke="#b5f6d0" strokeOpacity=".25"/></g>}
      {illustration && <g transform={`translate(${bottom[1].x} ${bottom[1].y})`}><ellipse cy="5" rx="17" ry="8" fill="#000" opacity=".4"/><path d="M-12 1L-7-18H7L12 1Q0 12-12 1" fill="#b1eec4" stroke="#eefff1" strokeWidth="2"/><circle cy="-24" r="8" fill="#e8ffe8"/><circle r="28" fill="none" stroke="#d4ffe2" strokeOpacity=".3"/></g>}
      {event?.type === 'explosion' && explosionA && explosionB && <g className="explosion" transform={`translate(${(explosionA.x + explosionB.x)/2} ${(explosionA.y + explosionB.y)/2})`}><circle r="25" fill="#f4957e" fillOpacity=".15" stroke="#ff9c87" strokeWidth="2"/><path d="M-12-12l24 24m-24 0l24-24M0-30v9M0 21v9M-30 0h9M21 0h9" stroke="#ffae90" strokeWidth="3" strokeLinecap="round"/></g>}
    </svg>
  );
}
