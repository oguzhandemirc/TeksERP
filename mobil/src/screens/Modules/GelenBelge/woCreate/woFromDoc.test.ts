// Belgeden iş emri (K6/K7/K8) saf parçaları: kısayol listesi, form doldurma, review zorunluluğu, kayıt gövdeleri.
import type { InboundNoteDetail } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import {
  buildCreateBody,
  buildDraftPatch,
  initialRowForm,
  isFormApprovalDisabled,
  pinRecent,
  pushRecent,
  resolveFormApproval,
  routeHasKursunStep,
  rowIssues,
  shortcutRoutes,
  shortcutTitle,
} from './woFromDoc';

const r = (id: string, extra: Partial<ProductionRoute> = {}): ProductionRoute => ({ id, name: `Rota ${id}`, ...extra }) as ProductionRoute;
const catalog = { propertyId: 'p-gr', options: [{ id: 'g1', name: '60 gr', isDefault: false }, { id: 'g2', name: '80 gr', isDefault: true }] };
const detail = (x: Partial<InboundNoteDetail> = {}): InboundNoteDetail => ({ id: 'n1', noteNo: 'GB-1', ownerCustomerId: null, ...x }) as InboundNoteDetail;

describe('shortcutRoutes / shortcutTitle', () => {
  it('⭐ yalnız işaretli + aktif kısayollar, shortcutOrder sırasıyla; eski sunucu (alan yok) → boş', () => {
    const list = [r('a', { isWorkOrderShortcut: true, shortcutOrder: 2 }), r('b'), r('c', { isWorkOrderShortcut: true, shortcutOrder: 1 }), r('d', { isWorkOrderShortcut: true, isActive: false })];
    expect(shortcutRoutes(list).map((x) => x.id)).toEqual(['c', 'a']);
    expect(shortcutRoutes([r('x'), r('y')])).toEqual([]);
  });
  it('başlık "<ad> terbiye iş emri"; ad zaten iş emriyle bitiyorsa tekrar yok', () => {
    expect(shortcutTitle({ name: 'Kurşun&Tambur' })).toBe('Kurşun&Tambur terbiye iş emri');
    expect(shortcutTitle({ name: 'Brode iş emri' })).toBe('Brode iş emri');
  });
});

describe('resolveFormApproval', () => {
  it('varsayılan ayrı onay (bugünkü); okunamadı → UNKNOWN', () => {
    expect(resolveFormApproval({}, false)).toBe('SEPARATE');
    expect(resolveFormApproval(undefined, false)).toBe('SEPARATE');
    expect(resolveFormApproval({ formApproval: 'WITH_WORK_ORDER' }, false)).toBe('WITH_WORK_ORDER');
    expect(resolveFormApproval(undefined, true)).toBe('UNKNOWN');
  });
});

describe('initialRowForm — belge formu doldurur', () => {
  it('⭐ müşteri önerisi, tek parti adayı, metre + review, varsayılan gramaj', () => {
    const f = initialRowForm(
      detail({
        ownerSuggestion: { customerId: 'c9', name: 'Gülkesim', matchedText: 'GULKESIM' },
        batchNoCandidates: [{ value: 'P-77', key: 'K1' }] as InboundNoteDetail['batchNoCandidates'],
        kursunMeters: '1250.5',
        kursunMetersReview: true,
      } as Partial<InboundNoteDetail>),
      catalog,
      true,
    );
    expect(f).toMatchObject({ ownerCustomerId: 'c9', ownerSuggested: 'Gülkesim', ourBatchNo: 'P-77', ourBatchNoKey: 'K1', meters: 1250.5, metersReview: true, gramajValueId: 'g2' });
  });
  it('öneri yok / çok aday / gramaj alanı yok → boş bırakılır (uydurma yok)', () => {
    const f = initialRowForm(
      detail({ batchNoCandidates: [{ value: 'A' }, { value: 'B' }] as InboundNoteDetail['batchNoCandidates'] }),
      { propertyId: 'p', options: [{ id: 'g1', name: '60', isDefault: false }] },
      true,
    );
    expect(f).toMatchObject({ ownerCustomerId: null, ownerSuggested: null, ourBatchNo: null, meters: null, gramajValueId: null });
    expect(initialRowForm(detail(), catalog, false).gramajValueId).toBeNull();
  });
  it('taslakta seçili müşteri öneriyi ezer', () => {
    const f = initialRowForm(detail({ ownerCustomerId: 'c1', ownerSuggestion: { customerId: 'c9', name: 'X', matchedText: 'X' } }), catalog, false);
    expect(f.ownerCustomerId).toBe('c1');
    expect(f.ownerSuggested).toBeNull();
  });
});

describe('rowIssues — review zorunlu', () => {
  const base = { ownerCustomerId: 'c1', ownerSuggested: null, ourBatchNo: null, ourBatchNoKey: null, meters: 100, metersReview: false, gramajValueId: null };
  it('⭐ doğrulanmamış okunan metre kaydı engeller', () => {
    expect(rowIssues({ ...base, metersReview: true })).toEqual(['Kurşun metresini doğrulayın ya da düzeltin.']);
    expect(rowIssues(base)).toEqual([]);
  });
  it('müşteri ve metre zorunlu', () => {
    expect(rowIssues({ ...base, ownerCustomerId: null, meters: null })).toHaveLength(2);
  });
});

describe('gövdeler', () => {
  const f = { ownerCustomerId: 'c1', ownerSuggested: null, ourBatchNo: 'P-1', ourBatchNoKey: 'K', meters: 120, metersReview: false, gramajValueId: 'g2' };
  it('⭐ iş emri gövdesi sözleşme 3: metre string, gramaj hedef değeri', () => {
    expect(buildCreateBody(f, { clientToken: 't', routeTemplateId: 'r1', gramajPropertyId: 'p-gr' })).toEqual({
      clientToken: 't', ownerCustomerId: 'c1', kursunMeters: '120', routeTemplateId: 'r1', ourBatchNo: 'P-1', ourBatchNoKey: 'K',
      targetValues: [{ propertyId: 'p-gr', valueId: 'g2' }],
    });
  });
  it('taslak PATCH yalnız değişeni gönderir; doğrulanan metre reviewed bayrağı', () => {
    const d = detail({ ownerCustomerId: 'c1', ourBatchNo: 'P-1', kursunMeters: '120', kursunMetersReview: true } as Partial<InboundNoteDetail>);
    expect(buildDraftPatch(f, d)).toEqual({ kursunMetersReviewed: true });
    expect(buildDraftPatch({ ...f, meters: 130 }, d)).toEqual({ kursunMeters: 130 });
  });
  it('403 GELEN_BELGE_FORM_APPROVAL_DISABLED tanınır; başka 403 değil', () => {
    expect(isFormApprovalDisabled({ status: 403, details: { code: 'GELEN_BELGE_FORM_APPROVAL_DISABLED' } })).toBe(true);
    expect(isFormApprovalDisabled({ status: 403, details: { code: 'MODULE_DISABLED' } })).toBe(false);
  });
});

describe('son kullanılan müşteriler', () => {
  it('üstte, listede olmayan atlanır, en fazla 5', () => {
    const opts = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];
    expect(pinRecent(opts, ['c', 'z'])).toEqual({ pinned: [{ value: 'c' }], rest: [{ value: 'a' }, { value: 'b' }] });
    expect(pushRecent(['1', '2', '3', '4', '5'], '3')).toEqual(['3', '1', '2', '4', '5']);
    expect(pushRecent(['1', '2', '3', '4', '5'], '9')).toHaveLength(5);
  });
});

describe('routeHasKursunStep', () => {
  it('sunucu türetimi; eski sunucuda istasyon türü yedeği', () => {
    expect(routeHasKursunStep(r('a', { steps: [{ station: { isKursunStation: true } }] } as unknown as Partial<ProductionRoute>))).toBe(true);
    expect(routeHasKursunStep(r('a', { steps: [{ station: { kind: 'PROCESS_QC' } }] } as unknown as Partial<ProductionRoute>))).toBe(true);
    expect(routeHasKursunStep(r('a'))).toBe(false);
  });
});
