// KİRA BAĞI KAPISI (genişlik kapısının sonucu, lisans v2) — kira basan HER yol aynı soruyu buradan sorar: teslim seçimi
// (`entitlementForDelivery`) `withheld` döndüğünde alıcının elinde kirayı bağlayabileceği güvenli HAK yoksa (`heldBound`
// değil) kira VERİLMEZ — `hak: null` taşıyan, bağlanamayan kira hiçbir yoldan çıkmaz. Zincir sahibinin yolu (yoklama ·
// DR devri · donanım öğrenmesi · etkinleştirme) güncel şartların kök imzasını kuyruğa alır; bağlanamıyorsa talep ACİL +
// `KOK_IMZASI_ACIL`; fabrika elindeki kirayla P'ye dek sürer (imzasız 403 hiçbir süreyi kısaltmaz). Kapanış kirası (K6)
// kuyruk açmaz — alan taraf zincir sahibi değil — ve bağlanamıyorsa eski 403'e düşer.
import { VendorError } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { findEntitlementForDelivery } from "./lease.service";
import { queueCurrentTermsUnderLock } from "./root-queue.service";

/** Teslim seçiminin kira bağıyla ilgili yarısı (`DeliveredEntitlement` · `DeliverableEntitlement`). */
export interface BindingView {
  readonly withheld?: { readonly heldBound: boolean } | undefined;
}

/** Kira bağlanamaz mı: genişlik kapısı tuttu VE alıcının elindeki HAK kirayı bağlamaya yetmiyor (ya da bilinmiyor). */
export function leaseUnbindable(delivered: BindingView): boolean {
  return delivered.withheld !== undefined && !delivered.withheld.heldBound;
}

/**
 * Kurulum kilidi ALTINDA, zincir sahibinin yolunda: genişlik kapısı tuttuysa güncel şartların kök imzası kuyruğa girer
 * (idempotent) — kira bağlanamıyorsa ACİL + bildirim (talep başına tek). Dönüş: kira bağlanamaz mı (çağıran kira VERMEZ,
 * kayıtlar commit olsun diye sonucu tx'ten döndürüp 403'ü tx dışında atar).
 */
export async function holdForRootSignatureTx(tx: Tx, g: { readonly entitlementId: string; readonly delivered: BindingView; readonly nowMs: number }): Promise<boolean> {
  if (!g.delivered.withheld) return false;
  const unbindable = leaseUnbindable(g.delivered);
  await queueCurrentTermsUnderLock(tx, { entitlementId: g.entitlementId, urgent: unbindable, nowMs: g.nowMs });
  return unbindable;
}

/** Bağlanamayan kiranın reddi: fabrika elindeki kirayla çalışmayı sürdürür (imzasız 403 hiçbir süreyi kısaltmaz). */
export const capabilityDowngradeRefusal = (): VendorError =>
  new VendorError(403, "KIRA_VERILMEDI", "Bu derlemenin tanıyacağı güncel lisans (HAK) satıcının kök imzasını bekliyor; kurulum elindeki kirayla çalışmaya devam eder");

/**
 * Ucuz ön denetim (nonce'tan ve yazmadan ÖNCE) — isteği elindeki HAK'ı bildirmeyen yollar (etkinleştirme · DR devri):
 * kira bağlanamayacaksa istek hiçbir şey yazmadan (kod tüketilmez, devir yazılmaz) durur; yalnız acil kök talebi kendi
 * kilitli tx'inde commit olur. Yetenekler verilmezse kurulum kaydından.
 */
export async function assertBindableBeforeLease(g: {
  readonly installation: { readonly id: string; readonly yetenekler: unknown };
  readonly capabilities?: readonly string[];
  readonly nowMs: number;
  readonly refusal?: () => VendorError;
}): Promise<void> {
  const hak = await prisma.hak.findFirst({ where: { kurulumId: g.installation.id, aktif: true } });
  if (!hak || hak.guncelSurum < 1) return;
  const delivered = await findEntitlementForDelivery(prisma, g.installation, hak, g.capabilities ? { capabilities: g.capabilities } : {});
  if (!delivered || !leaseUnbindable(delivered)) return;
  await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.installation.id);
    await holdForRootSignatureTx(tx, { entitlementId: hak.id, delivered, nowMs: g.nowMs });
  });
  throw (g.refusal ?? capabilityDowngradeRefusal)();
}
