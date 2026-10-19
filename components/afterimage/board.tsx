'use client';

import type { CSSProperties } from 'react';
import { getBoard } from '@/lib/geometry';
import type { GameEvent } from '@/lib/contracts';
import { playerColor, playerColorStyle } from '@/lib/player-colors';
import styles from './board.module.css';

export interface MemoMark { edgeId: string; status: 'safe' | 'mine' | 'unsure' }

interface BoardProps {
  gridSize?: number;
  /** The board creator's seat, independently of the player currently exploring. */
  ownerSeat?: number;
  mines?: string[];
  position?: string | null;
  allowedNodes?: string[];
  onNode?: (nodeId: string) => void;
  onEdge?: (edgeId: string) => void;
  selectedEdge?: string;
  event?: GameEvent | null;
  placement?: boolean;
  maxMines?: number;
  hintMode?: boolean;
  illustration?: boolean;
  disabled?: boolean;
  /** Personal, unverified annotations. Never supply another player's memo here. */
  memoMarks?: MemoMark[];
  memoLabel?: string;
  allowBaseEdges?: boolean;
  edgeActionLabel?: string;
  /** Pick the closest segment for memo editing on small touch screens. */
  easyEdgeSelection?: boolean;
  ariaLabel?: string;
  concealedEdges?: string[];
  concealmentMode?: boolean;
}

export function Board({ gridSize = 4, ownerSeat, mines = [], position, allowedNodes = [], onNode, onEdge, selectedEdge, event, placement, maxMines, hintMode, illustration, disabled, memoMarks = [], memoLabel = '내 메모', allowBaseEdges, edgeActionLabel, easyEdgeSelection, ariaLabel, concealedEdges = [], concealmentMode }: BoardProps) {
  const { nodes: boardNodes, edges } = getBoard(gridSize);
  const edgeTargetWidth = 44 * Math.min(1, 4 / gridSize);
  const nodes = new Map(boardNodes.map(node => [node.id, node]));
  const top = boardNodes.find(node => node.goal)!;
  const bottom = boardNodes.filter(node => node.start);
  const left = bottom[0];
  const right = bottom[bottom.length - 1];
  const pawn = nodes.get(position ?? '');
  const moveFrom = event?.type === 'move' ? nodes.get(event.from ?? '') : undefined;
  const explosionEdge = edges.find(edge => edge.id === event?.edgeId);
  const explosionA = explosionEdge && nodes.get(explosionEdge.a);
  const explosionB = explosionEdge && nodes.get(explosionEdge.b);
  return (
    <svg className={`game-board ${illustration ? 'illustrated-board' : ''} ${hintMode ? 'hinting-board' : ''} ${ownerSeat !== undefined ? styles.owned : ''}`} style={ownerSeat !== undefined ? playerColorStyle(ownerSeat) : undefined} viewBox="0 0 600 540" data-grid-size={gridSize} data-owner-seat={ownerSeat} data-owner-color={ownerSeat !== undefined ? playerColor(ownerSeat).label : undefined} role="group" aria-label={ariaLabel ?? `${ownerSeat !== undefined ? `${ownerSeat + 1}번 자리, ${playerColor(ownerSeat).label} 판. ` : ''}${placement ? `지뢰 배치판. ${gridSize}등분 선분을 선택해 지뢰를 설치하세요.` : `삼각형 탐색판. ${gridSize}등분 밑변에서 출발해 정상까지 이동하세요.`}`} onClickCapture={click => {
      // A fixed screen-space radius makes narrow SVG strokes easier to tap.
      // Choose the nearest legal segment rather than overlapping hit areas.
      // Native clicks fire after taps, not after scrolling the editor.
      if (!easyEdgeSelection || !onEdge || disabled || click.detail === 0) return;
      const matrix = click.currentTarget.getScreenCTM();
      if (!matrix) return;
      click.stopPropagation();
      let closest: string | undefined;
      let distance = 14;
      for (const edge of edges) {
        if ((edge.base && !allowBaseEdges) || (placement && !concealmentMode && maxMines !== undefined && mines.length >= maxMines && !mines.includes(edge.id))) continue;
        const a = nodes.get(edge.a)!;
        const b = nodes.get(edge.b)!;
        const start = new DOMPoint(a.x, a.y).matrixTransform(matrix);
        const end = new DOMPoint(b.x, b.y).matrixTransform(matrix);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const progress = Math.max(.19, Math.min(.81, ((click.clientX - start.x) * dx + (click.clientY - start.y) * dy) / (dx * dx + dy * dy)));
        const candidateDistance = Math.hypot(click.clientX - start.x - progress * dx, click.clientY - start.y - progress * dy);
        if (candidateDistance < distance) { closest = edge.id; distance = candidateDistance; }
      }
      if (closest) onEdge(closest);
    }}>
      <path className="board-surface" d={`M${top.x} ${top.y} L${left.x} ${left.y} L${right.x} ${right.y} Z`} fill="var(--board-fill, #fafbf8)"/>
      {edges.map(edge => {
        const a = nodes.get(edge.a)!;
        const b = nodes.get(edge.b)!;
        const mined = mines.includes(edge.id);
        const selected = edge.id === selectedEdge;
        const target = !!onEdge && (!edge.base || allowBaseEdges) && !disabled;
        const enabled = target && (concealmentMode || !placement || maxMines === undefined || mined || mines.length < maxMines);
        const concealed = concealedEdges.includes(edge.id);
        const memo = memoMarks.find(mark => mark.edgeId === edge.id);
        const memoSymbol = memo?.status === 'safe' ? '✓' : memo?.status === 'mine' ? '!' : '?';
        const memoStatusLabel = memo?.status === 'safe' ? '안전 추측' : memo?.status === 'mine' ? '지뢰 추측' : '미확인';
        return <g key={edge.id} className={`board-edge ${enabled ? 'edge-clickable' : ''} ${mined ? 'edge-mined' : ''} ${selected ? 'edge-selected' : ''}`}>
          <line className="edge-stroke" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? 'var(--gold, #956a21)' : mined ? 'var(--danger, #bc503c)' : 'var(--board-line, #537268)'} strokeWidth={selected || mined ? 4 : edge.base ? 3 : 2.5} strokeLinecap="round"/>
          {mined && <g className="mine-marker" transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`}><circle r="10" fill="var(--board-fill, #fafbf8)" stroke="var(--danger, #bc503c)" strokeWidth="1.8"/><path d="M-4-4l8 8m-8 0l8-8" stroke="var(--danger, #bc503c)" strokeWidth="2" strokeLinecap="round"/></g>}
          {concealed && <g className="concealment-marker" transform={`translate(${a.x + (b.x - a.x) * .7} ${a.y + (b.y - a.y) * .7})`} role="img" aria-label={`선분 ${edge.id}: 위장한 길`} pointerEvents="none"><path d="M0-7L6 0 0 7-6 0Z" fill="var(--panel)" stroke="var(--gold)" strokeWidth="1.8"/></g>}
          {memo && <g className="memo-marker" data-memo-status={memo.status} transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`} role="img" aria-label={`${memoLabel}, 선분 ${edge.id}: ${memoStatusLabel}`} pointerEvents="none"><title>{memoLabel} · {memoStatusLabel} · 직접 기록한 추측</title><circle r="12" fill="var(--panel)" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="3 2"/><text y="1" textAnchor="middle" dominantBaseline="middle" fill="var(--foreground)" style={{fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-sans)'}}>{memoSymbol}</text></g>}
          {target && <line className="edge-target" x1={a.x + (b.x-a.x)*.19} y1={a.y + (b.y-a.y)*.19} x2={b.x - (b.x-a.x)*.19} y2={b.y - (b.y-a.y)*.19} stroke="transparent" strokeWidth={edgeTargetWidth} pointerEvents="stroke" tabIndex={enabled ? 0 : -1} role="button" aria-disabled={!enabled} aria-pressed={concealmentMode ? concealed : placement ? mined : undefined} aria-label={`선분 ${edge.id}, ${edgeActionLabel ?? (concealmentMode ? '위장 선택' : placement ? mined ? '지뢰 제거' : '지뢰 설치' : '힌트 확인')}`} onClick={() => {if (enabled) onEdge?.(edge.id);}} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();if (enabled) onEdge?.(edge.id);}}}/>}
        </g>;
      })}
      {boardNodes.map(node => {
        const allowed = allowedNodes.includes(node.id) && !!onNode && !disabled;
        return <g key={node.id} className={`board-node ${allowed ? 'node-clickable' : ''}`}>
          {allowed && <circle className="node-halo" cx={node.x} cy={node.y} r="16" fill="var(--accent, #255e48)" fillOpacity=".08" stroke="var(--accent, #255e48)" strokeOpacity=".5"/>}
          <circle className={`node-circle ${node.start ? 'node-start' : ''}`} cx={node.x} cy={node.y} r={node.goal ? 10 : node.start ? 6.5 : 5} fill={node.goal ? 'var(--gold, #956a21)' : node.start ? 'var(--accent, #255e48)' : 'var(--board-fill, #fafbf8)'} stroke={node.goal ? 'var(--gold, #956a21)' : 'var(--board-line, #537268)'} strokeWidth="2.3"/>
          {node.goal && <><path d={`M${node.x} ${node.y-6}l4.5 6-4.5 6-4.5-6z`} fill="var(--on-accent, #fff)"/><text x={node.x} y={node.y-27} textAnchor="middle" className="board-label board-goal">정상</text></>}
          {node.start && <text x={node.x} y={node.y+33} textAnchor="middle" className="board-label">{node.col + 1}</text>}
          {allowed && <circle className="node-target" cx={node.x} cy={node.y} r="35" fill="transparent" role="button" tabIndex={0} aria-label={node.start && !position ? `출발점 ${node.col + 1}에서 시작` : `${node.row + 1}행 ${node.col + 1}열로 이동`} onClick={() => onNode(node.id)} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();onNode(node.id);}}}/>}
        </g>;
      })}
      {pawn && <g key={moveFrom ? event?.id : 'still'} className={`board-pawn ${moveFrom ? 'is-moving' : ''}`} style={moveFrom ? {'--pawn-from-x': `${moveFrom.x}px`, '--pawn-from-y': `${moveFrom.y}px`, '--pawn-to-x': `${pawn.x}px`, '--pawn-to-y': `${pawn.y}px`} as CSSProperties : undefined} transform={`translate(${pawn.x} ${pawn.y})`}><circle r="13" fill="var(--accent, #255e48)" stroke="var(--pawn-outline, #fff)" strokeWidth="3"/><circle r="4" fill="var(--on-accent, #fff)"/></g>}
      {illustration && <g className="illustrated-pawn" transform={`translate(${bottom[1].x} ${bottom[1].y})`}><circle r="15" fill="var(--accent, #255e48)" stroke="var(--pawn-outline, #fff)" strokeWidth="3"/><circle r="5" fill="var(--on-accent, #fff)"/></g>}
      {event?.type === 'explosion' && explosionA && explosionB && <g transform={`translate(${(explosionA.x + explosionB.x)/2} ${(explosionA.y + explosionB.y)/2})`}><g className="explosion"><circle r="25" fill="var(--danger, #bc503c)" fillOpacity=".12" stroke="var(--danger, #bc503c)" strokeWidth="2"/><path d="M-12-12l24 24m-24 0l24-24M0-30v9M0 21v9M-30 0h9M21 0h9" stroke="var(--danger, #bc503c)" strokeWidth="3" strokeLinecap="round"/></g></g>}
    </svg>
  );
}
