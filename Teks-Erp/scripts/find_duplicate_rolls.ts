// =============================================================================
// Tespit: mükerrer ham giriş ("aynı topu iki kez kaydetmişiz") — SALT OKUNUR
// Çalıştır: npx tsx scripts/find_duplicate_rolls.ts                (son 30 gün)
//           npx tsx scripts/find_duplicate_rolls.ts --days=90
//           npx tsx scripts/find_duplicate_rolls.ts --window=300   (saniye)
//           npx tsx scripts/find_duplicate_rolls.ts --csv          (makine okunur)
// =============================================================================
// ⚠️ BU SCRIPT HİÇBİR ŞEY YAZMAZ. `--apply` YOKTUR. Önce ne olduğunu görürüz,
// temizlik yolu çıktıya bakılarak AYRICA kararlaştırılır (canlı veri kuralı).
//
// SAHA VAKASI (2026-08-03): sunucu restart edildi; ham giriş personeli etiket
// çıkmayınca "Kaydet ve Etiket Bas"a defalarca bastı. Mobil KK1 her basışta YENİ
// bir `clientToken` ürettiği için backend'in idempotency koruması devreye
// giremedi → tek fiziksel top için N ayrı stok kaydı doğdu. Bu script AYNI
// desenin geçmişte başka ne zaman oluştuğunu arar.
//
// SERT ELEME — "hareket görmüş top KOPYA DEĞİLDİR":
// Bir top istasyona girdiyse / fasona gittiyse / kesildiyse, o mal FİZİKSEL
// OLARAK VARDI. Bu yüzden movement/operation taşıyan toplar kümeye HİÇ
// alınmaz. (İlk sürüm onları skorla eliyordu ve dev DB'de tam bu yüzden iki
// meşru balya girişini — 10 × 100 m, hepsi üretimden geçmiş — "muhtemel fazla"
// diye listeledi. Ops aracında bu çerçeveleme tehlikeli: gerçek topu sildirir.)
//
// KALAN SİNYALLER (hepsi birden = güçlü şüphe, KANIT DEĞİL):
//   • aynı ürün + renk + metraj + en + operatör + makine, saniyeler arayla
//   • `clientToken`ları FARKLI (aynı olsaydı backend zaten tek kayıt yapardı)
//   • hâlâ giriş statüsünde (STOCK/WAREHOUSE), hiç dokunulmamış
//
// ⚠️ ARACIN SINIRI: KK1 zaten SERİ GİRİŞ için tasarlanmıştır (form ürün/en'i
// korur, yalnız metraj temizlenir) — aynı balyadan arka arkaya girilen eşit
// metrajlı toplar veriye BİREBİR aynı desende görünür. Bu script "şüpheli"yi
// bulur, "kopya"yı KANITLAYAMAZ. Kararı fiziksel sayım ve operatör verir.
// =============================================================================

import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";

function arg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const v = Number(hit.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const DAYS = arg("days", 30);
const WINDOW_SEC = arg("window", 120);
const CSV = process.argv.includes("--csv");

/** Kopya olamayacak statüler — iptal/fire edilmiş top yeniden girilebilir. */
const IGNORED: RollStatus[] = [RollStatus.CANCELLED, RollStatus.SCRAP];

interface Row {
  id: string;
  barcode: string | null;
  createdAt: Date;
  itemId: string;
  itemName: string | null;
  colorId: string | null;
  initialQty: unknown;
  width: unknown;
  status: RollStatus;
  clientToken: string | null;
  createdById: string | null;
  operatorName: string | null;
  createdMachineId: string | null;
  moves: number;
  ops: number;
}

/**
 * Kümenin şüphe skoru (0-6). "Hiç hareket görmemiş" burada YOK — o artık sert
 * eleme koşulu (kümedeki her top zaten dokunulmamış).
 */
function scoreGroup(rows: Row[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const spanSec =
    (rows[rows.length - 1].createdAt.getTime() - rows[0].createdAt.getTime()) / 1000;
  reasons.push(`${Math.round(spanSec)} sn içinde`);
  // Refleks basış saniyeler içindedir; gerçek topu ölçüp girmek daha uzun sürer.
  if (spanSec <= 15) score += 3;
  else if (spanSec <= 45) score += 2;
  else score += 1;

  const tokens = new Set(rows.map((r) => r.clientToken ?? `null:${r.id}`));
  if (tokens.size === rows.length) {
    score += 2;
    reasons.push("clientToken'lar FARKLI");
  }

  if (rows.every((r) => r.status === RollStatus.STOCK || r.status === RollStatus.WAREHOUSE)) {
    score += 1;
    reasons.push("hepsi hâlâ giriş statüsünde");
  }

  return { score, reasons };
}

async function main() {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  console.log("=".repeat(78));
  console.log("MÜKERRER HAM GİRİŞ TARAMASI — SALT OKUNUR (hiçbir kayıt değişmez)");
  console.log("=".repeat(78));
  console.log(`Pencere : birbirine ≤ ${WINDOW_SEC} sn içinde doğmuş toplar`);
  console.log(`Kapsam  : son ${DAYS} gün (${since.toISOString()} sonrası)`);
  console.log("");

  const rolls = (await prisma.$queryRaw`
    SELECT r.id, r.barcode, r."createdAt", r."itemId", i.name AS "itemName",
           r."colorId", r."initialQty", r.width, r.status, r."clientToken",
           r."createdById", u."fullName" AS "operatorName", r."createdMachineId",
           (SELECT COUNT(*)::int FROM roll_movements m WHERE m."rollId" = r.id) AS moves,
           (SELECT COUNT(*)::int FROM roll_operations o WHERE o."rollId" = r.id) AS ops
    FROM rolls r
    LEFT JOIN items i ON i.id = r."itemId"
    LEFT JOIN users u ON u.id = r."createdById"
    WHERE r."createdAt" >= ${since}
      AND r."parentRollId" IS NULL
      AND r."parentReceiptId" IS NULL
      AND r.status NOT IN (${RollStatus.CANCELLED}::"RollStatus", ${RollStatus.SCRAP}::"RollStatus")
    ORDER BY r."itemId", r."initialQty", r."createdById", r."createdAt"
  `) as Row[];

  // SERT ELEME: hareket görmüş top = mal fiziksel olarak vardı = kopya değil.
  // Ne kadarının elendiğini AÇIKÇA yaz (sessiz daraltma yok).
  const untouched = rolls.filter((r) => r.moves === 0 && r.ops === 0);
  console.log(`Taranan giriş topu : ${rolls.length}`);
  console.log(
    `Hareket görmüş     : ${rolls.length - untouched.length} (elendi — üretime girmiş top kopya olamaz)`,
  );
  console.log(`Değerlendirilen    : ${untouched.length}`);

  // Kimlik = ürün + renk + metraj + en + operatör + makine. Zaman penceresi
  // gruplama SONRASI uygulanır (aynı kimlikten günler arayla gelenler ayrı küme).
  const buckets = new Map<string, Row[]>();
  for (const r of untouched) {
    const key = [
      r.itemId,
      r.colorId ?? "-",
      String(r.initialQty),
      String(r.width ?? "-"),
      r.createdById ?? "-",
      r.createdMachineId ?? "-",
    ].join("|");
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }

  // Her kimlik kümesini zaman penceresine göre zincirlere böl.
  const groups: Row[][] = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    let chain: Row[] = [list[0]];
    for (let i = 1; i < list.length; i++) {
      const gapSec = (list[i].createdAt.getTime() - chain[chain.length - 1].createdAt.getTime()) / 1000;
      if (gapSec <= WINDOW_SEC) {
        chain.push(list[i]);
      } else {
        if (chain.length > 1) groups.push(chain);
        chain = [list[i]];
      }
    }
    if (chain.length > 1) groups.push(chain);
  }

  groups.sort((a, b) => scoreGroup(b).score - scoreGroup(a).score);

  if (groups.length === 0) {
    console.log("");
    console.log("✅ Şüpheli küme bulunamadı.");
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const extras = groups.reduce((n, g) => n + g.length - 1, 0);
  console.log(`Şüpheli küme     : ${groups.length}`);
  console.log(`Fazladan kayıt   : ${extras} top (her kümede 1 tanesi gerçek kabul edilirse)`);
  console.log("");

  if (CSV) {
    console.log("kume,skor,barkod,id,olusma,statu,urun,metraj,en,operator,clientToken,hareket");
    groups.forEach((g, gi) => {
      const { score } = scoreGroup(g);
      for (const r of g) {
        console.log(
          [
            gi + 1, score, r.barcode ?? "", r.id, r.createdAt.toISOString(), r.status,
            JSON.stringify(r.itemName ?? ""), String(r.initialQty), String(r.width ?? ""),
            JSON.stringify(r.operatorName ?? ""), r.clientToken ?? "", r.moves + r.ops,
          ].join(","),
        );
      }
    });
  } else {
    groups.forEach((g, gi) => {
      const { score, reasons } = scoreGroup(g);
      const flag = score >= 6 ? "🔴 GÜÇLÜ ŞÜPHE" : score >= 4 ? "🟠 ŞÜPHELİ" : "🟡 ZAYIF";
      console.log("-".repeat(78));
      console.log(`Küme ${gi + 1}/${groups.length}  ${flag} (skor ${score}/6)`);
      console.log(`  Ürün      : ${g[0].itemName ?? g[0].itemId}`);
      console.log(`  Metraj/En : ${g[0].initialQty} m / ${g[0].width ?? "—"} cm`);
      console.log(`  Operatör  : ${g[0].operatorName ?? g[0].createdById ?? "—"}`);
      console.log(`  Sinyaller : ${reasons.join(" · ")}`);
      console.log("  Toplar:");
      for (const r of g) {
        const touched = r.moves + r.ops;
        console.log(
          `    ${r.createdAt.toISOString()}  ${(r.barcode ?? "(barkodsuz)").padEnd(20)} ` +
            `${r.status.padEnd(10)} hareket:${String(touched).padStart(2)}  ${r.id}`,
        );
      }
      // Öneri YALNIZ güçlü şüphede basılır. Zayıf kümede "fazla" demek, meşru
      // balya girişini sildirmeye davettir (bkz. dosya başlığındaki vaka).
      if (score >= 6) {
        console.log(
          `  → İlk kayıt ${g[0].barcode ?? g[0].id} tutulup diğer ${g.length - 1} tanesi ` +
            `İNCELENMELİ (fiziksel sayımla doğrula).`,
        );
      } else {
        console.log("  → Zayıf sinyal: büyük olasılıkla meşru seri giriş. Karar için fiziksel sayım şart.");
      }
    });
    console.log("-".repeat(78));
    console.log("");
    console.log("⚠️  BASILMIŞ ETİKETLER: iptal edilecek her top için fiziksel etiket");
    console.log("    basılmış olabilir. Kayıt temizlense de sahadaki kâğıt kalır —");
    console.log("    o barkodlar toplanıp imha edilmeli.");
    console.log("");
    console.log("⚠️  BU BİR KANIT DEĞİL, ŞÜPHE LİSTESİDİR. KK1 seri girişi meşru olarak");
    console.log("    aynı deseni üretir. Bu script YAZMAZ; temizlik kararı fiziksel");
    console.log("    sayım + operatör teyidi ile ayrıca verilir.");
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
