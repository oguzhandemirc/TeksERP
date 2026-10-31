// D4-E2b — çevrimdışı kuyruk ölçülen eni taşır; eski (düz rollId) kuyruk kaydı bugünkü `{}` gövdesiyle gider.
import { MutationObserver, dehydrate, onlineManager } from '@tanstack/react-query';
import { kursunQcService } from '../services/kursunQc.service';
import { rollService } from '../services/roll.service';
import { registerStationMutationDefaults, STATION_MUT } from './mutations';
import { queryClient } from './queryClient';
import { PERSIST_DEHYDRATE_OPTIONS } from './persistPolicy';
import { kursunFinishRequest, kursunFinishRollId } from './kursunFinishVars';

// jest.mock çağrıları babel-jest ile içe aktarımların üstüne taşınır.
jest.mock('../services/kursunQc.service', () => ({
  kursunQcService: { completeQc2: jest.fn(), reportError: jest.fn(), deleteError: jest.fn(), finishStep: jest.fn() },
}));
jest.mock('../services/roll.service', () => ({ rollService: { kursunFinish: jest.fn(), createInitialEntry: jest.fn(), scrap: jest.fn() } }));
jest.mock('../services/tambur.service', () => ({ tamburService: { finalizeOpenFabric: jest.fn() } }));
jest.mock('../services/subcontractor.service', () => ({ subcontractorService: { dispatch: jest.fn(), receive: jest.fn() } }));
jest.mock('../services/kartela.service', () => ({ kartelaService: { dispatch: jest.fn(), receive: jest.fn() } }));
jest.mock('../services/api', () => ({ resolveAuthToken: jest.fn(async () => 'test-token') }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

type Fn = (vars: unknown) => Promise<unknown>;
const fnOf = (key: readonly unknown[]) => queryClient.getMutationDefaults(key).mutationFn as Fn;

beforeAll(() => registerStationMutationDefaults());
afterEach(() => {
  onlineManager.setOnline(true);
  jest.clearAllMocks();
});

describe('KURSUN_FINISH kuyruk değişkeni', () => {
  it('eski kayıt (düz rollId) → gövde {} (bayt-aynı)', async () => {
    await fnOf(STATION_MUT.KURSUN_FINISH)('r1');
    expect(rollService.kursunFinish).toHaveBeenCalledWith('r1', {});
  });
  it('⭐ ölçülen en 280 → gövdede measuredWidthCm=280', async () => {
    await fnOf(STATION_MUT.KURSUN_FINISH)({ rollId: 'r1', measuredWidthCm: 280 });
    expect(rollService.kursunFinish).toHaveBeenCalledWith('r1', { measuredWidthCm: 280 });
  });
  it('nesne ama ensiz → gövde {}', () => {
    expect(kursunFinishRequest({ rollId: 'r1' })).toEqual({ rollId: 'r1', body: {} });
    expect(kursunFinishRollId({ rollId: 'r2' })).toBe('r2');
  });
});

describe('QC2_COMPLETE kuyruk değişkeni', () => {
  it('⭐ ölçülen en kuyruktan servise aynen geçer', async () => {
    const vars = { rollId: 'r1', stepId: 's1', properties: [], measuredWidthCm: 280 };
    await fnOf(STATION_MUT.QC2_COMPLETE)(vars);
    expect(kursunQcService.completeQc2).toHaveBeenCalledWith(vars);
  });
});

describe('çevrimdışı: bekleyen mutasyon kalıcı kayda eni taşır', () => {
  beforeAll(() => queryClient.mount());
  afterAll(() => {
    queryClient.getMutationCache().clear();
    queryClient.unmount();
  });
  it.each([
    [STATION_MUT.KURSUN_FINISH, { rollId: 'r9', measuredWidthCm: 280 }],
    [STATION_MUT.QC2_COMPLETE, { rollId: 'r9', stepId: 's9', measuredWidthCm: 280 }],
  ])('⭐ %p paused → dehydrate variables measuredWidthCm=280', async (key, vars) => {
    onlineManager.setOnline(false);
    const obs = new MutationObserver(queryClient, { ...queryClient.getMutationDefaults(key), mutationKey: key });
    void obs.mutate(vars as never).catch(() => undefined);
    await Promise.resolve();
    const persisted = dehydrate(queryClient, PERSIST_DEHYDRATE_OPTIONS).mutations.filter(
      (m) => JSON.stringify(m.mutationKey) === JSON.stringify(key),
    );
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted[persisted.length - 1].state.variables).toEqual(vars);
    queryClient.getMutationCache().clear();
  });
});
