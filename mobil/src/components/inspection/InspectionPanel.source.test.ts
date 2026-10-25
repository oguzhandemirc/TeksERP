// =============================================================================
// K4P-TABLET kaynak bekçisi — muayene bileşeni istasyon/ekran BİLMEZ ve ağ çağrısı yapmaz
// =============================================================================
// Tek bileşen her konakta aynıdır; konak kararı (kapı, kayıt) bağdaştırıcıda. Önizleme
// kancası (`useInspectionPreview`) konakta çağrılır — ağ yalnız o dosyada.
// =============================================================================
import fs from 'fs';
import path from 'path';

const sources = fs
  .readdirSync(__dirname)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ f, src: fs.readFileSync(path.join(__dirname, f), 'utf8') }));

describe('components/inspection kaynak taraması', () => {
  it('dizinde tek bileşen ailesi var (ikinci hata giriş bileşeni yok)', () => {
    expect(sources.some((s) => s.f === 'InspectionPanel.tsx')).toBe(true);
    expect(sources.filter((s) => /QualityPanel|DefectEntryPanel/.test(s.f))).toEqual([]);
  });

  it.each(sources.map((s) => [s.f, s.src] as const))('%s istasyon türü / ekran adı karşılaştırmaz', (_f, src) => {
    expect(src).not.toMatch(/StationKind|SCREEN_BY_STATION_KIND|\bkind\s*={2,3}|\.kind\b|['"]KK1['"]|['"]RAW_QC['"]/);
  });

  it('ağ çağrısı yalnız önizleme kancasında (bileşen kaydetmez)', () => {
    const net = sources.filter((s) => /services\/|apiClient/.test(s.src)).map((s) => s.f).sort();
    expect(net).toEqual(['inspectionWire.ts', 'useInspectionPreview.ts']);
  });
});

// K4P-EKRAN: bağımsız Muayene konağı aynı bileşeni kullanır; istasyon türüne bağlanmaz.
const MUAYENE_DIR = path.join(__dirname, '..', '..', 'screens', 'Modules', 'Muayene');
const muayeneSources = fs
  .readdirSync(MUAYENE_DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ f, src: fs.readFileSync(path.join(MUAYENE_DIR, f), 'utf8') }));

describe('screens/Modules/Muayene kaynak taraması (konak b)', () => {
  it('ekran tek bileşeni çizer; ikinci hata giriş ızgarası yok', () => {
    const screen = muayeneSources.find((s) => s.f === 'InspectionScreen.tsx');
    expect(screen?.src).toMatch(/from '..\/..\/..\/components\/inspection\/InspectionPanel'/);
    expect(muayeneSources.filter((s) => /defectTypes\.map\(|sizeClass\s*:\s*'S[1-4]'/.test(s.src)).map((s) => s.f)).toEqual([]);
  });

  it.each(muayeneSources.map((s) => [s.f, s.src] as const))('%s istasyon türü okumaz', (_f, src) => {
    expect(src).not.toMatch(/StationKind|SCREEN_BY_STATION_KIND|\bkind\s*={2,3}|\.kind\b|['"]RAW_QC['"]/);
  });
});
