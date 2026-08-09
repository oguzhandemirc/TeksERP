// =============================================================================
// VERİ GÖÇÜ — KAT kataloğu + istasyon-özellik MODLARI (2026-08-10)
// Çalıştır: npx tsx scripts/seed_fold_catalog_and_modes.ts          (DRY-RUN)
//           npx tsx scripts/seed_fold_catalog_and_modes.ts --apply  (YAZAR)
// =============================================================================
// İki iş yapar:
//
//   1. KAT KATALOĞU — `FabricProperty(code="KAT", valueType=CHOICE)` + değerleri
//      (2-KAT / 4-KAT / TÜP) + Tambur istasyonuna bağı (mod REQUIRED).
//      Bu satır olmadan `resolveFoldTypeForWrite` FAIL-OPEN çalışır: kat
//      doğrulanmaz, tablet tuşlarını çizemez. Yani script koşmazsa özellik
//      sessizce "eski davranış"a düşer — bozulma değil, ama kazanç da yok.
//
//   2. İSTASYON-ÖZELLİK MODLARI — mevcut satırlar şema varsayılanı OPTIONAL ile
//      doğdu. ⚠️ KURŞUN SATIRI **AUTO** OLMAK ZORUNDA: `copyStationCapabilitiesToRoll`
//      artık yalnız AUTO satırları kopyalıyor, dolayısıyla bu adım atlanırsa
//      KURSUN özelliği toplara YAZILMAYI BIRAKIR (sessiz gerileme) ve kurşun
//      bypass ataması "istasyon kurşunu OTOMATİK uygulamıyor" diye reddedilir.
//
// ⚠️ MODLAR TOPLU DEĞİL TEK TEK kararlaştırıldı. Fason istasyonlarının
// (BOYA_FASON ×7, ZIMPARA_FASON ×1) satırları OPTIONAL kalır: o yolda
// `copyStationCapabilitiesToRoll` hiç çağrılmıyor (özellik fason kabulde
// `WO.targetProperties`'ten yazılıyor), yani mod inert. Hepsini AUTO
// işaretlemek, iç boyahane akışı yazıldığı gün 7 özelliği sessizce her topa
// yazdırırdı.
//
// ⚠️ CANLI VERİ KURALI (kök CLAUDE.md): DRY-RUN varsayılan; `--apply` öncesi
// etkilenecek HER kayıt somut olarak listelenir. İdempotent — tekrar koşulabilir.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { FOLD_PROPERTY_CODE } from "../src/services/helpers/fold-type";

const APPLY = process.argv.includes("--apply");

/** Kat değerleri — kod KİMLİKTİR, ad görüntüdür. */
const FOLD_VALUES = [
  { code: "2-KAT", name: "2 Kat", sortOrder: 10 },
  { code: "4-KAT", name: "4 Kat", sortOrder: 20 },
  { code: "TÜP", name: "Tüp", sortOrder: 30 },
];

/**
 * Mevcut istasyon-özellik satırlarının hedef modu. Anahtar `<istasyonKodu>/<özellikKodu>`.
 * Listede OLMAYAN satıra DOKUNULMAZ (şema varsayılanı OPTIONAL'da kalır).
 */
const MODE_PLAN: Record<string, "AUTO" | "OPTIONAL" | "REQUIRED"> = {
  // Bugün gerçekten otomatik uygulanan TEK satır (kursun-qc + kursunFinish +
  // bypass kapanışı `copyStationCapabilitiesToRoll` ile yazıyor).
  "KURSUN_KK2/KURSUN": "AUTO",
};

async function main(): Promise<void> {
  const lines: string[] = [];

  // ── 1) KAT özelliği ────────────────────────────────────────────────────────
  const tambur = await prisma.station.findFirst({
    where: { kind: "TAMBUR", isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  if (!tambur) {
    console.log("⚠️  Aktif TAMBUR istasyonu yok — kat kataloğu bağlanamaz, atlanıyor.");
  }

  const existing = await prisma.fabricProperty.findUnique({
    where: { code: FOLD_PROPERTY_CODE },
    select: {
      id: true,
      name: true,
      valueType: true,
      isActive: true,
      values: { select: { code: true } },
      stationCapabilities: { select: { stationId: true, mode: true } },
    },
  });

  if (!existing) {
    lines.push(`+ FabricProperty OLUŞTUR  code=${FOLD_PROPERTY_CODE} name="Kat" valueType=CHOICE`);
    for (const v of FOLD_VALUES) lines.push(`    + değer  ${v.code}  ("${v.name}")`);
    if (tambur) lines.push(`    + istasyon bağı  ${tambur.code} (${tambur.name})  mod=REQUIRED`);
  } else {
    if (existing.valueType !== "CHOICE") {
      lines.push(`~ FabricProperty ${FOLD_PROPERTY_CODE}: valueType ${existing.valueType} → CHOICE`);
    }
    const have = new Set(existing.values.map((v) => v.code));
    for (const v of FOLD_VALUES) {
      if (!have.has(v.code)) lines.push(`    + değer EKLE  ${v.code}  ("${v.name}")`);
    }
    if (tambur && !existing.stationCapabilities.some((c) => c.stationId === tambur.id)) {
      lines.push(`    + istasyon bağı EKLE  ${tambur.code}  mod=REQUIRED`);
    }
  }

  // ── 2) Mevcut istasyon-özellik satırlarının modu ───────────────────────────
  const caps = await prisma.stationProperty.findMany({
    select: {
      id: true,
      mode: true,
      station: { select: { code: true, name: true } },
      property: { select: { code: true, name: true } },
    },
    orderBy: [{ station: { code: "asc" } }, { property: { code: "asc" } }],
  });

  const modeUpdates: { id: string; label: string; from: string; to: string }[] = [];
  for (const c of caps) {
    const key = `${c.station.code}/${c.property.code}`;
    const target = MODE_PLAN[key];
    if (!target || target === c.mode) continue;
    modeUpdates.push({ id: c.id, label: key, from: c.mode, to: target });
  }

  console.log("=== İSTASYON-ÖZELLİK SATIRLARI (mevcut durum) ===");
  for (const c of caps) {
    const key = `${c.station.code}/${c.property.code}`;
    const target = MODE_PLAN[key];
    const mark = target && target !== c.mode ? ` → ${target}` : target ? " (zaten doğru)" : " (dokunulmuyor)";
    console.log(`  ${key.padEnd(32)} ${c.mode}${mark}`);
  }

  console.log("\n=== PLANLANAN DEĞİŞİKLİKLER ===");
  if (lines.length === 0 && modeUpdates.length === 0) {
    console.log("  (yok — her şey zaten yerinde)");
  } else {
    for (const l of lines) console.log(`  ${l}`);
    for (const u of modeUpdates) console.log(`  ~ mod  ${u.label}: ${u.from} → ${u.to}`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — hiçbir şey yazılmadı. Uygulamak için: --apply");
    return;
  }

  // ── UYGULA ─────────────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    let propertyId = existing?.id;

    if (!propertyId) {
      const created = await tx.fabricProperty.create({
        data: {
          // Kod ELLE verilir: `FabricPropertyService.create` OZL+GGAAYY+NNNN
          // üretir ve `resolveFoldTypeForWrite` sabit "KAT" kodunu arıyor.
          // Bu yüzden katalog satırı doğrudan prisma ile yazılır.
          code: FOLD_PROPERTY_CODE,
          name: "Kat",
          category: "Üretim",
          valueType: "CHOICE",
          sortOrder: 5,
        },
        select: { id: true },
      });
      propertyId = created.id;
    } else if (existing && existing.valueType !== "CHOICE") {
      await tx.fabricProperty.update({
        where: { id: propertyId },
        data: { valueType: "CHOICE" },
      });
    }

    for (const v of FOLD_VALUES) {
      await tx.fabricPropertyValue.upsert({
        where: { propertyId_code: { propertyId, code: v.code } },
        create: { propertyId, code: v.code, name: v.name, sortOrder: v.sortOrder },
        // Ad/sıra ÜZERİNE YAZILMAZ: fabrika "4 Kat"ı yeniden adlandırmış olabilir.
        update: {},
      });
    }

    if (tambur) {
      const link = await tx.stationProperty.findUnique({
        where: { stationId_propertyId: { stationId: tambur.id, propertyId } },
        select: { id: true },
      });
      if (!link) {
        await tx.stationProperty.create({
          data: { stationId: tambur.id, propertyId, mode: "REQUIRED" },
        });
      }
      // Mevcut bağın modu EZİLMEZ — fabrika bilinçli olarak değiştirmiş olabilir.
    }

    for (const u of modeUpdates) {
      await tx.stationProperty.update({
        where: { id: u.id },
        data: { mode: u.to },
      });
    }
  });

  console.log("\n✅ Uygulandı.");
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
