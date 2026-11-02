// Onay kartı (T2) saf parçaları: kart görünürlüğü yalnız sunucu sinyalinden, düğme izinden, engel sunucu kodundan.
import type { ApproveNoteResult, InboundNoteDetail } from '../../../services/inboundDoc.service';
import { approvalCardView, approveResultView, batchPatch, meterChoices, parseMeters, showsApprovalCard } from './approvalGate';

const detail = (p: Partial<InboundNoteDetail> = {}): InboundNoteDetail => ({
  id: 'n1',
  noteNo: 'GB-0001',
  status: 'DRAFT',
  ownerCustomerId: 'c1',
  ourBatchNo: 'ISM1439770',
  ourBatchNoKey: 'isEmriNo',
  kursunMeters: '241',
  kursunMetersSource: 'OUTPUT',
  kursunMetersReview: false,
  batchNoCandidates: [{ key: 'isEmriNo', kind: 'BARCODE', label: 'İş Emri', value: 'ISM1439770' }],
  kursunMeterCandidates: { output: '241', total: null, input: '238', lineSum: '241' },
  perDocument: { code: null, warnings: [], totalsBlocking: false },
  ...p,
});

describe('showsApprovalCard — kip sinyali sunucudan', () => {
  it('PER_DOCUMENT (perDocument var) + taslak → kart', () => {
    expect(showsApprovalCard(detail())).toBe(true);
    expect(showsApprovalCard(detail({ status: 'PARTIAL' }))).toBe(true);
  });
  it('eski backend / PER_LINE (perDocument yok) → kart yok', () => {
    const { perDocument: _p, ...old } = detail();
    expect(showsApprovalCard(old as InboundNoteDetail)).toBe(false);
  });
  it('onaylanmış belge ya da detay yok → kart yok', () => {
    expect(showsApprovalCard(detail({ status: 'APPROVED' }))).toBe(false);
    expect(showsApprovalCard(null)).toBe(false);
  });
});

describe('approvalCardView — düğme ve engel', () => {
  it('onay izni → "Onayla ve … aç", engel yok', () => {
    const v = approvalCardView(detail(), { canApprove: true });
    expect(v.action).toBe('APPROVE');
    expect(v.label).toMatch(/^Onayla ve .*iş emri aç$/);
    expect(v.blocked).toBe(false);
    expect(v.meters.text).toBe('241 m (çıkış)');
    expect(v.batch.value).toBe('ISM1439770');
  });
  it('izin yok → "Taslak olarak bırak", pasif değil, neden yazılı', () => {
    const v = approvalCardView(detail({ perDocument: { code: 'KURSUN_METERS_REQUIRED', warnings: [] } }), { canApprove: false });
    expect(v.action).toBe('SAVE_DRAFT');
    expect(v.label).toBe('Taslak olarak bırak');
    expect(v.blocked).toBe(false);
    expect(v.reasons[0]).toMatch(/Onay yetkiniz yok/);
  });
  it('sunucu kodu REQUIRED / REVIEW_PENDING → pasif + Türkçe neden; review → Doğrula', () => {
    const req = approvalCardView(detail({ kursunMeters: null, perDocument: { code: 'KURSUN_METERS_REQUIRED', warnings: [] } }), { canApprove: true });
    expect(req.blocked).toBe(true);
    expect(req.reasons).toContain('Kurşun metresi yok — metreyi girin.');
    expect(req.meters.text).toBeNull();
    const rev = approvalCardView(detail({ kursunMetersReview: true, perDocument: { code: 'KURSUN_METERS_REVIEW_PENDING', warnings: [] } }), { canApprove: true });
    expect(rev.blocked).toBe(true);
    expect(rev.canVerify).toBe(true);
    expect(rev.meters.review).toBe(true);
  });
  it('WARN kipinde review geçer: engel yok, sunucu uyarısı görünür', () => {
    const v = approvalCardView(detail({ kursunMetersReview: true, perDocument: { code: null, warnings: ['gözden geçirilmeden'] } }), { canApprove: true });
    expect(v.blocked).toBe(false);
    expect(v.warnings).toEqual(['gözden geçirilmeden']);
  });
  it('müşteri yok → pasif', () => {
    expect(approvalCardView(detail({ ownerCustomerId: null }), { canApprove: true }).reasons).toContain('Müşteriyi seçin.');
  });
  it('parti no: çok aday ve boş → seçim ipucu; aday yok → seri bilgisi', () => {
    const two = [
      { key: 'sevkNo', kind: 'BARCODE', label: 'Sevk No', value: '46399' },
      { key: 'partiNo', kind: 'BATCH', label: 'Parti No', value: '214279' },
    ];
    expect(approvalCardView(detail({ ourBatchNo: null, batchNoCandidates: two }), { canApprove: true }).batch.hint).toBe('Parti no seçin (2 aday)');
    expect(approvalCardView(detail({ ourBatchNo: null, batchNoCandidates: [] }), { canApprove: true }).batch.hint).toMatch(/seriden/);
  });
});

describe('yardımcılar', () => {
  it('batchPatch: anahtarlı aday anahtarıyla, anahtarsız elle', () => {
    expect(batchPatch({ key: 'isEmriNo', value: 'ISM1' })).toEqual({ ourBatchNo: 'ISM1', ourBatchNoKey: 'isEmriNo' });
    expect(batchPatch({ value: 'X' })).toEqual({ ourBatchNo: 'X' });
  });
  it('meterChoices: düz ve nesne değer, tekrar ve boş atlanır', () => {
    const c = meterChoices(detail({ kursunMeterCandidates: { output: { value: '4521' }, total: '4521', input: '4500', lineSum: null } }));
    expect(c.map((x) => [x.role, x.value, x.text])).toEqual([
      ['output', 4521, '4.521 m'],
      ['input', 4500, '4.500 m'],
    ]);
  });
  it('parseMeters: binlik/ondalık, sıfır ve metin reddedilir', () => {
    expect(parseMeters('4.521')).toBe(4521);
    expect(parseMeters('198,1')).toBe(198.1);
    expect(parseMeters('198.1')).toBe(198.1);
    expect(parseMeters('4.521,5')).toBe(4521.5);
    expect(parseMeters('0')).toBeNull();
    expect(parseMeters('abc')).toBeNull();
    expect(parseMeters('')).toBeNull();
  });
});

describe('approveResultView', () => {
  const r = (p: Partial<ApproveNoteResult>): ApproveNoteResult => ({
    note: { id: 'n1', noteNo: 'GB-0001', status: 'APPROVED' },
    summary: { entered: 1, failed: 0, skipped: 0, replayed: 0 },
    warnings: [],
    ...p,
  });
  it('açılan iş emri → ok, numara başlıkta', () => {
    const v = approveResultView(r({ autoWorkOrders: { opened: 1, manual: 0, reason: null, groups: [{ key: 'g', itemName: 'Müşteri malı', rollCount: 1, outcome: 'OPENED', workOrderNumber: 'TIE-0042' }] } }));
    expect(v.tone).toBe('ok');
    expect(v.title).toMatch(/TIE-0042/);
  });
  it('atlanan grup + genel neden + uyarı → warn, satırlar sunucudan', () => {
    const v = approveResultView(r({
      warnings: ['metre gözden geçirilmedi'],
      autoWorkOrders: { opened: 0, manual: 1, reason: 'Rota önerisi yok', groups: [{ key: 'g', itemName: 'Müşteri malı', rollCount: 1, outcome: 'SKIPPED', reason: 'İşlem değeri çözülemedi' }] },
    }));
    expect(v.tone).toBe('warn');
    expect(v.lines).toEqual(['Müşteri malı: İşlem değeri çözülemedi', 'Rota önerisi yok', 'metre gözden geçirilmedi']);
  });
  it('oto iş emri sonucu yok → elle açma yönlendirmesi', () => {
    const v = approveResultView(r({}));
    expect(v.tone).toBe('warn');
    expect(v.lines[0]).toMatch(/otomatik açılmadı/);
  });
});
