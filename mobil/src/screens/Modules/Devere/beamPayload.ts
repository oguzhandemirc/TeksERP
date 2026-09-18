// =============================================================================
// LEVENT YÜKÜ — saf (React'sız): backend `createSchema` / `windSchema` ile birebir
// =============================================================================
// Köken XOR istemcide de kurulur (panel `schema.ts` aynası): IN_HOUSE → taraf yok,
// SUBCONTRACT → fasoncu, PURCHASED → tedarikçi XOR fasoncu. IN_HOUSE sarımda makine +
// ≥1 brüt çıkış satırı ZORUNLU; diğer kökenlerde makine ve iplik satırı HİÇ gönderilmez
// (sunucu 400 verir; form hiç kurmaz). Nominal kg ön hesabı sunucu formülünün aynasıdır.
// =============================================================================
import type { PlanWarpBeamRequest, WarpBeam, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WindWarpBeamRequest } from '../../../services/warpBeam.service';
import type { YarnLotQualityStatus } from '../../../types/models';
import { foldSearchText } from '../../../utils/searchFold';

// İplik lotu kalite durumu — SAR lot seçicisinde rozet (yarnQualityHold AÇIKken); ON_HOLD/BLOCKED çıkışını
// sunucu 400 `YARN_LOT_ON_HOLD` ile reddeder, tablet erken UYARIR (tahmin etmez, kapı sunucudan).
export const YARN_QUALITY_LABEL: Record<YarnLotQualityStatus, string> = {
  RELEASED: 'Serbest',
  ON_HOLD: 'Bekletmede',
  BLOCKED: 'Bloke',
};

/** Seçilen lot ON_HOLD/BLOCKED ise erken uyarı metni; RELEASED/undefined → null (uyarı yok). */
export function yarnQualityWarning(status: YarnLotQualityStatus | undefined | null): string | null {
  if (status === 'ON_HOLD') return 'Bu lot kalite BEKLETMEDE — sunucu bu lottan iplik çıkışını reddeder.';
  if (status === 'BLOCKED') return 'Bu lot kalite BLOKE — sunucu bu lottan iplik çıkışını reddeder.';
  return null;
}

export const ORIGIN_LABEL: Record<WarpBeamOrigin, string> = {
  IN_HOUSE: 'İçeride sarılacak',
  SUBCONTRACT: 'Fasona sardırıldı',
  PURCHASED: 'Hazır alındı',
  // G3 emanet: levent tablette PLANLANAMAZ (PlanModal butonları üç köken; sahip seçici yalnız KK1'de) — etiket rozet/liste için.
  CONSIGNED: 'Müşterinin emanet leventi',
};
export const KG_SOURCE_LABEL: Record<WarpKgSource, string> = { WEIGHED: 'Tartıldı', THEORETICAL: 'Nominal (hesap)' };
/** Durum rozeti — `Record` tam: backend'e değer gelince derleme kırılır (enum aynası). */
export const STATUS_LABEL: Record<WarpBeamStatus, string> = { PLANNED: 'Planlı', READY: 'Hazır', SHIPPED_OUT: 'Fasonda', MOUNTED: 'Tezgahta', EXHAUSTED: 'Bitti', SCRAPPED: 'Hurda', CANCELLED: 'İptal' };
/** Tablet eylemleri (sar · sil · iptal) yalnız bu durumlarda; SHIPPED_OUT levent tabletten dokunulmaz (dönüş fason ekranında). */
export function beamActionsEnabled(status: WarpBeamStatus): boolean {
  return status === 'PLANNED' || status === 'READY';
}

export interface PlanForm {
  warpSpecId: string | null;
  plannedLengthM: string;
  originKind: WarpBeamOrigin;
  subcontractorId: string | null;
  supplierId: string | null;
  physicalBeamNo: string;
  notes: string;
  /** Z1: bağlı dokuma işi (opsiyonel, IN_HOUSE önerisi). */
  weavingOrderId: string | null;
}

export const EMPTY_PLAN: PlanForm = { warpSpecId: null, plannedLengthM: '', originKind: 'IN_HOUSE', subcontractorId: null, supplierId: null, physicalBeamNo: '', notes: '', weavingOrderId: null };

export interface YarnLineDraft {
  key: string;
  warehouseId: string | null;
  qtyKg: string;
  reasonCode: string | null;
  /** Faz 2: lot; null = "Lot yok" (operatör AÇIKÇA seçer — sessiz lotsuz yazım olmasın). */
  lotId: string | null;
}

export interface WindForm {
  lengthM: string;
  kgSource: WarpKgSource;
  machineId: string | null;
  issues: YarnLineDraft[];
  returns: YarnLineDraft[];
  breakCount: string;
  /** Raşel takımı (#23): adet metni ("1" = tek levent, bugünkü); önek yalnız adet > 1'de anlamlı. */
  count: string;
  physicalBeamNoPrefix: string;
}

export type Validation = { ok: true } | { ok: false; message: string };

function num(s: string): number | null {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function nullable(s: string, max: number): string | null {
  const t = s.trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

export function validatePlan(f: PlanForm, beamWeavingLinkRequired = false): Validation {
  if (!f.warpSpecId) return { ok: false, message: 'Çözgü kartı seçin.' };
  // `devere.beamWeavingLinkRequired` (sunucudan) açıkken plan bir dokuma işine bağlanmalı (sunucu 400 ikizi).
  if (beamWeavingLinkRequired && !f.weavingOrderId) return { ok: false, message: 'Bu kurulumda levent bir dokuma işine bağlanmalı — iş seçin.' };
  const m = num(f.plannedLengthM);
  if (m == null || m <= 0) return { ok: false, message: 'Planlanan metre 0’dan büyük olmalı.' };
  if (f.originKind === 'IN_HOUSE' && (f.subcontractorId || f.supplierId)) return { ok: false, message: 'İçeride sarımda fasoncu/tedarikçi seçilmez.' };
  if (f.originKind === 'SUBCONTRACT' && (!f.subcontractorId || f.supplierId)) return { ok: false, message: 'Fason sarımda yalnız fasoncu seçilir.' };
  if (f.originKind === 'PURCHASED' && !!f.subcontractorId === !!f.supplierId) return { ok: false, message: 'Hazır alımda tedarikçi YA DA fasoncu — tam biri.' };
  return { ok: true };
}

export function buildPlanPayload(f: PlanForm, clientToken: string): PlanWarpBeamRequest {
  return {
    warpSpecId: f.warpSpecId ?? '',
    plannedLengthM: num(f.plannedLengthM) ?? 0,
    originKind: f.originKind,
    subcontractorId: f.originKind === 'IN_HOUSE' ? null : f.subcontractorId,
    supplierId: f.originKind === 'PURCHASED' ? f.supplierId : null,
    physicalBeamNo: nullable(f.physicalBeamNo, 32),
    notes: nullable(f.notes, 500),
    weavingOrderId: f.weavingOrderId,
    clientToken,
  };
}

/** Sarım formu başlangıcı: metre plandan, kg kaynağı kökene göre (panel `WindDialog` aynası). */
export function initialWindForm(beam: { plannedLengthM: number; originKind: WarpBeamOrigin }, defaultWarehouseId: string | null): WindForm {
  const inHouse = beam.originKind === 'IN_HOUSE';
  return {
    lengthM: String(beam.plannedLengthM),
    kgSource: inHouse ? 'WEIGHED' : 'THEORETICAL',
    machineId: null,
    issues: inHouse ? [{ key: 'i1', warehouseId: defaultWarehouseId, qtyKg: '', reasonCode: null, lotId: null }] : [],
    returns: [],
    breakCount: '',
    count: '1',
    physicalBeamNoPrefix: '',
  };
}

/** Z5/E6 SAR ön-dolgu önerisi: çözgü kartının son IN_HOUSE sarımı (tablet-context `lastWindDefaults` satırı). */
export interface WindDefault {
  warpSpecId: string;
  machineId: string | null;
  yarnIssues: { warehouseId: string; lotId: string | null; qtyKg: number }[];
  yarnReturns: { warehouseId: string; lotId: string | null; qtyKg: number; reasonCode: string }[];
}

/**
 * SAR açılış satır ön-dolgusu (Z5): çözgü kartının SON IN_HOUSE sarımından makine + iplik ÇIKIŞ satırlarının
 * DEPO + LOT'u önerilir — yalnız ÖNERİ. kg BOŞ başlar (1e kararı): kg deftere giren ÖLÇÜMdür, önceki sarımın kg'i
 * bu sarımın ağırlığı değildir ve dokunulmazsa yanlış sayı deftere iner ("Kg kaynağı: Tartıldı" ile de çelişir) —
 * operatör tartıp girer. Dip iadesi ÖN-DOLDURULMAZ (boş-kg satır İleri'yi kilitler, iade istisnaidir). Yalnız
 * IN_HOUSE'ta; öneri yoksa/başka kökende taban korunur; öneride çıkış yoksa tabanın tek boş satırı kalır.
 */
export function windFormWithDefault(base: WindForm, originKind: WarpBeamOrigin, def: WindDefault | undefined): WindForm {
  if (originKind !== 'IN_HOUSE' || !def) return base;
  const issues = def.yarnIssues.length
    ? def.yarnIssues.map((l, i) => ({ key: `i${i + 1}`, warehouseId: l.warehouseId, qtyKg: '', reasonCode: null, lotId: l.lotId }))
    : base.issues;
  return { ...base, machineId: def.machineId ?? base.machineId, issues };
}

/** Çözgü kartı için son sarım önerisini bul (yoksa undefined). */
export function windDefaultFor(defaults: readonly WindDefault[] | undefined, warpSpecId: string): WindDefault | undefined {
  return defaults?.find((d) => d.warpSpecId === warpSpecId);
}

/** Adet 1..24 tam sayı; boş/geçersiz → null. */
export function setCount(f: Pick<WindForm, 'count'>): number | null {
  const n = Number(f.count.trim());
  return Number.isInteger(n) && n >= 1 && n <= 24 ? n : null;
}

function validateLines(lines: YarnLineDraft[], label: string, needsReason: boolean): Validation {
  for (const l of lines) {
    if (!l.warehouseId) return { ok: false, message: `${label}: depo seçin.` };
    const q = num(l.qtyKg);
    if (q == null || q <= 0) return { ok: false, message: `${label}: kg 0’dan büyük olmalı.` };
    if (needsReason && !l.reasonCode) return { ok: false, message: `${label}: sebep seçin.` };
  }
  return { ok: true };
}

/** Sayfalı Sar formunun doğrulama sayfaları: ölçü (metre · adet) · makine + brüt çıkış · dip iadesi + kopuş. Fason/hazır kökende yalnız ölçü. */
export type WindPageKey = 'olcu' | 'makine' | 'dip';
export function windPageKeys(originKind: WarpBeamOrigin): WindPageKey[] {
  return originKind === 'IN_HOUSE' ? ['olcu', 'makine', 'dip'] : ['olcu'];
}

/** Tek sayfanın doğrulaması — `PagedSheet` İleri'de sorar; `validateWind` sayfaları sırayla zincirler (aynı sıra, aynı mesajlar). */
export function validateWindPage(f: WindForm, lotRequired: boolean, page: WindPageKey): Validation {
  if (page === 'olcu') {
    const m = num(f.lengthM);
    if (m == null || m <= 0) return { ok: false, message: 'Sarılan metre 0’dan büyük olmalı.' };
    if (setCount(f) == null) return { ok: false, message: 'Adet 1..24 arasında tam sayı olmalı.' };
    return { ok: true };
  }
  if (page === 'makine') {
    if (!f.machineId) return { ok: false, message: 'Devere makinesi seçin.' };
    if (f.issues.length === 0) return { ok: false, message: 'En az bir brüt iplik çıkışı satırı gerekir.' };
    // `devere.lotRequired` SUNUCUDAN okunur; istemci kapısı yalnız erken uyarı (sunucu 400 zaten verir).
    if (lotRequired && f.issues.some((l) => !l.lotId)) return { ok: false, message: 'Lot zorunlu: her iplik çıkış satırında lot seçin.' };
    return validateLines(f.issues, 'İplik çıkışı', false);
  }
  const r = validateLines(f.returns, 'Dip iadesi', true);
  if (!r.ok) return r;
  const issueKg = f.issues.reduce((s, l) => s + (num(l.qtyKg) ?? 0), 0);
  const returnKg = f.returns.reduce((s, l) => s + (num(l.qtyKg) ?? 0), 0);
  if (returnKg > issueKg) return { ok: false, message: `Dip iadesi (${returnKg} kg) brüt çıkışı (${issueKg} kg) aşamaz.` };
  const bc = f.breakCount.trim() === '' ? null : num(f.breakCount);
  if (bc != null && (bc < 0 || !Number.isInteger(bc))) return { ok: false, message: 'Kopuş adedi tam sayı olmalı.' };
  return { ok: true };
}

export function validateWind(f: WindForm, originKind: WarpBeamOrigin, lotRequired = false): Validation {
  for (const page of windPageKeys(originKind)) {
    const v = validateWindPage(f, lotRequired, page);
    if (!v.ok) return v;
  }
  return { ok: true };
}

/** Özet için kg toplamı (satır sayısıyla) — yalnız sayısal satırlar. */
export function linesTotalKg(lines: YarnLineDraft[]): number {
  return Math.round(lines.reduce((s, l) => s + (num(l.qtyKg) ?? 0), 0) * 1000) / 1000;
}

export function buildWindPayload(f: WindForm, originKind: WarpBeamOrigin, clientToken: string, weavingOrderId?: string | null): WindWarpBeamRequest {
  const inHouse = originKind === 'IN_HOUSE';
  return {
    lengthM: num(f.lengthM) ?? 0,
    kgSource: f.kgSource,
    machineId: inHouse ? f.machineId : null,
    yarnIssues: inHouse ? f.issues.map((l) => ({ warehouseId: l.warehouseId ?? '', qtyKg: num(l.qtyKg) ?? 0, lotId: l.lotId })) : [],
    yarnReturns: inHouse ? f.returns.map((l) => ({ warehouseId: l.warehouseId ?? '', qtyKg: num(l.qtyKg) ?? 0, reasonCode: l.reasonCode ?? '', lotId: l.lotId })) : [],
    breakCount: inHouse && f.breakCount.trim() !== '' ? (num(f.breakCount) ?? null) : null,
    clientToken,
    // Z1: plandaki dokuma işi bağı sarımda korunur (yalnız verildiğinde gönderilir — eski çağıran değişmez).
    ...(weavingOrderId !== undefined ? { weavingOrderId } : {}),
    // Raşel takımı: adet 1 → alanlar GİDMEZ (istek bugünkü ile birebir).
    ...((setCount(f) ?? 1) > 1 ? { count: setCount(f) ?? 1, physicalBeamNoPrefix: f.physicalBeamNoPrefix.trim() || null } : {}),
  };
}

/** Tek açık dokuma işi varsa onun id'si (Plan "Dokuma işi" ön-seçimi); 0 ya da >1 → null. */
export function soleWeavingOrderId(weavingOrders: readonly { id: string }[] | undefined): string | null {
  return weavingOrders && weavingOrders.length === 1 ? weavingOrders[0]!.id : null;
}

/** Nominal kg = tel × denye × metre / 9.000.000 — sunucu formülünün AYNASI (ön hesap; sunucu yeniden hesaplar). */
export function theoreticalKg(endsCount: number, denier: number | null, lengthM: number): number | null {
  if (denier == null || !(lengthM > 0) || !(endsCount > 0)) return null;
  return Math.round(((endsCount * denier * lengthM) / 9_000_000) * 1000) / 1000;
}

/** Sunucu `assertPhysicalBeamFreeTx` aynası (tr_fold = `foldSearchText`, canlı durumlar READY · SHIPPED_OUT · MOUNTED): aynı gövdede canlı çözgü varsa ERKEN UYARI metni; kilit değil — sunucu 409 `WARP_BEAM_PHYSICAL_BUSY` kalır. */
const PHYSICAL_LIVE: ReadonlySet<WarpBeamStatus> = new Set(['READY', 'SHIPPED_OUT', 'MOUNTED']);
const PHYSICAL_LIVE_LABEL: Partial<Record<WarpBeamStatus, string>> = { READY: 'hazır duruyor', SHIPPED_OUT: 'fasonda', MOUNTED: 'tezgahta' };
/** Tek devere makinesi varsa onun id'si (SAR sayfa 2 ön-seçimi); 0 ya da >1 makine → null (operatör seçer). */
export function soleMachineId(machines: readonly { id: string }[]): string | null {
  return machines.length === 1 ? machines[0]!.id : null;
}

/** Bağlamdaki EN SON leventin çözgü kartı (Plan modalı ön-dolgusu; `createdAt` en yeni) — liste boşsa null. */
export function lastPlannedWarpSpecId(beams: readonly { warpSpec: { id: string }; createdAt: string }[]): string | null {
  let enYeni: { warpSpec: { id: string }; createdAt: string } | null = null;
  for (const b of beams) {
    if (!enYeni || new Date(b.createdAt).getTime() > new Date(enYeni.createdAt).getTime()) enYeni = b;
  }
  return enYeni?.warpSpec.id ?? null;
}

export function physicalBeamBusyWarning(physicalBeamNo: string | null | undefined, beams: readonly Pick<WarpBeam, 'id' | 'beamNo' | 'physicalBeamNo' | 'status'>[], ownBeamId: string | null = null): string | null {
  const no = (physicalBeamNo ?? '').trim();
  if (!no) return null;
  const fold = foldSearchText(no);
  if (!fold) return null;
  const busy = beams.find((b) => b.id !== ownBeamId && PHYSICAL_LIVE.has(b.status) && !!b.physicalBeamNo && foldSearchText(b.physicalBeamNo) === fold);
  return busy ? `${no} gövdesinde ${busy.beamNo} ${PHYSICAL_LIVE_LABEL[busy.status] ?? 'canlı'} — sarım reddedilir; gövdeyi boşaltın ya da başka gövde yazın.` : null;
}

/** Sarımda doğacak gövde numaraları — sunucu `siblingPhysicalNo` aynası: k=1 leventin kendi gövdesi, k≥2 `${önek}-${k}` (önek yoksa yok). */
export function windPhysicalNos(own: string | null, f: Pick<WindForm, 'count' | 'physicalBeamNoPrefix'>): string[] {
  const n = setCount(f) ?? 1;
  const prefix = f.physicalBeamNoPrefix.trim();
  const nos: string[] = own ? [own] : [];
  if (n > 1 && prefix) for (let k = 2; k <= n; k++) nos.push(`${prefix}-${k}`.slice(0, 32));
  return nos;
}

export type BeamFailureAction =
  | { kind: 'refresh-list'; message: string }
  | { kind: 'refresh-context'; message: string }
  | { kind: 'refresh-presets'; message: string }
  | { kind: 'module-off'; modul: string; message: string }
  | { kind: 'token-collision'; message: string }
  | { kind: 'plain'; message: string };

interface FailureLike {
  message?: string;
  details?: { code?: string; modul?: string } | null;
}

// Faz 3: yuva doldu / kalan aşıldı / açık koşum → liste tazelenir; makine levent tüketmez / yuva aralığı / bayrak kapalı → bağlam tazelenir.
const REFRESH_LIST = new Set(['WARP_BEAM_STATE', 'WARP_BEAM_NOT_PLANNED', 'WARP_BEAM_NOT_WOUND', 'WARP_BEAM_CANCELLED', 'WARP_SLOT_BUSY', 'WARP_BEAM_REMAINING_EXCEEDED', 'WARP_DISMOUNT_OPEN_RUN']);
const REFRESH_CONTEXT = new Set(['WARP_BEAM_MACHINE_NOT_DEVERE', 'WARP_DENIER_MISSING', 'WARP_BEAM_ORIGIN_PARTY', 'WARP_BEAM_MACHINE_NOT_LOOM', 'WARP_SLOT_OUT_OF_RANGE', 'WARP_MOUNT_TRACKING_OFF', 'WARP_MOUNT_METHOD_REQUIRED']);

/** `details.code` → ekran eylemi. Bilinmeyen kod düz mesaj; kod uydurulmaz. */
export function classifyBeamFailure(error: unknown, fallback: string): BeamFailureAction {
  const e = (error ?? {}) as FailureLike;
  const message = e.message?.trim() || fallback;
  const code = e.details?.code ?? '';
  if (REFRESH_LIST.has(code)) return { kind: 'refresh-list', message };
  if (REFRESH_CONTEXT.has(code)) return { kind: 'refresh-context', message };
  if (code === 'REASON_CODE_INVALID') return { kind: 'refresh-presets', message };
  if (code === 'MODULE_DISABLED') return { kind: 'module-off', modul: e.details?.modul ?? 'devere', message };
  if (code === 'CLIENT_TOKEN_COLLISION') return { kind: 'token-collision', message };
  return { kind: 'plain', message };
}

/** Sarım tarihi fabrika gününde mi (cihaz saati Türkiye'de) — "bugün sarılan" sekmesi. */
export function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
