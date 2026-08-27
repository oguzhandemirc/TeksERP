// =============================================================================
// TeksERP - "Aktif sipariş kalemi" kuralının TEK KAYNAK bekçisi
// =============================================================================
// 2026-08-27'de kalem iptali eklendi. O günden sonra "açık talep" soran HER
// sorgu iptal edilmiş kalemi dışlamak zorunda. Kural
// `helpers/order-line-scope.helper.ts`te yaşar.
//
// NEDEN MEKANİK BEKÇİ: bu, unutulunca PATLAMAYAN bir kuraldır. Süzgeci atlayan
// yeni bir yüzey hata vermez, log basmaz — yalnız iptal edilmiş kalem talep
// gibi görünmeye devam eder ve planlamacı olmayan bir işi üretime alır. Aynı
// sınıf kural fason tarafında da tek kaynağa alınmıştı
// (`test_fason_open_dispatch_single_source`); bu onun ikizi.
//
// ⚠️ Bu dosyayı gevşetmeden önce: kuralı ihlal eden yer bulunca doğru tepki
// muafa eklemek DEĞİL, süzgeci koymaktır. Muaf yalnız GEÇMİŞ/DEFTER yüzeyleri
// içindir (iptal edilmiş kalemin sevk edilmiş metrajı gerçektir ve silinmez).
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const SRC = path.resolve(__dirname, "..", "src");
const HELPER_REL = path.join("services", "helpers", "order-line-scope.helper.ts");

/**
 * GEREKÇELİ MUAFLAR — yalnız GEÇMİŞ/DEFTER yüzeyleri. Liste iki yönlü
 * denetlenir: ölü muaf da testi düşürür (muaf edilen satır artık yoksa, muaf
 * gerçek bir ihlali sessizce kapsam dışında tutuyor demektir).
 */
const RAW_SQL_EXEMPT: Record<string, string> = {
  "services/order.service.ts":
    "satır KİLİDİ (SELECT … FOR UPDATE) — silinecek satırları kilitler, talep sorgusu değil",
  "constants/merge-map.ts": "birleştirme haritasında tablo ADI, sorgu değil",
  "utils/query-parser.ts": "tablo ADI listesi, sorgu değil",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);

console.log("=== 0) Körlük zemini ===");
// Tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakmadım" AYNI yeşile çıkar.
check("kaynak ağacı tarandı (>200 dosya)", FILES.length > 200, `${FILES.length}`);
const helperPath = path.join(SRC, HELPER_REL);
check("tek kaynak dosyası duruyor", fs.existsSync(helperPath));

const importers = FILES.filter(
  (f) => f !== helperPath && /from "[^"]*order-line-scope\.helper"/.test(fs.readFileSync(f, "utf8")),
);
check(
  "yardımcı GERÇEKTEN kullanılıyor (≥5 dosya)",
  importers.length >= 5,
  `${importers.length} — düşerse kural yazılı ama uygulanmıyor demektir`,
);

console.log("\n=== 1) 'Açık kalem' predicate'i elle yazılmamış ===");
{
  const offenders: string[] = [];
  for (const f of FILES) {
    if (f === helperPath) continue;
    const rel = path.relative(SRC, f);
    fs.readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const code = line.split("//")[0] ?? "";
        // `quantity: { gt: <client>.orderLine.fields.shippedQty }` — açık kalem
        // koşulunun Prisma yazımı. Tek sahibi yardımcıdır.
        if (/orderLine\.fields\.shippedQty/.test(code)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
  }
  check(
    "elle yazılmış açık-kalem predicate'i YOK",
    offenders.length === 0,
    offenders.join("\n     "),
  );
}

console.log("\n=== 2) Ham SQL'de order_lines süzgeci ===");
{
  const offenders: string[] = [];
  const usedExempt = new Set<string>();
  for (const f of FILES) {
    const rel = path.relative(SRC, f);
    const src = fs.readFileSync(f, "utf8");
    if (!/\border_lines\b/.test(src)) continue;
    if (RAW_SQL_EXEMPT[rel]) {
      usedExempt.add(rel);
      continue;
    }
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (!/\b(FROM|JOIN)\s+order_lines\b/i.test(line)) return;
      // Süzgeç aynı satırda ya da hemen ardındaki 3 satırda olmalı
      // (JOIN … ON … AND ol."cancelledAt" IS NULL / WHERE … AND …).
      const window = lines.slice(i, i + 4).join("\n");
      // GEÇMİŞ/DEFTER sorguları süzmez ve süzmemeli — ama kararın YAZILI olması
      // şart (`-- tz-ok:` deseninin ikizi). Gerekçesiz işaret kabul edilmez:
      // önceki satırda `aktif-kalem-muaf:` VE ardından bir açıklama olmalı.
      const before = lines.slice(Math.max(0, i - 6), i).join("\n");
      if (/aktif-kalem-muaf:\s*\S/.test(before)) return;
      if (!/cancelledAt/.test(window)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  check(
    "ham SQL'deki her order_lines erişimi aktif-kalem süzgeci taşıyor",
    offenders.length === 0,
    offenders.join("\n     "),
  );
  // Bayat muaf denetimi — ölü muaf gerçek bir ihlali gizler.
  const stale = Object.keys(RAW_SQL_EXEMPT).filter((k) => !usedExempt.has(k));
  check("muaf listesi bayat değil", stale.length === 0, stale.join(", "));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
