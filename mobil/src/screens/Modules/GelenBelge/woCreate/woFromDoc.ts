// Tablet "Terbiye İş Emri oluştur" (Gülkesim K6/K7/K8) — saf parçalar: kısayol listesi, kayıt kipi, satır formu,
// kayıt gövdeleri. Kural sunucudadır (sözleşme 1–5); burası yalnız formu doldurur ve düğmenin neden pasif olduğunu söyler.
import { TERIM } from '../../../../lib/terim';
import type {
  BatchNoCandidate,
  CreateWorkOrderFromNoteBody,
  CreateWorkOrderFromNoteResult,
  InboundDocSettings,
  InboundNoteDetail,
  InboundNotePatch,
  OwnerSuggestion,
  ReadSummary,
} from '../../../../services/inboundDoc.service';
import { declaredBodyPart } from './incomingDeclared';
import type { ProductionRoute } from '../../../../services/route.service';
import { withDeskPlan } from '../desk/deskPlan';
import { multiPartyIssues, openedWorkOrders, withParties, type MultiPartyDraft, type OpenedWo } from './partyDraft';
import { rollIssues, withRolls, type RollRow } from './rollDraft';
import type { FormIssue } from './woIssues';
import { parseFormNumber } from './woForm';

/** K29 S14b: rotasız seçenek (sözde rota; kimliği sunucuya HİÇ gitmez — gövdede rota anahtarı olmaz). */
export const SCAN_ROUTE_ID = 'scan-routed';
export const SCAN_ROUTE: ProductionRoute = {
  id: SCAN_ROUTE_ID,
  name: 'Sahada belirlenir (rotasız)',
  description: 'Rota seçilmez; adımlar istasyonda okutuldukça eklenir.',
  steps: [],
};
export const isScanRoute = (r: { id?: string } | null | undefined): boolean => r?.id === SCAN_ROUTE_ID;

/** Rota uygulaması "Okutmayla" iken rotasız seçenek listenin BAŞINDA (varsayılan); sıralıda liste aynen. */
export function withScanRoute(routes: readonly ProductionRoute[], scanMode: boolean): ProductionRoute[] {
  return scanMode ? [SCAN_ROUTE, ...routes] : [...routes];
}

/** Kısayollar: sunucu `?shortcut=1` ile süzer; eski sunucu parametreyi yok sayar → alan yok → liste boş (bugünkü yol). */
export function shortcutRoutes(routes: readonly ProductionRoute[]): ProductionRoute[] {
  return routes
    .filter((r) => r.isWorkOrderShortcut === true && r.isActive !== false)
    .sort((a, b) => (a.shortcutOrder ?? 0) - (b.shortcutOrder ?? 0) || a.name.localeCompare(b.name, 'tr'));
}

/** Özel iş emri başlığı: "<kısayol adı> terbiye iş emri" (görünen ad TERIM'den; ad zaten iş emriyle bitiyorsa tekrarlanmaz). */
export function shortcutTitle(route: Pick<ProductionRoute, 'name'> & { id?: string }): string {
  if (isScanRoute(route)) return route.name;
  const name = route.name.trim();
  return /i[şs] emri$/i.test(name) ? name : `${name} ${TERIM.terbiyeIsEmri.tekilKucuk}`;
}

/**
 * Kısayol karosunun alt satırı: rotanın açıklaması ya da adım yolu ("KURŞUN → TAMBUR"). Ham rota kodu
 * (ROT0211260001) operatöre bir şey söylemez (QA 2026-11-03); ikisi de yoksa alt satır yok.
 */
export function shortcutSub(route: Pick<ProductionRoute, 'description' | 'steps'>): string | undefined {
  const desc = route.description?.trim();
  if (desc) return desc;
  const path = [...(route.steps ?? [])]
    .sort((a, b) => a.sequence - b.sequence)
    .map((st) => st.station?.name?.trim())
    .filter((n): n is string => !!n);
  return path.length > 0 ? path.join(' → ') : undefined;
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

/**
 * Satır kaynağı okuma özetinden (`gelen-belge:write`): tablet `gelen-belge:read` taşımayabilir, detay 403 → form yine dolar.
 * Özet formun okuduğu bütün alanları taşır (sahip, öneri, parti no + adaylar, kurşun metresi + adaylar).
 */
export function detailFromSummary(s: ReadSummary): InboundNoteDetail {
  return {
    id: s.noteId,
    noteNo: s.noteNo,
    status: s.noteStatus,
    ownerCustomerId: s.ownerCustomerId ?? null,
    ...(s.customerBatchNo !== undefined ? { customerBatchNo: s.customerBatchNo } : {}),
    ourBatchNo: s.ourBatchNo ?? null,
    ourBatchNoKey: s.ourBatchNoKey ?? null,
    kursunMeters: s.kursunMeters ?? null,
    kursunMetersSource: s.kursunMetersSource ?? null,
    kursunMetersReview: s.kursunMetersReview,
    batchNoCandidates: s.batchNoCandidates,
    kursunMeterCandidates: s.kursunMeterCandidates,
    ownerSuggestion: s.ownerSuggestion ?? null,
    formFields: s.formFields ?? null,
    suggestions: s.suggestions ?? null,
    ...(s.docRolls ? { docRolls: s.docRolls } : {}),
    ...(s.incomingKg !== undefined ? { incomingKg: s.incomingKg, incomingKgSource: s.incomingKgSource ?? null } : {}),
  };
}

/** S16a: tek formun alanları detay ucunda yoksa okuma özetinden tamamlanır (iki uçtan biri taşıması yeter). */
export function withSummaryFields(d: InboundNoteDetail, s: ReadSummary | null | undefined): InboundNoteDetail {
  const fields = d.formFields ?? s?.formFields ?? null;
  const suggestions = d.suggestions ?? s?.suggestions ?? null;
  const docRolls = d.docRolls ?? s?.docRolls;
  // Müşteri parti no özetten (güven süzgeçli: SORMA'da tanıtılmamış tahmin null); detay ham kolonu taşır.
  const cbn = s?.customerBatchNo !== undefined ? s.customerBatchNo : d.customerBatchNo;
  // Gelen kg önerisi yalnız okuma özetinde (detay ucu taşımaz).
  const kg = d.incomingKg === undefined && s?.incomingKg !== undefined ? { incomingKg: s.incomingKg, incomingKgSource: s.incomingKgSource ?? null } : null;
  // Eklenecek bir şey yoksa detay AYNEN döner (eski sunucuda bugünkü nesne).
  if ((fields === null || fields === d.formFields) && (suggestions === null || suggestions === d.suggestions) && docRolls === d.docRolls && cbn === d.customerBatchNo && !kg) return d;
  return { ...d, formFields: fields, suggestions, ...(docRolls ? { docRolls } : {}), ...(cbn !== undefined ? { customerBatchNo: cbn } : {}), ...(kg ?? {}) };
}

export interface RowForm {
  ownerCustomerId: string | null;
  /** Müşteri belgedeki metinden önerildi (kullanıcı görsün). */
  ownerSuggested: string | null;
  /** Tam metin eşleşmesi (adres/antet olabilir): alana yazılmaz, "bu müşteri mi?" diye sorulur. */
  ownerAsk: OwnerSuggestion | null;
  ourBatchNo: string | null;
  ourBatchNoKey: string | null;
  /** Müşterinin parti no'su (düz metin; bizim parti no'dan ayrı). */
  customerBatchNo?: string | null;
  /** Değer belgeden kendiliğinden geldi ve elle değişmedi (sarı vurgu). */
  customerBatchNoFromDoc?: boolean;
  /** Kullanıcı alanı değiştirdi → gövdeye girer (eski sunucu strict gövdesi bilinmeyen anahtarı 400'ler). */
  customerBatchNoEdited?: boolean;
  meters: number | null;
  /** Okunan metre doğrulama bekliyor: doğrula ya da düzelt. */
  metersReview: boolean;
  /** Gelen kg (belgeden önerilen ya da elle); HEDEF kg değil. Yok/null = belgede kg yok. */
  incomingKg?: number | null;
  /** Kullanıcı gelen kg'yi değiştirdi → gövdeye girer (yoksa sunucu belgeden önerileni yazar). */
  incomingKgEdited?: boolean;
  /** Gelen en (cm) elle düzeltildi; düzeltilmediyse ekran belgedekini (`docIncomingWidth`) gösterir, gövdeye girmez. */
  incomingWidth?: number | null;
  incomingWidthEdited?: boolean;
  /** Gelen kumaş / renk beyanı (müşteri yazısı; İE hedefi DEĞİL): elle düzeltildiyse değer (null = beyan yok), gövdeye girer; düzeltilmediyse belgedeki (`docDeclaredText`) gösterilir. */
  incomingItemText?: string | null;
  incomingItemEdited?: boolean;
  incomingColorText?: string | null;
  incomingColorEdited?: boolean;
  gramajValueId: string | null;
  /** S1 çok partili belge: parti satırları + kip (null/yok = tek partili, bugünkü form). */
  multi?: MultiPartyDraft | null;
  /** Toplar ayrı geldi: top satırları (null/yok = kapalı, bugünkü tek parça). Çok partiyle birlikte açılmaz. */
  rolls?: RollRow[] | null;
  /** Belge masası (K23): kurşun adımının plan makinesi (yok = öneri yok, bugünkü). */
  machineId?: string | null;
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Okuma sonrası form: taslaktaki değer > belge önerisi; tek parti adayı ön seçilir.
 * Gramaj sunucu çözücüsünden (K22: müşteri > istasyon yeteneği > değer varsayılanı); cevap yoksa boş, sonra dolar.
 */
export function initialRowForm(d: InboundNoteDetail, gramajFor?: (customerId: string | null) => string | null | undefined): RowForm {
  const candidates = d.batchNoCandidates ?? [];
  const single: BatchNoCandidate | null = !d.ourBatchNo && candidates.length === 1 ? candidates[0] : null;
  const meters = toNumber(d.kursunMeters);
  const any = !d.ownerCustomerId && d.ownerSuggestion ? d.ownerSuggestion : null;
  const suggestion = any && any.source !== 'FULL_TEXT' ? any : null;
  const owner = d.ownerCustomerId ?? suggestion?.customerId ?? null;
  const customerBatchNo = docCustomerBatchNo(d);
  return {
    ownerCustomerId: owner,
    ownerSuggested: suggestion ? suggestion.name : null,
    ownerAsk: any && any.source === 'FULL_TEXT' ? any : null,
    ourBatchNo: d.ourBatchNo || single?.value || null,
    ourBatchNoKey: d.ourBatchNo ? d.ourBatchNoKey ?? null : single ? single.key ?? single.field ?? null : null,
    customerBatchNo,
    customerBatchNoFromDoc: customerBatchNo !== null,
    meters,
    metersReview: meters !== null && !!d.kursunMetersReview,
    incomingKg: toNumber(d.incomingKg),
    gramajValueId: gramajFor?.(owner) ?? null,
  };
}

/** Belgenin gelen eni (cm): okunan şablon `en` alanı (İE eninin ön dolumuyla aynı kaynak); yoksa null. */
export function docIncomingWidth(d: Pick<InboundNoteDetail, 'formFields'> | null | undefined): number | null {
  return parseFormNumber(d?.formFields?.en);
}

/** Müşteri parti no kaynağı: taslağın başlık değeri (özet/detay) → belgenin "parti no" türlü ilk adayı; yoksa null. */
export function docCustomerBatchNo(d: Pick<InboundNoteDetail, 'customerBatchNo' | 'batchNoCandidates'>): string | null {
  const stored = d.customerBatchNo?.trim();
  if (stored) return stored;
  return d.batchNoCandidates?.find((c) => c.kind === 'BATCH' && c.value.trim())?.value.trim() ?? null;
}

/** Müşteri parti no elle yazıldı: vurgu kalkar, değer gövdeye girer. */
export function editCustomerBatchNo(v: string): Pick<RowForm, 'customerBatchNo' | 'customerBatchNoFromDoc' | 'customerBatchNoEdited'> {
  return { customerBatchNo: v === '' ? null : v, customerBatchNoFromDoc: false, customerBatchNoEdited: true };
}

/** İş emriyle kayıtta engeller (sunucu kapısının aynası; sunucu yine doğrular); her engel alanına bağlı. */
export function rowIssueList(f: RowForm): FormIssue[] {
  const out: FormIssue[] = [];
  const meter = (text: string): FormIssue => ({ key: 'kursunMetresi', text });
  if (!f.ownerCustomerId) out.push({ key: 'musteri', text: 'Müşteriyi seçin.' });
  if (f.multi) out.push(...multiPartyIssues(f.multi).map(meter));
  else if (f.rolls) out.push(...rollIssues(f.rolls).map(meter));
  else if (f.meters === null) out.push(meter('Kurşun metresi yok — metreyi girin.'));
  else if (f.metersReview) out.push({ key: 'metreDogrula', text: 'Kurşun metresini doğrulayın ya da düzeltin.' });
  return out;
}

/** Düz metin listesi (toplu görünüm maddeleri, kayıt engeli). */
export const rowIssues = (f: RowForm): string[] => rowIssueList(f).map((i) => i.text);

export function buildCreateBody(
  f: RowForm,
  opts: { clientToken: string; routeTemplateId: string | null; gramajPropertyId: string | null; passThrough?: readonly { propertyId: string; valueId: string }[]; kursunSequence?: number | null },
): CreateWorkOrderFromNoteBody {
  const body: CreateWorkOrderFromNoteBody = {
    clientToken: opts.clientToken,
    ownerCustomerId: f.ownerCustomerId!,
    kursunMeters: String(f.meters),
    // Rotasız (K29): anahtar hiç gitmez.
    ...(opts.routeTemplateId ? { routeTemplateId: opts.routeTemplateId } : {}),
  };
  // Parti no hep açık: null = formda temizlendi (sunucu okumada yazılan adayı siler).
  body.ourBatchNo = f.ourBatchNo ?? null;
  if (f.ourBatchNo && f.ourBatchNoKey) body.ourBatchNoKey = f.ourBatchNoKey;
  if (f.customerBatchNoEdited) body.customerBatchNo = f.customerBatchNo?.trim() || null;
  // Gelen kg yalnız elle değiştiyse (boşaltılırsa anahtar yok → sunucu belgedekini yazar); çok parti/ayrı topta parti başınadır.
  if (!f.multi && !f.rolls && f.incomingKgEdited && f.incomingKg != null && f.incomingKg > 0) body.incomingKg = f.incomingKg;
  // Gelen en da aynı desen: elle değişmediyse sunucu belgedekini (şablon `en`) yazar.
  if (!f.multi && !f.rolls && f.incomingWidthEdited && f.incomingWidth != null && f.incomingWidth > 0) body.incomingWidth = f.incomingWidth;
  // Gelen kumaş / renk beyanı: aynı desen (yalnız elle değiştiyse; çok parti/ayrı topta parti başınadır).
  if (!f.multi && !f.rolls) Object.assign(body, declaredBodyPart({ text: f.incomingItemText ?? null, edited: !!f.incomingItemEdited }, 'item'), declaredBodyPart({ text: f.incomingColorText ?? null, edited: !!f.incomingColorEdited }, 'color'));
  // K22: hedef değerleri HEP açık (boş = "Hedef yok"): sunucu anahtarsız gövdeye değer dayatmaz; ekranda görülen gider.
  body.targetValues = [...(f.gramajValueId && opts.gramajPropertyId ? [{ propertyId: opts.gramajPropertyId, valueId: f.gramajValueId }] : []), ...(opts.passThrough ?? [])];
  // Çok parti önce: iki kip ekranda birlikte gösterilmez; sunucu ikisini birden 400'ler.
  const base = f.multi ? withParties(body, f.multi) : f.rolls ? withRolls(body, f.rolls) : body;
  return withDeskPlan(base, f, { kursunSequence: opts.kursunSequence ?? null, gramajPropertyId: opts.gramajPropertyId });
}

/** Taslak kaydı (ayrı onay kipi): yalnız değişen başlık alanları PATCH'e gider; boşsa çağrı yok. */
export function buildDraftPatch(f: RowForm, d: InboundNoteDetail): InboundNotePatch {
  const p: InboundNotePatch = {};
  if (f.ownerCustomerId && f.ownerCustomerId !== d.ownerCustomerId) p.ownerCustomerId = f.ownerCustomerId;
  if (f.ourBatchNo && f.ourBatchNo !== (d.ourBatchNo || null)) {
    p.ourBatchNo = f.ourBatchNo;
    if (f.ourBatchNoKey) p.ourBatchNoKey = f.ourBatchNoKey;
  }
  // Başlık PATCH'i alanı eski sunucuda da kabul eder: belgeden gelen aday (kolonda yoksa) da yazılır.
  const cbn = f.customerBatchNo?.trim() || null;
  if ((f.customerBatchNoEdited || cbn) && cbn !== (d.customerBatchNo?.trim() || null)) p.customerBatchNo = cbn;
  const readMeters = toNumber(d.kursunMeters);
  if (f.meters !== null && f.meters !== readMeters) p.kursunMeters = f.meters;
  else if (f.meters !== null && d.kursunMetersReview && !f.metersReview) p.kursunMetersReviewed = true;
  return p;
}

export type RowResult =
  | {
      kind: 'OPENED';
      workOrderId: string;
      workOrderNo: string;
      batchNumber: string;
      print: 'PRINTED' | 'PRINT_FAILED' | null;
      /** Açılan bütün iş emirleri (çok partide PER_PARTY → parti başına bir). */
      workOrders: OpenedWo[];
      /** PER_PARTY kısmi başarı: açılamayan partiler — satır açık kalır, düzeltilip yeniden gönderilir. */
      failed?: { blockNo: number; message: string }[];
      /** Sunucu uyarıları (kayıt yapıldı ama dikkat; ör. Fason Belge Okut önerisi). */
      warnings?: string[];
    }
  | { kind: 'DRAFT'; text: string }
  | { kind: 'FAILED'; text: string };

export function openedResult(r: CreateWorkOrderFromNoteResult): RowResult {
  const failed = (r.failed ?? []).map((f) => ({ blockNo: f.blockNo, message: f.message }));
  const warnings = r.warnings ?? [];
  return { kind: 'OPENED', workOrderId: r.workOrderId, workOrderNo: r.workOrderNo, batchNumber: r.batchNumber, print: null, workOrders: openedWorkOrders(r), ...(failed.length ? { failed } : {}), ...(warnings.length ? { warnings } : {}) };
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
