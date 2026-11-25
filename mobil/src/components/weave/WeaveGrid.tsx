// =============================================================================
// WeaveGrid — salt-okunur armür + atkı seçici kare ızgarası (react-native-svg)
// =============================================================================
// Yerleşim saf `weaveLayout.ts`ten; burada yalnız çizim. Renk başına tek Path (512 satırda da hafif).
// `labels`: atkı no solda, çerçeve no tezgâh ekranı gibi altta (yukarıdan aşağı kipte üstte).
// =============================================================================
import React, { useMemo } from 'react';
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { weaveGridLayout, type GridDirection, type WeaveGridInput } from './weaveLayout';
import { WEAVE_COLORS, yarnColor } from './weavePalette';

export interface WeaveGridProps extends WeaveGridInput {
  cell: number;
  direction?: GridDirection;
  maxRows?: number;
  labels?: boolean;
  testID?: string;
}

const LABEL_W = 30;
const LABEL_H = 18;

export default function WeaveGrid({ cell, direction = 'bottom-up', maxRows, labels = false, testID, ...input }: WeaveGridProps) {
  const L = useMemo(
    () => weaveGridLayout(input, cell, direction, maxRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- girdi dizileri sorgu verisinden, referansla sabit
    [input.liftPlan, input.lenoFrames, input.selvedgeFrames, input.pickSequence, input.yarnCount, cell, direction, maxRows],
  );
  if (L.rows === 0 || (L.frames === 0 && L.selCount === 0)) return null;
  const ox = labels ? LABEL_W : 0;
  const oy = labels && direction === 'top-down' ? LABEL_H : 0;
  const w = ox + L.width + 1;
  const h = L.height + (labels ? LABEL_H : 0) + 1;
  const every = cell >= 14 ? 1 : cell >= 8 ? 5 : 10;
  const font = Math.min(12, Math.max(9, cell - 4));
  const frameLabelY = direction === 'top-down' ? LABEL_H - 5 : L.height + LABEL_H - 5;
  return (
    <Svg width={w} height={h} testID={testID}>
      <G x={ox + 0.5} y={oy + 0.5}>
        <Rect x={0} y={0} width={L.frames * cell} height={L.height} fill={WEAVE_COLORS.bg} />
        {L.selCount > 0 ? <Rect x={L.selectorX} y={0} width={L.selCount * cell} height={L.height} fill={WEAVE_COLORS.selectorBg} /> : null}
        {L.lenoBgPath ? <Path d={L.lenoBgPath} fill={WEAVE_COLORS.lenoBg} /> : null}
        {L.selvedgeBgPath ? <Path d={L.selvedgeBgPath} fill={WEAVE_COLORS.selvedgeBg} /> : null}
        {L.liftPath ? <Path d={L.liftPath} fill={WEAVE_COLORS.lift} /> : null}
        {L.lenoLiftPath ? <Path d={L.lenoLiftPath} fill={WEAVE_COLORS.leno} /> : null}
        {L.selectorPaths.map((s) => <Path key={s.yarn} d={s.d} fill={yarnColor(s.yarn)} />)}
        <Path d={L.linesPath} stroke={WEAVE_COLORS.line} strokeWidth={cell >= 6 ? 1 : 0.5} fill="none" />
      </G>
      {labels ? (
        <G>
          {Array.from({ length: L.rows }, (_, r) => r).filter((r) => r === 0 || (r + 1) % every === 0).map((r) => {
            const top = (direction === 'bottom-up' ? L.rows - 1 - r : r) * cell + oy;
            return <SvgText key={`r${r}`} x={ox - 4} y={top + cell / 2 + font / 3} fontSize={font} fill={WEAVE_COLORS.label} textAnchor="end">{r + 1}</SvgText>;
          })}
          {Array.from({ length: L.frames }, (_, c) => c).filter((c) => c === 0 || (c + 1) % (cell >= 14 ? 1 : 4) === 0).map((c) => (
            <SvgText key={`f${c}`} x={ox + c * cell + cell / 2} y={frameLabelY} fontSize={font} fill={WEAVE_COLORS.label} textAnchor="middle">{c + 1}</SvgText>
          ))}
          {Array.from({ length: L.selCount }, (_, i) => i).map((i) => (
            <SvgText key={`s${i}`} x={ox + L.selectorX + i * cell + cell / 2} y={frameLabelY} fontSize={font} fill={yarnColor(i + 1)} fontWeight="bold" textAnchor="middle">{String.fromCharCode(65 + i)}</SvgText>
          ))}
        </G>
      ) : null}
    </Svg>
  );
}
