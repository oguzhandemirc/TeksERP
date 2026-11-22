// WarpEndsBand render: tek iplik → hiçbir şey; genişlik ölçülünce iplik başına blok; tutarsız dizilimde uyarı; ince kip lejantsız.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { Rect } from 'react-native-svg';
import { renderWithPaper } from '../../test/render';
import WarpEndsBand from './WarpEndsBand';

const yarns = [
  { letter: 'A', code: 'P150', name: 'P150', endsCount: 4 },
  { letter: 'B', code: 'P75', name: 'P75', endsCount: 2 },
];
const seq = { repeat: [1, 1, 2], repeatCount: 2, remainder: 0, totalEnds: 6, matchesYarnEnds: true };

describe('WarpEndsBand', () => {
  it('tek iplikli kartta çizmez', () => {
    const r = renderWithPaper(<WarpEndsBand yarns={[yarns[0]!]} endsSequence={seq} testID="b" />);
    expect(r.queryByTestId('b')).toBeNull();
  });

  it('ölçülen genişlikte ardışık iplik blokları + rapor satırı', () => {
    const r = renderWithPaper(<WarpEndsBand yarns={yarns} endsSequence={seq} sequenceNote="2A 1B" testID="b" />);
    expect(r.queryByTestId('b-svg')).toBeNull();
    fireEvent(r.getByTestId('b').children[1] as never, 'layout', { nativeEvent: { layout: { width: 300, height: 28 } } });
    expect(r.getByTestId('b-svg')).toBeTruthy();
    expect(r.UNSAFE_getAllByType(Rect)).toHaveLength(2);
    expect(r.getByText('Rapor 3 tel × 2 = 6 tel')).toBeTruthy();
    expect(r.queryByTestId('b-uyari')).toBeNull();
  });

  it('dizilim kart tel sayılarıyla tutmuyorsa uyarır; ince kipte lejant yok', () => {
    const r = renderWithPaper(<WarpEndsBand yarns={yarns} endsSequence={{ ...seq, matchesYarnEnds: false }} testID="b" />);
    expect(r.getByTestId('b-uyari')).toBeTruthy();
    const c = renderWithPaper(<WarpEndsBand yarns={yarns} endsSequence={seq} compact testID="c" />);
    expect(c.queryByText('P150 · 4 tel')).toBeNull();
  });
});
