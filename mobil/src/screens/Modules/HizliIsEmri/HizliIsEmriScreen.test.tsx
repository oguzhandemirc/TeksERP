// Hızlı İş Emri: "Belge okut" kısayolu (T2) yalnız Belge Tara ekranı görünürken çıkar ve oraya götürür.
import React, { type ReactNode } from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import HizliIsEmriScreen from './HizliIsEmriScreen';

const mockNavigate = jest.fn();
let mockVisible: { key: string }[] = [];
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../../hooks/useVisibleScreens', () => ({ useVisibleScreens: () => ({ visibleScreens: mockVisible }) }));
jest.mock('../../../components/ScreenChrome', () => ({ __esModule: true, default: ({ children }: { children: ReactNode }) => children }));
jest.mock('./NewWorkOrderView', () => ({ __esModule: true, default: () => null }));
jest.mock('./WorkOrderListView', () => ({ __esModule: true, default: () => null }));
jest.mock('./WorkOrderDetailSheet', () => ({ __esModule: true, default: () => null }));

describe('HizliIsEmriScreen — Belge okut kısayolu', () => {
  beforeEach(() => mockNavigate.mockReset());

  it('Belge Tara görünür → düğme var, Belge Tara ekranına gider', () => {
    mockVisible = [{ key: 'HizliIsEmri' }, { key: 'GelenBelge' }];
    const r = renderWithPaper(<HizliIsEmriScreen />);
    fireEvent.press(r.getByTestId('hizli-is-emri-belge-okut'));
    expect(mockNavigate).toHaveBeenCalledWith('GelenBelge');
  });

  it('modül kapalı / izin yok → düğme yok', () => {
    mockVisible = [{ key: 'HizliIsEmri' }];
    const r = renderWithPaper(<HizliIsEmriScreen />);
    expect(r.queryByTestId('hizli-is-emri-belge-okut')).toBeNull();
  });
});
