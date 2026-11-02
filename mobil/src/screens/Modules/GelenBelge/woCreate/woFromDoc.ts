// Tablet "Terbiye İş Emri oluştur" (Gülkesim K6/K7/K8) — saf parçalar: kısayol listesi, kayıt kipi, satır formu,
// kayıt gövdeleri. Kural sunucudadır (sözleşme 1–5); burası yalnız formu doldurur ve düğmenin neden pasif olduğunu söyler.
import { TERIM } from '../../../../lib/terim';
import type { KursunGramajCatalog } from '../../../../services/fabricProperty.service';
import type {
  BatchNoCandidate,
  CreateWorkOrderFromNoteBody,
  CreateWorkOrderFromNoteResult,
  InboundDocSettings,
  InboundNoteDetail,
  InboundNotePatch,
} from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';

/** Kısayollar: sunucu `?shortcut=1` ile süzer; eski sunucu parametreyi yok sayar → alan yok → liste boş (bugünkü yol). */
export function shortcutRoutes(routes: readonly ProductionRoute[]): ProductionRoute[] {
  return routes
    .filter((r) => r.isWorkOrderShortcut === true && r.isActive !== false)
    .sort((a, b) => (a.shortcutOrder ?? 0) - (b.shortcutOrder ?? 0) || a.name.localeCompare(b.name, 'tr'));
}

/** Özel iş emri başlığı: "<kısayol adı> terbiye iş emri" (görünen ad TERIM'den; ad zaten iş emriyle bitiyorsa tekrarlanmaz). */
export function shortcutTitle(route: Pick<ProductionRoute, 'name'>): string {
  const name = route.name.trim();
  return /i[şs] emri$/i.test(name) ? name : `${name} ${TERIM.terbiyeIsEmri.tekilKucuk}`;
}

/** Kayıt kipi. UNKNOWN = ayar okunamadı (izin): kayıt denenir, sunucu kapalı derse taslağa düşülür. */
export type FormApproval = 'SEPARATE' | 'WITH_WORK_ORDER' | 'UNKNOWN';

export function resolveFormApproval(settings: InboundDocSettings | undefined, failed: boolean): FormApproval {
  if (failed) return 'UNKNOWN';
  return settings?.formApproval === 'WITH_WORK_ORDER' ? 'WITH_WORK_ORDER' : 'SEPARATE';
}

/** Rotada kurşun adımı var mı (K4): sunucu `isKursunStation` verir; eski sunucuda kurşun+KK2 istasyonu türü. */
export function routeHasKursunStep(route: ProductionRoute | null | undefined): boolean {
  return (route?.steps ?? []).some((s) => s.station?.isKursunStation ?? s.station?.kind === 'PROCESS_QC');
}

export interface RowForm {
  ownerCustomerId: string | null;
  /** Müşteri belgedeki metinden önerildi (kullanıcı görsün). */
  ownerSuggested: string | null;
  ourBatchNo: string | null;
  ourBatchNoKey: string | null;
  meters: number | null;
  /** Okunan metre doğrulama bekliyor: doğrula ya da düzelt. */
  metersReview: boolean;
  gramajValueId: string | null;
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Okuma sonrası form: taslaktaki değer > belge önerisi; tek parti adayı ön seçilir; gramaj istasyon varsayılanı. */
export function initialRowForm(d: InboundNoteDetail, catalog: KursunGramajCatalog, showGramaj: boolean): RowForm {
  const candidates = d.batchNoCandidates ?? [];
  const single: BatchNoCandidate | null = !d.ourBatchNo && candidates.length === 1 ? candidates[0] : null;
  const meters = toNumber(d.kursunMeters);
  const suggestion = !d.ownerCustomerId && d.ownerSuggestion ? d.ownerSuggestion : null;
  return {
    ownerCustomerId: d.ownerCustomerId ?? suggestion?.customerId ?? null,
    ownerSuggested: suggestion ? suggestion.name : null,
    ourBatchNo: d.ourBatchNo || single?.value || null,
    ourBatchNoKey: d.ourBatchNo ? d.ourBatchNoKey ?? null : single ? single.key ?? single.field ?? null : null,
    meters,
    metersReview: meters !== null && !!d.kursunMetersReview,
    gramajValueId: showGramaj ? catalog.options.find((o) => o.isDefault)?.id ?? null : null,
  };
}

/** İş emriyle kayıtta engeller (sunucu kapısının aynası; sunucu yine doğrular). */
export function rowIssues(f: RowForm): string[] {
  const out: string[] = [];
  if (!f.ownerCustomerId) out.push('Müşteriyi seçin.');
  if (f.meters === null) out.push('Kurşun metresi yok — metreyi girin.');
  else if (f.metersReview) out.push('Kurşun metresini doğrulayın ya da düzeltin.');
  return out;
}

export function buildCreateBody(
  f: RowForm,
  opts: { clientToken: string; routeTemplateId: string; gramajPropertyId: string | null },
): CreateWorkOrderFromNoteBody {
  const body: CreateWorkOrderFromNoteBody = {
    clientToken: opts.clientToken,
    ownerCustomerId: f.ownerCustomerId!,
    kursunMeters: String(f.meters),
    routeTemplateId: opts.routeTemplateId,
  };
  if (f.ourBatchNo) body.ourBatchNo = f.ourBatchNo;
  if (f.ourBatchNo && f.ourBatchNoKey) body.ourBatchNoKey = f.ourBatchNoKey;
  if (f.gramajValueId && opts.gramajPropertyId) body.targetValues = [{ propertyId: opts.gramajPropertyId, valueId: f.gramajValueId }];
  return body;
}

/** Taslak kaydı (ayrı onay kipi): yalnız değişen başlık alanları PATCH'e gider; boşsa çağrı yok. */
export function buildDraftPatch(f: RowForm, d: InboundNoteDetail): InboundNotePatch {
  const p: InboundNotePatch = {};
  if (f.ownerCustomerId && f.ownerCustomerId !== d.ownerCustomerId) p.ownerCustomerId = f.ownerCustomerId;
  if (f.ourBatchNo && f.ourBatchNo !== (d.ourBatchNo || null)) {
    p.ourBatchNo = f.ourBatchNo;
    if (f.ourBatchNoKey) p.ourBatchNoKey = f.ourBatchNoKey;
  }
  const readMeters = toNumber(d.kursunMeters);
  if (f.meters !== null && f.meters !== readMeters) p.kursunMeters = f.meters;
  else if (f.meters !== null && d.kursunMetersReview && !f.metersReview) p.kursunMetersReviewed = true;
  return p;
}

export type RowResult =
  | { kind: 'OPENED'; workOrderId: string; workOrderNo: string; batchNumber: string; print: 'PRINTED' | 'PRINT_FAILED' | null }
  | { kind: 'DRAFT'; text: string }
  | { kind: 'FAILED'; text: string };

export function openedResult(r: CreateWorkOrderFromNoteResult): RowResult {
  return { kind: 'OPENED', workOrderId: r.workOrderId, workOrderNo: r.workOrderNo, batchNumber: r.batchNumber, print: null };
}

export function draftResult(noteNo: string, disabledByServer: boolean): RowResult {
  const why = disabledByServer ? 'Fabrika ayarı ayrı onay istiyor: ' : '';
  return { kind: 'DRAFT', text: `${noteNo} taslak olarak kaydedildi. ${why}${TERIM.terbiyeIsEmri.tekil} panelde onaylanınca açılır.` };
}

/** Sunucu "form onayı kapalı" dedi → bu satır taslak yoluna düşer (ayar okunamadığında ya da yarışta kapandıysa). */
export function isFormApprovalDisabled(e: unknown): boolean {
  const x = e as { status?: number; details?: { code?: string } } | null;
  return x?.status === 403 && x?.details?.code === 'GELEN_BELGE_FORM_APPROVAL_DISABLED';
}

export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : 'Kaydedilemedi';
}

/** Son kullanılan müşteriler üstte (seçicinin sabit bölümü); listede olmayan kimlik atlanır. */
export function pinRecent<T extends { value: string }>(options: readonly T[], recentIds: readonly string[]): { pinned: T[]; rest: T[] } {
  const byId = new Map(options.map((o) => [o.value, o]));
  const pinned = recentIds.map((id) => byId.get(id)).filter((o): o is T => !!o);
  const pinnedIds = new Set(pinned.map((o) => o.value));
  return { pinned, rest: options.filter((o) => !pinnedIds.has(o.value)) };
}

export const RECENT_OWNER_MAX = 5;

export function pushRecent(list: readonly string[], id: string, max = RECENT_OWNER_MAX): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
