// =============================================================================
// Test: WorkOrder durum yazımı TERMİNAL GUARD taşımak zorunda (2026-08-09)
// Çalıştır: npx tsx scripts/test_wo_terminal_guard.ts
// =============================================================================
// Korunan invariant (kök CLAUDE.md): "WO kapaması yalnız terminal-guard'lı
// completeWorkOrderIfStepsDone helper'ıyla yapılır — CANCELLED/SUPERSEDED asla
// COMPLETED'a dirilmez."
//
// Denetim bulgusu F-FAS-ESZ-001 (2026-08-09): `WorkOrder.status` yazan 10 çağrı
// yerinden 7'si durum süzgeçli `updateMany` kullanıyordu, 3'ü ise
// subcontractor.service.ts içinde ÇIPLAK `update({ where: { id } })` idi. Yani
// kural yedi yerde uygulanıyor, üç yerde değil — ve ayrışma sessizdi: CANCELLED
// bir iş emrinin fason kalemi kabul edilince WO COMPLETED'a diriliyordu.
//
// Bu bekçi SAF KAYNAK TARAMASIDIR (DB gerekmez, saniyeler sürer):
//   1. `workOrder.update(` ile `status:` yazan HİÇBİR çağrı kalmamalı
//      (durum yazımı ya guard'lı updateMany ya da helper üzerinden yapılır).
//   2. `workOrder.updateMany(` ile `status:` yazan her çağrının `where`'i
//      bir durum süzgeci taşımalı (`status:`) — yoksa terminal WO ezilir.
//   3. subcontractor.service.ts helper'ı gerçekten import etmeli
//      (regresyonda import geri çekilirse üstteki iki kontrol de boşa düşer).
//   4. KÖRLÜK ZEMİNİ: taranan dosya ve bulunan çağrı sayısı bir tabanın
//      altına düşerse KIRMIZI — "ihlal yok" ile "hiçbir şeye bakılmadı"
//      aynı yeşile çıkmasın (test_timestamptz_contract deseni).
// =============================================================================
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "../src");
const REPO = join(__dirname, "..");

/** Kanonik helper — durum yazımının TEK meşru sarmalayıcısı. */
const HELPER = "completeWorkOrderIfStepsDone";

/** Körlük zemini: bunların altına düşen sayım, tarayıcının boşa düştüğü anlamına gelir. */
const MIN_FILES = 100;
const MIN_WO_STATUS_WRITES = 6;

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * `<obj>.workOrder.<method>(` çağrısının argüman bloğunu parantez-dengeli çıkarır.
 * Düz regex yetmez: blok iç içe nesne/dizi taşır ve satır sonuna kadar okumak
 * `where`i görmeden keser (denetimdeki ilk yanlış ölçüm tam bu yüzden oldu).
 */
function extractCalls(src: string, method: "update" | "updateMany"): string[] {
  const needle = `.workOrder.${method}(`;
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) break;
    let depth = 0;
    let i = at + needle.length - 1; // açılış parantezi
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(src.slice(at, i + 1));
    from = i + 1;
  }
  return blocks;
}

/** Çağrı bloğundaki `where: { ... }` kısmını döndürür (yoksa null). */
function whereClauseOf(block: string): string | null {
  const at = block.indexOf("where:");
  if (at === -1) return null;
  const open = block.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < block.length; i++) {
    if (block[i] === "{") depth++;
    else if (block[i] === "}") {
      depth--;
      if (depth === 0) return block.slice(open, i + 1);
    }
  }
  return null;
}

function main(): void {
  console.log("=== WorkOrder terminal guard sözleşmesi ===\n");

  const files = walk(SRC);
  let statusWrites = 0;
  const rawUpdateViolations: string[] = [];
  const unguardedUpdateMany: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes(".workOrder.")) continue;
    const rel = relative(REPO, file);

    // --- 1) status yazan ÇIPLAK update ---------------------------------------
    for (const block of extractCalls(src, "update")) {
      if (!/\bstatus\s*:/.test(block)) continue; // status'e dokunmuyor → kapsam dışı
      statusWrites++;
      rawUpdateViolations.push(rel);
    }

    // --- 2) status yazan updateMany: where'de durum süzgeci ŞART --------------
    for (const block of extractCalls(src, "updateMany")) {
      if (!/\bstatus\s*:/.test(block)) continue;
      statusWrites++;
      const where = whereClauseOf(block);
      if (!where || !/\bstatus\s*:/.test(where)) unguardedUpdateMany.push(rel);
    }
  }

  // --- Körlük zemini (ÖNCE — sayım çökmüşse aşağıdaki yeşiller anlamsız) -----
  console.log(`  (tarandı: ${files.length} dosya, ${statusWrites} adet WorkOrder durum yazımı)\n`);
  check(
    `en az ${MIN_FILES} kaynak dosyası tarandı`,
    files.length >= MIN_FILES,
    `bulunan: ${files.length}`,
  );
  check(
    `en az ${MIN_WO_STATUS_WRITES} WorkOrder durum yazımı bulundu`,
    statusWrites >= MIN_WO_STATUS_WRITES,
    `bulunan: ${statusWrites} — tarayıcı boşa düşmüş olabilir`,
  );

  // --- Asıl kontroller ------------------------------------------------------
  check(
    "status yazan çıplak workOrder.update() YOK (guard'lı updateMany veya helper kullanılmalı)",
    rawUpdateViolations.length === 0,
    rawUpdateViolations.length ? [...new Set(rawUpdateViolations)].join(", ") : "",
  );
  check(
    "status yazan her workOrder.updateMany() where'inde durum süzgeci taşıyor",
    unguardedUpdateMany.length === 0,
    unguardedUpdateMany.length ? [...new Set(unguardedUpdateMany)].join(", ") : "",
  );

  // --- 3) Fason servisi helper'ı gerçekten kullanıyor ------------------------
  const fason = readFileSync(join(SRC, "services/subcontractor.service.ts"), "utf8");
  const helperCalls = (fason.match(new RegExp(`\\b${HELPER}\\(`, "g")) ?? []).length;
  check(
    `subcontractor.service ${HELPER}'ı import ediyor`,
    new RegExp(`^\\s*${HELPER},?\\s*$`, "m").test(fason),
  );
  check(
    `subcontractor.service ${HELPER}'ı en az 3 yerde çağırıyor (üç eski elle yazım)`,
    helperCalls >= 3,
    `bulunan: ${helperCalls}`,
  );

  // --- 4) Kanonik helper'ın kendisi terminal guard'ı taşıyor -----------------
  // ⚠️ Kapsam DARALTILIR: roll-step.helper birden çok guard'lı `workOrder.updateMany`
  // taşır (ör. ensureWorkOrderInProgress → `status: PLANNED` claim'i). İlk bloğu
  // almak yanlış fonksiyonu ölçer — kontrol YALNIZ helper'ın kendi gövdesinde koşar.
  const helperSrc = readFileSync(join(SRC, "services/helpers/roll-step.helper.ts"), "utf8");
  const fnAt = helperSrc.indexOf(`export async function ${HELPER}`);
  check(`${HELPER} roll-step.helper içinde bulundu`, fnAt !== -1);
  const helperBody = fnAt === -1 ? "" : helperSrc.slice(fnAt, helperSrc.indexOf("\n}\n", fnAt));
  const helperBlock = extractCalls(helperBody, "updateMany").find((b) => /\bstatus\s*:/.test(b));
  const helperWhere = helperBlock ? whereClauseOf(helperBlock) : null;
  // ⚠️ YORUMLAR SÖKÜLÜR — ilk yazımda sökülmüyordu ve kontrol KÖRDÜ: guard'ın
  // içinden SUPERSEDED silindiğinde bile hemen üstündeki `// SUPERSEDED ... de
  // terminal` açıklama satırı eşleşiyor ve test YEŞİL kalıyordu (negatif sondayla
  // yakalandı). Bir bekçi kodu ölçmeli, kodun yanındaki cümleyi değil.
  const helperWhereCode = (helperWhere ?? "").replace(/\/\/[^\n]*/g, "");
  check(
    "roll-step.helper terminal guard'ı CANCELLED + SUPERSEDED'i dışlıyor",
    Boolean(helperWhere && /CANCELLED/.test(helperWhereCode) && /SUPERSEDED/.test(helperWhereCode)),
    helperWhere ? `where(kod): ${helperWhereCode.replace(/\s+/g, " ").trim()}` : "where bulunamadı",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
