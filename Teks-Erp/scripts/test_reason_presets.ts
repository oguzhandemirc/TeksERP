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
//   §5 Sebep KODU çözücü (2026-08-21, metin saklayan iki kind): gelen metin
//      label/fullText ile KATLANMIŞ eşlenir (İ/ı, büyük/küçük), gizli satır da
//      eşleşir, serbest metne kod UYDURULMAZ (null), açık kod katalogda
//      doğrulanır (uydurma → REASON_CODE_INVALID), açık kod + boş metin →
//      metin preset'ten dolar, açık kod + metin → metin EZİLMEZ.
//   §6 ESKİ ADLAR (`legacyTexts`): etiket/metin düzenlenince eskisi listeye
//      düşer; bayat tablet eski metni gönderince kod YİNE çözülür; güncel ad
//      eski ada karşı önceliklidir; iki satırda aynı eski ad → belirsiz → null;
//      sınır 20; metin dışı düzenleme listeye dokunmaz; eski ada geri dönüş
//      listeyi temizler. Sistem satırı için çevrimdışı zemin (seed metni) senaryosu.
// =============================================================================

import { readFileSync } from "fs";
import { join } from "path";
import { ReasonPresetKind, RollVarianceKind } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import {
  ReasonPresetService,
  refreshReasonPresetCache,
  resolveReasonCode,
  resolveReasonCodeFromText,
  assertKnownReasonCode,
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

  // ── §5 Sebep KODU çözücü (metin saklayan iki kind) ──────────────────────────
  console.log("\n── §5 Sebep kodu çözücü (Roll.entryReasonCode / cancelReasonCode) ──");
  const CANCEL = ReasonPresetKind.ROLL_CANCEL;
  const MANUAL = ReasonPresetKind.ROLL_MANUAL_ENTRY;
  check(
    "label eşleşir: 'Mükerrer' → MUKERRER",
    (await resolveReasonCodeFromText(CANCEL, "Mükerrer")) === "MUKERRER",
  );
  check(
    "fullText eşleşir: 'Yanlış metraj girildi' → YANLIS_METRAJ",
    (await resolveReasonCodeFromText(CANCEL, "Yanlış metraj girildi")) === "YANLIS_METRAJ",
  );
  check(
    "KATLANMIŞ eşleşir (küçük harf): 'yanlış metraj girildi' → YANLIS_METRAJ",
    (await resolveReasonCodeFromText(CANCEL, "yanlış metraj girildi")) === "YANLIS_METRAJ",
  );
  check(
    "KATLANMIŞ eşleşir (İ/ı + ASCII + boşluk): '  YANLIS  METRAJ GİRİLDİ ' → YANLIS_METRAJ",
    (await resolveReasonCodeFromText(CANCEL, "  YANLIS  METRAJ GİRİLDİ ")) === "YANLIS_METRAJ",
  );
  check(
    "elle ekleme: 'Sayım farkı — fiziksel mal var' → SAYIM_FARKI",
    (await resolveReasonCodeFromText(MANUAL, "Sayım farkı — fiziksel mal var")) === "SAYIM_FARKI",
  );
  check(
    "kind'lar KARIŞMAZ: iptal metni elle-ekleme kataloğunda eşleşmez → null",
    (await resolveReasonCodeFromText(MANUAL, "Yanlış metraj girildi")) === null,
  );
  check(
    "serbest metne kod UYDURULMAZ → null",
    (await resolveReasonCodeFromText(CANCEL, "operatör yanlışlıkla iki kez bastı")) === null,
  );
  check("boş metin → null", (await resolveReasonCodeFromText(CANCEL, "   ")) === null);

  // Fabrikanın eklediği ve sonra GİZLEDİĞİ satır da eşleşir (bayat listeli tablet
  // gizlenmiş sebebi metniyle göndermeye devam edebilir — kodu düşmemeli).
  const hiddenCancel = await ReasonPresetService.create({
    kind: CANCEL,
    label: TEST_LABEL + " İPTAL",
  });
  created.push(hiddenCancel.id);
  await ReasonPresetService.update(hiddenCancel.id, { isActive: false });
  check(
    "fabrika satırı (GİZLİ) metinle eşleşir → kendi kodu",
    (await resolveReasonCodeFromText(CANCEL, TEST_LABEL + " İPTAL")) === hiddenCancel.code,
    hiddenCancel.code,
  );

  let badCode = false;
  try {
    await assertKnownReasonCode(CANCEL, "YOK_BOYLE_KOD");
  } catch (e) {
    const code = (e as { code?: string; details?: { code?: string } }).code ?? (e as { details?: { code?: string } }).details?.code;
    badCode = code === "REASON_CODE_INVALID" || String((e as Error).message).includes("Geçersiz sebep kodu");
  }
  check("uydurma AÇIK kod reddedilir (REASON_CODE_INVALID)", badCode);

  const explicitOnly = await resolveReasonCode(CANCEL, { reasonCode: "TOP_YOK" });
  check(
    "açık kod + boş metin → metin preset'ten dolar",
    explicitOnly.code === "TOP_YOK" && explicitOnly.text === "Top fiziksel olarak yok (hatalı kayıt)",
    `${explicitOnly.code} / ${explicitOnly.text}`,
  );
  const explicitWithText = await resolveReasonCode(CANCEL, { reasonCode: "TOP_YOK", reasonText: "elimde yok" });
  check(
    "açık kod + metin → metin EZİLMEZ",
    explicitWithText.code === "TOP_YOK" && explicitWithText.text === "elimde yok",
    `${explicitWithText.code} / ${explicitWithText.text}`,
  );
  const derivedOnly = await resolveReasonCode(MANUAL, { reasonText: "Etiketi kopmuş / okunmuyor" });
  check(
    "yalnız metin → kod türetilir, metin aynen kalır",
    derivedOnly.code === "ETIKET_KOPMUS" && derivedOnly.text === "Etiketi kopmuş / okunmuyor",
    `${derivedOnly.code} / ${derivedOnly.text}`,
  );

  // ── §6 ESKİ ADLAR (legacyTexts): etiket düzenlenince eski metin kodu DÜŞÜRMEZ ──
  console.log("\n── §6 Eski adlar — etiket düzenlemesi sonrası bayat metin ──");
  const aliasA = await ReasonPresetService.create({ kind: CANCEL, label: TEST_LABEL + " ALIAS BIR" });
  created.push(aliasA.id);
  check("yeni satır eski ad listesi BOŞ doğar", aliasA.legacyTexts.length === 0);
  const renamed1 = await ReasonPresetService.update(aliasA.id, { label: TEST_LABEL + " ALIAS IKI" });
  check(
    "etiket değişince eski etiket + eski fullText listeye düşer (katlanmış tekil)",
    renamed1.legacyTexts.length === 1 && renamed1.legacyTexts[0] === TEST_LABEL + " ALIAS BIR",
    JSON.stringify(renamed1.legacyTexts),
  );
  check(
    "bayat tablet ESKİ etiketi gönderir → kod YİNE çözülür",
    (await resolveReasonCodeFromText(CANCEL, TEST_LABEL + " ALIAS BIR")) === aliasA.code,
  );
  check("güncel etiket de çözülür", (await resolveReasonCodeFromText(CANCEL, TEST_LABEL + " ALIAS IKI")) === aliasA.code);
  const renamed2 = await ReasonPresetService.update(aliasA.id, { fullText: TEST_LABEL + " ALIAS IKI tam metin" });
  check(
    "fullText değişince eski fullText de listeye düşer (etiketle aynıysa tekrar YAZILMAZ)",
    renamed2.legacyTexts.length === 1 && renamed2.legacyTexts[0] === TEST_LABEL + " ALIAS BIR",
    JSON.stringify(renamed2.legacyTexts),
  );
  const renamed3 = await ReasonPresetService.update(aliasA.id, { label: TEST_LABEL + " ALIAS UC" });
  check(
    "ikinci yeniden adlandırma: iki eski ad + eski fullText birikti, sıra eski→yeni",
    JSON.stringify(renamed3.legacyTexts) ===
      JSON.stringify([TEST_LABEL + " ALIAS BIR", TEST_LABEL + " ALIAS IKI", TEST_LABEL + " ALIAS IKI tam metin"]),
    JSON.stringify(renamed3.legacyTexts),
  );
  check("en eski ad hâlâ çözülür", (await resolveReasonCodeFromText(CANCEL, TEST_LABEL + " ALIAS BIR")) === aliasA.code);
  // requiresText/isActive düzenlemesi METİN değiştirmez → liste dokunulmaz
  const untouched = await ReasonPresetService.update(aliasA.id, { requiresText: true });
  check("metin dışı düzenleme eski ad listesine DOKUNMAZ", JSON.stringify(untouched.legacyTexts) === JSON.stringify(renamed3.legacyTexts));
  // Eski ada geri dönüş: eski ad güncel olur, listeden TEMİZLENİR (çift kaynak olmasın)
  const back = await ReasonPresetService.update(aliasA.id, { label: TEST_LABEL + " ALIAS BIR" });
  check(
    "eski ada geri dönünce o ad listeden temizlenir, öncekisi (ALIAS UC) listeye girer",
    !back.legacyTexts.some((t) => t === TEST_LABEL + " ALIAS BIR") && back.legacyTexts.includes(TEST_LABEL + " ALIAS UC"),
    JSON.stringify(back.legacyTexts),
  );
  // Öncelik: B'nin GÜNCEL adı A'nın ESKİ adıysa → B kazanır (operatörün gördüğü B)
  const aliasB = await ReasonPresetService.create({ kind: CANCEL, label: TEST_LABEL + " ALIAS UC" });
  created.push(aliasB.id);
  check("güncel ad eski ada karşı ÖNCELİKLİ (B kazanır)", (await resolveReasonCodeFromText(CANCEL, TEST_LABEL + " ALIAS UC")) === aliasB.code);
  // Belirsizlik: B de yeniden adlandırılınca aynı eski ad iki satırda → kod UYDURULMAZ
  await ReasonPresetService.update(aliasB.id, { label: TEST_LABEL + " ALIAS DORT" });
  check("aynı eski ad iki satırda → belirsiz → null (uydurulmaz)", (await resolveReasonCodeFromText(CANCEL, TEST_LABEL + " ALIAS UC")) === null);
  // Sınır: 25 yeniden adlandırma → en fazla 20 eski ad, en eskisi düşer
  for (let i = 1; i <= 25; i++) await ReasonPresetService.update(aliasB.id, { label: `${TEST_LABEL} ALIAS N${i}` });
  const capped = await prisma.reasonPreset.findUniqueOrThrow({ where: { id: aliasB.id }, select: { legacyTexts: true } });
  check("eski ad listesi 20 ile sınırlı (en eskisi düşer)", capped.legacyTexts.length === 20 && capped.legacyTexts[19] === `${TEST_LABEL} ALIAS N24`, `${capped.legacyTexts.length} / son=${capped.legacyTexts[19]}`);
  check("sınırı aşan en eski ad artık çözülmez (bilinçli)", (await resolveReasonCodeFromText(CANCEL, TEST_LABEL + " ALIAS DORT")) === null);
  // Sistem satırı (BUILTIN çevrimdışı zemin senaryosu): label+fullText değişir, tablet seed metnini gönderir
  const ym = await prisma.reasonPreset.findFirstOrThrow({
    where: { kind: CANCEL, code: "YANLIS_METRAJ" },
    select: { id: true, label: true, fullText: true, legacyTexts: true },
  });
  try {
    await ReasonPresetService.update(ym.id, { label: "Metraj hatalı", fullText: "Metraj hatalı girildi (yeni)" });
    check("SİSTEM satırı düzenlendi: çevrimdışı zemin (seed fullText) yine koda çözülür", (await resolveReasonCodeFromText(CANCEL, "Yanlış metraj girildi")) === "YANLIS_METRAJ");
    check("SİSTEM satırı: eski label da çözülür", (await resolveReasonCodeFromText(CANCEL, "yanlış metraj")) === "YANLIS_METRAJ");
    check("SİSTEM satırı: yeni metin çözülür", (await resolveReasonCodeFromText(CANCEL, "Metraj hatalı girildi (yeni)")) === "YANLIS_METRAJ");
  } finally {
    // Sistem satırı birebir geri: metinler servisle, eski-ad listesi ham (test izi bırakmasın).
    await ReasonPresetService.update(ym.id, { label: ym.label, fullText: ym.fullText });
    await prisma.reasonPreset.update({ where: { id: ym.id }, data: { legacyTexts: ym.legacyTexts } });
    await refreshReasonPresetCache();
  }
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
