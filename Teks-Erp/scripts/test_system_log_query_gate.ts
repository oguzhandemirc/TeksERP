// =============================================================================
// SİSTEM LOG LİSTE UCU — `recordId` YALNIZ BAŞINA GÖNDERİLEMEZ (fail-closed kapı)
//
// ── NEDEN DOĞDU (2026-09-05 perf turu) ──────────────────────────────────────
// `system_logs_tableName_recordId_idx` composite'inin İLK kolonu `tableName`.
// Yalnız `recordId` verilirse planlayıcı yine "Index Scan" YAZAR ama index'in
// TAMAMINI okur — tuzak tam olarak budur, plan düğümünün adı sorunu gizler:
//     yalnız recordId      : 478 buffer / 1,793 ms
//     tableName + recordId :   4 buffer / 0,025 ms   (120x)
// Kural admin.routes.ts ve system-log.service.ts yorumlarında YAZILIYDI ama
// şema ZORLAMIYORDU (iki alan da bağımsız optional). Kök CLAUDE.md'nin
// "FAIL-CLOSED varsayılan" kuralı zorlamayı emrediyor; bu bekçi kapıyı tutar.
//
// ⚠️ İSTEMCİ SÖZLEŞMESİ: `recordId` gönderen TEK yüzey Electron
// RecordHistoryDialog ve o `tableName`i zaten birlikte gönderiyor — bu kapı
// sahadaki hiçbir istemciyi kırmaz. Yalnız-recordId isteği 400 alır.
//
// Salt-okunur: DB'ye hiç bağlanmaz.
// Koşum: npx tsx scripts/test_system_log_query_gate.ts
// =============================================================================
import "dotenv/config";
import { z } from "zod";
import { systemLogListQuerySchema } from "../src/routes/admin.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const REC = "e4ac7ace-1dcb-49b0-820d-f05ab5004c49";

// ── 1) Kapı: yalnız recordId REDDEDİLİR, mesaj Türkçe ve tableName'i işaret eder
const yalnizRecord = systemLogListQuerySchema.safeParse({ recordId: REC });
check("yalnız recordId reddedilir", !yalnizRecord.success);
if (!yalnizRecord.success) {
  const issue = yalnizRecord.error.issues[0];
  check("hata tableName alanını işaret eder", issue?.path.join(".") === "tableName", String(issue?.path));
  check(
    "mesaj Türkçe ve tableName'i söylüyor",
    typeof issue?.message === "string" && issue.message.includes("tableName"),
    issue?.message,
  );
}

// ── 2) Meşru kullanım GEÇER (kapı fazla kapatmıyor)
const ikisi = systemLogListQuerySchema.safeParse({ tableName: "ROLL", recordId: REC, limit: "100" });
check("tableName + recordId kabul edilir", ikisi.success, ikisi.success ? "" : JSON.stringify(ikisi.error.issues));
check("limit coerce edilmeye devam ediyor", ikisi.success && ikisi.data.limit === 100);

// ── 3) recordId'siz filtreler etkilenmez (Activity / Sistem Kayıtları sayfaları)
check("yalnız tableName kabul edilir", systemLogListQuerySchema.safeParse({ tableName: "ROLL" }).success);
check("yalnız category kabul edilir", systemLogListQuerySchema.safeParse({ category: "AUTH,SYSTEM" }).success);
check("boş sorgu kabul edilir", systemLogListQuerySchema.safeParse({}).success);

// ── 4) NEGATİF SONDA: kural OLMASAYDI bu test kırmızı VERİR miydi? ───────────
// Kapı olmayan bir kontrol şeması aynı girdiyi KABUL etmeli. Etmiyorsa yukarıdaki
// "reddedilir" iddiası kuralı değil başka bir şeyi ölçüyor demektir (boş sonda).
const kontrolSema = z.object({
  tableName: z.string().min(1).max(100).optional(),
  recordId: z.string().min(1).max(64).optional(),
});
check(
  "negatif sonda: kapısız kontrol şeması aynı girdiyi KABUL ediyor",
  kontrolSema.safeParse({ recordId: REC }).success,
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail === 0 ? 0 : 1);
