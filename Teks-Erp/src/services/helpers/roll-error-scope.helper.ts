// =============================================================================
// RollError KARAR KAPSAMI — tek kaynak (K4P-KAPSAM, 2026-10-25)
// =============================================================================
// NEDEN: `RollError` iki kökenli (K4P-SEMA). PROCESS = KK2/Kurşun/Tambur hatası,
// Tambur kararına girer; INSPECTION = 4 puan muayene belgesinin parçası, metresiz
// olabilir ve `isProcessed` hep false (CHECK). Karar/aksiyon yolu (Tambur listesi,
// yetim kapatma, bypass uygunluğu, bekleyen sayısı) muayene satırını görürse
// Tambur'a metresiz hata düşer, NO_CUT kapatması CHECK'e çarpar.
//
// ÜÇ ŞEKİL AYNI KURALI SÖYLER VE BİRLİKTE DEĞİŞİR (`quality-station.helper` emsali):
//   (a) Prisma where parçası  → `{ ...ACTIONABLE_ROLL_ERROR_WHERE, rollId, … }`
//   (b) bellek-içi yüklem     → `isActionableRollError(e)`
//   (c) ham SQL parçası       → `AND ${ACTIONABLE_ROLL_ERROR_SQL}` (tablo takma adı `re`)
// Tarihçe/denetim yolları iki kökeni de görür; bu muafiyet
// `scripts/lib/roll-error-kapsam-beyan.ts`te beyanlıdır.
// Bekçi: `scripts/test_roll_error_kapsam.ts` (AST) · `test_roll_error_kapsam_db.ts`.
// ⚠️ Nesne MUTATE EDİLMEZ — her zaman spread ile kopyalanır.
// =============================================================================

import { Prisma, RollErrorOrigin } from "@prisma/client";

/** Karar yolunun gördüğü köken — üç şeklin ortak tek değeri. */
export const ACTIONABLE_ROLL_ERROR_ORIGIN = RollErrorOrigin.PROCESS;

export const ACTIONABLE_ROLL_ERROR_WHERE = {
  origin: ACTIONABLE_ROLL_ERROR_ORIGIN,
} satisfies Prisma.RollErrorWhereInput;

export function isActionableRollError(e: { origin: RollErrorOrigin }): boolean {
  return e.origin === ACTIONABLE_ROLL_ERROR_ORIGIN;
}

/** Ham SQL ikizi; sorguda `roll_errors` takma adı `re` OLMALI. */
export const ACTIONABLE_ROLL_ERROR_SQL = Prisma.sql`re."origin" = ${Prisma.raw(`'${ACTIONABLE_ROLL_ERROR_ORIGIN}'`)}::"RollErrorOrigin"`;
