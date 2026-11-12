// "Malın sahibi" satırı (GK 2026-11-11) + sayaç şeridi `fill` (sol sütun boş alanı): sahip yoksa satır yok,
// emanet topta "Fason" rozeti; şerit tablette büyür ve rakamlar kritik boyda.
import React from 'react';
import { StyleSheet } from 'react-native';
import { renderWithPaper } from '../../../test/render';
import GoodsOwnerCard, { goodsOwnerOf } from './GoodsOwnerCard';
import MeterStrip from './MeterStrip';
import { fmtMeters } from './meterCapture';
import type { MeterAcksState } from './useMeterAcks';
import type { MeterCaptureState } from './useMeterCapture';

describe('GoodsOwnerCard', () => {
  it('emanet top: ad kalın satırda + Fason rozeti', () => {
    const r = renderWithPaper(<GoodsOwnerCard roll={{ goodsOwner: { name: 'Gülkesim Tekstil', consigned: true } }} />);
    expect(r.getByText('Malın sahibi')).toBeOnTheScreen();
    expect(r.getAllByText('Gülkesim Tekstil').length).toBeGreaterThan(0);
    expect(r.getByTestId('kursun-mal-sahibi-fason')).toBeOnTheScreen();
  });

  it('İE müşterisi: rozet yok', () => {
    const r = renderWithPaper(<GoodsOwnerCard roll={{ goodsOwner: { name: 'ABC Ltd', consigned: false } }} />);
    expect(r.getByTestId('kursun-mal-sahibi')).toBeOnTheScreen();
    expect(r.queryByTestId('kursun-mal-sahibi-fason')).toBeNull();
  });

  it('seçili top yok / sahip bilinmiyor / eski backend: satır çizilmez', () => {
    for (const roll of [null, undefined, {}, { goodsOwner: null }, { goodsOwner: { name: '  ', consigned: true } }]) {
      const r = renderWithPaper(<GoodsOwnerCard roll={roll} />);
      expect(r.queryByTestId('kursun-mal-sahibi')).toBeNull();
      r.unmount();
    }
    expect(goodsOwnerOf({ goodsOwner: { name: ' X ', consigned: false } })).toEqual({ name: 'X', consigned: false });
  });
});

describe('MeterStrip fill', () => {
  const meter = {
    last: null, inOn: false, readIn: jest.fn(), inMetersOf: () => null, declaredOf: () => 120,
  } as unknown as MeterCaptureState;
  const acks = { pinPendingCount: 0, officePendingCount: 0, openPin: jest.fn() } as unknown as MeterAcksState;

  it('fill: şerit artan alana yayılır, rakam 32 tabular', () => {
    const r = renderWithPaper(<MeterStrip meter={meter} acks={acks} roll={null} stepId={null} fill />);
    const root = StyleSheet.flatten(r.getByTestId('metre-serit').props.style);
    expect(root).toMatchObject({ flexGrow: 1 });
    expect(root.maxHeight).toBeUndefined();
    const value = StyleSheet.flatten(r.getByText(fmtMeters(120)).props.style);
    expect(value).toMatchObject({ fontSize: 32, fontVariant: ['tabular-nums'] });
  });

  it('fill yok (telefon): yayılmaz', () => {
    const r = renderWithPaper(<MeterStrip meter={meter} acks={acks} roll={null} stepId={null} />);
    expect(StyleSheet.flatten(r.getByTestId('metre-serit').props.style).flexGrow).toBeUndefined();
    expect(StyleSheet.flatten(r.getByText(fmtMeters(120)).props.style).fontSize).toBe(24);
  });
});
