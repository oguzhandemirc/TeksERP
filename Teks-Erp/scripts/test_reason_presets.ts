// =============================================================================
// Test: HAZIR SEBEP KATALOĞU (2026-08-19)
// =============================================================================
// Katalog koddan DB'ye taşındı (fabrika sebepleri panelden düzenleyebilsin).
// Bu bekçi dört sözleşmeyi kilitler:
//
//   §1 Uzlaştırma: kodu deploy etmek = katalogu getirmek; İKİNCİ koşum hiçbir
//      şeyi değiştirmez ve fabrikanın düzenlemesini EZMEZ.
//   §2 Düzenleme: ad değişir, KOD değişmez; çoğaltma kaynağın altına düşer;
//      son aktif satır gizlenemez.
//   §3 Doğrulama: DB'deki YENİ kod kabul edilir (yoksa fabrika kendi sebebini
//      ekler ama operatör onunla kayıt yapamaz), GİZLİ kod da kabul edilir
//      (bayat listeli tablet vardiya ortasında 400 almamalı), UYDURMA kod
//      reddedilir (fail-closed).
//   §4 Mobil zemin aynası: APK'ya gömülü liste ile sunucu sistem kataloğu
//      birebir — ayrışırsa çevrimdışı tablet başka bir liste gösterir.
// =============================================================================

import { readFileSync } from "fs";
import { join } from "path";
import { ReasonPresetKind, RollVarianceKind } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import {
  ReasonPresetService,
  refreshReasonPresetCache,
} from "../src/services/reason-preset.service";
import {
  REASON_PRESET_CATALOG,
  REASON_PRESET_KINDS,
  MANUAL_ENTRY_REASONS,
  CANCEL_REASONS,
  slugifyReasonCode,
} from "../src/constants/reason-presets";
import { validateVarianceReason } from "../src/constants/variance-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TEST_LABEL = "TEST-SEBEP-" + Date.now();
const created: string[] = [];

async function main(): Promise<void> {
  // ── §1 Uzlaştırma ─────────────────────────────────────────────────────────
  console.log("\n── §1 Boot uzlaştırması ──");
  const first = await reconcileReasonPresets();
  const second = await reconcileReasonPresets();
  check("ikinci koşum HİÇBİR satır eklemiyor (idempotent)", second.created.length === 0);
  check(
    "katalogdaki her sistem satırı DB'de",
    second.existing >= first.total,
    `existing=${second.existing} total=${first.total}`,
  );

  const scrapRows = await prisma.reasonPreset.findMany({
    where: { kind: ReasonPresetKind.ROLL_SCRAP },
    orderBy: { sortOrder: "asc" },
  });
  check(
    "fire listesi 'Top başı' ile BAŞLIYOR (2026-08-19 saha isteği)",
    scrapRows[0]?.code === "TOP_BASI",
    scrapRows.map((r) => r.code).join(","),
  );
  check("körlük zemini: sistem satırı sayısı ≥ 20", first.total >= 20, `total=${first.total}`);

  // Fabrika düzenlemesi EZİLMEZ — en kritik uzlaştırma kuralı.
  const probe = scrapRows.find((r) => r.code === "LEKE")!;
  await prisma.reasonPreset.update({
    where: { id: probe.id },
    data: { label: "FABRİKA DÜZENLEMESİ" },
  });
  await reconcileReasonPresets();
  const afterRecon = await prisma.reasonPreset.findUnique({ where: { id: probe.id } });
  check(
    "fabrikanın düzenlediği etiket uzlaştırmada EZİLMİYOR",
    afterRecon?.label === "FABRİKA DÜZENLEMESİ",
    afterRecon?.label,
  );
  await prisma.reasonPreset.update({ where: { id: probe.id }, data: { label: probe.label } });

  // ── §2 Düzenleme / çoğaltma / gizleme ─────────────────────────────────────
  console.log("\n── §2 Düzenleme sözleşmesi ──");
  const row = await ReasonPresetService.create({
    kind: ReasonPresetKind.ROLL_SCRAP,
    label: TEST_LABEL,
  });
  created.push(row.id);
  check("yeni sebep eklenebiliyor", !!row.id);
  check(
    "kod ETİKETTEN türetiliyor ve ASCII",
    row.code === slugifyReasonCode(TEST_LABEL) && /^[A-Z0-9_]+$/.test(row.code),
    row.code,
  );
  check("fabrika satırı isSystem=false", row.isSystem === false);

  const renamed = await ReasonPresetService.update(row.id, { label: TEST_LABEL + " YENİ" });
  check("ad düzenlenebiliyor", renamed.label === TEST_LABEL + " YENİ");
  check("KOD düzenlemede DEĞİŞMİYOR (rapor anahtarı)", renamed.code === row.code);

  const copy = await ReasonPresetService.duplicate(row.id, TEST_LABEL + " KOPYA");
  created.push(copy.id);
  check("çoğaltma yeni KOD üretiyor", copy.code !== row.code, `${row.code} → ${copy.code}`);
  check(
    "kopya kaynağın HEMEN ALTINA yerleşiyor",
    copy.sortOrder === renamed.sortOrder + 1,
    `${renamed.sortOrder} → ${copy.sortOrder}`,
  );
  check("kopya sistem satırı DEĞİL", copy.isSystem === false);

  // Aynı adla ikinci çoğaltma — kod çakışması sessizce kabul EDİLMEMELİ.
  const copy2 = await ReasonPresetService.duplicate(row.id, TEST_LABEL + " KOPYA");
  created.push(copy2.id);
  check("aynı adlı ikinci kopya AYRI kod alıyor", copy2.code !== copy.code, copy2.code);

  const hidden = await ReasonPresetService.update(copy2.id, { isActive: false });
  check("gizleme satırı silmiyor, işaretliyor", hidden.isActive === false);

  // Son aktif satır gizlenemez — liste boşalırsa operatör sebep seçemez.
  const spare = await prisma.reasonPreset.findMany({
    where: { kind: ReasonPresetKind.ROLL_CANCEL, isActive: true },
    select: { id: true },
  });
  await prisma.reasonPreset.updateMany({
    where: { kind: ReasonPresetKind.ROLL_CANCEL, id: { in: spare.slice(1).map((r) => r.id) } },
    data: { isActive: false },
  });
  let blocked = false;
  try {
    await ReasonPresetService.update(spare[0]!.id, { isActive: false });
  } catch {
    blocked = true;
  }
  check("SON aktif satır gizlenemiyor (liste boş kalamaz)", blocked);
  await prisma.reasonPreset.updateMany({
    where: { kind: ReasonPresetKind.ROLL_CANCEL, id: { in: spare.map((r) => r.id) } },
    data: { isActive: true },
  });

  // ── §3 Doğrulama ──────────────────────────────────────────────────────────
  console.log("\n── §3 Sapma doğrulaması dinamik katalogtan besleniyor ──");
  await refreshReasonPresetCache();
  const okNew = validateVarianceReason(RollVarianceKind.SCRAP, { reasonCode: row.code });
  check(
    "fabrikanın EKLEDİĞİ kod kabul ediliyor (yoksa sebep eklenemez olurdu)",
    okNew.reasonCode === row.code,
  );
  const okHidden = validateVarianceReason(RollVarianceKind.SCRAP, { reasonCode: copy2.code });
  check("GİZLENMİŞ kod da kabul ediliyor (bayat listeli tablet 400 almamalı)", okHidden.reasonCode === copy2.code);

  let rejected = false;
  try {
    validateVarianceReason(RollVarianceKind.SCRAP, { reasonCode: "UYDURMA_KOD_XYZ" });
  } catch {
    rejected = true;
  }
  check("katalog DIŞI kod REDDEDİLİYOR (fail-closed)", rejected);

  const legacy = validateVarianceReason(RollVarianceKind.SCRAP, { reasonCode: "TOP_BASI" });
  check("sistem kodu (TOP_BASI) geçerli", legacy.reasonCode === "TOP_BASI");

  // ── §4 Mobil zemin aynası ─────────────────────────────────────────────────
  console.log("\n── §4 Mobil çevrimdışı zemini aynası ──");
  const mobileDir = join(__dirname, "..", "..", "mobil", "src", "constants");
  const manualSrc = readFileSync(join(mobileDir, "manualReasons.ts"), "utf-8");
  const cancelSrc = readFileSync(join(mobileDir, "cancelReasons.ts"), "utf-8");

  const mobileManual = [...manualSrc.matchAll(/^\s*'([^']+)',$/gm)].map((m) => m[1]);
  check(
    "elle-ekleme metinleri mobil zeminle BİREBİR",
    JSON.stringify(mobileManual) === JSON.stringify(MANUAL_ENTRY_REASONS.map((r) => r.fullText)),
    `mobil=${mobileManual.length} sunucu=${MANUAL_ENTRY_REASONS.length}`,
  );
  check("körlük zemini: mobil elle-ekleme listesi gerçekten okundu", mobileManual.length >= 5);

  const mobileCancel = [...cancelSrc.matchAll(/\{ short: '([^']+)', full: '([^']+)' \}/g)].map((m) => ({
    short: m[1],
    full: m[2],
  }));
  check(
    "iptal sebepleri mobil zeminle BİREBİR (kısa + tam metin)",
    JSON.stringify(mobileCancel) ===
      JSON.stringify(CANCEL_REASONS.map((r) => ({ short: r.label, full: r.fullText }))),
    `mobil=${mobileCancel.length} sunucu=${CANCEL_REASONS.length}`,
  );
  check("körlük zemini: mobil iptal listesi gerçekten okundu", mobileCancel.length >= 5);

  // Kind kapsaması — yeni bir liste eklenip katalogsuz kalmasın.
  check(
    "her ReasonPresetKind'ın sistem satırı var",
    REASON_PRESET_KINDS.every((k) => REASON_PRESET_CATALOG[k].length > 0),
    REASON_PRESET_KINDS.join(","),
  );
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    // Test kendi yarattığını siler (sistem satırlarına DOKUNMAZ).
    if (created.length > 0) {
      await prisma.reasonPreset.deleteMany({ where: { id: { in: created } } });
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
