// =============================================================================
// MÜKERRER KARAR DOSYASI UYGULAYICI — CSV köprüsü (panel v2 P4, 2026-08-22)
// =============================================================================
// Çalıştır:
//   npx tsx scripts/apply_merge_decisions.ts --file=kararlar.csv          (DRY-RUN)
//   npx tsx scripts/apply_merge_decisions.ts --file=kararlar.csv --apply  (UYGULA)
//
// NEDEN VAR: kullanıcı canlı verinin bir KOPYASI üzerinde SQL ile inceleme yapıp
// kararları toplu veriyor. Karar dosyası panelden indirilen aday CSV'sinden
// (Sistem → Mükerrer Kayıtlar → "CSV indir") Excel'de türetilir.
//
// ⚠️ İNCELEME SQL'DE, UYGULAMA MOTORDA. Ham `UPDATE ... SET customerId = ...`
// ile birleştirme YAPILMAZ: 42 kurallık FK haritasını, çakışma politikalarını
// (alias/çuval/şablon yönlendirmesi), etiket & refakat kartı bayatlatmasını,
// advisory kilidi ve audit'i atlar. Bu script kararları AYNI motordan geçirir
// (`MasterDataMergeService`), yani panelden yapılmışla birebir aynı sonucu üretir.
//
// ⚠️ DRY-RUN VARSAYILAN ve `--apply` öncesi HER satır somut listelenir (kaç satır
// taşınacak, hangi çakışma nasıl çözülecek) — canlı veri kuralı.
//
// ── DOSYA BİÇİMİ (tr-TR Excel: `;` ayraç, BOM'lu UTF-8 kabul edilir) ─────────
//   varlik;hedefKod;kaynakKodlar;karar;gerekce;alanSecimleri
//
//   varlik         : customer | item | color | subcontractor
//   hedefKod       : KALACAK kaydın `code`'u (survivor)
//   kaynakKodlar   : birleşecek kayıtların kodları — virgül ya da `|` ile ayrılır
//   karar          : BIRLESTIR | MUKERRER_DEGIL | ERTELE | ATLA
//   gerekce        : BIRLESTIR'de ZORUNLU (≥10 karakter); karar defterine de yazılır
//   alanSecimleri  : opsiyonel — `alan=kaynakKod` çiftleri, virgülle:
//                    `name=MUS-002,taxNumber=MUS-002`  (P2 alan seçimi)
//
// Kod eşleşmesi TAM ve HARF DUYARSIZ değildir — kodlar sistemde nasıl yazılıysa
// öyle verilir (`foldCodeForCompare` uygulanmaz: iki kaydın kodu yalnız harf
// büyüklüğüyle ayrılıyorsa hangisini kastettiğin belirsizdir, script tahmin etmez).
// =============================================================================
import { readFileSync } from "fs";
import { DuplicateReviewDecision } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { MERGE_ENTITIES, type MergeEntity } from "../src/constants/merge-map";
import { isMergeableField } from "../src/constants/merge-fields";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { DuplicateReviewService } from "../src/services/duplicate-review.service";

const APPLY = process.argv.includes("--apply");
const FILE = (process.argv.find((a) => a.startsWith("--file=")) ?? "").split("=")[1];

type Decision = "BIRLESTIR" | "MUKERRER_DEGIL" | "ERTELE" | "ATLA";
const DECISIONS: Decision[] = ["BIRLESTIR", "MUKERRER_DEGIL", "ERTELE", "ATLA"];

interface Row {
  lineNo: number;
  entity: MergeEntity;
  survivorCode: string;
  sourceCodes: string[];
  decision: Decision;
  reason: string;
  fieldPicks: Record<string, string>;
}

/** `;` ayraçlı, tırnaklı alanları anlayan küçük ayrıştırıcı (tr-TR Excel çıktısı). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseFile(path: string): { rows: Row[]; errors: string[] } {
  const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];
  const rows: Row[] = [];
  if (lines.length === 0) return { rows, errors: ["Dosya boş."] };

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const need = ["varlik", "hedefkod", "kaynakkodlar", "karar"];
  const missing = need.filter((n) => !header.includes(n));
  if (missing.length > 0) {
    return {
      rows,
      errors: [
        `Başlık satırında eksik kolon(lar): ${missing.join(", ")}. ` +
          "Beklenen: varlik;hedefKod;kaynakKodlar;karar;gerekce;alanSecimleri",
      ],
    };
  }
  const col = (cells: string[], name: string): string => {
    const i = header.indexOf(name);
    return i === -1 ? "" : (cells[i] ?? "");
  };

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = parseCsvLine(lines[i]);
    const entityRaw = col(cells, "varlik").toLowerCase();
    const survivorCode = col(cells, "hedefkod");
    const sourceCodes = col(cells, "kaynakkodlar")
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const decisionRaw = col(cells, "karar").toUpperCase().replace(/\s+/g, "_");
    const reason = col(cells, "gerekce");
    const picksRaw = col(cells, "alansecimleri");

    if (!(MERGE_ENTITIES as readonly string[]).includes(entityRaw)) {
      errors.push(`Satır ${lineNo}: bilinmeyen varlık '${entityRaw}' (geçerli: ${MERGE_ENTITIES.join(", ")})`);
      continue;
    }
    const entity = entityRaw as MergeEntity;
    if (!DECISIONS.includes(decisionRaw as Decision)) {
      errors.push(`Satır ${lineNo}: bilinmeyen karar '${decisionRaw}' (geçerli: ${DECISIONS.join(", ")})`);
      continue;
    }
    const decision = decisionRaw as Decision;
    if (!survivorCode) {
      errors.push(`Satır ${lineNo}: hedefKod boş.`);
      continue;
    }
    if (sourceCodes.length === 0) {
      errors.push(`Satır ${lineNo}: kaynakKodlar boş.`);
      continue;
    }
    if (sourceCodes.includes(survivorCode)) {
      errors.push(`Satır ${lineNo}: hedefKod kaynak listesinde de var ('${survivorCode}').`);
      continue;
    }
    if (decision === "BIRLESTIR" && reason.trim().length < 10) {
      errors.push(`Satır ${lineNo}: BIRLESTIR için gerekçe en az 10 karakter olmalı.`);
      continue;
    }

    const fieldPicks: Record<string, string> = {};
    for (const pair of picksRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [field, fromCode] = pair.split("=").map((s) => s.trim());
      if (!field || !fromCode) {
        errors.push(`Satır ${lineNo}: alanSecimleri biçimi 'alan=kod' olmalı ('${pair}').`);
        continue;
      }
      if (!isMergeableField(entity, field)) {
        errors.push(`Satır ${lineNo}: '${field}' alanı ${entity} birleştirmesinde seçilemez.`);
        continue;
      }
      fieldPicks[field] = fromCode;
    }

    rows.push({ lineNo, entity, survivorCode, sourceCodes, decision, reason, fieldPicks });
  }
  return { rows, errors };
}

const delegateOf = (entity: MergeEntity) =>
  ({
    customer: prisma.customer,
    item: prisma.item,
    color: prisma.color,
    subcontractor: prisma.subcontractor,
  })[entity] as unknown as {
    findMany: (a: unknown) => Promise<Array<{ id: string; code: string; name: string; mergedIntoId: string | null }>>;
  };

async function main(): Promise<void> {
  if (!FILE) {
    console.error(
      "Kullanım: npx tsx scripts/apply_merge_decisions.ts --file=<kararlar.csv> [--apply]\n" +
        "Dosya biçimi: varlik;hedefKod;kaynakKodlar;karar;gerekce;alanSecimleri",
    );
    process.exit(1);
  }
  const dbName = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "?";
  console.log("=".repeat(78));
  console.log(`MÜKERRER KARAR DOSYASI — ${APPLY ? "⚠️  UYGULAMA MODU" : "DRY-RUN (hiçbir şey yazılmaz)"}`);
  console.log(`Veritabanı : ${dbName}`);
  console.log(`Dosya      : ${FILE}`);
  console.log("=".repeat(78));

  const { rows, errors } = parseFile(FILE);
  if (errors.length > 0) {
    console.log("\n❌ DOSYA HATALARI (hiçbir şey uygulanmadı):");
    for (const e of errors) console.log(`   ${e}`);
    process.exit(1);
  }
  console.log(`\n${rows.length} karar satırı okundu.\n`);

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const prefix = `Satır ${row.lineNo} [${row.entity}] ${row.survivorCode} ← ${row.sourceCodes.join(", ")}`;
    if (row.decision === "ATLA") {
      console.log(`⏭️  ${prefix}: ATLA`);
      skipped++;
      continue;
    }

    // Kodları id'ye çöz — TAM eşleşme, tombstone hariç.
    const codes = [row.survivorCode, ...row.sourceCodes];
    const found = await delegateOf(row.entity).findMany({
      where: { code: { in: codes }, mergedIntoId: null },
      select: { id: true, code: true, name: true, mergedIntoId: true },
    });
    const byCode = new Map(found.map((r) => [r.code, r]));
    const missing = codes.filter((c) => !byCode.has(c));
    if (missing.length > 0) {
      console.log(`❌ ${prefix}: bulunamayan/birleşmiş kod: ${missing.join(", ")}`);
      failed++;
      continue;
    }
    const survivor = byCode.get(row.survivorCode)!;
    const sources = row.sourceCodes.map((c) => byCode.get(c)!);

    if (row.decision === "MUKERRER_DEGIL" || row.decision === "ERTELE") {
      const decision =
        row.decision === "MUKERRER_DEGIL"
          ? DuplicateReviewDecision.NOT_DUPLICATE
          : DuplicateReviewDecision.DEFERRED;
      console.log(
        `${APPLY ? "✅" : "🔎"} ${prefix}: ${row.decision} → ${sources.length} çift karar defterine` +
          `${APPLY ? "" : " (dry-run)"}`,
      );
      if (APPLY) {
        for (const s of sources) {
          await DuplicateReviewService.decide({
            entity: row.entity,
            aId: survivor.id,
            bId: s.id,
            decision,
            note: row.reason || null,
          });
        }
      }
      ok++;
      continue;
    }

    // BIRLESTIR — önce önizleme (dry-run'da da koşar, yan etkisiz).
    const preview = await MasterDataMergeService.preview(
      row.entity,
      survivor.id,
      sources.map((s) => s.id),
    );
    const picks: Record<string, string> = {};
    let pickError: string | null = null;
    for (const [field, fromCode] of Object.entries(row.fieldPicks)) {
      const donor = byCode.get(fromCode);
      if (!donor) {
        pickError = `alan '${field}' için kod bulunamadı: ${fromCode}`;
        break;
      }
      picks[field] = donor.id;
    }
    if (pickError) {
      console.log(`❌ ${prefix}: ${pickError}`);
      failed++;
      continue;
    }

    const summary =
      `${preview.totalRowsToMove} satır taşınacak` +
      (preview.conflicts.length > 0 ? ` · ${preview.conflicts.length} çakışma` : "") +
      (Object.keys(picks).length > 0 ? ` · alan seçimi: ${Object.keys(picks).join(", ")}` : "") +
      (preview.measuredAll ? "" : " · ⚠️ bazı sayımlar ölçülemedi");

    if (!preview.canMerge) {
      console.log(`❌ ${prefix}: BİRLEŞTİRİLEMEZ — ${preview.blockers.map((b) => b.message).join(" | ")}`);
      failed++;
      continue;
    }
    if (!APPLY) {
      console.log(`🔎 ${prefix}: BIRLESTIR — ${summary}`);
      for (const m of preview.moves.filter((m) => m.count === null || m.count > 0)) {
        console.log(`      ${m.label}: ${m.count === null ? "ölçülemedi" : m.count}`);
      }
      for (const c of preview.conflicts) {
        console.log(`      ⚠️ çakışma ${c.label} (${c.count}) → politika ${c.policy}`);
      }
      ok++;
      continue;
    }

    try {
      const res = await MasterDataMergeService.merge(row.entity, {
        survivorId: survivor.id,
        sourceIds: sources.map((s) => s.id),
        reason: row.reason,
        acknowledgedConflicts: preview.conflicts.length,
        fieldPicks: Object.keys(picks).length > 0 ? picks : undefined,
      });
      console.log(
        `✅ ${prefix}: ${res.mergedCount} kayıt birleşti · ${summary}` +
          (res.fieldsApplied.length > 0 ? ` · ${res.fieldsApplied.length} alan yazıldı` : ""),
      );
      ok++;
    } catch (e) {
      console.log(`❌ ${prefix}: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log("");
  console.log("-".repeat(78));
  console.log(`Sonuç: ${ok} ${APPLY ? "uygulandı" : "uygulanabilir"} · ${failed} hatalı · ${skipped} atlandı`);
  if (!APPLY && ok > 0) {
    console.log("");
    console.log("Uygulamak için aynı komutu `--apply` ile çalıştırın.");
    console.log("⚠️ Birleştirme GERİ ALINAMAZ — önce gece yedeğinin alındığından emin olun.");
  }
  await prisma.$disconnect();
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Beklenmeyen hata:", e);
  await prisma.$disconnect();
  process.exit(1);
});
