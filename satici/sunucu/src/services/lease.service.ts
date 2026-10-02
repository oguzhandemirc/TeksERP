// KİRA basımı: yaptırım defterinin katlanması + kira belgesi + indirme belirteçleri.
// Kira ALT anahtarla otomatik imzalanır (kök parolası istemez); ticari/operasyonel şartları
// (yaptırım, zorlama, geçerlilik bitişi, ödenmiş tarih P, DR devri) taşır. Her kira `kira` defterine satır olur.
// Lisans v2: kiraya `odenmisTarih` (P — `paid-through.ts` tek kaynak), `hakOzeti` (teslim edilen HAK'ın bayt özeti)
// ve iptal belgesi varsa `iptalSira` girer; eski fabrika bu alanları atar. Kapanış kirası (K6) aynı basımdan geçer.
import { randomUUID } from "node:crypto";
import type { Hak, Kira, Kurulum, YaptirimEylemi, ZincirKarari } from "@prisma/client";
import { z } from "zod";
import {
  DAY_MS,
  DOWNLOAD_PRODUCTS,
  IsoTimeSchema,
  LeaseSchema,
  LicenseResponseSchema,
  ModuleKeySchema,
  SANCTION_LEVELS,
  TYP,
  jwsDigest,
  msToIso,
  signDocument,
  signDownloadToken,
  type ActivationCodeKind,
  type ClosingLeaseReason,
  type Fingerprint,
  type LeaseDoc,
  type LicenseResponse,
  type SanctionLevel,
} from "../lisans-protokol";
import type { KeyStore } from "../keys/key-store";
import { VendorError } from "../lib/errors";
import type { Db, Tx } from "../lib/prisma";
import { channelVersionsForLease } from "./channel.service";
import { leaseCloudFields } from "./cloud-entitlement";
import { deliverableEntitlement, type DeliverableEntitlement, type HeldEntitlement } from "./entitlement-issue.service";
import { installationCapabilities } from "./entitlement-policy";
import { leaseFingerprintRule } from "./fingerprint-policy";
import { moduleKeyGrants } from "./module-key.service";
import { leaseUpdatePolicy } from "./update-policy.service";
import { paidThroughOf, type PaidThrough } from "./paid-through";
import type { VendorContext } from "./context";
import { distributableRevocation } from "./revocation.service";

export interface SanctionState {
  readonly kademe: SanctionLevel | null;
  readonly mesaj: string | null;
  readonly kisitlamaTarihi: string | null;
  readonly donmusModuller: string[];
  readonly guncellemeDonuk: boolean;
}

/** Yaptırım eyleminin parametresi (tür başına alt küme dolu). */
export const SanctionParamSchema = z.object({
  mesaj: z.string().max(500).optional(),
  kisitlamaTarihi: IsoTimeSchema.optional(),
  moduller: z.array(ModuleKeySchema).max(64).optional(),
});

const LEVELS: readonly string[] = SANCTION_LEVELS;

/**
 * Defterin katlanması (SAF): geri alınmamış K0…K5 eylemleri → kiradaki yaptırım.
 * Kademe en şiddetlisidir; mesaj en son mesajlı eylemden; K3 tarihi en erken; K2 modülleri birleşim.
 */
export function foldSanctions(rows: readonly Pick<YaptirimEylemi, "id" | "tur" | "parametre" | "geriAlinanEylemId" | "createdAt">[]): SanctionState {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const reversed = new Set(ordered.filter((r) => r.tur === "GERI_AL" && r.geriAlinanEylemId).map((r) => r.geriAlinanEylemId));
  const active = ordered.filter((r) => LEVELS.includes(r.tur) && !reversed.has(r.id));
  let kademe: SanctionLevel | null = null;
  let mesaj: string | null = null;
  let kisitlamaTarihi: string | null = null;
  const frozen = new Set<string>();
  let guncellemeDonuk = false;
  for (const r of active) {
    const level = r.tur as SanctionLevel;
    if (kademe === null || LEVELS.indexOf(level) > LEVELS.indexOf(kademe)) kademe = level;
    const p = SanctionParamSchema.safeParse(r.parametre);
    const param = p.success ? p.data : {};
    if (param.mesaj) mesaj = param.mesaj;
    if (level === "K3" && param.kisitlamaTarihi && (kisitlamaTarihi === null || param.kisitlamaTarihi < kisitlamaTarihi)) {
      kisitlamaTarihi = param.kisitlamaTarihi;
    }
    if (level === "K2") for (const m of param.moduller ?? []) frozen.add(m);
    if (level === "K1") guncellemeDonuk = true;
  }
  return { kademe, mesaj, kisitlamaTarihi, donmusModuller: [...frozen].sort(), guncellemeDonuk };
}

/** Kapanış kirasının yaptırımı (K6): katlanmış duruma K3 eklenir — kademe en az K3, tarih ikisinin erkeni. */
export function withClosingRestriction(state: SanctionState, restrictAt: Date): SanctionState {
  const at = restrictAt.toISOString();
  const kademe: SanctionLevel = state.kademe !== null && LEVELS.indexOf(state.kademe) > LEVELS.indexOf("K3") ? state.kademe : "K3";
  const kisitlamaTarihi = state.kisitlamaTarihi !== null && state.kisitlamaTarihi < at ? state.kisitlamaTarihi : at;
  return { ...state, kademe, kisitlamaTarihi };
}

export async function computeSanctionState(db: Db, installationDbId: string): Promise<SanctionState> {
  const rows = await db.yaptirimEylemi.findMany({
    where: { kurulumId: installationDbId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return foldSanctions(rows);
}

// ---------------------------------------------------------------- iki SEÇİM NOKTASI (lisans v2 G4)

/** Yanıtla dağıtılan iptal belgesi (`tekserp-iptal`) ve sırası — kiranın `iptalSira`sı ile yanıtın `iptal`i birlikte. */
export interface LeaseRevocation {
  readonly sira: number;
  readonly belge: string;
}

/**
 * Kiraya ve yanıta giden iptal belgesi — TEK seçim noktası (G4 §2.3): iptal defterinin dağıtım kapısından geçen
 * (`distributableRevocation`) en yüksek sıralı belge; defter boşsa ya da her belge kapıda bekliyorsa null.
 */
export async function leaseRevocation(db: Db, keys: KeyStore): Promise<LeaseRevocation | null> {
  const gate = await distributableRevocation(db, keys);
  return gate.dagitilan ? { sira: gate.dagitilan.sira, belge: gate.dagitilan.belge } : null;
}

/** Teslim edilen HAK sürümü: kiranın `hakSurum`/`hakOzeti`si ile yanıtın `hak`ı bundan türer (bayt bağı tutarlı kalsın). */
export interface DeliveredEntitlement {
  readonly hakId: string;
  readonly surum: number;
  readonly belge: string;
  /** Genişlik kapısı (`deliverableEntitlement`): HAK teslim EDİLMEZ, sürüm yalnız kira bağıdır. */
  readonly withheld?: DeliverableEntitlement["withheld"];
}

/**
 * Kuruluma TESLİM edilecek HAK — TEK seçim noktası (`deliverableEntitlement`): `hak-ara` bildirene güncel sürüm, bildirmeyene
 * en yeni ARA İMZALI OLMAYAN sürüm, o sürüm güncelden genişse HİÇBİRİ (genişlik kapısı, `withheld`). Yetenekler verilmezse
 * kurulum kaydından (`installationCapabilities`); yoklamada yanıtı ALACAK tarafın imzalı gövdede bildirdiği küme ve elindeki
 * HAK (`held`) verilir (eski sürüme dönen fabrika ara imzalı HAK'ı aynı yanıtta almasın).
 */
/** Teslim seçiminin alıcıya özgü girdileri: bildirdiği yetenekler (yoksa kurulum kaydı) ve elindeki HAK. */
export interface DeliveryReceiver {
  readonly capabilities?: readonly string[];
  readonly held?: HeldEntitlement | null;
}

export async function entitlementForDelivery(
  db: Db,
  installation: { readonly yetenekler: unknown },
  entitlement: Pick<Hak, "id" | "guncelSurum">,
  receiver: DeliveryReceiver = {},
): Promise<DeliveredEntitlement> {
  const d = await findEntitlementForDelivery(db, installation, entitlement, receiver);
  if (!d) throw new VendorError(500, "SUNUCU_HATASI", "Bu kurulumun derlemesinin tanıyacağı imzalı lisans (HAK) yok");
  return d;
}

/** Aynı seçim, bulunamazsa null — salt okuyan görünüm ve taramalar içindir (kira basımı `entitlementForDelivery`). */
export async function findEntitlementForDelivery(
  db: Db,
  installation: { readonly yetenekler: unknown },
  entitlement: Pick<Hak, "id" | "guncelSurum">,
  receiver: DeliveryReceiver = {},
): Promise<DeliveredEntitlement | null> {
  const d = await deliverableEntitlement(db, entitlement, receiver.capabilities ?? installationCapabilities(installation), receiver.held ?? null);
  return d ? { hakId: entitlement.id, surum: d.surum, belge: d.belge, ...(d.withheld ? { withheld: d.withheld } : {}) } : null;
}

/** Defterdeki bir kiranın BAĞLI olduğu HAK sürümü — aynı kirayı yeniden veren yol (tekrar, yeniden kullanım) bunu teslim eder. */
export async function leaseEntitlement(db: Db, lease: Pick<Kira, "hakId" | "hakSurum">): Promise<DeliveredEntitlement> {
  const version = await db.hakSurumu.findUnique({ where: { hakId_surum: { hakId: lease.hakId, surum: lease.hakSurum } }, select: { belge: true } });
  if (!version) throw new VendorError(500, "SUNUCU_HATASI", "Kiranın bağlı olduğu HAK sürümü defterde yok");
  return { hakId: lease.hakId, surum: lease.hakSurum, belge: version.belge };
}

// ---------------------------------------------------------------- basım

/** Kapanış kirası (K6): eşleşmeyen tarafa imzalı K3 — zincir ucunu ilerletmez, modül anahtarı ve bulut hakkı taşımaz. */
export interface ClosingLeaseTerms {
  readonly reason: ClosingLeaseReason;
  /** K3 kısıtlama anı: olayın çapası + ek süre (kapanış tekrarında aynı kalır). */
  readonly restrictAt: Date;
  /** Kiranın bağlandığı anahtar: eşleşmeyen tarafın (kopyanın, taşınmış eski makinenin) anahtarı. */
  readonly keyId: string;
}

export interface IssueLeaseInput {
  readonly installation: Kurulum;
  readonly entitlement: Hak;
  readonly previousLeaseId: string | null;
  readonly decision: ZincirKarari;
  /** İsteyenin ölçtüğü parmak izi (çatal kararının girdisi). */
  readonly clientFingerprint: Fingerprint;
  /** Kiraya yazılan: sunucunun KABUL ettiği küme. */
  readonly acceptedFingerprint: Fingerprint;
  readonly nowMs: number;
  /** Yalnız kapanış kirasında (karar `KAPANIS`). */
  readonly closing?: ClosingLeaseTerms;
  /** Kirayı ALACAK tarafın yetenekleri (teslim edilecek HAK biçimi); verilmezse kurulum kaydından. */
  readonly capabilities?: readonly string[];
  /** Kirayı alacak tarafın elindeki HAK (genişlik kapısında kira buna bağlanabilir). */
  readonly held?: HeldEntitlement | null;
}

export interface IssuedLease {
  readonly id: string;
  readonly token: string;
  readonly sanction: SanctionState;
  /** Kiranın bağlandığı (teslim edilecek) HAK sürümü ve yanıtla gidecek iptal belgesi. */
  readonly entitlement: DeliveredEntitlement;
  readonly revocation: LeaseRevocation | null;
  /** Kiraya basılan ödenmiş tarih (P) ve kaynağı. */
  readonly paidThrough: PaidThrough;
}

/** Kira basar ve deftere yazar (tx içinde; zincir ucunu çağıran ilerletir — kapanış kirasında ilerletilmez). */
export async function issueLease(tx: Tx, ctx: VendorContext, g: IssueLeaseInput): Promise<IssuedLease> {
  const { installation, entitlement, nowMs, closing } = g;
  if ((g.decision === "KAPANIS") !== (closing !== undefined)) throw new Error("Kapanış kirası yalnız KAPANIS kararıyla basılır");
  const keyId = closing ? closing.keyId : installation.anahtarKimligi;
  if (!keyId) throw new VendorError(500, "SUNUCU_HATASI", "Kurulumun kayıtlı anahtarı yok");
  if (entitlement.guncelSurum < 1) throw new VendorError(500, "SUNUCU_HATASI", "Bu kurulum için imzalı lisans (HAK) yok");
  const key = ctx.keys.leaseKeyFor(installation.sinif, nowMs);
  if (!key) throw new VendorError(500, "SUNUCU_HATASI", "Kira imzalayacak geçerli alt anahtar yok");
  const folded = await computeSanctionState(tx, installation.id);
  const sanction = closing ? withClosingRestriction(folded, closing.restrictAt) : folded;
  const channel = await tx.kanal.findUnique({ where: { kod: installation.kanalKodu } });
  const cloud = leaseCloudFields(installation, closing ? null : entitlement, sanction.donmusModuller);
  // Faz 2d: yalnız HAK'taki, dondurulmamış modüllerin anahtarları; kurulumun X25519'u yoksa hiçbiri. Kapanışta hiçbiri.
  const grants = closing ? [] : await moduleKeyGrants(tx, ctx, { installation, entitlement, frozen: sanction.donmusModuller });
  const paid = await paidThroughOf(tx, installation.id, entitlement);
  const delivered = await entitlementForDelivery(tx, installation, entitlement, { capabilities: g.capabilities, held: g.held });
  const revocation = await leaseRevocation(tx, ctx.keys);
  // K8: kural kiradaki alanla seçilir — yalnız `parmak-izi-v2` bildiren alıcıya (eski fabrika eski kuralı uygular).
  const fingerprintRule = leaseFingerprintRule(g.acceptedFingerprint, installation.sinif, g.capabilities ?? installationCapabilities(installation));
  const id = randomUUID();
  const issuedAt = new Date(nowMs);
  const expiresAt = new Date(nowMs + ctx.config.KIRA_GUN * DAY_MS);
  const payload: LeaseDoc = {
    v: 1,
    kiraId: id,
    hakId: entitlement.id,
    hakSurum: delivered.surum,
    kurulumId: installation.kurulumId,
    kurulumAnahtarKimligi: keyId,
    parmakIzi: g.acceptedFingerprint,
    verilis: issuedAt.toISOString(),
    bitis: expiresAt.toISOString(),
    sunucuSaati: issuedAt.toISOString(),
    ekSureGun: ctx.config.EK_SURE_GUN,
    zorlama: installation.zorlama,
    gecerlilikBitis: entitlement.gecerlilikBitis ? entitlement.gecerlilikBitis.toISOString() : null,
    yaptirim: {
      kademe: sanction.kademe,
      mesaj: sanction.mesaj,
      kisitlamaTarihi: sanction.kisitlamaTarihi,
      donmusModuller: sanction.donmusModuller,
      guncellemeDonuk: sanction.guncellemeDonuk,
    },
    yoklamaAraligiDk: installation.yoklamaAraligiDk,
    esitlemeAraligiDk: cloud.esitlemeAraligiDk,
    patronBulutBitis: cloud.patronBulutBitis,
    devredildi: installation.durum === "DEVREDILDI",
    kanal: { kod: installation.kanalKodu, guncelSurumler: channelVersionsForLease(channel) },
    altSertifika: key.certificate,
    ...(grants.length > 0 ? { modulAnahtarlari: grants } : {}),
    guncelleme: leaseUpdatePolicy(installation, issuedAt.getTime(), expiresAt.getTime()),
    odenmisTarih: paid.tarih ? paid.tarih.toISOString() : null,
    ...(fingerprintRule ? { parmakIziKurali: fingerprintRule } : {}),
    hakOzeti: jwsDigest(delivered.belge),
    ...(revocation ? { iptalSira: revocation.sira } : {}),
    ...(closing ? { kapanis: closing.reason } : {}),
  };
  const token = signDocument({ typ: TYP.KIRA, schema: LeaseSchema, payload, key: { kid: key.kid, privateKey: key.privateKey } });
  await tx.kira.create({
    data: {
      id,
      kurulumId: installation.id,
      oncekiKiraId: g.previousLeaseId,
      hakId: entitlement.id,
      hakSurum: delivered.surum,
      anahtarKimligi: keyId,
      karar: g.decision,
      istemciParmakIzi: g.clientFingerprint,
      verilis: issuedAt,
      bitis: expiresAt,
      belge: token,
      kapanisNedeni: closing?.reason ?? null,
    },
  });
  return { id, token, sanction, entitlement: delivered, revocation, paidThrough: paid };
}

/**
 * İndirme belirteçleri (kanalın electron/ · mobil/ · backend/ önekleri — `DOWNLOAD_PRODUCTS`). Verilmez: K1
 * (güncelleme donuk), bakım bitmiş (son hak edilen sürümde kalır), kurulum ETKİN değil, indirme anahtarı yok.
 */
export function downloadTokens(
  ctx: VendorContext,
  installation: Kurulum,
  entitlement: Hak,
  sanction: SanctionState,
  nowMs: number,
): { yolOneki: string; belirtec: string }[] {
  if (sanction.guncellemeDonuk || installation.durum !== "ETKIN" || entitlement.bakimBitis.getTime() < nowMs) return [];
  const key = ctx.keys.downloadKey(nowMs);
  if (!key) return [];
  const exp = msToIso(nowMs + ctx.config.INDIRME_OMUR_DK * 60_000);
  return DOWNLOAD_PRODUCTS.map((dir) => {
    const yolOneki = `/${installation.kanalKodu}/${dir}/`;
    return {
      yolOneki,
      belirtec: signDownloadToken({
        payload: { v: 1, kanal: installation.kanalKodu, yolOneki, kurulumId: installation.kurulumId, exp },
        key: { kid: key.kid, privateKey: key.privateKey },
        nowMs,
      }),
    };
  });
}

/** Kurulumun aktif hakkı. */
export async function activeEntitlement(db: Db, installationDbId: string): Promise<Hak> {
  const hak = await db.hak.findFirst({ where: { kurulumId: installationDbId, aktif: true } });
  if (!hak || hak.guncelSurum < 1) throw new VendorError(500, "SUNUCU_HATASI", "Bu kurulum için imzalı lisans (HAK) yok");
  return hak;
}

/**
 * Lisans yanıtı. Etkinleştirme yanıtı lisans kimliğini (`kurulumId`, D14) ve tüketilen kodun türünü taşır. İptal belgesi
 * (varsa) HER yanıta eklenir: kira `iptalSira` beyan ediyorsa fabrika en az o sıradaki belgeyi elinde tutmalı.
 */
export function licenseResponse(g: {
  readonly hak: string | null;
  readonly kira: string;
  readonly tokens: { yolOneki: string; belirtec: string }[];
  readonly nowMs: number;
  readonly installationId?: string;
  readonly codeKind?: ActivationCodeKind;
  readonly revocation?: LeaseRevocation | null;
}): LicenseResponse {
  return LicenseResponseSchema.parse({
    v: 1,
    hak: g.hak,
    kira: g.kira,
    indirmeBelirtecleri: g.tokens,
    sunucuSaati: msToIso(g.nowMs),
    ...(g.installationId === undefined ? {} : { kurulumId: g.installationId }),
    ...(g.codeKind === undefined ? {} : { kodTuru: g.codeKind }),
    ...(g.revocation ? { iptal: g.revocation.belge } : {}),
  });
}
