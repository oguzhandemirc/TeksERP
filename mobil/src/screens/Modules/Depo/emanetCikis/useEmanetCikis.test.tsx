// Emanet çıkış (T1) hook'u — idempotency sözleşmesi + kayıt kapısı.
// Kabul: belirsiz hata (5xx/ağ) sonrası ikinci basış AYNI token; kesin 4xx sonrası TAZE token;
// yük (kalem) değişirse TAZE token; çevrimdışı kayıt çağrılmaz; önizleme canCreate=false kaydı kapatır;
// sahip değişince kalemler boşalır. Negatif sonda: onError her hatada yapıştırırsa "4xx → taze" kırmızı.
import React, { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { BeamCandidate } from '../../../../services/consignment.service';
import { beamLine } from './emanetCikisLogic';
import { useEmanetCikis } from './useEmanetCikis';

const mockPreview = jest.fn();
const mockCreate = jest.fn();
jest.mock('../../../../services/consignment.service', () => ({
  consignmentService: { preview: (b: unknown) => mockPreview(b), create: (b: unknown) => mockCreate(b), candidates: jest.fn() },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../../lib/screenToast', () => ({ showScreenError: jest.fn() }));

const beam = (id: string): BeamCandidate => ({ warpBeamId: id, beamNo: `LV${id}`, warpSpecName: null, remainingM: '100', blockedReason: null });
const okPreview = (canCreate = true) => ({ lines: [], totals: { beamCount: 1, beamLengthM: '100', yarnKg: '0' }, canCreate, warnings: [] });
const err = (status?: number) => Object.assign(new Error('x'), { status });
const created = { id: 'd1', dispatchNo: 'EC-0001', ownerCustomer: { id: 'c1', name: 'Akın' }, totals: { beamCount: 1, beamLengthM: '100', yarnKg: '0' } };

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useEmanetCikis(true), { wrapper });
}

async function ready(r: ReturnType<typeof setup>['result'], id = '1') {
  act(() => r.current.selectOwner('c1', 'Akın'));
  act(() => r.current.addLine(beamLine(beam(id))));
  await waitFor(() => expect(r.current.canSubmit).toBe(true));
}
const tokens = () => mockCreate.mock.calls.map((c) => (c[0] as { clientToken: string }).clientToken);

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  mockPreview.mockResolvedValue(okPreview());
});

it('⭐ belirsiz hata (5xx) sonrası tekrar AYNI token ile gider; CTA "Tekrar Dene"', async () => {
  const { result } = setup();
  await ready(result);
  mockCreate.mockRejectedValueOnce(err(503));
  act(() => result.current.submit());
  await waitFor(() => expect(result.current.retrying).toBe(true));
  await waitFor(() => expect(result.current.canSubmit).toBe(true));
  mockCreate.mockResolvedValueOnce(created);
  act(() => result.current.submit());
  await waitFor(() => expect(result.current.result?.dispatchNo).toBe('EC-0001'));
  expect(tokens()).toHaveLength(2);
  expect(tokens()[1]).toBe(tokens()[0]);
});

it('⭐ ağ hatası (status yok) da yapışır', async () => {
  const { result } = setup();
  await ready(result);
  mockCreate.mockRejectedValueOnce(err(undefined));
  act(() => result.current.submit());
  await waitFor(() => expect(result.current.retrying).toBe(true));
});

it('⭐ kesin 4xx sonrası TAZE token (döngüye girmez)', async () => {
  const { result } = setup();
  await ready(result);
  mockCreate.mockRejectedValueOnce(err(409));
  act(() => result.current.submit());
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.canSubmit).toBe(true));
  expect(result.current.retrying).toBe(false);
  mockCreate.mockResolvedValueOnce(created);
  act(() => result.current.submit());
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(tokens()[1]).not.toBe(tokens()[0]);
});

it('⭐ yük değişirse (kalem eklendi) yapışkan token bırakılır — yeni deneme', async () => {
  const { result } = setup();
  await ready(result);
  mockCreate.mockRejectedValueOnce(err(500));
  act(() => result.current.submit());
  await waitFor(() => expect(result.current.retrying).toBe(true));
  act(() => result.current.addLine(beamLine(beam('2'))));
  await waitFor(() => expect(result.current.retrying).toBe(false));
  await waitFor(() => expect(result.current.canSubmit).toBe(true));
  mockCreate.mockResolvedValueOnce(created);
  act(() => result.current.submit());
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(tokens()[1]).not.toBe(tokens()[0]);
});

it('⭐ önizleme canCreate=false kaydı kapatır', async () => {
  mockPreview.mockResolvedValue(okPreview(false));
  const { result } = setup();
  act(() => result.current.selectOwner('c1', 'Akın'));
  act(() => result.current.addLine(beamLine(beam('1'))));
  await waitFor(() => expect(result.current.blockedReason).toBe('Engelli kalemleri çıkarın.'));
  expect(result.current.canSubmit).toBe(false);
  act(() => result.current.submit());
  expect(mockCreate).not.toHaveBeenCalled();
});

it('⭐ çevrimdışı: önizleme ve kayıt çağrılmaz', async () => {
  onlineManager.setOnline(false);
  const { result } = setup();
  act(() => result.current.selectOwner('c1', 'Akın'));
  act(() => result.current.addLine(beamLine(beam('1'))));
  expect(result.current.blockedReason).toMatch(/^Çevrimdışı/);
  act(() => result.current.submit());
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockPreview).not.toHaveBeenCalled();
});

it('sahip değişince kalemler boşalır; aynı sahip yeniden seçilince korunur', async () => {
  const { result } = setup();
  await ready(result);
  act(() => result.current.selectOwner('c1', 'Akın'));
  expect(result.current.lines).toHaveLength(1);
  act(() => result.current.selectOwner('c2', 'Başka'));
  expect(result.current.lines).toHaveLength(0);
});

it('aynı kalem iki kez eklenmez; yeni çıkış sahibi korur', async () => {
  const { result } = setup();
  await ready(result);
  act(() => result.current.addLine(beamLine(beam('1'))));
  expect(result.current.lines).toHaveLength(1);
  mockCreate.mockResolvedValueOnce(created);
  act(() => result.current.submit());
  await waitFor(() => expect(result.current.result).not.toBeNull());
  act(() => result.current.startNext());
  expect(result.current.owner?.id).toBe('c1');
  expect(result.current.lines).toHaveLength(0);
  expect(result.current.result).toBeNull();
});
