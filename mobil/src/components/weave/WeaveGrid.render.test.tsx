// WeaveGrid render: boş girdi → hiçbir şey; armürlü girdi → SVG (etiketli kipte atkı/çerçeve/iplik harfi).
import React from 'react';
import { renderWithPaper } from '../../test/render';
import { Path, Text as SvgText } from 'react-native-svg';
import WeaveGrid from './WeaveGrid';

describe('WeaveGrid', () => {
  it('armür ve seçici yoksa çizmez', () => {
    const r = renderWithPaper(<WeaveGrid liftPlan={null} cell={10} testID="g" />);
    expect(r.queryByTestId('g')).toBeNull();
  });

  it('armürlü girdi etiketlerle çizilir', () => {
    const r = renderWithPaper(<WeaveGrid liftPlan={[[1, 0], [0, 1]]} pickSequence={[1, 2]} yarnCount={2} cell={16} labels testID="g" />);
    expect(r.getByTestId('g')).toBeTruthy();
    // 2 atkı no + 2 çerçeve no + 2 iplik harfi; dolu hücreler renk başına tek Path.
    expect(r.UNSAFE_getAllByType(SvgText)).toHaveLength(6);
    expect(r.UNSAFE_getAllByType(Path).length).toBeLessThanOrEqual(5);
  });
});
