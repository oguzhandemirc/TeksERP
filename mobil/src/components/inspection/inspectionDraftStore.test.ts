// K4P-TABLET — taslak deposu: anahtar ayrımı, çökme sonrası diskten dönüş, hydrate birleşimi, bozuk kayıt süzgeci.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_DRAFT } from './inspectionDraft';
import { inspectionDraftKey, sanitizeDrafts, useInspectionDraftStore, INSPECTION_DRAFT_MAX } from './inspectionDraftStore';

const KEY = 'TEKSERP_INSPECTION_DRAFTS_V1';
const add = (key: string, id: string, meter: number) =>
  useInspectionDraftStore.getState().dispatch(key, { type: 'add', id, defectTypeId: 'leke', meter, sizeClass: 'S2' });

beforeEach(async () => {
  await AsyncStorage.clear();
  useInspectionDraftStore.setState({ drafts: {}, hydrated: false });
});

describe('inspectionDraftStore', () => {
  it('anahtar konak + top ayırır: bir anahtarın taslağı ötekinde görünmez', async () => {
    await useInspectionDraftStore.getState().hydrate();
    const a = inspectionDraftKey('kk1-birth', 'station:s1');
    const b = inspectionDraftKey('kk1-birth', 'station:s2');
    add(a, 'x', 3);
    expect(useInspectionDraftStore.getState().drafts[a]?.defects).toHaveLength(1);
    expect(useInspectionDraftStore.getState().drafts[b]).toBeUndefined();
  });

  it('uygulama çöktü → taslak diskten döner (sunucuya yazılmaz)', async () => {
    await useInspectionDraftStore.getState().hydrate();
    add('h|r', 'x', 3);
    await Promise.resolve();
    // "Yeniden başlatma": bellek boş, disk dolu.
    useInspectionDraftStore.setState({ drafts: {}, hydrated: false });
    await useInspectionDraftStore.getState().hydrate();
    expect(useInspectionDraftStore.getState().drafts['h|r']?.defects.map((d) => d.id)).toEqual(['x']);
  });

  it("hydrate'ten önce diske yazılmaz; bellekteki yeni taslak birleşimde kazanır", async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ 'h|r': { defects: [{ id: 'old', defectTypeId: 'leke', sizeClass: 'S1', meter: 1, points: 1 }], note: '', inspectedLengthM: null }, 'h|q': { defects: [{ id: 'q', defectTypeId: 'leke', sizeClass: 'S1', meter: 1, points: 1 }], note: '', inspectedLengthM: null } }));
    add('h|r', 'new', 5);
    expect(JSON.parse((await AsyncStorage.getItem(KEY))!)['h|r'].defects[0].id).toBe('old');
    await useInspectionDraftStore.getState().hydrate();
    const s = useInspectionDraftStore.getState().drafts;
    expect(s['h|r']?.defects.map((d) => d.id)).toEqual(['new']);
    expect(s['h|q']?.defects.map((d) => d.id)).toEqual(['q']);
  });

  it('temizle anahtarı siler; restore yalnız ekrandaki boşsa döner', async () => {
    await useInspectionDraftStore.getState().hydrate();
    add('h|r', 'x', 3);
    const prev = useInspectionDraftStore.getState().drafts['h|r']!;
    useInspectionDraftStore.getState().dispatch('h|r', { type: 'clear' });
    expect(useInspectionDraftStore.getState().drafts['h|r']).toBeUndefined();
    useInspectionDraftStore.getState().restore('h|r', prev);
    expect(useInspectionDraftStore.getState().drafts['h|r']).toBe(prev);
    add('h|z', 'yeni', 1);
    useInspectionDraftStore.getState().restore('h|z', prev);
    expect(useInspectionDraftStore.getState().drafts['h|z']?.defects[0]?.id).toBe('yeni');
    useInspectionDraftStore.getState().restore('h|w', EMPTY_DRAFT);
    expect(useInspectionDraftStore.getState().drafts['h|w']).toBeUndefined();
  });

  it('tavan: en eski dokunulan taslak düşer', async () => {
    await useInspectionDraftStore.getState().hydrate();
    for (let i = 0; i <= INSPECTION_DRAFT_MAX; i++) add(`h|${i}`, `x${i}`, 1);
    const keys = Object.keys(useInspectionDraftStore.getState().drafts);
    expect(keys).toHaveLength(INSPECTION_DRAFT_MAX);
    expect(keys).not.toContain('h|0');
  });

  it('bozuk disk kaydı süzülür', () => {
    expect(sanitizeDrafts(null)).toEqual({});
    expect(sanitizeDrafts({ a: { defects: 'x' }, b: { defects: [{ id: 1 }] }, c: { defects: [], note: 'not' } })).toEqual({ c: { defects: [], note: 'not', inspectedLengthM: null } });
  });
});
