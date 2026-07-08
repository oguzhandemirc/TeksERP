// =============================================================================
// P2 infra bucket testi — F20 (atomik login rezervasyonu) + F29 (boot guard)
// =============================================================================
// Koşum:  DATABASE_URL="postgresql://oad@localhost:5432/adnansahin_p2_test?schema=public" \
//         npx tsx scripts/test_p2_infra.ts
// HTTP yok; modül + prisma doğrudan import. Kendi ayar satırlarını yaratır+temizler.
// =============================================================================

import prisma from "../src/lib/prisma";
import {
  reserveLoginAttempt,
  resetLoginLockout,
} from "../src/middlewares/login-lockout";
import { assertBaseServiceGuards } from "../src/services/base.service";

const SETTING_KEYS = {
  enabled: "auth.pinLockoutEnabled",
  attempts: "auth.pinLockoutAttempts",
  penaltySec: "auth.pinLockoutPenaltySec",
} as const;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? "  → " + extra : ""}`);
  }
}

async function upsertSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}

async function main(): Promise<void> {
  // Ön koşul: kilit AÇIK, attempts=5 (temiz sayı için penalty uzun).
  const ATTEMPTS = 5;
  await upsertSetting(SETTING_KEYS.enabled, true);
  await upsertSetting(SETTING_KEYS.attempts, ATTEMPTS);
  await upsertSetting(SETTING_KEYS.penaltySec, 300);

  // --- F20: 200 paralel reserveLoginAttempt(aynı key) → tam olarak ATTEMPTS kadar
  //     blocked:false; gerisi blocked:true. (Eski check→verify→record akışında
  //     N istek record'dan önce check'i geçip hepsi doğrulamaya sızıyordu.) ---
  const KEY = "test-ip-" + Math.floor(process.hrtime()[1]).toString(36);
  const results = await Promise.all(
    Array.from({ length: 200 }, () => reserveLoginAttempt(KEY)),
  );
  const allowed = results.filter((r) => !r.blocked).length;
  const blocked = results.filter((r) => r.blocked).length;
  check(
    `F20: 200 paralel denemeden tam ${ATTEMPTS} tanesi doğrulamaya geçti`,
    allowed === ATTEMPTS,
    `allowed=${allowed} blocked=${blocked}`,
  );
  check("F20: kalan denemeler bloklandı (429)", blocked === 200 - ATTEMPTS);

  // Bloklu key tekrar denenince blocked:true + retryAfterSec>0.
  const afterBlock = await reserveLoginAttempt(KEY);
  check(
    "F20: eşik aşıldıktan sonra yeni deneme bloklu + retryAfter>0",
    afterBlock.blocked && afterBlock.retryAfterSec > 0,
    JSON.stringify(afterBlock),
  );

  // reset → sayaç sıfırlanır, tekrar ATTEMPTS deneme hakkı doğar.
  resetLoginLockout(KEY);
  const afterReset = await reserveLoginAttempt(KEY);
  check(
    "F20: resetLoginLockout sonrası ilk deneme yeniden serbest",
    !afterReset.blocked,
    JSON.stringify(afterReset),
  );

  // Kilit KAPALI iken her zaman blocked:false (rezervasyon no-op).
  await upsertSetting(SETTING_KEYS.enabled, false);
  const disabled = await Promise.all(
    Array.from({ length: 50 }, () => reserveLoginAttempt("disabled-key")),
  );
  check(
    "F20: kilit kapalıyken tüm denemeler serbest",
    disabled.every((r) => !r.blocked),
  );

  // --- F29: assertBaseServiceGuards DMMF çözülünce fırlatmamalı (mutlu yol). ---
  let guardThrew = false;
  try {
    assertBaseServiceGuards();
  } catch {
    guardThrew = true;
  }
  check("F29: assertBaseServiceGuards() DMMF dolu → fırlatmadı", !guardThrew);
}

main()
  .then(async () => {
    // Cleanup: yarattığımız ayar satırlarını sil (test DB'yi kirletme).
    await prisma.systemSetting.deleteMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("HATA:", err);
    await prisma.systemSetting.deleteMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    }).catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  });
