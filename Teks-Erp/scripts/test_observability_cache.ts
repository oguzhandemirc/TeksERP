// Audit gözlemlenebilirliği + feature-flag agregat cache davranış testi.
// Çalıştırma:  npx ts-node scripts/test_observability_cache.ts
// Test verisi üzerinde çalışır; pricingEnabled flag'ini geçici toggle eder ve
// ESKİ değerine geri alır. Audit testi bilerek FK-ihlali bir log denemesi yapar
// (yazılmaz, sadece sayaç artar) → DB'ye kalıcı kayıt bırakmaz.
//
// Doğrulananlar:
//   1. getFeatureFlags() ardışık çağrıda önbellekten döner (cache hit): servisi
//      ATLAYAN bir DB yazımı TTL içinde görünmez. Referans eşitliği ölçü DEĞİL — yanıt
//      her çağrıda canlı lisans bloğuyla yeni nesne olarak kurulur.
//   2. setFeatureFlags() cache'i invalidate eder → sonraki getFeatureFlags() TAZE
//      değer döner (bayat cache servis etmez), önbellek yeniden dolar.
//   3. set() (herhangi bir ayar yazımı) cache'i bayatlatır.
//   4. AuditService.log başarısız olursa (FK ihlali) sayaç artar, lastError/
//      lastFailureAt dolar → /health bunu görebilir. Ana akış patlamaz (yutulur).
//   5. invalidateFeatureFlagsCache() tek başına cache'i temizler (servis dışı yazım görünür olur).

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

  const key = SETTING_KEYS.FINANCE_PRICING_ENABLED;
  // Ham satır: geri alma BİREBİR olsun (satır yoktuysa yine yok) — `finally`de.
  fiyatSatiriOnce = await prisma.systemSetting.findUnique({ where: { key } });
  // Servisi (ve önbellek geçersizleştirmesini) ATLAYAN yazım: önbellekten dönen yanıt bunu görmez.
  const dogrudanYaz = (v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });

  // --- 1) Cache hit: servis dışı DB yazımı TTL içinde görünmez ---
  // Yanıt her çağrıda canlı `license` bloğuyla yeni nesnedir (lisans durumu ayar önbelleğinden
  // bağımsız değişir) ⇒ referans eşitliği önbelleği ölçmez; ölçü, DB'nin okunmadığıdır.
  console.log("1) Feature-flag cache hit");
  invalidateFeatureFlagsCache(); // temiz başla
  const r1 = await systemSettingService.getFeatureFlags();
  const original = r1.data!.pricingEnabled;
  await dogrudanYaz(!original);
  const r2 = await systemSettingService.getFeatureFlags();
  check(r2.data!.pricingEnabled === original, "ardışık getFeatureFlags() önbellekten (servis dışı DB yazımı TTL içinde görünmez — cache hit)");
  await dogrudanYaz(original);

  // --- 2) Invalidation + tazelik: setFeatureFlags sonrası taze değer ---
  console.log("2) setFeatureFlags() invalidation + tazelik");
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
  // Önbellek yeniden DOLDU: servis dışı yazım yine TTL içinde görünmez.
  await dogrudanYaz(original);
  const r4 = await systemSettingService.getFeatureFlags();
  check(r4.data!.pricingEnabled === toggled, "set sonrası yeniden cache hit (servis dışı yazım görünmez)");

  // Geri alma `finally`de (`temizleFiyatBayragi`); burada yalnız servis yolundan eski değere dönüş ölçülür.
  await systemSettingService.setFeatureFlags({ pricingEnabled: original }, admin.id);
  const restored = await systemSettingService.getFeatureFlags();
  check(
    restored.data!.pricingEnabled === original,
    `flag eski değerine geri alındı (${original})`
  );

  // --- 3) invalidateFeatureFlagsCache() tek başına çalışır ---
  console.log("3) Manuel invalidate");
  await dogrudanYaz(!original);
  const a = await systemSettingService.getFeatureFlags();
  check(a.data!.pricingEnabled === original, "invalidate ÖNCESİ servis dışı yazım görünmez (önbellek)");
  invalidateFeatureFlagsCache();
  const b = await systemSettingService.getFeatureFlags();
  check(b.data!.pricingEnabled === !original, "invalidateFeatureFlagsCache sonrası DB'den taze değer");
  await dogrudanYaz(original);
  invalidateFeatureFlagsCache();

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
