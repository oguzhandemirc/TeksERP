// =============================================================================
// Test: AYARLANABİLİR BOŞ GRID — tüm belgelerde, OPT-IN (2026-08-09)
// Çalıştır: npx tsx scripts/test_blank_grid.ts
// =============================================================================
// Saha isteği "kurşuncular için tablo koy" diye başladı ama istenen ÖZEL bir
// tablo değil GENEL bir yapıydı — kullanıcının ifadesi: *"belgede istediğim gibi
// grid ayarlayabileyim; satır, sütun sayısını ben belirleyeceğim. İlk satırda
// tanım sütunları olmayacak yani hepsi boş olacak hücrelerin. Sütun
// genişliklerini de ben belirleyeceğim."*
//
// §1 ⭐ KAPALIYKEN TEK BAYT BASILMAZ — bu bekçinin ASIL işi.
//    Sekiz canlı belge renderer'ına dokunuldu; ayarına dokunulmamış her belgenin
//    çıktısı BAYT-BAYT korunmalı. `docBlocksHtml` de aynı sözleşmeyi taşır.
// §2 Açıkken satır/sütun/genişlik/başlık kullanıcının dediği gibi
// §3 Başlık ve sütun başlıkları AYRI AYRI opsiyonel (tamamı boş olabilir)
// §4 Konum (afterHeader / beforeSignatures) doğru çıpaya basar
// §5 DÖRT KAPI — kayıt kapısı + önizleme şeması round-trip
// §6 Sınırlar: aralık dışı değer KIRPILIR, sayı olmayan varsayılana düşer
// =============================================================================
import {
  docBlankGridHtml,
  docBlankGridCss,
  sanitizeBlankGrid,
  BLANK_GRID_MAX_ROWS,
  BLANK_GRID_MAX_COLS,
  type BlankGridConfig,
} from "../src/services/document-render/doc-style";
import { docConfigSchema } from "../src/controllers/printed-document.controller";
import { sanitizeDocumentsConfig } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const G = (g: BlankGridConfig) => ({ blankGrid: g });

function main(): void {
  // ── §1 KAPALIYKEN TEK BAYT ──────────────────────────────────────────────
  console.log("\n── §1 ⭐ Kapalıyken tek bayt basılmaz ──");

  for (const cfg of [{}, G({ enabled: false }), G({ enabled: false, rows: 20, columns: 8 })]) {
    const html =
      docBlankGridHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc);
    check(
      `kapalı config → HTML boş (${JSON.stringify(cfg).slice(0, 40)})`,
      html === "",
      `uzunluk=${html.length}`,
    );
    check("kapalı config → CSS de boş (koşullu emit)", docBlankGridCss(cfg) === "");
  }

  // ── §2 Açıkken kullanıcının dediği gibi ─────────────────────────────────
  console.log("\n── §2 Satır · sütun · genişlik ──");

  const cfg2 = G({ enabled: true, rows: 3, columns: 4, columnWidths: [40, 20, 20, 20] });
  const h2 = docBlankGridHtml(cfg2, "beforeSignatures", esc);
  check("satır sayısı doğru", (h2.match(/<tr>/g) ?? []).length === 3, `${(h2.match(/<tr>/g) ?? []).length} satır`);
  check("sütun sayısı doğru", (h2.match(/<td><\/td>/g) ?? []).length === 12, "3 satır × 4 sütun = 12 hücre");
  check("sütun genişlikleri uygulandı", h2.includes('<col style="width:40%">'));
  check("CSS artık basılıyor", docBlankGridCss(cfg2).includes(".bgrid"));
  check(
    "hücreler GERÇEKTEN BOŞ (veri basılmıyor)",
    !/<td>[^<]/.test(h2),
    "grid elle doldurulur — buraya veri bağlanmaz",
  );

  // Genişlik sayısı sütunla UYUŞMUYORSA tamamen atılır (eşit bölünür).
  const mismatched = sanitizeBlankGrid({ enabled: true, columns: 4, columnWidths: [50, 50] });
  check(
    "eksik genişlik listesi ATILIR (kısmi doldurma yok)",
    mismatched?.columnWidths === undefined,
    "kısmi liste, görülen tabloyla basılanı sessizce ayrıştırırdı",
  );

  // ── §3 Başlıklar AYRI AYRI opsiyonel ────────────────────────────────────
  console.log("\n── §3 Başlık ve sütun başlıkları opsiyonel ──");

  const noTitle = docBlankGridHtml(G({ enabled: true, rows: 2, columns: 2 }), "beforeSignatures", esc);
  check("başlık verilmezse başlık satırı BASILMAZ", !noTitle.includes("bgrid-title"));
  check("sütun başlığı verilmezse <thead> BASILMAZ", !noTitle.includes("<thead>"), "tamamı boş grid mümkün");

  const titled = docBlankGridHtml(
    G({ enabled: true, rows: 2, columns: 2, title: "KURŞUN KAYDI", headers: ["Tarih", "İmza"] }),
    "beforeSignatures",
    esc,
  );
  check("başlık basılıyor", titled.includes("KURŞUN KAYDI"));
  check("sütun başlıkları basılıyor", titled.includes("<th>Tarih</th>") && titled.includes("<th>İmza</th>"));

  const emptyHeaders = docBlankGridHtml(
    G({ enabled: true, rows: 2, columns: 2, headers: ["", "  "] }),
    "beforeSignatures",
    esc,
  );
  check(
    "başlıkların TAMAMI boşsa <thead> hiç basılmaz",
    !emptyHeaders.includes("<thead>"),
    "boş başlık satırı kâğıtta anlamsız bir şerit olurdu",
  );

  check(
    "başlık HTML-escape ediliyor",
    docBlankGridHtml(G({ enabled: true, title: "<script>x" }), "beforeSignatures", esc).includes("&lt;script&gt;"),
  );

  // ── §4 Konum ────────────────────────────────────────────────────────────
  console.log("\n── §4 Konum çıpası ──");

  const top = G({ enabled: true, rows: 1, columns: 1, position: "afterHeader" });
  check("afterHeader → üst çıpada basılır", docBlankGridHtml(top, "afterHeader", esc) !== "");
  check("afterHeader → alt çıpada BASILMAZ", docBlankGridHtml(top, "beforeSignatures", esc) === "");
  const bottom = G({ enabled: true, rows: 1, columns: 1 });
  check(
    "konum verilmezse varsayılan beforeSignatures",
    docBlankGridHtml(bottom, "beforeSignatures", esc) !== "" &&
      docBlankGridHtml(bottom, "afterHeader", esc) === "",
  );

  // ── §5 DÖRT KAPI ────────────────────────────────────────────────────────
  console.log("\n── §5 Dört kapı (kayıt + önizleme) ──");

  const payload = {
    SHIPMENT_DISPATCH: {
      blankGrid: {
        enabled: true, rows: 6, columns: 3,
        columnWidths: [50, 25, 25], title: "KURŞUN KAYDI",
        headers: ["Operatör", "Tarih", "İmza"], position: "beforeSignatures",
      },
    },
  };
  const saved = sanitizeDocumentsConfig(payload as never);
  const g = saved?.SHIPMENT_DISPATCH?.blankGrid;
  check("⭐ KAYIT KAPISI grid'i saklıyor", g != null, "bu satır olmadan ayar SESSİZCE atılırdı");
  check("kayıtta satır/sütun korundu", g?.rows === 6 && g?.columns === 3);
  check("kayıtta genişlikler korundu", JSON.stringify(g?.columnWidths) === "[50,25,25]");
  check("kayıtta başlıklar korundu", JSON.stringify(g?.headers) === '["Operatör","Tarih","İmza"]');

  const parsed = docConfigSchema.parse(payload.SHIPMENT_DISPATCH) as Record<string, unknown>;
  const pg = parsed.blankGrid as BlankGridConfig | undefined;
  check(
    "⭐ ÖNİZLEME ŞEMASI grid'i taşıyor",
    pg?.enabled === true && pg?.rows === 6,
    "bu satır olmadan ayar gerçek baskıda görünür ama önizlemede GÖRÜNMEZ",
  );

  check(
    "kapalı grid HİÇ saklanmaz (ayar dosyası şişmez)",
    sanitizeBlankGrid({ enabled: false, rows: 10 }) === undefined,
  );

  // ── §6 Sınırlar ─────────────────────────────────────────────────────────
  console.log("\n── §6 Sınırlar: kırp / varsayılana düş ──");

  const big = sanitizeBlankGrid({ enabled: true, rows: 999, columns: 99 });
  check("aşırı satır KIRPILIR", big?.rows === BLANK_GRID_MAX_ROWS, `${big?.rows}`);
  check("aşırı sütun KIRPILIR", big?.columns === BLANK_GRID_MAX_COLS, `${big?.columns}`);
  const zero = sanitizeBlankGrid({ enabled: true, rows: 0, columns: 0 });
  check("sıfır/negatif alt sınıra çekilir", zero?.rows === 1 && zero?.columns === 1);
  const junk = sanitizeBlankGrid({ enabled: true, rows: "çok", columns: null });
  check(
    "sayı olmayan değer VARSAYILANA düşer (baskı yolu düşmez)",
    junk?.rows === 10 && junk?.columns === 5,
    `${junk?.rows}/${junk?.columns} — fason çeki sözleşmesiyle aynı`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main();
process.exit(fail > 0 ? 1 : 0);
