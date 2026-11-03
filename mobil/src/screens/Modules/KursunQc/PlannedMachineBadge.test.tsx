// Plan makinesi rozeti: öneri varsa adıyla çizilir; yoksa / eski backend alanı göndermezse hiç çizilmez.
import React from 'react';
import { StyleSheet } from 'react-native';
import { renderWithPaper } from '../../../test/render';
import PlannedMachineBadge from './PlannedMachineBadge';

describe('PlannedMachineBadge', () => {
  it('öneri varsa makine adıyla görünür', () => {
    const r = renderWithPaper(<PlannedMachineBadge name="Kurşun M2" testID="pm" />);
    expect(r.getByTestId('pm')).toBeTruthy();
    expect(r.getByText('Plan: Kurşun M2')).toBeTruthy();
  });
  it('öneri yoksa (null / alan yok) çizilmez', () => {
    expect(renderWithPaper(<PlannedMachineBadge name={null} testID="pm" />).queryByTestId('pm')).toBeNull();
    expect(renderWithPaper(<PlannedMachineBadge name={undefined} testID="pm" />).queryByTestId('pm')).toBeNull();
  });
  it('⭐ sabit piksel tavanı yok (yer varken ad kesilmesin)', () => {
    const r = renderWithPaper(<PlannedMachineBadge name="KURŞUN MAKİNESİ 1" testID="pm" />);
    const style = StyleSheet.flatten(r.getByTestId('pm').props.style);
    expect(typeof style.maxWidth).not.toBe('number');
  });
});
