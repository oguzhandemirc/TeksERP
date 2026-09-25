// =============================================================================
// GERİYE DOLDURMA — Roll.entryReason + Roll.foldType
// Çalıştır: npx tsx scripts/backfill_roll_fold_and_reason.ts          (DRY-RUN)
//           npx tsx scripts/backfill_roll_fold_and_reason.ts --apply  (YAZAR)
// =============================================================================
// 2026-08-04'te iki kalıcı kolon eklendi. Bu script, kolonlardan ÖNCE doğmuş
// topların değerlerini mevcut izlerden geri kurar:
//
//   entryReason ← SystemLog.newData.reason   (elle eklenen toplar)
//   foldType    ← RollOperation.metadata.foldType (TAMBUR_PROCESSED operasyonu)
//
// ⚠️ CANLI VERİ KURALI (kök CLAUDE.md): toplu düzeltme script'i DRY-RUN
// varsayılandır ve `--apply` öncesi ETKİLENECEK HER KAYDI somut listeler.
// "N kayıt güncellenecek" gibi soyut sayı YETMEZ.
//
// ⚠️ KAPSAM SINIRI — DÜRÜSTÇE: audit 6 ayda bir `system_log_archives`'a TAŞINIR.
// Bu script YALNIZ `system_logs`'a bakar; arşive düşmüş sebep GERİ GETİRİLMEZ.
// Doğrusu backfill'i kolon eklendikten hemen sonra koşmaktır. Arşivi de taramak
// teknik olarak mümkün ama iki kaynağı birleştirmek "hangisi doğru" sorusunu
// doğurur ve arşiv sınırsız büyüyen bir tablodur (perf).
//
// ⚠️ ASLA ÜZERİNE YAZMAZ: kolonu zaten DOLU olan top atlanır. Script birden çok
// kez koşulabilir (idempotent).
//
// ⚠️ AUDIT GÖÇ İSTİSNASI (K-A1, 1e onayı 2026-09-25): "audit yalnız ayak izidir"
// kuralının beyanlı istisnası (`lib/audit-okuma-beyan.ts` AUDIT_GOC_ISTISNALARI).
// Servisin audit dalı SİLİNDİ — sebep artık YALNIZ kolondan okunur; bu script o
// sürümün YAYIN GÜNÜ adımıdır (kuru → liste → kullanıcı onayı → --apply).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { normalizeFoldType } from "../src/services/helpers/fold-type";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";

const APPLY = process.argv.includes("--apply");

interface Planned {
  rollId: string;
  barcode: string | null;
  field: "entryReason" | "foldType";
  value: string;
  source: string;
}

async function main(): Promise<void> {
  const planned: Planned[] = [];

  // ── 1) SEBEP — elle doğan, kolonu boş toplar ───────────────────────────────
  const manualRolls = await prisma.roll.findMany({
    where: {
      entrySource: { in: ["TAMBUR_MANUAL", "MANUAL_ENTRY"] },
      entryReason: null,
    },
    select: { id: true, barcode: true, entrySource: true },
  });
  for (const r of manualRolls) {
    // ⚠️ Bir topun BİRDEN ÇOK CREATE audit kaydı olabilir: `createInitialEntry`
    // kendi kaydını yazar, manuel uç ARDINDAN ikinci bir kayıt (sebepli) yazar.
    // En eskisini almak sebebi TAŞIMAYAN kaydı seçip sessizce boş dönüyordu —
    // dry-run 0 gösterdi, veri ise oradaydı. Sebep TAŞIYAN kaydı ara.
    const logs = await prisma.systemLog.findMany({
      where: { tableName: "ROLL", recordId: r.id, action: "CREATE" },
      orderBy: { createdAt: "asc" },
      select: { newData: true },
    });
    const withReason = logs.find((l) => {
      const d = (l.newData ?? null) as Record<string, unknown> | null;
      return typeof d?.reason === "string" && (d.reason as string).trim() !== "";
    });
    const data = (withReason?.newData ?? null) as Record<string, unknown> | null;
    const reason = data?.reason;
    if (typeof reason === "string" && reason.trim()) {
      planned.push({
        rollId: r.id,
        barcode: r.barcode,
        field: "entryReason",
        value: reason.trim().slice(0, 500),
        source: `SystemLog(${String(data?.event ?? "CREATE")})`,
      });
    }
  }

  // ── 2) KAT — TAMBUR_PROCESSED operasyonundan ───────────────────────────────
  // Operasyon PARENT topa yazılır ve `metadata.childRollIds` o finalize'da doğan
  // çocukları sayar. Kat kararı o an verildiği için ÇOCUKLARA uygulanır; parent
  // zaten tüketilmiş (TAMBUR_CONSUMED) olduğundan ona yazmak anlamsızdır.
  const ops = await prisma.rollOperation.findMany({
    where: { operationType: "TAMBUR_PROCESSED" },
    select: { id: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const op of ops) {
    const md = (op.metadata ?? null) as Record<string, unknown> | null;
    const raw = md?.foldType ?? md?.plannedFoldType;
    if (typeof raw !== "string") continue;
    const canonical = normalizeFoldType(raw);
    if (!canonical) continue;
    const childIds = Array.isArray(md?.childRollIds)
      ? (md.childRollIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    if (childIds.length === 0) continue;
    const children = await prisma.roll.findMany({
      where: { id: { in: childIds }, foldType: null },
      select: { id: true, barcode: true },
    });
    for (const c of children) {
      planned.push({
        rollId: c.id,
        barcode: c.barcode,
        field: "foldType",
        value: canonical,
        source: `RollOperation(TAMBUR_PROCESSED ${op.createdAt.toISOString().slice(0, 10)})`,
      });
    }
  }

  // ── RAPOR — her kayıt tek tek ──────────────────────────────────────────────
  console.log(`\n=== GERİYE DOLDURMA ${APPLY ? "(UYGULANIYOR)" : "(DRY-RUN — hiçbir şey yazılmaz)"} ===\n`);
  if (planned.length === 0) {
    console.log("Doldurulacak kayıt yok — kolonlar zaten dolu ya da iz bulunamadı.");
  }
  for (const pl of planned) {
    console.log(
      `  ${pl.field.padEnd(12)} ${(pl.barcode ?? "(barkodsuz)").padEnd(16)} ← "${pl.value}"   [${pl.source}]`,
    );
  }
  const byField = planned.reduce<Record<string, number>>((acc, p) => {
    acc[p.field] = (acc[p.field] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n  TOPLAM: ${planned.length}  (${JSON.stringify(byField)})`);

  // Kapsam dışı kalanları da SÖYLE — sessiz eksik bırakma.
  const stillNullReason = manualRolls.length - (byField.entryReason ?? 0);
  if (stillNullReason > 0) {
    console.log(
      `\n  ⚠️  ${stillNullReason} elle-giriş topunun sebebi audit'te BULUNAMADI ` +
        `(Electron "Manuel Top Ekle" sebep yazmıyor, ya da kayıt arşive taşınmış).` +
        `\n      Bunlar NULL kalacak — dürüst cevap budur, uydurma değer yazılmaz.`,
    );
  }

  if (!APPLY) {
    console.log("\n  → Uygulamak için: npx tsx scripts/backfill_roll_fold_and_reason.ts --apply\n");
    return;
  }

  let written = 0;
  for (const pl of planned) {
    // Koşullu update: arada değişmişse (kolon dolmuşsa) DOKUNMA.
    const res = await prisma.roll.updateMany({
      where: { id: pl.rollId, [pl.field]: null },
      data: { [pl.field]: pl.value },
    });
    written += res.count;
  }
  console.log(`\n  ✅ ${written} alan yazıldı (${planned.length - written} atlandı — arada dolmuş).\n`);

  const SCRIPT = "scripts/backfill_roll_fold_and_reason.ts";
  const izYazildi = await onarimIziYaz({
    script: SCRIPT,
    action: "ROLL_FOLD_AND_REASON_BACKFILL",
    tableName: "ROLL",
    olcum: {
      yazilanAlan: written,
      planlanan: planned.length,
      atlanan: planned.length - written,
      alanKirilimi: planned.reduce<Record<string, number>>((a, p) => {
        a[p.field] = (a[p.field] ?? 0) + 1;
        return a;
      }, {}),
    },
  });
  if (!izYazildi) {
    console.error(izDustuUyarisi(SCRIPT, false));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
