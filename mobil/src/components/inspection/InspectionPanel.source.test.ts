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
