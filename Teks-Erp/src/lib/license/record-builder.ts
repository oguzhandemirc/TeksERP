// Durum kaydının SONRAKİ hâli (saf): saatlik yazım, yeni kira kabulü ve kirasız doğuş. G12 alanları (belirsizlik ve
// parmak izi birikimi, kalıcı iz kaybı, K7 çapası, son bilinen çapa, HAK pini tavanı) burada birleşir; imza ve
// yazım `accumulation.ts`te. Kural: hiçbir yazım birikimi geriletmez, iz kaybını silmez — yalnız yeni kira kabulü.
import { CLOCK_SKEW_MS, isoToMs, msToIso, type LeaseDoc, type VerifiedEntitlement } from "./protocol";
import { sanctionSnapshotOf } from "./state-rules";
import { rememberAnchor } from "./state-rules-time";
import { revocationPin } from "./state-rules-revocation";
import { rootKindOf, type EntitlementPin, type StateRecord, type TraceKind } from "./saat";
import type { IntegrityRecordPatch } from "./integrity-state";

export function entitlementPinOf(entitlement: VerifiedEntitlement): EntitlementPin {
  const d = entitlement.document;
  return {
    hakId: d.hakId,
    surum: d.surum,
    sinif: d.sinif,
    kokTuru: rootKindOf(entitlement.signer.rootKid),
    moduller: [...d.moduller],
    ...(d.kipAltSiniri ? { kipAltSiniri: d.kipAltSiniri } : {}),
  };
}

/** Motorun bu yazıma getirdiği merdiven ölçümleri. */
export interface LadderFields {
  readonly belirsizlikMs: number;
  readonly parmakIziUyusmazMs: number;
  readonly izKaybi: readonly TraceKind[];
  readonly ucIzYok: boolean;
  /** DB izi şu an okunup bu lisansa ait geçerli bulundu. */
  readonly izDogrulandi: boolean;
  readonly parmakIziOnbellegi: StateRecord["parmakIziOnbellegi"] | undefined;
}

function ladderPatch(prev: StateRecord | null, l: LadderFields, nowIso: string): Partial<StateRecord> {
  const lost = new Set<TraceKind>([...(prev?.izKaybi?.izler ?? []), ...l.izKaybi]);
  const izler = (["KIRA", "DURUM", "IZ"] as const).filter((k) => lost.has(k));
  const uncertainty = Math.max(Math.round(l.belirsizlikMs), prev?.belirsizlik?.birikenMs ?? 0);
  return {
    belirsizlik: { birikenMs: uncertainty, ilk: prev?.belirsizlik?.ilk ?? (uncertainty > 0 ? nowIso : null) },
    parmakIziUyusmazMs: Math.max(0, Math.round(l.parmakIziUyusmazMs)),
    izKaybi: izler.length > 0 ? { ilk: prev?.izKaybi?.ilk ?? nowIso, izler } : null,
    ekSureCapasi: prev?.ekSureCapasi ?? (l.ucIzYok ? nowIso : null),
    izKurulu: prev?.izKurulu === true || l.izDogrulandi,
    ...(l.parmakIziOnbellegi ?? prev?.parmakIziOnbellegi ? { parmakIziOnbellegi: l.parmakIziOnbellegi ?? prev?.parmakIziOnbellegi } : {}),
  };
}

/** İptal pini (G4): önceki pin ∨ kiranın beyanı ∨ elde tutulan belge; hiçbiri yoksa alan YAZILMAZ (eski kayıtla bayt farkı yok). */
function revocationPinField(prev: StateRecord | null, lease: LeaseDoc | null, held: number | null | undefined): Pick<StateRecord, "iptalSira"> {
  const pin = revocationPin(prev?.iptalSira, lease?.iptalSira, held);
  return pin === null ? {} : { iptalSira: pin };
}

/** Bütünlük çapası alanları: yama verilmediyse önceki kayıttakiler aynen taşınır. */
function integrityFields(patch: IntegrityRecordPatch | undefined, prev: StateRecord | null): IntegrityRecordPatch {
  return patch ?? { butunlukIlk: prev?.butunlukIlk ?? null, butunlukPaketId: prev?.butunlukPaketId ?? null };
}

export interface HourlyInput {
  readonly prev: StateRecord;
  readonly lease: LeaseDoc | null;
  readonly entitlement: VerifiedEntitlement | null;
  /** HAK doğrulandı ve pine ters düşmüyor: pin ve P bu HAK'tan tazelenir. */
  readonly hakGecerli: boolean;
  readonly elapsedMs: number;
  readonly creditMs: number;
  readonly clockConsistent: boolean;
  readonly highWaterMs: number;
  readonly skewSeconds: number | null;
  readonly integrity?: IntegrityRecordPatch;
  readonly ladder: LadderFields;
  readonly nowMs: number;
  /** Elde tutulan etkin iptal belgesinin sırası (pine girer). */
  readonly iptalSira?: number | null;
}

/**
 * Saatlik/kapanış yazımı. Kaydın kirası diskte olmasa da birikim SÜRER (o kiradan beri geçen çalışma süresi);
 * kirasız kayıt monotonik taşımaz. Son bilinen çapa ve pin yalnız AYNI kira ve geçerli HAK'la tazelenir.
 */
export function nextHourlyRecord(g: HourlyInput): StateRecord {
  const r = g.prev;
  const nowIso = msToIso(g.nowMs);
  const sameLease = g.lease !== null && r.kiraId === g.lease.kiraId;
  const fresh = sameLease && g.lease ? rememberAnchor(g.hakGecerli ? g.entitlement : null, g.lease) : null;
  return {
    ...r,
    birikenMs: r.kiraId === null ? 0 : Math.max(r.birikenMs, Math.round(g.elapsedMs)),
    yazildi: nowIso,
    yuksekSu: msToIso(g.highWaterMs),
    sira: r.sira + 1,
    sonKira: r.sonKira ?? (sameLease && g.lease ? { kiraId: g.lease.kiraId, verilis: g.lease.verilis } : null),
    sonHak: g.hakGecerli && g.entitlement ? entitlementPinOf(g.entitlement) : (r.sonHak ?? null),
    sureCapasi: fresh && (g.hakGecerli || !r.sureCapasi) ? fresh : (r.sureCapasi ?? null),
    kapaliMs: (r.kapaliMs ?? 0) + g.creditMs,
    duvarTutarli: g.clockConsistent,
    saticiSapmaSn: g.skewSeconds,
    ...integrityFields(g.integrity, r),
    ...ladderPatch(r, g.ladder, nowIso),
    ...revocationPinField(r, g.lease, g.iptalSira),
  };
}

export interface LeaseRecordInput {
  readonly prev: StateRecord | null;
  readonly lease: LeaseDoc;
  readonly entitlement: VerifiedEntitlement;
  readonly licenseId: string;
  readonly highWaterMs: number;
  readonly skewSeconds: number | null;
  readonly integrity?: IntegrityRecordPatch;
  readonly ladder: Pick<LadderFields, "parmakIziUyusmazMs" | "izDogrulandi" | "parmakIziOnbellegi">;
  readonly nowMs: number;
  readonly iptalSira?: number | null;
}

/**
 * Yeni kira kabul edildi: birikim sıfırdan; kira kararları (kip + yaptırım), kiranın kendisi, HAK pini ve süre çapası
 * kalıcı iz olarak — eski dosyayla değiştirilen kira/HAK geri alma sayılsın. Belirsizlik birikimi ve iz kaybı
 * YALNIZ burada sıfırlanır; parmak izi merdiveni sürer (yalnız eşiğin yeniden tutması kapatır).
 */
export function leaseRecord(g: LeaseRecordInput): StateRecord {
  const prev = g.prev;
  return {
    v: 1,
    kurulumId: g.licenseId,
    kiraId: g.lease.kiraId,
    birikenMs: 0,
    yazildi: msToIso(g.nowMs),
    yuksekSu: msToIso(g.highWaterMs),
    sonKiraZorlamasi: g.lease.zorlama,
    sonYaptirim: sanctionSnapshotOf(g.lease),
    sira: prev ? prev.sira + 1 : 0,
    sonKira: { kiraId: g.lease.kiraId, verilis: g.lease.verilis },
    sonHak: entitlementPinOf(g.entitlement),
    kapaliMs: 0,
    // Kabul anında duvar saati satıcının İMZALI saatinden ileri kaçmışsa kayıt kredi vermez.
    duvarTutarli: g.nowMs - isoToMs(g.lease.sunucuSaati) <= CLOCK_SKEW_MS,
    saticiSapmaSn: g.skewSeconds,
    // Yeni kira bütünlük çapasını SIFIRLAMAZ (kira yenilemek ek süreyi uzatmasın).
    ...integrityFields(g.integrity, prev),
    sureCapasi: rememberAnchor(g.entitlement, g.lease),
    belirsizlik: { birikenMs: 0, ilk: null },
    parmakIziUyusmazMs: Math.max(0, Math.round(g.ladder.parmakIziUyusmazMs)),
    izKaybi: null,
    ekSureCapasi: null,
    izKurulu: prev?.izKurulu === true || g.ladder.izDogrulandi,
    ...(g.ladder.parmakIziOnbellegi ?? prev?.parmakIziOnbellegi ? { parmakIziOnbellegi: g.ladder.parmakIziOnbellegi ?? prev?.parmakIziOnbellegi } : {}),
    ...revocationPinField(prev, g.lease, g.iptalSira),
  };
}

export interface OrphanInput {
  readonly licenseId: string;
  readonly lease: LeaseDoc | null;
  readonly entitlement: VerifiedEntitlement | null;
  readonly highWaterMs: number;
  readonly skewSeconds: number | null;
  readonly integrity?: IntegrityRecordPatch;
  readonly ladder: LadderFields;
  readonly nowMs: number;
  readonly iptalSira?: number | null;
}

/**
 * Hiçbir kopya yok (durum kaydı + DB izi gitti): KİRASIZ kayıt doğar — kiranın monotoniğini taşımaz (aynı kira için
 * sıfırdan başlatma yok, DURUM_DOSYASI yeni kiraya dek sürer), sıra 0'dan (satıcıda sıfırlanma görünür). Kira diskteyse
 * kararları ve çapası kayda alınır; değilse (K7) yaptırım kaynağı kalmaz — bilinçli kabul, birikim 14 günden başlar.
 */
export function orphanRecord(g: OrphanInput): StateRecord {
  const nowIso = msToIso(g.nowMs);
  return {
    v: 1,
    kurulumId: g.licenseId,
    kiraId: null,
    birikenMs: 0,
    yazildi: nowIso,
    yuksekSu: msToIso(g.highWaterMs),
    sonKiraZorlamasi: g.lease ? g.lease.zorlama : null,
    sonYaptirim: g.lease ? sanctionSnapshotOf(g.lease) : null,
    sira: 0,
    sonKira: g.lease ? { kiraId: g.lease.kiraId, verilis: g.lease.verilis } : null,
    sonHak: g.entitlement ? entitlementPinOf(g.entitlement) : null,
    kapaliMs: 0,
    duvarTutarli: false,
    saticiSapmaSn: g.skewSeconds,
    ...integrityFields(g.integrity, null),
    sureCapasi: g.lease ? rememberAnchor(g.entitlement, g.lease) : null,
    ...ladderPatch(null, g.ladder, nowIso),
    ...revocationPinField(null, g.lease, g.iptalSira),
  };
}
