// ÇEVRİMDIŞI UZATMA DOSYASI (lisans v2 §1.4-3): portal, istek beklemeden zincir ucuna bağlı yeni kirayı (ve teslim
// edilecek HAK'ı) basar, imzalı `LicenseResponse` JSON'u olarak verir; müşteri e-posta/USB ile taşır, panelin "Lisans
// dosyası yükle" düğmesi çevrimdışı yanıt ucuna yollar. Kira uçtaki kiranın çocuğudur (karar DOSYA) ve ucu ilerletir;
// fabrika dosyayı yüklemeden yoklarsa elindeki ebeveyn kira olağan yenilemeyle döner (`lease-chain.ts`). Dosya yeni bir
// süre VERMEZ: P ödeme durumundan türer (`paid-through.ts`) — dosya yalnız bilinen durumu internetsiz fabrikaya taşır.
// Eski dosyayı fabrikanın geri alma kapısı reddeder (LICENSE_LEASE_STALE).
import type { LicenseResponse } from "../lisans-protokol";
import { notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import type { Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { readFingerprint } from "./lease-chain";
import { activeEntitlement, issueLease, licenseResponse } from "./lease.service";

export interface ExtensionFile {
  /** İmzalı yanıt — dosyanın içeriği AYNEN budur (çevrimdışı yanıt ucunun beklediği biçim). */
  readonly dosya: LicenseResponse;
  readonly dosyaAdi: string;
  readonly kiraId: string;
  readonly odenmisTarih: string | null;
}

/** Dosya adı: lisans no + basım günü (UTC) — kullanıcıya yalnız ad; içerik imzalıdır. */
export function extensionFileName(licenseNo: string, nowMs: number): string {
  return `lisans-${licenseNo}-${new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "")}.json`;
}

export async function issueExtensionFileTx(tx: Tx, ctx: VendorContext, g: { installationDbId: string; actor: string; nowMs: number }): Promise<ExtensionFile> {
  await lockInstallation(tx, g.installationDbId);
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  if ((inst.durum !== "ETKIN" && inst.durum !== "DEVREDILDI") || !inst.anahtarKimligi || !inst.sonKiraId) {
    throw stateConflict("Uzatma dosyası yalnız etkinleşmiş kuruluma verilir");
  }
  const openFork = await tx.kopyaUyarisi.findFirst({ where: { kurulumId: inst.id, tur: "ZINCIR_CATALI", durum: "ACIK" }, select: { id: true } });
  if (openFork) throw stateConflict("Açık kira zinciri çatalı varken uzatma dosyası verilmez — önce kopya uyarısını kapatın");
  const tip = await tx.kira.findUniqueOrThrow({ where: { id: inst.sonKiraId } });
  const hak = await activeEntitlement(tx, inst.id);
  const lease = await issueLease(tx, ctx, {
    installation: inst,
    entitlement: hak,
    previousLeaseId: tip.id,
    decision: "DOSYA",
    // İstek yok: ucun ölçümü "isteyen" sayılır (aynı makinenin sonraki yoklaması zincirde kalır).
    clientFingerprint: readFingerprint(tip.istemciParmakIzi),
    acceptedFingerprint: readFingerprint(inst.kabulEdilenParmakIzi),
    nowMs: g.nowMs,
  });
  const claim = await tx.kurulum.updateMany({ where: { id: inst.id, sonKiraId: tip.id }, data: { sonKiraId: lease.id } });
  if (claim.count === 0) throw retryConflict();
  const paid = lease.paidThrough.tarih ? lease.paidThrough.tarih.toISOString() : null;
  await tx.kurulumKaydi.create({
    data: { kurulumId: inst.id, olay: "UZATMA_DOSYASI", anahtarKimligi: inst.anahtarKimligi, ayrinti: { kiraId: lease.id, odenmisTarih: paid }, yapan: g.actor },
  });
  return {
    // Dosya HAK'ı HER ZAMAN taşır: internetsiz fabrikanın elindeki HAK eski olabilir, kira teslim edilen HAK'a bağlıdır.
    dosya: licenseResponse({ hak: lease.entitlement.belge, kira: lease.token, tokens: [], nowMs: g.nowMs, revocation: lease.revocation }),
    dosyaAdi: extensionFileName(hak.lisansNo, g.nowMs),
    kiraId: lease.id,
    odenmisTarih: paid,
  };
}
