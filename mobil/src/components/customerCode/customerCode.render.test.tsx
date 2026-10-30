// BEKÇİ — D4-F4 tablet müşteri etiketi: okut-bağla başarı akışı · 409 AMBIGUOUS'ta DOĞRUDAN aday modalı ve
// seçimle iç barkodla devam (sessiz seçim yok, K12) · eski backend 404 → düğme gizli · izin yoksa düğme yok.
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import { useAmbiguousScanPicker } from './CustomerCodeCandidateModal';
import { CustomerCodeBindSheet } from './CustomerCodeBindSheet';
import { CustomerCodeBindButton } from './CustomerCodeBindButton';
import { resetCustomerCodeEndpointMissing } from './useCustomerCodeBindable';
import { rollCustomerCodeService } from '../../services/rollCustomerCode.service';

let mockPerms: string[] = [];
let mockFlags: Record<string, unknown> | undefined;
jest.mock('../../hooks/usePermission', () => ({
  usePermissions: () => ({ has: (c: string) => mockPerms.includes(c) }),
}));
jest.mock('../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ data: mockFlags }) }));
jest.mock('../BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../services/rollCustomerCode.service', () => ({
  rollCustomerCodeService: { bind: jest.fn(), revoke: jest.fn() },
}));
const bindMock = rollCustomerCodeService.bind as jest.Mock;

const AMBIGUOUS = {
  status: 409,
  details: {
    code: 'CUSTOMER_CODE_AMBIGUOUS',
    scannedCode: 'MK77',
    candidates: [
      { rollId: 'r1', barcode: 'H251030001', customerId: 'a', customerName: 'Acar Perde', code: 'MK77', currentQty: 41.5 },
      { rollId: 'r2', barcode: 'H251030002', customerId: 'b', customerName: 'Bora Tekstil', code: 'MK77', currentQty: 37 },
    ],
  },
};

function ScanHarness({ scan, onPick }: { scan: (code: string) => Promise<void>; onPick: (b: string) => void }) {
  const picker = useAmbiguousScanPicker(onPick);
  const [shown, setShown] = React.useState('');
  React.useEffect(() => {
    scan('MK77').catch((e) => {
      if (!picker.intercept(e)) setShown('genel hata');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <Text>{shown}</Text>
      {picker.modal}
    </>
  );
}

beforeEach(() => {
  mockPerms = ['mobile:tambur'];
  mockFlags = { emanetEnabled: true, scanCustomerCodeLookupEnabled: true };
  bindMock.mockReset();
  resetCustomerCodeEndpointMissing();
});

describe('409 CUSTOMER_CODE_AMBIGUOUS → aday modalı', () => {
  it('modal DOĞRUDAN açılır, hiçbir aday kendiliğinden seçilmez; seçim iç barkodla sürer', async () => {
    const onPick = jest.fn();
    renderWithPaper(<ScanHarness scan={() => Promise.reject(AMBIGUOUS)} onPick={onPick} />);
    await waitFor(() => expect(screen.getByText('H251030001')).toBeTruthy());
    expect(screen.getByText('H251030002')).toBeTruthy();
    expect(screen.getByText('Acar Perde · 41.5 m')).toBeTruthy();
    expect(screen.getByText('Bora Tekstil · 37.0 m')).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('H251030002'));
    expect(onPick).toHaveBeenCalledWith('H251030002');
    expect(onPick).toHaveBeenCalledTimes(1);
  });
  it('başka hata modal açmaz (bugünkü hata yolu)', async () => {
    renderWithPaper(<ScanHarness scan={() => Promise.reject({ status: 404, details: { code: 'X' } })} onPick={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('genel hata')).toBeTruthy());
    expect(screen.queryByText('H251030001')).toBeNull();
  });
});

describe('okut-bağla', () => {
  const roll = { id: 'r1', barcode: 'H251030001' };
  it('başarı: kod + clientToken ile bağlar, onBound çağrılır', async () => {
    bindMock.mockResolvedValue({ success: true, data: {} });
    const onBound = jest.fn();
    renderWithPaper(<CustomerCodeBindSheet roll={roll} onDismiss={jest.fn()} onBound={onBound} />);
    await act(async () => {});
    fireEvent.changeText(screen.getByTestId('customer-code-input'), 'MK77');
    await act(async () => {});
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Bağla' })));
    expect(bindMock).toHaveBeenCalledWith('r1', { code: 'MK77', clientToken: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(onBound).toHaveBeenCalledWith('MK77');
  });
  it('409 TAKEN → Türkçe mesaj, modal açık kalır', async () => {
    bindMock.mockRejectedValue({ status: 409, details: { code: 'CUSTOMER_CODE_TAKEN' } });
    renderWithPaper(<CustomerCodeBindSheet roll={roll} onDismiss={jest.fn()} />);
    await act(async () => {});
    fireEvent.changeText(screen.getByTestId('customer-code-input'), 'MK77');
    await act(async () => {});
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Bağla' })));
    expect(screen.getByText(/Bu kod başka bir topta/)).toBeTruthy();
  });
  it('topta kod var → sebep alanı + "Değiştir"', async () => {
    bindMock.mockRejectedValue({ status: 409, details: { code: 'ROLL_CUSTOMER_CODE_EXISTS' } });
    renderWithPaper(<CustomerCodeBindSheet roll={roll} onDismiss={jest.fn()} />);
    await act(async () => {});
    fireEvent.changeText(screen.getByTestId('customer-code-input'), 'MK77');
    await act(async () => {});
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Bağla' })));
    expect(screen.getByTestId('customer-code-reason')).toBeTruthy();
    expect(screen.getByText('Değiştir')).toBeTruthy();
  });
});

describe('düğme görünürlüğü', () => {
  it('izin + emanet + sunucu yeteneği + emanet top → görünür', () => {
    renderWithPaper(<CustomerCodeBindButton ownerCustomerId="a" onPress={jest.fn()} />);
    expect(screen.getByTestId('customer-code-bind-icon')).toBeTruthy();
  });
  it('izin yoksa düğme yok', () => {
    mockPerms = ['mobile:tarti-paket'];
    renderWithPaper(<CustomerCodeBindButton ownerCustomerId="a" onPress={jest.fn()} />);
    expect(screen.queryByTestId('customer-code-bind-icon')).toBeNull();
  });
  it('eski backend (bayrak alanı yok) → düğme yok', () => {
    mockFlags = { emanetEnabled: true };
    renderWithPaper(<CustomerCodeBindButton ownerCustomerId="a" onPress={jest.fn()} />);
    expect(screen.queryByTestId('customer-code-bind-icon')).toBeNull();
  });
  it('eski backend 404 → düğme gizlenir', async () => {
    bindMock.mockRejectedValue({ status: 404, message: 'Endpoint bulunamadı' });
    renderWithPaper(
      <>
        <CustomerCodeBindButton ownerCustomerId="a" onPress={jest.fn()} />
        <CustomerCodeBindSheet roll={{ id: 'r1', barcode: 'H1' }} onDismiss={jest.fn()} />
      </>,
    );
    expect(screen.getByTestId('customer-code-bind-icon')).toBeTruthy();
    await act(async () => {});
    fireEvent.changeText(screen.getByTestId('customer-code-input'), 'MK77');
    await act(async () => {});
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Bağla' })));
    expect(screen.queryByTestId('customer-code-bind-icon')).toBeNull();
  });
});
