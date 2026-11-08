// Emanet çıkış (T1) saf kuralları: okutma eşleşmesi, kg biçimi, engel metni, gövde, önizleme bağı, kayıt kapısı.
// Negatif sonda: matchScan büyük/küçük harf katlamasız ya da çok depolu lotta tek sonuç dönerse kırmızı.
import type { BeamCandidate, ConsignmentCandidates, ConsignmentPreview, YarnCandidate } from '../../../../services/consignment.service';
import { beamLine, blockedText, createErrorText, buildBody, lineBlock, matchScan, parseKg, previewBlockFor, submitBlock, yarnKey, yarnLine } from './emanetCikisLogic';

const beam = (x: Partial<BeamCandidate> = {}): BeamCandidate => ({ warpBeamId: 'b1', beamNo: 'LV0001', warpSpecName: 'Tül 280', remainingM: '1200.00', blockedReason: null, ...x });
const yarn = (x: Partial<YarnCandidate> = {}): YarnCandidate => ({ lotId: 'l1', lotNo: 'L-55', yarnItemId: 'y1', itemCode: 'IP1', itemName: 'Polyester 75D', warehouseId: 'w1', warehouseName: 'Ana Depo', balanceKg: '120.500', blockedReason: null, ...x });
const cands = (beams: BeamCandidate[], yarns: YarnCandidate[]): ConsignmentCandidates => ({
  ownerCustomer: { id: 'c1', name: 'Akın' }, modules: { devere: true, iplik: true }, beams, yarns, truncated: { beams: false, yarns: false },
});

describe('matchScan', () => {
  it('⭐ levent no büyük/küçük harf duyarsız eşleşir', () => {
    expect(matchScan(' lv0001 ', cands([beam()], []))).toEqual({ kind: 'beam', beam: beam() });
  });
  it('⭐ lot birden çok depoda ise hepsi döner (depo seçilir)', () => {
    const m = matchScan('l-55', cands([], [yarn(), yarn({ warehouseId: 'w2', warehouseName: 'Yan Depo' })]));
    expect(m.kind).toBe('yarn');
    expect(m.kind === 'yarn' && m.yarns.map(yarnKey)).toEqual(['yarn:l1:w1', 'yarn:l1:w2']);
  });
  it('eşleşmeyen ve boş kod none', () => {
    expect(matchScan('XX', cands([beam()], [yarn()]))).toEqual({ kind: 'none' });
    expect(matchScan('  ', cands([beam()], [yarn()]))).toEqual({ kind: 'none' });
  });
});

describe('parseKg', () => {
  it.each([['12,5', '12.5'], ['0012.250', '12.250'], ['3', '3']])('%s → %s', (raw, out) => expect(parseKg(raw)).toBe(out));
  it.each(['0', '0,000', '-1', '1.2345', 'abc', ''])('%s reddedilir', (raw) => expect(parseKg(raw)).toBeNull());
});

describe('engel metni', () => {
  it('⭐ bilinen kod Türkçe, tanınmayan kod genel cümle (ham kod basılmaz)', () => {
    expect(blockedText('YARN_LOT_INACTIVE')).toBe('Lot pasif — çıkış yapılamaz');
    expect(blockedText('YENI_SUNUCU_KODU')).toBe('Bu kalem çıkışa uygun değil');
    expect(blockedText(null)).toBeNull();
  });
  it('belgede olan satır sunucu engelinden önce söylenir', () => {
    expect(lineBlock('beam:b1', null, new Set(['beam:b1']))).toBe('Belgede zaten var');
    expect(lineBlock('beam:b1', 'CONSIGNMENT_BEAM_NOT_READY', new Set())).toBe('Levent hazır (boşta) değil');
    expect(lineBlock('beam:b1', null, new Set())).toBeNull();
  });
});

describe('gövde + önizleme', () => {
  const lines = [beamLine(beam()), yarnLine(yarn(), '20.5')];
  it('⭐ gövde plaka taşımaz; kalemler sözleşme biçiminde', () => {
    expect(buildBody('c1', lines)).toEqual({
      ownerCustomerId: 'c1',
      items: [{ kind: 'WARP_BEAM', warpBeamId: 'b1' }, { kind: 'YARN', yarnItemId: 'y1', warehouseId: 'w1', lotId: 'l1', qtyKg: '20.5' }],
    });
  });
  it('⭐ önizleme engeli doğru satıra bağlanır (levent → warpBeamId, iplik → lotId)', () => {
    const preview: ConsignmentPreview = {
      lines: [
        { kind: 'WARP_BEAM', refId: 'b1', label: 'LV0001', qty: '1200', unit: 'METER', blockedReason: null },
        { kind: 'YARN', refId: 'l1', label: 'L-55', qty: '20.5', unit: 'KG', blockedReason: 'CONSIGNMENT_YARN_INSUFFICIENT' },
      ],
      totals: { beamCount: 1, beamLengthM: '1200', yarnKg: '20.5' }, canCreate: false, warnings: [],
    };
    expect(previewBlockFor(lines[0]!, preview)).toBeNull();
    expect(previewBlockFor(lines[1]!, preview)).toBe('Lotun bu depodaki bakiyesi yetmiyor');
    expect(previewBlockFor(lines[1]!, undefined)).toBeNull();
  });
});

describe('submitBlock', () => {
  const ok = { online: true, hasOwner: true, lineCount: 1, previewError: false, canCreate: true };
  it('⭐ çevrimdışı her şeyden önce kapatır', () => {
    expect(submitBlock({ ...ok, online: false })).toMatch(/^Çevrimdışı/);
  });
  it('sahip → kalem → önizleme hatası → engelli kalem sırası', () => {
    expect(submitBlock({ ...ok, hasOwner: false, lineCount: 0 })).toBe('Önce malın sahibini seçin.');
    expect(submitBlock({ ...ok, lineCount: 0 })).toBe('En az bir levent ya da iplik lotu ekleyin.');
    expect(submitBlock({ ...ok, previewError: true, canCreate: false })).toBe('Önizleme alınamadı — tekrar deneyin.');
    expect(submitBlock({ ...ok, canCreate: false })).toBe('Engelli kalemleri çıkarın.');
    expect(submitBlock(ok)).toBeNull();
    expect(submitBlock({ ...ok, canCreate: undefined })).toBeNull();
  });
});

describe('createErrorText', () => {
  const e = (code?: string) => Object.assign(new Error('sunucu'), { status: 409, details: code ? { code } : undefined });
  it('⭐ CLIENT_TOKEN_COLLISION Türkçe; engel kodu (somut sunucu cümlesi) ve tanınmayan kod sunucuya bırakılır', () => {
    expect(createErrorText(e('CLIENT_TOKEN_COLLISION'))).toMatch(/farklı kalemlerle kaydedilmiş olabilir/);
    expect(createErrorText(e('YARN_LOT_INACTIVE'))).toBeNull();
    expect(createErrorText(e('BILINMEYEN'))).toBeNull();
    expect(createErrorText(e())).toBeNull();
  });
});
