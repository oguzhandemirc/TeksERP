// =============================================================================
// TİCARET REJİM KAPISI BEKÇİSİ — `ticaret.enabled` kapalıyken alış siparişi /
// mal kabul / fiyat listesi / stok sayımı ULAŞILAMAZ mı?
// =============================================================================
// NEDEN AYRI BİR DOSYA: 2026-09-02'ye kadar bu dört yüzey ön muhasebenin
// (`finance.enabled`) arkasındaydı ve `test_finance_regime_gate` onları
// ölçüyordu. Modül anahtarları ayrılınca beş model (stockCount ·
// stockCountLine · itemPrice · purchaseOrder · purchaseOrderLine) TİCARET
// modülüne geçti; finans bekçisinde bırakılsalardı o bekçi bu router'larda
// `requireFinanceEnabled` arar ve "KAPISIZ" ilan ederdi — oysa kapıları var,
// yalnız ADI değişti.
//
// İZİN KAPISI TEK BAŞINA YETMEZ: `ADMIN_FULL` tanımı gereği HER izni taşır.
// Rejim kapısı olmayan bir ticaret ucu, fabrikadaki admin'e alış siparişi
// açma / fiyat kartı yazma yolu bırakırdı — menüde hiçbir şey görünmese bile,
// çünkü adres bilmek yeterlidir.
//
// KAPSAM TÜRETİLİR (elle listelenmez): ticaret-özel Prisma modellerine dokunan
// servisler AST ile bulunur, onları transitif import eden router'lar süzülür.
// Tarayıcı ORTAK: `scripts/lib/regime-gate-scan.ts`.
//
// ⚠️ MAL KABUL MODEL TÜRETMESİYLE DEĞİL, ADLA KİLİTLİ (§4). Ölçüldü
// (2026-09-02): `goodsReceipt` modelini sete koymak `InventoryService`
// üzerinden 13 router'ı kapsama alır ve muaf listesini 4'ten 9'a çıkarır —
// yani kapsamı genişletmek koruma DEĞİL gürültü üretirdi. Mal kabulün kapısı
// bu yüzden pozitif bir ad kontrolüyle ölçülür.
//
// Salt-okunur: DB'ye dokunmaz, HTTP atmaz — boş CI veritabanında da tam koşar.
// Koşum: npx tsx scripts/test_ticaret_regime_gate.ts
//
// NEGATİF SONDALAR — hepsi 2026-09-02'de koşuldu (çıkış kodu ölçüldü,
// `git checkout -- <dosya>` ile geri alındı):
//   ① kapı satırı silinirse (stok sayımı):
//      sed -i '' 's/^router.use(verifyToken, requireTicaretEnabled);//' \
//        src/routes/stock-count.routes.ts                      → SONDA-1
//   ② mal kabulün kapısı silinirse (§4 pozitif ad kontrolü):
//      sed -i '' 's/^router.use(verifyToken, requireTicaretEnabled);//' \
//        src/routes/goods-receipt.routes.ts                    → SONDA-2
//   ③ kapı adı jenerikleştirilirse (AST identifier kaybolur):
//      sed -i '' 's/requireTicaretEnabled/requireModule("ticaret")/g' \
//        src/routes/item-price.routes.ts                       → SONDA-3
// SONDA TABLOSU (ölçüldü — hepsi `git checkout`/md5 ile birebir geri alındı):
//   SONDA-1 → çıkış 1 · 1 ❌ · §2 "KAPISIZ: routes/stock-count.routes.ts"
//   SONDA-2 → çıkış 1 · 2 ❌ · §2 + §4 (adla kilitli mal kabul kontrolü de düştü)
//   SONDA-3 → çıkış 1 · 1 ❌ · §2 (jenerik `requireModule("ticaret")` AST'de kapı SAYILMAZ)
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { rejimTaramasiKur } from "./lib/regime-gate-scan";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const SRC = path.resolve(__dirname, "../src");

/**
 * TİCARET-ÖZEL Prisma model erişimcileri.
 *
 * ⚠️ Bu listeye model eklemeden önce sor: "ticaret modülünü KULLANMAYAN bir
 * fabrikada bu tabloya satır yazılması MEŞRU mu?" Meşruysa liste dışıdır.
 * `roll`/`order` burada DEĞİL — onlar üretim tarafının ana tabloları.
 * `goodsReceipt` de burada DEĞİL (yukarıdaki ölçüm; kapısı §4'te adla ölçülür).
 */
const TICARET_MODELLERI = new Set([
  "stockCount",
  "stockCountLine",
  "itemPrice",
  "purchaseOrder",
  "purchaseOrderLine",
]);

const KAPI = "requireTicaretEnabled";

/** Kapısı ADLA ölçülen router'lar (model türetmesinin göremediği/gereksiz yere büyüttüğü). */
const ADLA_BEKLENEN_KAPILI: ReadonlyArray<{ dosya: string; neden: string }> = [
  {
    dosya: "routes/goods-receipt.routes.ts",
    neden:
      "MAL KABUL (karar #4, 2026-09-02). Router 2026-09-02'ye kadar KAPISIZDI ve muaf " +
      "gerekçesi 'fabrikada da kullanılır' diyordu; dosyanın KENDİ başlığı ise tersini " +
      "söylüyor ('üretici fabrikada kullanılmaz — mal KK1'den ham girer') ve ölçüm başlığı " +
      "doğruladı. Artık `router.use(verifyToken, requireTicaretEnabled)` taşıyor. Kapı burada " +
      "MODEL TÜRETMESİYLE ölçülemez: `goodsReceipt`i model setine koymak InventoryService " +
      "üzerinden 13 router'ı kapsama alıp muaf listesini 9'a çıkarıyordu.",
  },
];

// -----------------------------------------------------------------------------
// MUAF LİSTESİ — gerekçeli, iki yönlü denetlenir (§3)
// -----------------------------------------------------------------------------
// ⚠️ İLK ÜÇÜ `test_finance_regime_gate`ten TAŞINDI, silinmedi: `purchaseOrder`
// modeli TİCARET setine geçtiği için finans bekçisinde "gereksiz muaf" olmuştu.
// Geçişli dokunuş (InventoryService) orada da burada da AYNI olgudur.
const MUAF: ReadonlyArray<{ dosya: string; neden: string }> = [
  {
    dosya: "routes/customer.routes.ts",
    neden:
      "CARİ KART (çekirdek, her kurulumda). Ticaret dokunuşu SALT-OKUMADIR: cari kart arşiv kapısı (URUN-YASAM-DONGUSU.md §6) açık alış siparişini canlı referans olarak SAYAR. Ticaret kapalı kurulumda `purchase_orders` boştur, sayı 0 döner; router satır yazmaz. Kapı takılsaydı müşteri kartı ticaretsiz fabrikada yönetilemezdi.",
  },
  {
    dosya: "routes/subcontractor-management.routes.ts",
    neden:
      "FASON PROFİLİ (çekirdek). Ticaret dokunuşu SALT-OKUMADIR: fasoncu arşiv kapısı (URUN-YASAM-DONGUSU.md §6) açık alış siparişini canlı referans olarak SAYAR. Ticaret kapalı kurulumda tablo boştur, sayı 0 döner; router satır yazmaz.",
  },
  {
    dosya: "routes/master-data-merge.routes.ts",
    neden:
      "ANA VERİ BİRLEŞTİRME (çekirdek). Ticaret dokunuşu birleştirmenin kendi işidir: MERGE_MAP müşteri/fasoncu kaynağının alış siparişi satırlarını survivor'a TAŞIR (ham SQL ile — tarayıcı 2026-09-25'e dek görmüyordu, fasoncu arşiv kapısının içe aktarılmasıyla görünür oldu). Ticaret kapalı kurulumda tablo boştur, taşınacak satır yoktur; birleştirme ticaretsiz fabrikada da çalışmak zorunda.",
  },
  {
    dosya: "routes/item.routes.ts",
    neden:
      "ÜRÜN KARTI (çekirdek, her kurulumda). Ticaret dokunuşu SALT-OKUMADIR: yaşam döngüsü önizlemesi ve " +
      "Pasif'e geçiş kapısı (URUN-YASAM-DONGUSU.md D1) kartın canlı referanslarını SAYAR — purchase_order_lines (açık alış kalemi) " +
      "bunlardan biri. ticaret kapalı kurulumda tablo boştur, sayı 0 döner; router bu tabloya hiçbir satır yazmaz. " +
      "Kapı takılsaydı ürün kartı ticaretsiz fabrikada yönetilemezdi.",
  },
  {
    dosya: "routes/subcontractor-weaving.routes.ts",
    neden:
      "FASON DOKUMA (G2, 2026-09-14). Kendi rejim kapısını taşır (`requireDokumaEnabled`); ticaret dokunuşu " +
      "GEÇİŞLİ ve YANILTICIDIR: `createInitialEntry` (inventory zinciri) ve `nextPrefixedSequenceTx` " +
      "(subcontractor.service) üzerinden. Bu yüzey alış siparişine/faturaya YAZMAZ; levent kalemi F1 defterine yazar, iplik kalemi G1'de " +
      "kendi kapısıyla gelir. Route kapısı KONULAMAZ: dokuma fasonu iplik/ticaret modülü olmadan meşrudur.",
  },
  {
    dosya: "routes/demo.routes.ts",
    neden:
      "DEMO senaryo üreticileri (2026-09-01). Ticaret modeline dokunuş GEÇİŞLİDİR ve " +
      "YANILTICI: router hiçbir ticaret işi yapmaz, `InventoryService`i yalnız top/etiket " +
      "senaryosu için (`applyManualProperties`) import eder — o servis kocaman olduğu için " +
      "transitif tarama `purchaseOrder`a kadar uzanıyor. Rejim kapısı KONULAMAZ: senaryo " +
      "ticaretle ilgisizdir ve ticaret kapalı bir kurulumda da çalışmalıdır. Router'ın KENDİ " +
      "kapısı vardır ve daha DARdır: `requireDemoMode` — fabrikada (demo modu kapalı) tüm " +
      "uçlar 403 döner, yani yazma yüzeyi SIFIRDIR. ⚠️ Buraya bir TİCARET senaryosu " +
      "eklenirse bu muaf YENİDEN DEĞERLENDİRİLMELİ.",
  },
  {
    dosya: "routes/boss.routes.ts",
    neden:
      "PATRON ÖZETİ (2026-09-01). Ticaret modeline dokunuş GEÇİŞLİ ve YANILTICI: router " +
      "hiçbir ticaret işi yapmaz, `getBossOverview` üretim akışı kolonları için " +
      "`InventoryService`i import ediyor ve transitif tarama `purchaseOrder`a kadar " +
      "uzanıyor — `demo.routes.ts` ve `inventory.routes.ts` ile BİREBİR aynı olgu. Rejim " +
      "kapısı KONULAMAZ: patron özeti üretim/stok/sevkiyat takibidir ve ticaret KAPALI olan " +
      "üretici fabrikada çalışmak zorundadır (zaten ilk müşterisi orası). Yazma yüzeyi SIFIR: " +
      "router'da tek bir GET var, hiçbir tabloya INSERT/UPDATE üretmez.",
  },
  {
    dosya: "routes/inventory.routes.ts",
    neden:
      "Envanter FABRİKANIN ana router'ıdır → rejim kapısı KONULAMAZ. purchaseOrder izi tek " +
      "daldan gelir (G2, 2026-08-14): `softDelete`, iptal edilen top bir mal kabul fişinden " +
      "doğduysa (`Roll.goodsReceiptId` dolu) PO rollup senkronunu tetikler. Fabrikada " +
      "goodsReceiptId'li top VAR OLAMAZ (fişi yazan tek yol goods-receipt akışı ve o artık " +
      "`requireTicaretEnabled` kapılı) → dal tek sorgu bile koşmaz, fabrika yolu bayt-bayt " +
      "aynı kalır. Bekçi: test_purchase_order.ts §T (negatif sondalı).",
  },
  {
    dosya: "routes/finance.routes.ts",
    neden:
      "ÖN MUHASEBE (2026-09-02'de eklendi). Ticaret dokunuşu TEK ve SALT-OKUMA: fatura " +
      "satırının varsayılan birim fiyatı `item-price.service` üzerinden çözülüyor " +
      "(`resolveItemPrice` — 'müşteri istisnası > kart varsayılanı > null'). Fiyat KARTINI " +
      "yazan yüzey `item-price.routes` ve o KAPILI. Router kapısız değildir, kendi rejim " +
      "kapısını taşır (`requireFinanceEnabled`); ticaret kapısı EKLENEMEZ çünkü ön muhasebe " +
      "ticaretten bağımsız açılabilen bir modüldür (MODULE_DEPENDENCIES'te böyle bir bağ " +
      "YOK) ve fatura kesmek fiyat kartı olmadan da mümkündür (birim fiyat elle girilir).",
  },
];

function main(): void {
  console.log("=== TİCARET REJİM KAPISI BEKÇİSİ (ticaret.enabled) ===\n");

  const tarama = rejimTaramasiKur({
    src: SRC,
    modeller: TICARET_MODELLERI,
    kapiAdlari: [KAPI],
  });
  const ilgili = tarama.ilgiliRouterlar();

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  // Türetme boşa düşerse ("hiç ticaret router'ı bulunamadı") sonuç "ihlal yok"
  // ile AYNI yeşile çıkardı — model adları değişir ya da tarayıcı kırılırsa.
  check(
    "§1a Körlük zemini: router dosyaları tarandı",
    tarama.routerlar.length >= 40,
    `router=${tarama.routerlar.length}`,
  );
  check(
    "§1b Körlük zemini: ticaret-özel router'lar TÜRETİLEBİLDİ",
    ilgili.length >= 5,
    `bulunan=${ilgili.length} → ${ilgili.map((x) => path.basename(x.f)).join(", ")}`,
  );

  // ── §2 ⭐ ASIL KONTROL ────────────────────────────────────────────────────
  const muafSet = new Set(MUAF.map((m) => path.join(SRC, m.dosya)));
  const kapisiz = ilgili.filter((x) => !muafSet.has(x.f) && !tarama.kapiliMi(x.f));
  check(
    "§2 ⭐ Ticaret modeline dokunan HER router rejim kapısı taşıyor",
    kapisiz.length === 0,
    kapisiz.length === 0
      ? `${ilgili.length - muafSet.size} router kapılı`
      : `KAPISIZ: ${kapisiz.map((x) => `${path.relative(SRC, x.f)} (→ ${x.model})`).join(", ")} — ` +
        `router'a \`router.use(verifyToken, ${KAPI})\` ekle`,
  );

  // ── §3 MUAF LİSTESİ BAYATLIK DENETİMİ (iki yönlü) ─────────────────────────
  const olu = MUAF.filter((m) => !fs.existsSync(path.join(SRC, m.dosya)));
  check("§3a Muaf listesinde ölü satır yok", olu.length === 0, olu.map((m) => m.dosya).join(", "));
  const gereksiz = MUAF.filter((m) => {
    const f = path.join(SRC, m.dosya);
    return fs.existsSync(f) && (tarama.kapiliMi(f) || tarama.modelDokunusu(f) === null);
  });
  check(
    "§3b Muaf listesinde gereksiz satır yok (artık kapılı ya da ticarete dokunmuyor)",
    gereksiz.length === 0,
    gereksiz.map((m) => m.dosya).join(", "),
  );
  const gerekcesiz = MUAF.filter((m) => !m.neden || m.neden.trim().length < 20);
  check(
    "§3c Her muafın GEREKÇESİ yazılı",
    gerekcesiz.length === 0,
    gerekcesiz.map((m) => m.dosya).join(", "),
  );

  // ── §4 ⭐ ADLA BEKLENEN KAPILAR (model türetmesinin dışı) ──────────────────
  for (const b of ADLA_BEKLENEN_KAPILI) {
    const f = path.join(SRC, b.dosya);
    check(`§4 ⭐ ${b.dosya} rejim kapısı taşıyor (adla kilitli)`, fs.existsSync(f) && tarama.kapiliMi(f));
    check(`§4b ${b.dosya} gerekçesi yazılı`, b.neden.trim().length >= 20);
  }

  for (const m of MUAF) console.log(`   ℹ️  muaf: ${m.dosya} — ${m.neden}`);
  for (const b of ADLA_BEKLENEN_KAPILI) console.log(`   ℹ️  adla beklenen: ${b.dosya} — ${b.neden}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: kapısız bir ticaret ucu, FABRİKADAKİ ADMİN'e (ADMIN_FULL tanımı gereği\n" +
        "her izni taşır) alış siparişi açma / mal kabul fişi yazma / fiyat kartı düzenleme\n" +
        "yolu açar — menüde hiçbir şey görünmese bile, çünkü adres bilmek yeterlidir.\n" +
        "Doğru tepki muaf listesine satır eklemek DEĞİL, kapıyı takmaktır.",
    );
  }
  process.exit(fail > 0 ? 1 : 0);
}

main();
