// =============================================================================
// REJİM KAPISI BEKÇİSİ — ticaret paketinin HER ucu `requireFinanceEnabled`den
// geçiyor mu?
//
// NEDEN VAR: Ticaret paketinin (ön muhasebe + iplik + fiyat + alış siparişi)
// tek ve en önemli sözleşmesi **FABRİKA SIFIR-FARK**tır: `finance.enabled`
// KAPALI bir kurulumda bu kavramların hiçbiri var olmamalı. Bunu iki ayrı kapı
// sağlar ve İKİSİ DE gereklidir:
//
//   • REJİM  (`requireFinanceEnabled`) → "bu KURULUM bu modülü kullanıyor mu"
//   • İZİN   (`requirePermission`)     → "bu KİŞİ bunu yapabilir mi"
//
// İzin kapısı TEK BAŞINA YETMEZ ve sebebi somut: `ADMIN_FULL` şablonu tanımı
// gereği HER izni taşır. Yani rejim kapısı olmayan bir ticaret ucu, fabrikadaki
// admin'e cari deftere / çek portföyüne / iplik stoğuna yazma yolu açardı —
// menüde hiçbir şey görünmese bile, çünkü adres bilmek yeterlidir.
//
// ÖLÇÜM — kapsam TÜRETİLİR, elle listelenmez:
//   ① Ticaret-özel Prisma modellerine (`cheque`, `cariTransaction`, `yarnStock`…)
//      dokunan servis dosyaları AST ile bulunur.
//   ② Bu servisleri (transitif) import eden rota dosyaları bulunur.
//   ③ Her biri için "rejim kapısı var mı" sorulur — kapı dosyanın KENDİSİNDE
//      olabilir ya da onu MOUNT EDEN üst router'dan MİRAS alınabilir
//      (`finance-allocation.routes` → `finance.routes` emsali).
//
// Elle liste tutulsaydı, yeni bir ticaret router'ı eklendiği gün kapsam dışında
// kalırdı ve bekçi "ihlal yok" derdi — yani tam da korkulan anda susardı.
//
// ⚠️ TARAMA TS AST İLE, REGEX DEĞİL. Bu dosya yazılırken düz metin araması
// `reports.routes.ts`i "kapılı" saydı — çünkü orada `requireFinanceEnabled`
// yalnız bir AÇIKLAMA SATIRINDA geçiyor. Regex bekçi, kapısı olmayan bir
// router'ı kapılı ilan ederdi: yanlış YEŞİL, yani en tehlikeli hata.
//
// Salt-okunur: DB'ye dokunmaz, boş CI veritabanında da tam koşar.
// Koşum: npx tsx scripts/test_finance_regime_gate.ts
//
// ⚠️ 2026-09-02 — TARAYICI `scripts/lib/regime-gate-scan.ts`E TAŞINDI. Bu dosya
// artık YALNIZ ön muhasebe için parametre veriyor (model seti + kapı adı +
// muaf listesi); AST mantığı dört modül bekçisiyle ORTAK. Kopyalanmadı çünkü
// kopya bekçi, bekçilerin en kötü cinsidir: biri düzeltilir, diğerleri eski
// mantıkla yeşil kalır. DAVRANIŞ BİREBİR KORUNDU — kontrol adları, eşikler ve
// çıktı satırları taşımadan önceki hâliyle aynıdır (ölçüm: taşımadan önce ve
// sonra "6 geçti, 0 başarısız" + aynı §1b listesi).
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `finance.routes.ts`teki
//    `router.use(verifyToken, requireFinanceEnabled)` satırı silindi → §2 KIRMIZI
//    ve KAPISIZ router'ları ADIYLA saydı (finance.routes + finance-allocation.routes).
//    Geri konunca 6/6 yeşil. Bekçi "modül kapalıyken uç açık kalıyor" sınıfını yakalıyor.
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

const KOK = path.resolve(__dirname, "..");
const SRC = path.join(KOK, "src");

/**
 * TİCARET-ÖZEL Prisma model erişimcileri.
 *
 * ⚠️ Bu listeye bir model eklemeden önce sor: "fabrika kurulumunda bu tabloya
 * satır yazılması MEŞRU mu?" Meşruysa liste dışıdır. `invoice`/`payment` burada
 * çünkü ön muhasebe fabrikada KAPALI; `roll`/`order` burada DEĞİL çünkü onlar
 * üretim tarafının ana tabloları.
 */
const TICARET_MODELLERI = new Set([
  // Ön muhasebe çekirdeği
  "cariAccount",
  "cariBalance",
  "cariTransaction",
  "invoice",
  "invoiceLine",
  "payment",
  "cashBox",
  "bankAccount",
  "cashTransaction",
  "exchangeRate",
  // Paket C
  "cheque",
  "chequeEvent",
  "paymentAllocation",
  "cariPeriodClose",
  // Resmi ön muhasebe belgeleri (J2 #18). ⚠️ Bunlar OLMASA da kapsam bugün
  // türetiliyor (servisler `cariTransaction`/`cheque` okuyor) — listede
  // durmalarının sebebi İLERİSİ: yalnız bu tablolara dokunan bir servis/router
  // yazıldığı gün kapsam dışında kalmasın.
  "reconciliationLetter",
  "chequeDeliveryNote",
  "chequeDeliveryNoteItem",
  // ⚠️ 2026-09-02 — YEDİ MODEL BU SETTEN ÇIKTI, SİLİNMEDİ: `stockCount`,
  // `stockCountLine`, `itemPrice`, `purchaseOrder`, `purchaseOrderLine` artık
  // TİCARET modülünün (`ticaret.enabled` / `requireTicaretEnabled`), `yarnStock`
  // ve `yarnMovement` ise İPLİK modülünün (`iplik.enabled` /
  // `requireIplikEnabled`) kapsamındadır ve kendi bekçilerinde ölçülürler.
  // Burada bırakılsalardı bu bekçi o router'larda `requireFinanceEnabled`
  // arar ve KAPISIZ ilan ederdi — oysa kapıları var, yalnız adı değişti.
  // Bu dosya bundan sonra YALNIZ ön muhasebe defterini (cari · fatura ·
  // tahsilat · kasa/banka · çek) sorar.
]);

// -----------------------------------------------------------------------------
// MUAF LİSTESİ — gerekçeli, iki yönlü denetlenir
// -----------------------------------------------------------------------------
// ⚠️ 2026-09-02 — ÜÇ MUAF BU LİSTEDEN ÇIKTI (demo · boss · inventory) çünkü
// tek bağları `purchaseOrder`dı ve o model artık TİCARET setinde. Burada
// kalsalardı §3b "gereksiz muaf" der ve kırmızı verirdi. SİLİNMEDİLER,
// TAŞINDILAR: üçü de `test_ticaret_regime_gate.ts`in muaf listesinde AYNI
// gerekçelerle duruyor (`InventoryService` üzerinden geçişli dokunuş orada da
// aynen sürüyor). Metinleri geçici olarak burada YORUM hâlinde bekletiliyordu;
// ticaret bekçisi yazılıp doğrulandığı için kopya 2026-09-03'te silindi —
// aynı gerekçenin iki yerde yaşaması, bir gün ayrışıp "hangisi güncel"
// sorusunu doğuracak bir borçtu.

const MUAF: ReadonlyArray<{ dosya: string; neden: string }> = [
  {
    dosya: "routes/customer.routes.ts",
    neden:
      "CARİ KART (çekirdek, her kurulumda). Finans dokunuşu SALT-OKUMADIR: cari kart arşiv kapısı (URUN-YASAM-DONGUSU.md §6) sıfırdan farklı cari bakiyeyi canlı referans olarak SAYAR (cari.service'teki bakiye kapısının kart ikizi). Ön muhasebe kapalı kurulumda `cari_balances` boştur, sayı 0 döner; router satır yazmaz. Kapı takılsaydı müşteri kartı ön muhasebesiz fabrikada yönetilemezdi.",
  },
  {
    dosya: "routes/return.routes.ts",
    neden:
      "İade FABRİKANIN ana akışıdır (mobil iade ekranı + RollReturn) → rejim kapısı KONULAMAZ. " +
      "invoice izi tek daldan gelir (H8, 2026-08-14): `attachReturnInvoices` sayfadaki iade " +
      "gruplarına faturalanmışlık bilgisini SALT-OKUMA tek sorguyla ekler (panelin 'Satış İade " +
      "Faturası' düğmesi alana bakar). Fabrikada `returnGroupId`li fatura VAR OLAMAZ (fatura " +
      "yazan tüm uçlar rejim kapılı) → sorgu 0 satır döner, alan null kalır, davranış bayt-bayt " +
      "aynı. Yazma yüzeyi sıfır: dal hiçbir ticaret tablosuna INSERT/UPDATE üretmez. Bu muaf " +
      "2026-08-14 gecesi J1 dikişinde eklendi — kenar H8'den beri vardı ve o günkü taramada " +
      "gözden kaçmıştı (shipping.service'in statik invoice importu kaldırılınca tek başına " +
      "görünür oldu).",
  },
  // ⚠️ `routes/goods-receipt.routes.ts` MUAFI 2026-09-02'de KALDIRILDI ve bu bir
  // gerekçe değişikliğidir, temizlik değil. Eski metin "Mal kabul FABRİKADA DA
  // kullanılır → rejim kapısı KONULAMAZ" diyordu; dosyanın KENDİ başlığı ise
  // tersini söylüyor ("üretici fabrikada kullanılmaz — mal KK1'den ham girer")
  // ve ölçüm başlığı doğruladı (fabrikada bu uçlara istek yok, izinler hiçbir
  // rol şablonunda tanımlı değil). Mal kabul artık `requireTicaretEnabled`
  // taşıyor; pozitif beklenti ticaret bekçisinde ADLA yazılıdır (model
  // türetmesiyle DEĞİL: `goodsReceipt`i model setine koymak `InventoryService`
  // üzerinden 13 router'ı kapsama alıp muaf listesini 9'a çıkarıyordu).
  {
    dosya: "routes/goods-receipt.routes.ts",
    neden:
      "MAL KABUL — GEREKÇE 2026-09-02'de DEĞİŞTİ (muaf kaldırılıp yeniden yazıldı). " +
      "Eski gerekçe 'fabrikada da kullanılır, kapı KONULAMAZ' idi ve YANLIŞTI: router " +
      "artık `router.use(verifyToken, requireTicaretEnabled)` taşıyor, yani KAPISIZ DEĞİL. " +
      "Burada muaf olmasının sebebi kapısızlık değil, FİNANS modeline dokunuşunun SALT-OKUMA " +
      "olması: tek iz `invoice.findFirst` — fiş iptalinde 'bu fişten kesilmiş canlı fatura " +
      "var mı' kontrolü (`return.routes` ile aynı sınıf). Hiçbir finans tablosuna " +
      "INSERT/UPDATE üretmez; ön muhasebe kapalıyken sorgu 0 satır döner. " +
      "⚠️ Bu bekçi `kapiliMi`yi BİLEREK yalnız `requireFinanceEnabled`e bakacak şekilde " +
      "tutuyor (yüklem bir ad KÜMESİNE genelleştirilirse bu satır §3b'de 'gereksiz' olur ve " +
      "SİLİNMELİDİR — o gün ölçüm zaten 'kapılı' diyecektir). Mal kabulün kapısı ADLA, " +
      "ticaret bekçisinde pozitif kontrol olarak ölçülür.",
  },
];

// ⚠️ AST yardımcıları (`oku` · `yerelImportlar` · `mountEdilenler` ·
// `ticaretModeliKullaniyor` · `ticaretDokunuyorTransitif` · `rejimKapisiVar` ·
// `tumRouterlar`) 2026-09-02'de `scripts/lib/regime-gate-scan.ts`e taşındı.
// Buradaki tek fark PARAMETRELERDİR: model seti yukarıda, kapı adı aşağıda.

async function main(): Promise<void> {
  console.log("=== REJİM KAPISI BEKÇİSİ (fabrika sıfır-fark) ===\n");

  // ⚠️ `kapiAdlari` BİLEREK TEK ELEMANLI: mal kabul muafının gerekçesi bu
  // daralığa dayanıyor (aşağıdaki `goods-receipt` satırının uyarısına bak).
  const tarama = rejimTaramasiKur({
    src: SRC,
    modeller: TICARET_MODELLERI,
    kapiAdlari: ["requireFinanceEnabled"],
  });
  const routerlar = tarama.routerlar;
  const kapiliMi = tarama.kapiliMi;
  const ticaretDokunuyorTransitif = tarama.modelDokunusu;
  const ticaretRouterlari = tarama.ilgiliRouterlar();

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  // Türetme boşa düşerse ("hiç ticaret router'ı bulunamadı") sonuç "ihlal yok"
  // ile AYNI yeşile çıkardı — model adları değişir ya da tarayıcı kırılırsa.
  check("§1a Körlük zemini: router dosyaları tarandı", routerlar.length >= 40, `router=${routerlar.length}`);
  check(
    "§1b Körlük zemini: ticaret-özel router'lar TÜRETİLEBİLDİ",
    ticaretRouterlari.length >= 5,
    `bulunan=${ticaretRouterlari.length} → ${ticaretRouterlari.map((x) => path.basename(x.f)).join(", ")}`,
  );

  // ── §2 ⭐ ASIL KONTROL ────────────────────────────────────────────────────
  const muafSet = new Set(MUAF.map((m) => path.join(SRC, m.dosya)));
  const kapisiz = ticaretRouterlari.filter((x) => !muafSet.has(x.f) && !kapiliMi(x.f));
  check(
    "§2 ⭐ Ticaret modeline dokunan HER router rejim kapısı taşıyor",
    kapisiz.length === 0,
    kapisiz.length === 0
      ? `${ticaretRouterlari.length - muafSet.size} router kapılı`
      : `KAPISIZ: ${kapisiz.map((x) => `${path.relative(SRC, x.f)} (→ ${x.model})`).join(", ")} — ` +
        `router'a \`router.use(verifyToken, requireFinanceEnabled)\` ekle ya da rejim kapısı ` +
        `taşıyan bir üst router'ın İÇİNE mount et`,
  );

  // ── §3 MUAF LİSTESİ BAYATLIK DENETİMİ (iki yönlü) ─────────────────────────
  const olu = MUAF.filter((m) => !fs.existsSync(path.join(SRC, m.dosya)));
  check("§3a Muaf listesinde ölü satır yok", olu.length === 0, olu.map((m) => m.dosya).join(", "));
  const gereksiz = MUAF.filter((m) => {
    const f = path.join(SRC, m.dosya);
    return fs.existsSync(f) && (kapiliMi(f) || ticaretDokunuyorTransitif(f) === null);
  });
  check(
    "§3b Muaf listesinde gereksiz satır yok (artık kapılı ya da ticarete dokunmuyor)",
    gereksiz.length === 0,
    gereksiz.map((m) => m.dosya).join(", "),
  );
  const gerekcesiz = MUAF.filter((m) => !m.neden || m.neden.trim().length < 20);
  check("§3c Her muafın GEREKÇESİ yazılı", gerekcesiz.length === 0, gerekcesiz.map((m) => m.dosya).join(", "));
  for (const m of MUAF) console.log(`   ℹ️  muaf: ${m.dosya} — ${m.neden}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: kapısız bir ticaret ucu, FABRİKADAKİ ADMİN'e (ADMIN_FULL tanımı\n" +
        "gereği her izni taşır) cari deftere / çek portföyüne / iplik stoğuna yazma\n" +
        "yolu açar — menüde hiçbir şey görünmese bile, çünkü adres bilmek yeterlidir.\n" +
        "Doğru tepki muaf listesine satır eklemek DEĞİL, kapıyı takmaktır.",
    );
  }
  process.exit(fail > 0 ? 1 : 0);
}

void main();
