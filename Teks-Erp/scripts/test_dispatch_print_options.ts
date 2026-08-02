// =============================================================================
// Sevk irsaliyesi baskı seçenekleri — liste seçimi + sayfa ayrımı
// Çalıştır: npx tsx scripts/test_dispatch_print_options.ts
//
// DB'ye DOKUNMAZ: renderer saf fonksiyon (snapshot → HTML), örnek veriyle koşar.
// Bu yüzden temiz CI veritabanında da tam kapsamla çalışır.
//
// Doğrulanan sözleşme:
//  • Varsayılan = AYRI SAYFA. Basılan listelerin İLKİ sayfa açmaz, sonrakiler açar
//    (`.pgb`). Kapalı bölüm sayaca girmez — aksi halde ilk basılan liste boş bir
//    sayfanın ardından gelirdi.
//  • `listSections` tek seferliktir ve KALICI ayarı ezer; boş/geçersiz gelirse
//    yok sayılır (gövdesiz belge üretilmez).
//  • `mergeSections` sayfa ayrımını tamamen kapatır.
//  • `thead { table-header-group }` HER belgede var — çok sayfaya taşan tablonun
//    devam sayfasında başlık satırı tekrar eder.
// =============================================================================
import {
  renderShipmentDispatchHtml,
  DISPATCH_LIST_SECTIONS,
} from "../src/services/document-render/shipment-dispatch.html";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

type Cfg = Record<string, unknown>;
type Meta = Parameters<typeof renderShipmentDispatchHtml>[1];

function render(cfg: Cfg, meta: Meta = {}): string {
  return renderShipmentDispatchHtml(
    {
      schemaVersion: 1,
      frozenAt: new Date(0).toISOString(),
      company: { name: "TEST A.Ş.", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
      docConfigOverride: cfg as never,
      doc: SAMPLE_PRINTED_DOCS.SHIPMENT_DISPATCH,
    } as never,
    meta,
  );
}

/** Basılan liste başlıklarını belge sırasıyla döndürür. */
function captions(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/class="caption"[^>]*>([^<]+)</g)) found.push(m[1].trim());
  return found;
}
/** Sayfa açan tablo sayısı. */
function pageBreaks(html: string): number {
  return [...html.matchAll(/class="sec pgb"/g)].length;
}

function main() {
  console.log("\n── 1) Varsayılan: üç liste, ayrı sayfalar ──");
  const def = render({});
  check("üç liste de basılır", captions(def).length === 3, captions(def).join(" | "));
  check(
    "ilk liste sayfa AÇMAZ, diğer ikisi açar (2 kırılma)",
    pageBreaks(def) === 2,
    `pgb=${pageBreaks(def)}`,
  );
  check(
    "ilk tablo düz `sec` sınıfı taşır (belge boş sayfayla başlamaz)",
    def.includes('<table class="sec">'),
  );

  console.log("\n── 2) Birleştirme (?merge=1) ──");
  const merged = render({}, { mergeSections: true });
  check("hiç sayfa kırılması yok", pageBreaks(merged) === 0, `pgb=${pageBreaks(merged)}`);
  check("üç liste yine basılır", captions(merged).length === 3);

  console.log("\n── 3) Tek seferlik liste seçimi ──");
  const onlySack = render({}, { listSections: ["cuval"] });
  check("yalnız çuval listesi basılır", captions(onlySack).length === 1, captions(onlySack).join(" | "));
  check("tek liste sayfa açmaz", pageBreaks(onlySack) === 0);
  check(
    "çuval başlığı doğru",
    captions(onlySack)[0]?.toUpperCase().includes("ÇUVAL"),
    captions(onlySack)[0],
  );

  const twoLists = render({}, { listSections: ["cuval", "ceki"] });
  check("iki liste seçilince ikisi basılır", captions(twoLists).length === 2);
  check("iki listede tek kırılma olur", pageBreaks(twoLists) === 1, `pgb=${pageBreaks(twoLists)}`);

  console.log("\n── 4) Geçersiz / boş seçim kalıcı ayara düşer ──");
  const emptySel = render({}, { listSections: [] });
  check("boş seçim yok sayılır (üç liste basılır)", captions(emptySel).length === 3);
  const junkSel = render({}, { listSections: ["olmayan-bolum"] });
  check("tanınmayan anahtar yok sayılır (gövdesiz belge yok)", captions(junkSel).length === 3);

  console.log("\n── 5) Kalıcı ayarla etkileşim (sayaç doğruluğu) ──");
  // KRİTİK: ürün listesi kalıcı ayarla kapalıyken ÇUVAL artık ilk basılan listedir
  // → sayfa AÇMAMALI. Sayaç kapalı bölümde artsaydı belge boş sayfayla açılırdı.
  const noUrun = render({ sections: { urun: false } });
  check("kapalı bölüm basılmaz", captions(noUrun).length === 2, captions(noUrun).join(" | "));
  check(
    "kapalı bölüm sayaca GİRMEZ — ilk basılan liste sayfa açmaz",
    pageBreaks(noUrun) === 1,
    `pgb=${pageBreaks(noUrun)} (2 ise ilk liste boş sayfadan sonra gelir)`,
  );
  // Tek seferlik seçim kalıcı ayarı EZER: ayar kapalı olsa da seçilirse basılır.
  const overrides = render({ sections: { urun: false } }, { listSections: ["urun"] });
  check(
    "tek seferlik seçim kalıcı 'kapalı' ayarını EZER",
    captions(overrides).length === 1 && captions(overrides)[0].toUpperCase().includes("ÜRÜN"),
    captions(overrides).join(" | "),
  );

  console.log("\n── 6) Sayfalama hijyeni (tüm belgelerde) ──");
  check("thead devam sayfasında tekrar eder", def.includes("table-header-group"));
  check("satır iki sayfaya bölünmez", def.includes("break-inside: avoid"));
  check("eski WebKit eşleniği de basılır", def.includes("page-break-before: always"));
  check(
    "ekran önizlemesinde sayfa sınırı görünür (@media screen)",
    def.includes("@media screen") && def.includes("yeni sayfa"),
  );

  console.log("\n── 7) Sözleşme senkronu ──");
  check(
    "DISPATCH_LIST_SECTIONS = urun,cuval,ceki (frontend DISPATCH_LISTS ile aynı)",
    DISPATCH_LIST_SECTIONS.join(",") === "urun,cuval,ceki",
    DISPATCH_LIST_SECTIONS.join(","),
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
