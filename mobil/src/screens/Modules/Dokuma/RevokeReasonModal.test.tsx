// BEKÇİ — geri alma modalı tek bileşen: `minLength` koşum/duruş 3 (varsayılan) · indirme 1; kısa sebep Geri Al'ı kilitler.
import { act, fireEvent } from '@testing-library/react-native';
import RevokeReasonModal from './RevokeReasonModal';
import { renderWithPaper } from '../../../test/render';

describe('RevokeReasonModal', () => {
  it('varsayılan minLength 3: 2 karakter kilitli, 3 karakter Geri Al → onConfirm kırpılmış sebeple', async () => {
    const onConfirm = jest.fn();
    const u = renderWithPaper(<RevokeReasonModal visible title="Koşum geri alınsın mı?" hint="Damga." busy={false} onClose={jest.fn()} onConfirm={onConfirm} />);
    await act(async () => {});
    fireEvent.changeText(u.getByTestId('revoke-sebep'), 'ab');
    await act(async () => {});
    expect(u.getByTestId('revoke-onay').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(u.getByTestId('revoke-sebep'), ' abc ');
    await act(async () => {});
    expect(u.getByTestId('revoke-onay').props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(u.getByTestId('revoke-onay'));
    await act(async () => {});
    expect(onConfirm).toHaveBeenCalledWith('abc');
  });

  it('minLength 1 (indirme geri al): tek karakter yeter', async () => {
    const onConfirm = jest.fn();
    const u = renderWithPaper(<RevokeReasonModal visible title="DF-1 geri alınsın mı?" hint="Sebep zorunlu." busy={false} minLength={1} onClose={jest.fn()} onConfirm={onConfirm} />);
    await act(async () => {});
    fireEvent.changeText(u.getByTestId('revoke-sebep'), 'x');
    await act(async () => {});
    expect(u.getByTestId('revoke-onay').props.accessibilityState?.disabled).toBe(false);
  });
});
