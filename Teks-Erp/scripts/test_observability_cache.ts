// Audit gözlemlenebilirliği + feature-flag agregat cache davranış testi.
// Çalıştırma:  npx ts-node scripts/test_observability_cache.ts
// Test verisi üzerinde çalışır; pricingEnabled flag'ini geçici toggle eder ve
// ESKİ değerine geri alır. Audit testi bilerek FK-ihlali bir log denemesi yapar
// (yazılmaz, sadece sayaç artar) → DB'ye kalıcı kayıt bırakmaz.
//
// Doğrulananlar:
//   1. getFeatureFlags() ardışık iki çağrıda AYNI data referansı döner (cache hit,
//      15 ayrı findUnique tekrar koşmaz).
//   2. setFeatureFlags() cache'i invalidate eder → sonraki getFeatureFlags() TAZE
//      değer döner (bayat cache servis etmez), referans değişir.
//   3. set() (herhangi bir ayar yazımı) cache'i bayatlatır.
//   4. AuditService.log başarısız olursa (FK ihlali) sayaç artar, lastError/
//      lastFailureAt dolar → /health bunu görebilir. Ana akış patlamaz (yutulur).
//   5. invalidateFeatureFlagsCache() tek başına cache'i temizler.

import prisma from "../src/lib/prisma";
import {
  systemSettingService,
  invalidateFeatureFlagsCache,
  SETTING_KEYS,
} from "../src/services/system-setting.service";
import { AuditService } from "../src/services/audit.service";

let pass = 0;
let fail = 0;

function check(cond: boolean, label: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

/** `pricingEnabled` ham satırının bekçi ÖNCESİ hâli; `undefined` = dokunulmadı, `null` = satır yoktu. */
let fiyatSatiriOnce: { value: unknown } | null | undefined;

/** Teardown: fiyat bayrağı satırı BİREBİR eski hâline (satır yoktuysa silinir) + önbellek tazelenir. */
async function temizleFiyatBayragi(): Promise<void> {
  if (fiyatSatiriOnce === undefined) return;
  const key = SETTING_KEYS.FINANCE_PRICING_ENABLED;
  if (fiyatSatiriOnce) await prisma.systemSetting.update({ where: { key }, data: { value: fiyatSatiriOnce.value as never } });
  else await prisma.systemSetting.deleteMany({ where: { key } });
  invalidateFeatureFlagsCache();
}

async function main(): Promise<void> {
  const admin =
    (await prisma.user.findFirst({ where: { username: "admin" } })) ??
    (await prisma.user.findFirst());
  if (!admin) throw new Error("Test için en az bir kullanıcı (admin) gerekli.");

  // --- 1) Cache hit: iki ardışık çağrı aynı data referansını döndürür ---
  console.log("1) Feature-flag cache hit");
  invalidateFeatureFlagsCache(); // temiz başla
  const r1 = await systemSettingService.getFeatureFlags();
  const r2 = await systemSettingService.getFeatureFlags();
  check(r1.data === r2.data, "ardışık getFeatureFlags() aynı data referansı (cache hit)");

  // --- 2) Invalidation + tazelik: setFeatureFlags sonrası taze değer ---
  console.log("2) setFeatureFlags() invalidation + tazelik");
  const original = r1.data!.pricingEnabled;
  // Ham satır: geri alma BİREBİR olsun (satır yoktuysa yine yok) — `finally`de.
  fiyatSatiriOnce = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_PRICING_ENABLED } });
  const toggled = !original;
  const afterSet = await systemSettingService.setFeatureFlags(
    { pricingEnabled: toggled },
    admin.id
  );
  check(
    afterSet.data!.pricingEnabled === toggled,
    `setFeatureFlags dönüşü taze değer (${original} → ${toggled})`
  );
  const r3 = await systemSettingService.getFeatureFlags();
  check(
    r3.data!.pricingEnabled === toggled,
    "set sonrası getFeatureFlags TAZE değer (bayat cache servis etmedi)"
  );
  check(r3.data !== r1.data, "set sonrası data referansı değişti (cache yenilendi)");
  // sonraki çağrı yine cache hit olmalı (referans r3 ile aynı)
  const r4 = await systemSettingService.getFeatureFlags();
  check(r4.data === r3.data, "yeniden cache hit (TTL içinde aynı referans)");

  // Geri alma `finally`de (`temizleFiyatBayragi`); burada yalnız servis yolundan eski değere dönüş ölçülür.
  await systemSettingService.setFeatureFlags({ pricingEnabled: original }, admin.id);
  const restored = await systemSettingService.getFeatureFlags();
  check(
    restored.data!.pricingEnabled === original,
    `flag eski değerine geri alındı (${original})`
  );

  // --- 3) invalidateFeatureFlagsCache() tek başına çalışır ---
  console.log("3) Manuel invalidate");
  const a = await systemSettingService.getFeatureFlags();
  invalidateFeatureFlagsCache();
  const b = await systemSettingService.getFeatureFlags();
  check(a.data !== b.data, "invalidateFeatureFlagsCache sonrası yeni referans");

  // --- 4) Audit failure sayacı: best-effort log düşerse /health görür ---
  console.log("4) Audit hata sayacı");
  const before = AuditService.getHealth().failureCount;
  // Var olmayan userId → SystemLog.userId FK ihlali → log içeride catch'lenir.
  await AuditService.log({
    userId: "00000000-0000-0000-0000-000000000000",
    action: "CREATE",
    tableName: "TEST_OBSERVABILITY",
    recordId: "fk-violation-on-purpose",
    newData: { note: "bu log bilerek başarısız olmalı" },
  });
  const health = AuditService.getHealth();
  check(health.failureCount === before + 1, `failureCount arttı (${before} → ${health.failureCount})`);
  check(health.lastError !== null, "lastError dolduruldu");
  check(health.lastFailureAt !== null, "lastFailureAt dolduruldu");

  // Ana akış patlamadı (buraya geldiysek log yutuldu) — başarılı log sayacı artırmaz.
  const before2 = AuditService.getHealth().failureCount;
  await AuditService.log({
    userId: admin.id,
    action: "CREATE",
    tableName: "TEST_OBSERVABILITY",
    recordId: "valid-log",
    newData: { note: "bu log başarılı" },
  });
  check(
    AuditService.getHealth().failureCount === before2,
    "başarılı log sayacı ARTIRMADI (sadece hatalar sayılır)"
  );
  // bıraktığı geçerli test log'unu temizle
  await prisma.systemLog
    .deleteMany({ where: { tableName: "TEST_OBSERVABILITY" } })
    .catch(() => {});

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
}

main()
  .catch((e) => {
    console.error("Test hatası:", e);
    fail++;
  })
  .finally(async () => {
    await temizleFiyatBayragi().catch((e) => { console.error("bayrak geri alınamadı:", e); fail++; });
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
