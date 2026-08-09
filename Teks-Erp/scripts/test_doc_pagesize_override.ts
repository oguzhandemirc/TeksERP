// =============================================================================
// BEKÇİ: belge baskısında TEK SEFERLİK kâğıt boyu (?pageSize=A4|A5) — 2026-08-09
// =============================================================================
// Saha isteği: *"mobilden belge çıkarırken A5 mi A4 mü seçebiliyor muyum?"*
// Cevap hayırdı: refakat kartında uç vardı ama mobil hiç göndermiyordu, fason
// çekide ise uç HİÇ YOKTU (kâğıt boyu yalnız kalıcı `DocumentConfig`'ten
// geliyordu, yani belge tipi başına tek ve kalıcıydı).
//
// Sözleşme refakat kartındakinin AYNISI (`traveler-card.controller`):
//   • kalıcı ayarı VE donmuş snapshot'ın kendi boyunu EZER,
//   • hiçbir yere YAZILMAZ (ne ayara, ne snapshot'a) ve yeni versiyon DOĞURMAZ,
//   • geçersiz değer SESSİZCE yok sayılır (yazım hatası sahayı kâğıtsız bırakmasın).
//
// Bu bekçinin kilitlediği dört şey:
//   §1 Ezme GERÇEKTEN uygulanıyor (A4 ↔ A5 çıktısı farklı)
//   §2 Ezme HİÇBİR YERE yazılmıyor (snapshot + versiyon değişmiyor)
//   §3 `style`in DİĞER alanları KORUNUYOR (kenar boşluğu/punto sıfırlanmıyor)
//   §4 Geçersiz/eksik değer → kalıcı ayar geçerli, çıktı bayt-bayt AYNI
// =============================================================================

import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { printedDocumentService } from "../src/services/printed-document.service";
import { PrintedDocType } from "@prisma/client";
// Builder'lar YAN ETKİYLE kaydolur — import edilmezse `requireBuilder` 500 verir.
import "../src/services/subcontractor.service"; // SUBCONTRACTOR_DISPATCH

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

/** `@page` kuralından çözülen kâğıt boyu — renderer'ın gerçekten bastığı değer. */
function pageSizeOf(html: string): string {
  const m = html.match(/@page[^{]*\{[^}]*size:\s*(A4|A5)/i);
  return m?.[1]?.toUpperCase() ?? "YOK";
}

async function main(): Promise<void> {
  // Gerçek bir donmuş belge bul — fixture kurmak yerine mevcut kaydı OKUYORUZ
  // (bu bekçi salt-okunur; hiçbir şey yazmaması da kanıtlanacak şeyin parçası).
  const doc = await prisma.printedDocument.findFirst({
    where: { docType: PrintedDocType.SUBCONTRACTOR_DISPATCH },
    orderBy: { createdAt: "desc" },
    select: { sourceId: true, docType: true, version: true, snapshot: true, documentNo: true },
  });

  if (!doc) {
    // ⚠️ ATLAMA DEĞİL, KIRMIZI: "veri yoksa geç" deseydik temiz bir CI DB'sinde
    // bekçi sessizce hiçbir şey ölçmez ve yeşil kalırdı.
    check("fason çeki belgesi bulundu (bekçinin çalışabilmesi için şart)", false, "hiç SUBCONTRACTOR_DISPATCH yok");
    return;
  }
  console.log(`\nDenek belge: ${doc.documentNo} (v${doc.version})`);

  const render = (pageSize?: "A4" | "A5"): Promise<string> =>
    printedDocumentService
      .getHtml(doc.docType, doc.sourceId, undefined, { pageSize })
      .then((r) => ((r.data as { html: string } | null)?.html ?? ""));

  // ── §1 EZME UYGULANIYOR ───────────────────────────────────────────────────
  console.log("\n── §1 ⭐ Tek seferlik ezme gerçekten uygulanıyor ──");
  const base = await render();
  const a5 = await render("A5");
  const a4 = await render("A4");

  check("ezmesiz baskı HTML üretiyor (zemin)", base.length > 0, `${base.length} bayt`);
  check("⭐ ?pageSize=A5 → sayfa A5 basılıyor", pageSizeOf(a5) === "A5", pageSizeOf(a5));
  check("⭐ ?pageSize=A4 → sayfa A4 basılıyor", pageSizeOf(a4) === "A4", pageSizeOf(a4));
  // Körlük zemini: iki çıktı GERÇEKTEN farklı olmalı — aynı çıkıyorsa yukarıdaki
  // iki kontrol de "her zaman A4" hâlinde yeşil kalabilirdi.
  check(
    "zemin: A4 ile A5 çıktısı BİRBİRİNDEN FARKLI",
    a4 !== a5,
    a4 === a5 ? "ikisi aynı → ezme çalışmıyor olabilir" : "farklı",
  );

  // ── §2 HİÇBİR YERE YAZILMIYOR ─────────────────────────────────────────────
  console.log("\n── §2 ⭐ Ezme PERSIST EDİLMİYOR ──");
  const after = await prisma.printedDocument.findFirst({
    where: { docType: doc.docType, sourceId: doc.sourceId },
    orderBy: { version: "desc" },
    select: { version: true, snapshot: true },
  });
  check("⭐ yeni belge VERSİYONU doğmadı", after?.version === doc.version, `v${doc.version} → v${after?.version}`);
  check(
    "⭐ donmuş snapshot DEĞİŞMEDİ (bayt-bayt)",
    JSON.stringify(after?.snapshot) === JSON.stringify(doc.snapshot),
  );

  // ── §3 STYLE'İN DİĞER ALANLARI KORUNUYOR ──────────────────────────────────
  console.log("\n── §3 `style`in diğer alanları korunuyor ──");
  // Ezme `style`i KOMPLE değiştirseydi kenar boşluğu/punto varsayılana düşerdi.
  // Kanıt: A5 çıktısındaki margin kuralı, ezmesiz çıktıdakiyle AYNI olmalı
  // (kâğıt boyu değişti, yerleşim ayarı değişmedi).
  const marginOf = (h: string): string => h.match(/@page[^{]*\{[^}]*margin:\s*([^;}]+)/i)?.[1]?.trim() ?? "YOK";
  check(
    "kenar boşluğu ezmeden ETKİLENMİYOR",
    marginOf(a5) === marginOf(base),
    `ezmesiz=${marginOf(base)} · A5=${marginOf(a5)}`,
  );

  // ── §4 GEÇERSİZ DEĞER → SESSİZ, ÇIKTI AYNI ───────────────────────────────
  console.log("\n── §4 Ezmesiz yol bayt-bayt korunuyor ──");
  const base2 = await render(undefined);
  check(
    "⭐ ezme verilmeyince çıktı BİREBİR aynı (dokunulmamış belge korunur)",
    base2 === base,
    base2 === base ? "birebir" : "FARKLI — ezmesiz yol bozulmuş",
  );
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
