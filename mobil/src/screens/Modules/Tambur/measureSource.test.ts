// D4-B3 kabul (DALGA4 §13): simülede SIMULATED + "SİMÜLASYON" toastu; ölçüm sonrası elle değiştirilen
// ve tamamen elle → OPERATOR; makine değişmeden → MACHINE + peripheralId; kuyruk/tekrar deneme kaynağı
// taşır; eski backend (alan elenir) → kesim sürer; ölçüm kapısı 400'leri Türkçe mesaj.
import {
  SIMULATION_TOAST,
  measureErrorMessage,
  measureTamburCut,
  measureToneOf,
  resolveMeasure,
  simulatedMeters,
  withMeasure,
  type MeterCapture,
} from './measureSource';
import type { DevicePeripheral } from '../../../services/peripheral.service';

const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));
// eslint-disable-next-line import/first
import { tamburService } from '../../../services/tambur.service';

const PERIPHERAL_ID = '11111111-1111-4111-8111-111111111111';
const dev = (simulate: boolean) => ({ id: PERIPHERAL_ID, simulate } as unknown as DevicePeripheral);
const base = { katLabel: '4-KAT', remaining: 120 };

describe('measureTamburCut', () => {
  it('simülasyon cihazı: SIMULATED + kırmızı SİMÜLASYON toastu, cihaz okunmaz', async () => {
    const toast = jest.fn();
    const read = jest.fn();
    const c = await measureTamburCut({ ...base, peripheral: dev(true), read, toast, random: () => 0.5 });
    expect(c).toEqual({ value: simulatedMeters(120, () => 0.5), source: 'SIMULATED', peripheralId: PERIPHERAL_ID, rawCounter: null });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: 'SİMÜLASYON' }));
    expect(toast).toHaveBeenCalledWith(SIMULATION_TOAST);
    expect(read).not.toHaveBeenCalled();
    expect(resolveMeasure(c, c!.value).source).toBe('SIMULATED');
  });

  it('gerçek okuma: MACHINE + peripheralId, toast yok', async () => {
    const toast = jest.fn();
    const read = jest.fn().mockResolvedValue({ ok: true, value: 42.5, raw: '42.5', transport: {} });
    const c = await measureTamburCut({ ...base, peripheral: dev(false), read, toast });
    expect(c).toEqual({ value: 42.5, source: 'MACHINE', peripheralId: PERIPHERAL_ID, rawCounter: 42.5 });
    expect(toast).not.toHaveBeenCalled();
  });

  it('cihaz yok / okunamadı / desteklenmiyor → null + hata toastu (sessiz sahte değer YOK)', async () => {
    const toast = jest.fn();
    expect(await measureTamburCut({ ...base, peripheral: null, read: jest.fn(), toast })).toBeNull();
    const fail = jest.fn().mockResolvedValue({ ok: false, reason: 'READ_FAILED', message: 'Bağlantı yok' });
    expect(await measureTamburCut({ ...base, peripheral: dev(false), read: fail, toast })).toBeNull();
    const uns = jest.fn().mockResolvedValue({ ok: false, reason: 'UNSUPPORTED' });
    expect(await measureTamburCut({ ...base, peripheral: dev(false), read: uns, toast })).toBeNull();
    expect(toast).toHaveBeenCalledTimes(3);
    expect(toast.mock.calls.every(([t]) => t.type === 'error' && t.text1 !== 'SİMÜLASYON')).toBe(true);
  });
});

describe('resolveMeasure', () => {
  const machine: MeterCapture = { value: 30, source: 'MACHINE', peripheralId: PERIPHERAL_ID, rawCounter: 30 };
  it('makine ölçümü değişmeden → MACHINE + peripheralId', () => {
    expect(resolveMeasure(machine, 30)).toEqual({ source: 'MACHINE', peripheralId: PERIPHERAL_ID, rawCounter: 30 });
  });
  it('ölçüm sonrası elle değiştirilen → OPERATOR, cihaz kimliği yok', () => {
    expect(resolveMeasure(machine, 28.5)).toEqual({ source: 'OPERATOR' });
    expect(resolveMeasure({ ...machine, source: 'SIMULATED' }, 31)).toEqual({ source: 'OPERATOR' });
  });
  it('tamamen elle → OPERATOR', () => {
    expect(resolveMeasure(null, 12)).toEqual({ source: 'OPERATOR' });
    expect(resolveMeasure(undefined, 12)).toEqual({ source: 'OPERATOR' });
  });
});

describe('gövde ve kuyruk', () => {
  const body = { lengthMeters: 30, status: 'WAREHOUSE' as const, qualityGrade: '1K', clientToken: 't1' };
  it('ölçümsüz (eski kuyruk öğesi) gövde bayt-aynı; ölçümlü gövde alanı taşır', () => {
    expect(JSON.stringify(withMeasure(body, undefined))).toBe(JSON.stringify(body));
    expect(withMeasure(body, { source: 'OPERATOR' })).toEqual({ ...body, measure: { source: 'OPERATOR' } });
  });
  it('sapma onaylı tekrar deneme değişkenleri measure alanını korur (kesimler online-only; kuyruk kabulü uygulanamaz)', () => {
    const vars = { rollId: 'r1', ...body, measure: { source: 'SIMULATED' as const, peripheralId: PERIPHERAL_ID, rawCounter: null } };
    const restored = JSON.parse(JSON.stringify(vars)) as typeof vars;
    const retry = { ...restored, confirmMismatch: true };
    expect(withMeasure({ lengthMeters: retry.lengthMeters }, retry.measure).measure).toEqual(vars.measure);
  });
  it('measure gövdede /cut ucuna gider', async () => {
    // Yalnız istemci gövdesini ölçer; eski backend uyumu sunucu şemasının işidir
    // (manual/roll + manual/produce B1a öncesi strict → yeni APK en az B1a ister).
    mockPost.mockImplementation(async () => ({ data: { success: true, data: { childRoll: { id: 'c1' } } } }));
    const res = await tamburService.cutOpenFabric('r1', withMeasure(body, { source: 'MACHINE', peripheralId: PERIPHERAL_ID }));
    expect(res.success).toBe(true);
    expect(mockPost).toHaveBeenCalledWith('/tambur/r1/cut', expect.objectContaining({ measure: { source: 'MACHINE', peripheralId: PERIPHERAL_ID } }));
  });
});

describe('şerit rengi ve hata mesajı', () => {
  it('yeşil makine / amber elle / kırmızı simülasyon', () => {
    expect(measureToneOf('MACHINE')).toBe('GREEN');
    expect(measureToneOf('OPERATOR')).toBe('AMBER');
    expect(measureToneOf('SIMULATED')).toBe('RED');
    expect(measureToneOf(null)).toBe('NONE');
  });
  it('400 SIMULATED_METER_DISABLED ve MEASURE_SOURCE_REQUIRED → anlaşılır Türkçe mesaj', () => {
    const sim = measureErrorMessage({ details: { code: 'SIMULATED_METER_DISABLED' } });
    expect(sim?.text1).toBe('Simüle ölçüm kabul edilmiyor');
    expect(sim?.text2).toMatch(/Elle/);
    expect(measureErrorMessage({ details: { code: 'MEASURE_SOURCE_REQUIRED' } })?.text1).toBe('Ölçüm kaynağı zorunlu');
    expect(measureErrorMessage({ details: { code: 'METER_PERIPHERAL_NOT_FOUND' } })).not.toBeNull();
    expect(measureErrorMessage({ details: { code: 'PLAN_MISMATCH' } })).toBeNull();
    expect(measureErrorMessage(new Error('x'))).toBeNull();
    expect(measureErrorMessage(null)).toBeNull();
  });
});
