// ETKİNLEŞTİRME — tek kullanımlık kod (atomik claim) + kurulum anahtarı kaydı + HAK + KİRA.
// Kod portalda KURULUMA bağlı doğar; kimliksiz istekte (D14) kurulumu KOD belirler, kimlik taşıyan istekte
// kod o kurulumun olmalı (başkasınınki "yok" sayılır). Yanıt lisans kimliğini (`kurulumId`) ve kod türünü taşır.
// Kod türü (D8): `ilk` hiç etkinleşmemiş kurulumu açar ya da aynı anahtarla yeniden etkinleştirir — başka
// anahtarla ETKİN kuruluma 409 TASIMA_KODU_GEREKLI (kod TÜKETİLMEZ); `tasima` kodu yalnız onaylanan talebin
// anahtarıyla kullanılır, anahtar o anda değişir (eski anahtar emekli: sonraki isteği 403) ve zincir yeniden başlar.
// Aynı kod + aynı anahtarla tekrar (ağ tekrarı) aynı kirayı alır; başka anahtarla ikinci kullanım 409.
// İlk kurulum kabulü (Ek-7 §5): kodu TÜKETECEK istek kurulum imzalı kabul belgesi taşımalı (yoksa 409 KABUL_GEREKLI);
// kabul etkinleştirmeyle aynı tx'te kurulum kaydına `SOZLESME_KABUL_EDILDI` olarak yazılır. Kapı iki yerde: ucuz ön
// denetim (nonce'tan önce) ve kodu tüketen claim'in kendisi (tx içi, taze satırla).
import type { EtkinlestirmeKodu, KodTuru, Kurulum, Prisma, TasimaTalebi } from "@prisma/client";
import { ENDPOINTS, verifyAcceptance, type AcceptanceDoc, type AcceptanceRejection, type ActivateRequest, type LicenseResponse } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";
import { bodyKeyRole, installationCancelled, recordRequestNonce, verifySignedRequest, type KeyRole } from "./installation-auth";
import { storableSequence } from "./local-intervention";
import {
  activeEntitlement,
  computeSanctionState,
  downloadTokens,
  issueLease,
  leaseEntitlement,
  leaseRevocation,
  licenseResponse,
} from "./lease.service";

const codeInvalid = (reason: string): VendorError => new VendorError(404, "ETKINLESTIRME_KODU_GECERSIZ", reason);
const codeUsed = (): VendorError => new VendorError(409, "ETKINLESTIRME_KODU_KULLANILMIS", "Bu etkinleştirme kodu daha önce kullanıldı");
const transferCodeRequired = (): VendorError =>
  new VendorError(409, "TASIMA_KODU_GEREKLI", "Bu kurulum başka bir makinede etkin: yeni makine yalnız onaylı taşıma koduyla etkinleşir (portaldan taşıma talebi)");

/** Kurulum kaydındaki olay adı — kabul, etkinleştirmeyle aynı tx'te ve ondan 1 ms önce yazılır. */
export const ACCEPTANCE_EVENT = "SOZLESME_KABUL_EDILDI";

const ACCEPTANCE_MESSAGES: Readonly<Record<AcceptanceRejection, string>> = {
  YOK: "Etkinleştirme için ilk kurulum sözleşme kabulü gerekli: panelin Lisans ekranında kabul adımını tamamlayın (kabul adımı olmayan eski panel ya da sunucu sürümü güncellenmeli)",
  IMZA: "Sözleşme kabul belgesi bu kurulumun anahtarıyla doğrulanamadı; kabul adımını bu sunucuda yeniden yapın",
  SEMA: "Sözleşme kabul belgesi biçimsiz; kabul adımını yeniden yapın",
  METIN: "Kabul edilen sözleşme metni sürümü lisans sunucusunda tanınmıyor; satıcıyla görüşün",
  KUTU: "Sözleşme kabul belgesi metnin bütün onay kutularını taşımıyor; kabul adımını yeniden yapın",
};

interface VerifiedAcceptance {
  readonly doc: AcceptanceDoc;
  /** İmzalı belgenin kendisi — kurulum kaydına kanıt olarak girer. */
  readonly belge: string;
}

const acceptanceRequired = (neden: AcceptanceRejection): VendorError => new VendorError(409, "KABUL_GEREKLI", ACCEPTANCE_MESSAGES[neden], { neden });

/** Kodu tüketecek etkinleştirmenin kabul kapısı — saf, nonce ve kilitten ÖNCE koşar (red defter tüketmez). */
function requireAcceptance(body: ActivateRequest): VerifiedAcceptance {
  const r = verifyAcceptance(body.kabul, { publicKeyX: body.acikAnahtar });
  if (!r.ok || !body.kabul) throw acceptanceRequired(r.ok ? "YOK" : r.neden);
  return { doc: r.doc, belge: body.kabul };
}

type CodeWithTransfer = EtkinlestirmeKodu & { tasimaTalebi: TasimaTalebi | null };

/**
 * Durum ön denetimi (kilitsiz, yan etkisiz; kilit altında AYNEN yinelenir): tüketilmemiş kod bu kuruluma bu
 * anahtarla kullanılabilir mi? Tüketilmiş kodun tekrar kararı ayrı (`replayOrConflict`).
 */
function assertUsable(g: { code: CodeWithTransfer; inst: Kurulum; kid: string; role: KeyRole; nowMs: number }): void {
  const { code, inst, kid, role, nowMs } = g;
  if (role === "RETIRED" || inst.durum === "IPTAL" || inst.durum === "DEVREDILDI") {
    throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum etkinleştirilemez (taşındı, devredildi ya da iptal)");
  }
  if (code.gecerlilikBitis.getTime() < nowMs) throw codeInvalid("Etkinleştirme kodunun süresi dolmuş");
  if (code.tur === "ilk") {
    if (inst.durum === "ETKIN" && inst.anahtarKimligi !== kid) throw transferCodeRequired();
    return;
  }
  if (inst.durum !== "ETKIN") throw new VendorError(403, "KURULUM_IPTAL", "Taşıma kodu yalnız etkin kurulumda kullanılır");
  if (code.tasimaTalebi?.yeniAnahtarKimligi !== kid) throw codeInvalid("Bu taşıma kodu başka bir makinenin talebine ait");
}

/** Tüketilmiş kodu aynı anahtar yeniden sunduysa önceki sonucu döner; aksi hâlde 409. */
async function replayOrConflict(tx: Tx, ctx: VendorContext, code: EtkinlestirmeKodu, inst: Kurulum, kid: string, nowMs: number): Promise<LicenseResponse> {
  if (code.kullananAnahtarKimligi !== kid || inst.anahtarKimligi !== kid || !code.kiraId) throw codeUsed();
  const lease = await tx.kira.findUniqueOrThrow({ where: { id: code.kiraId } });
  const hak = await activeEntitlement(tx, inst.id);
  const sanction = await computeSanctionState(tx, inst.id);
  return licenseResponse({
    // Tekrar AYNI kirayı verir: HAK da o kiranın bağlı olduğu sürümdür (`hakOzeti` tutsun).
    hak: (await leaseEntitlement(tx, lease)).belge,
    kira: lease.belge,
    tokens: downloadTokens(ctx, inst, hak, sanction, nowMs),
    nowMs,
    installationId: inst.kurulumId,
    codeKind: code.tur,
    revocation: await leaseRevocation(tx, ctx.keys),
  });
}

interface Activated {
  readonly response: LicenseResponse;
  readonly installationDbId: string;
  readonly codeId: string;
  readonly kind: KodTuru;
  readonly event: "ETKINLESTI" | "YENIDEN_ETKINLESTI" | "TASINDI";
}

/** Kilitli tx gövdesi; dışa açık yalnız bekçi içindir (`test_etkinlestirme_kabul` §7 tx içi kabul kapısını sınar). */
export async function activateInTx(
  tx: Tx,
  ctx: VendorContext,
  g: { codeId: string; installationDbId: string; kid: string; body: ActivateRequest; acceptance: VerifiedAcceptance | null; nowMs: number },
): Promise<{ kind: "replay"; response: LicenseResponse } | { kind: "activated"; activated: Activated }> {
  await lockInstallation(tx, g.installationDbId);
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
  const code = await tx.etkinlestirmeKodu.findUniqueOrThrow({ where: { id: g.codeId }, include: { tasimaTalebi: true } });
  if (code.durum === "IPTAL") throw codeInvalid("Etkinleştirme kodu geçersiz");
  if (code.durum === "KULLANILDI") {
    if (inst.durum === "IPTAL" || inst.durum === "DEVREDILDI") throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum etkinleştirilemez (devredildi ya da iptal)");
    return { kind: "replay", response: await replayOrConflict(tx, ctx, code, inst, g.kid, g.nowMs) };
  }
  assertUsable({ code, inst, kid: g.kid, role: await bodyKeyRoleTx(tx, inst, g.kid), nowMs: g.nowMs });
  // Ön denetim tx DIŞI okumayla karar verdi (kod tüketilmiş göründüyse kabul sorulmadı); kodu tüketen claim kabulsüz koşmaz.
  if (!g.acceptance) throw acceptanceRequired("YOK");
  const claim = await tx.etkinlestirmeKodu.updateMany({
    where: { id: code.id, durum: "AKTIF" },
    data: { durum: "KULLANILDI", kullanimZamani: new Date(g.nowMs), kullananAnahtarKimligi: g.kid },
  });
  if (claim.count === 0) {
    const fresh = await tx.etkinlestirmeKodu.findUniqueOrThrow({ where: { id: code.id } });
    return { kind: "replay", response: await replayOrConflict(tx, ctx, fresh, inst, g.kid, g.nowMs) };
  }
  const hak = await activeEntitlement(tx, inst.id);
  const keyChanged = inst.durum === "ETKIN" && inst.anahtarKimligi !== g.kid;
  const event: Activated["event"] = code.tur === "tasima" ? "TASINDI" : inst.durum === "ETKIN" ? "YENIDEN_ETKINLESTI" : "ETKINLESTI";
  // Aynı tx'te aynı kuruluma iki satır: kronoloji belirlenimli (kabul → etkinleşme, +1 ms), `now()` ikisine eşit verirdi.
  const [{ simdi }] = await tx.$queryRaw<{ simdi: Date }[]>`SELECT now() AS simdi`;
  if (g.acceptance) await recordAcceptance(tx, { installationDbId: inst.id, kid: g.kid, codeId: code.id, acceptance: g.acceptance, at: simdi });
  await tx.kurulumKaydi.create({
    data: {
      createdAt: new Date(simdi.getTime() + 1),
      kurulumId: inst.id,
      olay: event,
      anahtarKimligi: g.kid,
      acikAnahtar: g.body.acikAnahtar,
      eskiAnahtarKimligi: keyChanged ? inst.anahtarKimligi : null,
      eskiAcikAnahtar: keyChanged ? inst.acikAnahtar : null,
      ayrinti: {
        kodId: code.id,
        kodTuru: code.tur,
        ...(code.tasimaTalebiId ? { talepId: code.tasimaTalebiId } : {}),
        platform: g.body.ortam.platform,
        uygulamaSurum: g.body.ortam.uygulamaSurum,
        // Faz 2d: yeni anahtar (taşıma) eski makinenin X25519'unu devralmaz — yoksa null yazılır.
        sifrelemeAnahtari: g.body.sifrelemeAnahtari ?? null,
      },
      yapan: "kurulum",
    },
  });
  const updated = await tx.kurulum.updateMany({
    where: { id: inst.id, durum: inst.durum, sonKiraId: inst.sonKiraId, anahtarKimligi: inst.anahtarKimligi },
    data: {
      durum: "ETKIN",
      acikAnahtar: g.body.acikAnahtar,
      anahtarKimligi: g.kid,
      sifrelemeAnahtari: g.body.sifrelemeAnahtari ?? null,
      kabulEdilenParmakIzi: g.body.parmakIzi,
      platform: g.body.ortam.platform,
      sonOrtam: g.body.ortam,
      etkinlesmeZamani: new Date(g.nowMs),
      sonKiraId: null,
      // Lisans v2: yetenekler ve durum kaydı sırasının TABANI etkinleştirmede yeniden kurulur (yeni makine sıfırdan sayar).
      yetenekler: [...(g.body.yetenekler ?? [])],
      sonDurumSirasi: storableSequence(g.body.durumKaydi) ?? null,
    },
  });
  if (updated.count === 0) throw retryConflict();
  const fresh = await tx.kurulum.findUniqueOrThrow({ where: { id: inst.id } });
  const lease = await issueLease(tx, ctx, {
    installation: fresh,
    entitlement: hak,
    previousLeaseId: null,
    decision: code.tur === "tasima" ? "TASIMA" : "ETKINLESTIRME",
    clientFingerprint: g.body.parmakIzi,
    acceptedFingerprint: g.body.parmakIzi,
    nowMs: g.nowMs,
  });
  const tip = await tx.kurulum.updateMany({ where: { id: inst.id, sonKiraId: null }, data: { sonKiraId: lease.id } });
  if (tip.count === 0) throw retryConflict();
  await tx.etkinlestirmeKodu.update({ where: { id: code.id }, data: { kiraId: lease.id } });
  // Eski anahtarın zil aboneliği "şimdi yokla" duyar → sonraki yoklaması 403 KURULUM_IPTAL.
  if (keyChanged) await notifyDoorbell(tx, inst.id, "lisans");
  return {
    kind: "activated",
    activated: {
      response: licenseResponse({
        hak: lease.entitlement.belge,
        kira: lease.token,
        tokens: downloadTokens(ctx, fresh, hak, lease.sanction, g.nowMs),
        nowMs: g.nowMs,
        installationId: fresh.kurulumId,
        codeKind: code.tur,
        revocation: lease.revocation,
      }),
      installationDbId: inst.id,
      codeId: code.id,
      kind: code.tur,
      event,
    },
  };
}

/** Kabul kurulum kaydına: kimlik fabrikanın `kabulId`si (aynı kabul ikinci etkinleştirmede yeniden yazılmaz). */
async function recordAcceptance(tx: Tx, g: { installationDbId: string; kid: string; codeId: string; acceptance: VerifiedAcceptance; at: Date }): Promise<void> {
  const d = g.acceptance.doc;
  const detail: Prisma.InputJsonObject = {
    kabulId: d.kabulId,
    metin: d.metin,
    kutular: d.kutular,
    kabulEden: d.kabulEden,
    zaman: d.zaman,
    istemci: d.istemci,
    sunucuSurum: d.sunucuSurum,
    kodId: g.codeId,
    // İmzalı kabul belgesinin kendisi (kod TAŞIMAZ): kanıt kurulum anahtarıyla sonradan da doğrulanır.
    belge: g.acceptance.belge,
  };
  await tx.kurulumKaydi.createMany({
    data: [{ kurulumId: g.installationDbId, olay: ACCEPTANCE_EVENT, anahtarKimligi: g.kid, ayrinti: detail, yapan: "kurulum", kaynakKayitId: d.kabulId, createdAt: g.at }],
    skipDuplicates: true,
  });
}

/** Kilit altındaki taze rol (emekli anahtar tx içinde okunur). */
async function bodyKeyRoleTx(tx: Tx, inst: Kurulum, kid: string): Promise<KeyRole> {
  if (inst.anahtarKimligi === kid) return "CURRENT";
  const retired = await tx.kurulumKaydi.count({ where: { kurulumId: inst.id, eskiAnahtarKimligi: kid } });
  return retired > 0 ? "RETIRED" : "BODY";
}

/**
 * Uç (gövde KATI şemadan geçmiş): imza (gövdedeki anahtar) → kod → ucuz ön denetimler → kurulum hız sınırı →
 * nonce → kilitli tx. Ön denetimler nonce'tan ve kilitten ÖNCE: reddedilecek istek kilit/defter tüketmez.
 */
export async function handleActivation(
  ctx: VendorContext,
  g: { header: unknown; rawBody: Buffer; body: ActivateRequest; nowMs: number; limit?: (scope: string) => void; path?: string },
): Promise<LicenseResponse> {
  const body = g.body;
  const verified = await verifySignedRequest({
    header: g.header,
    rawBody: g.rawBody,
    purposes: ["etkinlestir"],
    nowMs: g.nowMs,
    keyFromBody: body.acikAnahtar,
    path: g.path ?? ENDPOINTS.ACTIVATE,
  });
  if ((body.kurulumId ?? null) !== (verified.request.kurulumId ?? null)) {
    throw new VendorError(401, "ISTEK_KURULUM", "Gövdedeki kurulum kimliği imzalı istekle uyuşmuyor");
  }
  const code = await prisma.etkinlestirmeKodu.findUnique({
    where: { kodOzeti: ctx.codeHasher.digest(body.kod) },
    include: { kurulum: true, tasimaTalebi: true },
  });
  // Kimlik taşıyan istekte başka kurulumun kodu "yok"tur (varlığı sızdırılmaz).
  if (!code || !code.kurulum.aktif || code.durum === "IPTAL" || (verified.installation && verified.installation.id !== code.kurulumId)) {
    throw codeInvalid("Etkinleştirme kodu geçersiz");
  }
  const inst = code.kurulum;
  const role = verified.installation ? verified.role : await bodyKeyRole(inst, verified.kid);
  if (role === "RETIRED") throw installationCancelled();
  if (code.durum === "AKTIF") assertUsable({ code, inst, kid: verified.kid, role, nowMs: g.nowMs });
  else if (inst.durum === "IPTAL" || inst.durum === "DEVREDILDI") throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum etkinleştirilemez (devredildi ya da iptal)");
  else if (code.kullananAnahtarKimligi !== verified.kid) throw codeUsed();
  // Yalnız kodu TÜKETECEK istek kabul ister: tüketilmiş kodun ağ tekrarı önceki sonucu alır (kabul o gün yazıldı).
  const acceptance = code.durum === "AKTIF" ? requireAcceptance(body) : null;
  g.limit?.(inst.id);
  await recordRequestNonce({ installationDbId: inst.id, kid: verified.kid, request: verified.request, nowMs: g.nowMs });
  const result = await prisma.$transaction((tx) =>
    activateInTx(tx, ctx, { codeId: code.id, installationDbId: inst.id, kid: verified.kid, body, acceptance, nowMs: g.nowMs }),
  );
  if (result.kind === "replay") return result.response;
  const a = result.activated;
  await recordAudit({
    event: a.event === "TASINDI" ? "KURULUM_TASINDI" : a.event === "YENIDEN_ETKINLESTI" ? "KURULUM_YENIDEN_ETKINLESTI" : "KURULUM_ETKINLESTI",
    entity: "Kurulum",
    entityId: a.installationDbId,
    actor: "kurulum",
    summary: { kodId: a.codeId, kodTuru: a.kind, anahtarKimligi: verified.kid, kabulId: acceptance?.doc.kabulId ?? null },
  });
  return a.response;
}
