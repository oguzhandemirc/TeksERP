// Aynı belge tekrar okutulunca kısayol (2026-11-06): ön sorgu taslak AÇMAZ · yarışta açılan sayfasız taslak silinir ·
// kart metni (tarih fabrika saatiyle, İE durumu, iptal İE → yeni İE yolu) · K27 BLOCK kaydında eş sorgusu.
import { createAttemptToken } from '../../../offline/attemptToken';
import type { InboundDocApi, SameDocumentMatch } from '../../../services/inboundDoc.service';
import { SameDocumentFound, SubmitError, sameDocumentOf, submitDocScan, type ScanPage } from './docScan';
import { sameDocumentText } from './SameDocumentCard';
import { sameDocOnSave } from './woCreate/sameDocOnSave';


const page = (s: string): ScanPage => ({ base64: 'QUJD', sha256: s.padEnd(64, '0'), uri: `file:///${s}.jpg`, width: 1, height: 1 });
const input = (pages: ScanPage[]) => ({ pages, ownerCustomerId: 'own-1', senderDocNo: 'A-1', barcodeText: null, readOnDevice: async () => null });

const match = (over: Partial<SameDocumentMatch> = {}): SameDocumentMatch => ({
  via: 'SHA',
  note: { id: 'n-old', noteNo: 'GB-7', status: 'APPROVED', senderDocNo: 'A-1', createdAt: '2026-11-05T07:30:00.000Z', approvedAt: '2026-11-05T08:15:00.000Z', updatedAt: '2026-11-05T08:15:00.000Z' },
  state: 'PROCESSED',
  workOrders: [{ id: 'wo-1', workOrderNumber: 'IE-12', status: 'IN_PROGRESS' }],
  ...over,
});

function api(opts: { found?: SameDocumentMatch | null; lookupFails?: boolean; uploadError?: unknown } = {}) {
  const calls = { create: 0, upload: 0, deleted: [] as string[], lookups: [] as unknown[] };
  const a: InboundDocApi = {
    findSameDocument: async (q) => {
      calls.lookups.push(q);
      if (opts.lookupFails) throw Object.assign(new Error('ağ'), { status: 503 });
      return opts.found ?? null;
    },
    deleteDraftNote: async (id) => { calls.deleted.push(id); return null; },
    createDraftNote: async () => { calls.create++; return { id: 'n-new', noteNo: 'GB-9', status: 'DRAFT' } as never; },
    uploadScan: async () => {
      calls.upload++;
      if (opts.uploadError) throw opts.uploadError;
      return { scan: { id: 's1' }, duplicate: false } as never;
    },
  };
  return { a, calls };
}

const notFree = (sameDocument: SameDocumentMatch | null) => ({ status: 409, details: { code: 'DOCUMENT_SCAN_NOT_FREE', boundTo: 'n-old', sameDocument } });

describe('submitDocScan — aynı belge', () => {
  it('ön sorgu eşleşirse taslak AÇILMAZ, sayfa yüklenmez', async () => {
    const f = api({ found: match() });
    await expect(submitDocScan(f.a, input([page('a'), page('b')]), createAttemptToken())).rejects.toBeInstanceOf(SameDocumentFound);
    expect(f.calls.create).toBe(0);
    expect(f.calls.upload).toBe(0);
    expect(f.calls.lookups[0]).toEqual({ sha256: [page('a').sha256, page('b').sha256], ownerCustomerId: 'own-1', senderDocNo: 'A-1' });
  });

  it('eşleşme yok / sorgu hatası / eski api (uç yok) → bugünkü yol', async () => {
    for (const f of [api(), api({ lookupFails: true })]) {
      const r = await submitDocScan(f.a, input([page('c')]), createAttemptToken());
      expect(r.note.id).toBe('n-new');
    }
    const { findSameDocument: _f, deleteDraftNote: _d, ...old } = api().a;
    expect((await submitDocScan(old, input([page('d')]), createAttemptToken())).uploaded).toBe(1);
  });

  it('devam eden taslağa sayfa eklerken sorgu yapılmaz', async () => {
    const f = api({ found: match() });
    await submitDocScan(f.a, input([page('e')]), createAttemptToken(), { note: { id: 'n-cur', noteNo: 'GB-8' }, uploaded: new Set() });
    expect(f.calls.lookups).toHaveLength(0);
  });

  it('⭐ yarış: ilk yükleme 409 NOT_FREE + sameDocument → açılan sayfasız taslak silinir, kart verisi döner', async () => {
    const f = api({ uploadError: notFree(match({ state: 'DRAFT' })) });
    const err = await submitDocScan(f.a, input([page('f')]), createAttemptToken()).catch((e) => e);
    expect(err).toBeInstanceOf(SameDocumentFound);
    expect((err as SameDocumentFound).match.note.id).toBe('n-old');
    expect(f.calls.deleted).toEqual(['n-new']);
  });

  it('yarış ama eski sunucu (sameDocument yok) → bugünkü SubmitError, taslak silinmez', async () => {
    const f = api({ uploadError: notFree(null) });
    await expect(submitDocScan(f.a, input([page('g')]), createAttemptToken())).rejects.toBeInstanceOf(SubmitError);
    expect(f.calls.deleted).toHaveLength(0);
  });

  it('önceden var olan taslakta 409 → taslak SİLİNMEZ', async () => {
    const f = api({ uploadError: notFree(match()) });
    await expect(submitDocScan(f.a, input([page('h')]), createAttemptToken(), { note: { id: 'n-cur', noteNo: 'GB-8' }, uploaded: new Set() })).rejects.toBeInstanceOf(SubmitError);
    expect(f.calls.deleted).toHaveLength(0);
  });

  it('sameDocumentOf yalnız 409 NOT_FREE okur', () => {
    expect(sameDocumentOf(notFree(match()))?.note.id).toBe('n-old');
    expect(sameDocumentOf({ status: 409, details: { code: 'X', sameDocument: match() } })).toBeNull();
    expect(sameDocumentOf(null)).toBeNull();
  });
});

describe('sameDocumentText', () => {
  it('işlenmiş belge: fabrika saatiyle tarih + İE no (durum) + canlı İE açılır, yeni İE yolu yok', () => {
    const t = sameDocumentText(match());
    expect(t.lines[0]).toBe("Bu belge 05.11.2026 11:15'de işlendi → IE-12 (Devam Ediyor)");
    expect(t.liveWorkOrderId).toBe('wo-1');
    expect(t.canStartNew).toBe(false);
  });

  it('⭐ İE iptal → kayıt gösterilir + "bu belgeden yeni İE" yolu', () => {
    const t = sameDocumentText(match({ workOrders: [{ id: 'wo-1', workOrderNumber: 'IE-12', status: 'CANCELLED' }] }));
    expect(t.lines.join(' ')).toContain('IE-12 (İptal');
    expect(t.lines).toContain('Bu belgenin iş emri iptal edildi.');
    expect(t.liveWorkOrderId).toBeNull();
    expect(t.canStartNew).toBe(true);
  });

  it('iptal belge → yalnız bilgi', () => {
    const t = sameDocumentText(match({ state: 'CANCELLED', workOrders: [] }));
    expect(t.title).toBe('Bu belge iptal edilmiş');
    expect(t.canStartNew).toBe(false);
    expect(t.liveWorkOrderId).toBeNull();
  });
});

describe('sameDocOnSave (K27 BLOCK)', () => {
  const block = { status: 409, details: { code: 'DELIVERY_NOTE_DUPLICATE_DOC_NO' } };
  it('BLOCK 409 → eşi kendi taslağı hariç sorar', async () => {
    const f = api({ found: match({ via: 'DOC_NO' }) });
    const m = await sameDocOnSave(f.a, block, { noteId: 'n-new', ownerCustomerId: 'own-1', senderDocNo: 'A-1' });
    expect(m?.via).toBe('DOC_NO');
    expect(f.calls.lookups[0]).toEqual({ ownerCustomerId: 'own-1', senderDocNo: 'A-1', excludeNoteId: 'n-new' });
  });
  it('başka hata / sahipsiz / sorgu hatası → null', async () => {
    expect(await sameDocOnSave(api({ found: match() }).a, { status: 409, details: { code: 'DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE' } }, { noteId: 'n', ownerCustomerId: 'o', senderDocNo: 'A' })).toBeNull();
    expect(await sameDocOnSave(api({ found: match() }).a, block, { noteId: 'n', ownerCustomerId: null, senderDocNo: 'A' })).toBeNull();
    expect(await sameDocOnSave(api({ lookupFails: true }).a, block, { noteId: 'n', ownerCustomerId: 'o', senderDocNo: 'A' })).toBeNull();
  });
});
