// =============================================================================
// PagedSheet — sayfalı kip sözleşmesi (kullanıcı kuralı 2026-09-18)
// =============================================================================
//   §1 saf geçiş: İleri'de hata → sayfa DEĞİŞMEZ + hata döner · Geri daima geçer · uçlarda kenetlenir
//   §2 render: ilk sayfa · İleri hatalıysa aynı sayfada hata yazısı, sayfa aynı · hatasız İleri → 2. sayfa
//   §3 son sayfada Kaydet var, İleri yok; Kaydet onSubmit'i çağırır; submitDisabled Kaydet'i kilitler ama Geri'yi değil
//   §4 Geri ilk sayfada pasif; adım göstergesinden geriye dokunma çalışır
// Negatif sonda (2026-09-18, bir kezlik): `nextPageState` hatayı yok sayıp ilerledi → §1 ve §2 ❌.
// =============================================================================
import { act, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native-paper';
import PagedSheet, { nextPageState, type SheetPage } from './PagedSheet';
import { renderWithPaper } from '../test/render';

describe('nextPageState (saf)', () => {
  it('§1 İleri hatalı → sayfa aynı, hata döner', () => {
    expect(nextPageState(0, 3, 'ileri', 'Metre zorunlu')).toEqual({ page: 0, error: 'Metre zorunlu' });
  });
  it('§1 İleri hatasız → +1, kenetli', () => {
    expect(nextPageState(0, 3, 'ileri', null)).toEqual({ page: 1, error: null });
    expect(nextPageState(2, 3, 'ileri', null)).toEqual({ page: 2, error: null });
  });
  it('§1 Geri daima geçer, hata silinir, 0da kenetli', () => {
    expect(nextPageState(2, 3, 'geri', 'x')).toEqual({ page: 1, error: null });
    expect(nextPageState(0, 3, 'geri', null)).toEqual({ page: 0, error: null });
  });
});

function pages(valid: boolean): SheetPage[] {
  return [
    { key: 'a', title: 'Ölçü', render: () => <Text>SAYFA-1</Text>, validate: () => (valid ? null : 'Metre zorunlu') },
    { key: 'b', title: 'Makine', render: () => <Text>SAYFA-2</Text> },
    { key: 'c', title: 'Özet', render: () => <Text>SAYFA-3</Text> },
  ];
}

// SimplePortal host'a bildirimi mikrotaskta düşer (RollCancelModal.test ile aynı): her basıştan sonra bir tur akıt.
async function press(u: ReturnType<typeof renderWithPaper>, id: string) {
  fireEvent.press(u.getByTestId(id));
  await act(async () => {});
}

function setup(valid = true, submitDisabled = false) {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  const utils = renderWithPaper(
    <PagedSheet visible onDismiss={onCancel} onCancel={onCancel} onSubmit={onSubmit} title="Sar" pages={pages(valid)} submitDisabled={submitDisabled} />,
  );
  return { ...utils, onSubmit, onCancel };
}

describe('PagedSheet', () => {
  it('§2 ilk sayfa çizilir; İleri hatalıysa hata o sayfada, sayfa değişmez', async () => {
    const u = setup(false);
    expect(u.getByText('SAYFA-1')).toBeTruthy();
    await press(u, 'paged-ileri');
    expect(u.getByTestId('paged-hata').props.children).toBe('Metre zorunlu');
    expect(u.getByText('SAYFA-1')).toBeTruthy();
    expect(u.queryByText('SAYFA-2')).toBeNull();
  });

  it('§2b hatasız İleri → ikinci sayfa, hata yok', async () => {
    const u = setup(true);
    await press(u, 'paged-ileri');
    expect(u.getByText('SAYFA-2')).toBeTruthy();
    expect(u.queryByTestId('paged-hata')).toBeNull();
  });

  it('§3 son sayfada Kaydet var, İleri yok; Kaydet onSubmit', async () => {
    const u = setup(true, false);
    await press(u, 'paged-ileri');
    await press(u, 'paged-ileri');
    expect(u.getByText('SAYFA-3')).toBeTruthy();
    expect(u.queryByTestId('paged-ileri')).toBeNull();
    await press(u, 'paged-kaydet');
    expect(u.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('§3b submitDisabled Kaydet kilitli, Geri açık', async () => {
    const k = setup(true, true);
    await press(k, 'paged-ileri');
    await press(k, 'paged-ileri');
    expect(k.getByTestId('paged-kaydet').props.accessibilityState?.disabled).toBe(true);
    expect(k.getByTestId('paged-geri').props.accessibilityState?.disabled).toBeFalsy();
  });

  it('§4 Geri ilk sayfada pasif; Geri ile dönülür', async () => {
    const u = setup(true);
    expect(u.getByTestId('paged-geri').props.accessibilityState?.disabled).toBe(true);
    await press(u, 'paged-ileri');
    await press(u, 'paged-geri');
    expect(u.getByText('SAYFA-1')).toBeTruthy();
  });
});
