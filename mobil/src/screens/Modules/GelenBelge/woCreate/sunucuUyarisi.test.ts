// 2. prova ek (2026-11-06): (1) İE kaydı yanıtının KÖKÜNDEKİ `ApiResponse.warnings` (ör. müşteri malı belge Stoğa üretim
// açıldı → "Fason Belge Okut") sonuca taşınır ve satır sonucunda kalır; (2) onaylı partide kayıtlı metre (`recordedMeters`)
// forma gelir, okunan Σ satır farklıysa ayrı bilgi olarak yazılır. Eski sunucu alanları göndermez → bugünkü davranış.
// Negatif sonda: servis `r.data.data` döndürürse (uyarı düşer) ilk test kırmızı.
import { inboundDocService } from '../../../../services/inboundDoc.service';
import { initialMultiParty, partyFacts } from './partyDraft';
import { openedResult } from './woFromDoc';
import type { NoteParty } from '../../../../services/inboundDoc.service';

const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));

const WARN = 'Belgedeki mal müşteri malı; Fason (müşteri malı) için "Fason Belge Okut"u kullanın.';
const base = { workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1', rollId: 'r1' };

describe('İE kaydı — sunucu uyarısı', () => {
  it('yanıt kökündeki warnings sonuca taşınır ve satır sonucunda kalır', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true, data: base, warnings: [WARN] } });
    const r = await inboundDocService.createWorkOrder('n1', {} as never);
    expect(r.warnings).toEqual([WARN]);
    const row = openedResult(r);
    expect(row.kind === 'OPENED' && row.warnings).toEqual([WARN]);
  });
  it('eski sunucu (warnings yok) → boş, satır sonucunda uyarı alanı yok', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true, data: base } });
    const r = await inboundDocService.createWorkOrder('n1', {} as never);
    expect(r.warnings).toEqual([]);
    const row = openedResult(r);
    expect(row.kind === 'OPENED' && 'warnings' in row).toBe(false);
  });
});

const party = (blockNo: number, x: Partial<NoteParty> = {}): NoteParty => ({
  blockNo, batchNo: `P${blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 15, meters: 2464.701, weightKg: null, warnings: [], ...x,
});

describe('parti kartı — kayıtlı metre', () => {
  it('onaylı parti: forma kayıtlı metre gelir (öneri ve Σ satır değil); Σ satır farklıysa ayrı bilgi', () => {
    const m = initialMultiParty({ parties: [party(1, { recordedMeters: 586, suggestedMeters: 600 }), party(2, { recordedMeters: 3935 })], warnings: [], multi: true, defaultMode: 'PER_PARTY' });
    expect(m?.rows.map((r) => r.meters)).toEqual([586, 3935]);
    expect(partyFacts(party(2, { recordedMeters: 3935 }))).toContain('Satır toplamı 2.464,7 m');
  });
  it('kayıtlı = Σ satır → ek bilgi yok; eski sunucu / onaysız (alan yok/null) → öneri ya da Σ satır', () => {
    expect(partyFacts(party(1, { meters: 586, recordedMeters: 586 })).some((f) => f.startsWith('Satır toplamı'))).toBe(false);
    expect(partyFacts(party(1, { recordedMeters: null })).some((f) => f.startsWith('Satır toplamı'))).toBe(false);
    const m = initialMultiParty({ parties: [party(1, { suggestedMeters: 600 }), party(2, { recordedMeters: null })], warnings: [], multi: true, defaultMode: 'PER_PARTY' });
    expect(m?.rows.map((r) => r.meters)).toEqual([600, 2464.701]);
  });
});
