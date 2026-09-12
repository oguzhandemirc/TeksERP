// =============================================================================
// MODÜL BAYRAĞI FIXTURE'I (bekçi altyapısı — test DEĞİL)
// =============================================================================
// NEDEN VAR: 2026-09-02'de iplik kg defterinin kapısı SERVİS düzeyine indi —
// `applyYarnMovementTx` gövdesinin ilk işi `readIplikEnabled` (route kapısı
// yetmiyordu: mal kabul ve stok sayımı meşru olarak yalnız `requireTicaretEnabled`
// taşır ve ticaret AÇIK + iplik KAPALI bir kurulumda kg defterine yazmaya devam
// ediyorlardı — ölçüldü). Fabrika profilinde iplik KAPALI olduğu için, iplik
// hareketi yazan her test artık 403 alır.
//
// ⚠️ BU BİR "TESTİ GEÇİRME" HİLESİ DEĞİL, ORTAM KURULUMUDUR. İplik defterini
// ölçen bir test, iplik modülünü KULLANAN bir kurulumu taklit etmek zorundadır;
// aksi hâlde ölçtüğü şey defterin davranışı değil, kapının davranışı olur (ve
// kapının kendi bekçileri zaten var: `test_iplik_regime_gate §4d` +
// `test_module_flag_off`). Kapıyı testler için gevşetmek ise asıl yanlış
// olurdu — o zaman sahadaki sızıntı hiçbir bekçide görünmezdi.
//
// ⚠️ GLOBAL DURUM YAZAR: bayraklar süreç boyunca AÇIK kalır ve dönen fonksiyon
// onları BULDUĞU değere geri yazar. `finally` bloğunda ÇAĞRILMASI ZORUNLU —
// çağrılmazsa test DB'si iplik AÇIK kalır ve `test_module_grandfathering §2d`
// bir sonraki koşumda "damga izi bozuldu" diye kapsamını kaybeder.
//
// ⚠️ SIRA LOAD-BEARING (`MODULE_DEPENDENCIES.iplikEnabled = ticaretEnabled`):
// açarken ÖNCE ticaret, kapatırken ÖNCE iplik. Ters sırada `setFeatureFlags`
// 400 verir ve fixture "kuramadım" yerine "500" diye düşer.
//
// TÜKETİCİLER: test_yarn_stock · test_goods_receipt · test_stock_count ·
// test_purchase_order (iplik kalemli kabul/rollup ölçen dört test).
// =============================================================================
import prisma from "../src/lib/prisma";
import { systemSettingService } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

/** Ham DB değeri — `getFeatureFlags` 30 sn önbellekli, fixture ona güvenemez. */
async function hamOku(key: string): Promise<boolean> {
  const s = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  return s?.value === true || s?.value === "true";
}

/** Satırın VARLIĞI — değerinden ayrı bir durum ve geri yüklemenin parçası. */
async function satirVarMi(key: string): Promise<boolean> {
  return (await prisma.systemSetting.findUnique({ where: { key }, select: { key: true } })) !== null;
}

/**
 * `setFeatureFlags` bir KULLANICI ister (`if (!userId) throw unauthorized()`) —
 * ayar değişikliği audit'e "kim yaptı" ile yazılır ve o alan opsiyonel değildir.
 *
 * ⚠️ Fixture ayarı DOĞRUDAN `system_settings`e yazmıyor, servisten geçiyor:
 * doğrudan yazım bağımlılık doğrulamasını (`iplik → ticaret`) atlar ve fixture
 * bir gün tutarsız çift üretirse bunu HİÇBİR ŞEY söylemezdi. Bedeli, audit'te
 * bir kullanıcı adı gerekmesi — "admin", yoksa herhangi bir aktif kullanıcı.
 */
async function audituKullanici(): Promise<string> {
  const u =
    (await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } })) ??
    (await prisma.user.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }));
  if (!u) {
    throw new Error(
      "fixture-module-flags: aktif kullanıcı yok — `setFeatureFlags` audit için userId ister",
    );
  }
  return u.id;
}

/**
 * Ticaret + iplik modüllerini AÇAR, önceki duruma dönen bir fonksiyon döner.
 *
 * Kullanım:
 * ```
 * const modulGeriAl = await ensureIplikModuluAcik();
 * try { … } finally { await modulGeriAl(); }
 * ```
 */
export async function ensureIplikModuluAcik(): Promise<() => Promise<void>> {
  // Yazmadan ÖNCE hedef DB kapısı — `.env` yanlış DB'yi gösteriyorsa gürültülü dur.
  const dbEngeli = hedefDbEngeli();
  if (dbEngeli) throw new Error(`fixture-module-flags DURDURULDU: ${dbEngeli}`);
  const uid = await audituKullanici();
  // ⚠️ İKİ AYRI DURUM: "satır var ve false" ile "satır YOK" aynı DEĞERİ okutur
  // ama aynı DURUM değildir. Geri yükleme `false` YAZARSA olmayan satır DOĞAR ve
  // taze kurulumda kalır — "boş kurulumda modül satırı yok" diyen bekçiler
  // (`test_module_flag_off §3`, `test_module_grandfathering §2b`) kırmızıya döner.
  // Ölçüldü 2026-09-12 (CI-biçimli koşum): `teks_ci`de tam bu oldu.
  const ilkTicaret = await hamOku("ticaret.enabled");
  const ilkIplik = await hamOku("iplik.enabled");
  const ticaretSatiriVardi = await satirVarMi("ticaret.enabled");
  const iplikSatiriVardi = await satirVarMi("iplik.enabled");
  if (!ilkTicaret) await systemSettingService.setFeatureFlags({ ticaretEnabled: true }, uid);
  if (!ilkIplik) await systemSettingService.setFeatureFlags({ iplikEnabled: true }, uid);

  return async () => {
    if (!ilkIplik) {
      if (iplikSatiriVardi) await systemSettingService.setFeatureFlags({ iplikEnabled: false }, uid);
      else await prisma.systemSetting.deleteMany({ where: { key: "iplik.enabled" } });
    }
    if (!ilkTicaret) {
      if (ticaretSatiriVardi) await systemSettingService.setFeatureFlags({ ticaretEnabled: false }, uid);
      else await prisma.systemSetting.deleteMany({ where: { key: "ticaret.enabled" } });
    }
  };
}
