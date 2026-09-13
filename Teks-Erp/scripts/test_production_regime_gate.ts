// =============================================================================
// ÜRETİM REJİM KAPISI BEKÇİSİ — `production.enabled` kapalıyken üretim
// yüzeyleri ULAŞILAMAZ mı? Ve "bilinçli kapısız" listesi HÂLÂ doğru mu?
// =============================================================================
// ⚠️ BU BEKÇİ MODEL TÜRETMESİYLE ÇALIŞMAZ, POZİTİF AD LİSTESİYLE ÇALIŞIR — ve
// bu bilinçli bir farktır. Üretimin "özel modeli" YOKTUR: `roll`, `workOrder`,
// `batch` fabrikanın ANA tablolarıdır ve sevkiyat/depo/kartela yolları da
// onlara dokunur. Model türetmesi bu modülde her router'ı kapsama alır ve muaf
// listesi bekçinin kendisinden uzun olurdu. Kapsam bu yüzden K6b kararında
// ADLA yazılıdır (10 dosya) ve burada birebir ölçülür.
//
// ÜÇ ŞEY AYNI KOŞUMDA ÖLÇÜLÜR:
//   §2  Kapılanan 10 dosyanın HER BİRİ kapıyı taşıyor — ve kapı `verifyToken`
//       DAN SONRA (kimliksiz istek 401 alır, 403 değil) ve o router'ın TÜM
//       uçlarından ÖNCE (Express kayıt sırası: `use`tan önce tanımlı bir uç
//       kapıyı HİÇ görmez ve bu sızıntı ne hata ne log üretir).
//   §3  "Bilinçli kapısız" listesi GERÇEKTEN kapısız — biri sessizce
//       kapılanırsa (ör. `/api/rolls`) KK1 ham girişi fabrikada ölür.
//   §4  Liste `module.middleware.ts` başlığındaki BİLİNÇLİ KAPISIZ bloğuyla
//       BİREBİR — ayrışırsa ya kapı sessizce düşer ya bekçi ölü satır sayar.
//
// Salt-okunur: DB'ye dokunmaz, HTTP atmaz.
// Koşum: npx tsx scripts/test_production_regime_gate.ts
//
// NEGATİF SONDALAR — 2026-09-02'de koşuldu:
//   ① bir kapı satırı silinirse:
//      sed -i '' 's/^router.use(verifyToken, requireProductionEnabled);//' \
//        src/routes/tambur.routes.ts                                 → SONDA-7
//   ② kapı UÇLARDAN SONRAYA kayarsa (sıra sızıntısı, en sessiz hata):
//      kapı satırını dosyanın SONUNA taşı                            → SONDA-8
//   ③ bilinçli kapısız bir yüzey kapılanırsa (§3):
//      inventory.routes.ts'e kapı ekle                               → SONDA-9
// SONDA TABLOSU (ölçüldü — md5 ile birebir geri alındı):
//   SONDA-7 → çıkış 1 · 3 ❌ · §2 + §2b + §2c (/api/tambur kapısı silindi)
//   SONDA-8 → çıkış 1 · 1 ❌ · §2c (kapı dosyanın SONUNA taşındı — uçlar kapıyı görmez;
//             §2 ve §2b YEŞİL kaldı, yani sıra kontrolü olmasa sızıntı sessiz geçerdi)
//   SONDA-9 → çıkış 1 · 1 ❌ · §3 "KAPILANMIŞ: /api/rolls"
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { routerKapiOlcumu, yorumlariSok } from "./lib/regime-gate-scan";

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
const KAPI = "requireProductionEnabled";
const MW = path.join(SRC, "middlewares/module.middleware.ts");

/** K6b — üretim kapısı TAKILAN router dosyaları (mount adresiyle). */
const KAPILI: ReadonlyArray<{ dosya: string; mount: string }> = [
  { dosya: "routes/route.routes.ts", mount: "/api/routes" },
  { dosya: "routes/product-recipe.routes.ts", mount: "/api/product-recipes" },
  { dosya: "routes/workorder.routes.ts", mount: "/api/work-orders" },
  { dosya: "routes/production-balance.routes.ts", mount: "/api/production-balance" },
  { dosya: "routes/tambur.routes.ts", mount: "/api/tambur" },
  { dosya: "routes/kursun-qc.routes.ts", mount: "/api/kursun-qc" },
  { dosya: "routes/kursun-bypass.routes.ts", mount: "/api/kursun-bypass" },
  { dosya: "routes/traveler-card.routes.ts", mount: "/api/traveler-cards" },
  { dosya: "routes/batch.routes.ts", mount: "/api/batches" },
  { dosya: "routes/station-capability.routes.ts", mount: "/api/station-capabilities" },
  { dosya: "routes/machine-run.routes.ts", mount: "/api/machine-runs" },
  // Dokuma işi yazma yüzeyi (2026-09-13). Kapıyı doğduğu gün taşıyordu ama bu
  // listede ANILMIYORDU ⇒ bekçi 12 taşıyıcının 11'ini doğruluyor, 12'nci hakkında
  // hiçbir şey söylemiyordu. §1e o boşluğu kapatan koldur.
  { dosya: "routes/weaving-order.routes.ts", mount: "/api/weaving-orders" },
  // Dokuma doff yüzeyi (2026-09-13). §1e ilk gününde bu dosyayı yakaladı: kapıyı
  // doğuştan taşıyordu ama listede yoktu — tarayıcı kolu tam bunun için var.
  { dosya: "routes/machine-doff.routes.ts", mount: "/api/machine-doffs" },
];

/**
 * K6b — BİLİNÇLİ KAPISIZ. `mount` metni `module.middleware.ts` başlığında
 * ARANIR (§4): kapının kapsamı iki yerde yaşıyor ve ikisi ayrışamaz.
 */
const BILINCLI_KAPISIZ: ReadonlyArray<{ dosya: string; mount: string; neden: string }> = [
  {
    dosya: "routes/inventory.routes.ts",
    mount: "/api/rolls",
    neden:
      "KARMA router: KK1 ham giriş motoru (`initial-entry`) ÇEKİRDEKTİR — router seviyesinde " +
      "kapı KK1'i öldürür. Uç bazlı karar sonraki pakete bırakıldı.",
  },
  {
    dosya: "routes/station.routes.ts",
    mount: "/api/stations",
    neden: "KK1 ve sevk istasyonu da kullanıyor (istasyon/makine damgası) — çekirdek.",
  },
  {
    dosya: "routes/work-session.routes.ts",
    mount: "/api/work-sessions",
    neden: "Vardiya oturumu; sevk istasyonu da açar — çekirdek.",
  },
  {
    dosya: "routes/subcontractor.routes.ts",
    mount: "/api/subcontractor",
    neden:
      "Fasonun kendi anahtarı (`modul.fason`) Dilim 1 dışında; üretime asmak YANLIŞ modülü " +
      "kapatırdı.",
  },
  {
    dosya: "routes/kartela.routes.ts",
    mount: "/api/kartela",
    neden: "Kartela ayrı bir modül (`modul.kartela`), WO'suz akış — üretim kapısına girmez.",
  },
  {
    dosya: "routes/swatch.routes.ts",
    mount: "/api/swatches",
    neden: "Kartela modülünün ikinci yüzeyi — aynı gerekçe.",
  },
  {
    dosya: "routes/defect-type.routes.ts",
    mount: "/api/defect-types",
    neden: "Ortak katalog; sevk/depo/kartela yolları da okur.",
  },
  {
    dosya: "routes/quality-grade.routes.ts",
    mount: "/api/quality-grades",
    neden: "Ortak katalog (kalite kovaları rapor tarafında da okunuyor).",
  },
  {
    dosya: "routes/fabric-property.routes.ts",
    mount: "/api/fabric-properties",
    neden: "Ortak katalog — üretim karakteristiği tanımı, üretim İŞLEMİ değil.",
  },
  {
    dosya: "routes/reason-preset.routes.ts",
    mount: "/api/reason-presets",
    neden: "Ortak sebep katalogları (iptal · fire · kayıt düzeltmesi) — depo yolları da okur.",
  },
  {
    dosya: "routes/label.routes.ts",
    mount: "/api/labels",
    neden: "Baskı yüzeyi; çuval/sevk etiketleri de buradan basılır.",
  },
  {
    dosya: "routes/label-template.routes.ts",
    mount: "/api/label-templates",
    neden: "Etiket şablonu tasarımı — `label-template:*` izniyle korunur, üretim değil.",
  },
  {
    dosya: "routes/traveler-template.routes.ts",
    mount: "/api/traveler-templates",
    neden:
      "BELGE tasarımı yüzeyi (`document-template:*`), üretim değil — kartın KENDİSİ " +
      "(`/api/traveler-cards`) kapılıdır.",
  },
  {
    dosya: "routes/reports.routes.ts",
    mount: "/api/reports",
    neden: "Karma rapor (sevk + üretim + stok); uç bazlı ayrım sonraki pakette.",
  },
  {
    dosya: "routes/dashboard.routes.ts",
    mount: "/api/dashboard",
    neden: "Karma pano — aynı gerekçe.",
  },
];

function main(): void {
  console.log("=== ÜRETİM REJİM KAPISI BEKÇİSİ (production.enabled) ===\n");

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  check("§1a Körlük zemini: kapı listesi dolu", KAPILI.length >= 10, `kapılı=${KAPILI.length}`);
  check(
    "§1b Körlük zemini: bilinçli kapısız listesi dolu",
    BILINCLI_KAPISIZ.length >= 10,
    `kapısız=${BILINCLI_KAPISIZ.length}`,
  );
  const eksikDosya = [...KAPILI, ...BILINCLI_KAPISIZ].filter(
    (x) => !fs.existsSync(path.join(SRC, x.dosya)),
  );
  check(
    "§1c Listelerde ölü dosya yok",
    eksikDosya.length === 0,
    eksikDosya.map((x) => x.dosya).join(", "),
  );
  check("§1d Körlük zemini: middleware dosyası okunabildi", fs.existsSync(MW), MW);

  // ── §1e ⭐ KAPSAM — kapıyı TAŞIYAN her dosya listede ANILIR ────────────────
  //
  // ⚠️ NEDEN AYRI BİR KOL: §1c yalnız ÖLÜ girdiyi arar (listede var, dosya yok).
  // Ters yön — dosya var, kapıyı taşıyor, ama HİÇBİR listede anılmıyor — ölçülmüyordu.
  // Ölçüldü 2026-09-13: ağaçta 12 dosya `requireProductionEnabled` taşıyordu,
  // `KAPILI` 11 satırdı; `weaving-order.routes.ts` ikisinin de dışındaydı ve bekçi
  // 41/0 YEŞİL veriyordu. O gün biri o dosyadan kapıyı silse hiçbir şey kırmızı
  // vermezdi. Sınıf: *kapsamını bir LİSTEYLE beyan eden bekçi, listenin DIŞINDA
  // kalanı göremez* — pozitif ad listesiyle çalışmanın ödenmemiş bedeli.
  //
  // ⚠️ BU KOLUN KAPSAMI: liste DIŞINDA kalan KAPI TAŞIYICIYI ölçer. Kapı
  // TAŞIMAYAN bir dosyanın kapıyı taşıMAsı gerekip gerekmediğini ÖLÇMEZ — o §3'ün
  // işidir ("bilinçli kapısız" listesi) ve oraya girmek bir KARARDIR, ölçüm değil.
  //
  // Taban YOK, sert kural: `weaving-order.routes.ts` bu commit'te listeye alındı.
  const routeDizini = path.join(SRC, "routes");
  const tumRouteDosyalari = fs
    .readdirSync(routeDizini)
    .filter((f) => f.endsWith(".routes.ts"))
    .map((f) => `routes/${f}`);
  const kapiTasiyan = tumRouteDosyalari.filter((rel) =>
    fs.readFileSync(path.join(SRC, rel), "utf8").includes(KAPI),
  );
  const anilan = new Set([...KAPILI, ...BILINCLI_KAPISIZ].map((x) => x.dosya));
  const listesiz = kapiTasiyan.filter((rel) => !anilan.has(rel));
  // KÖRLÜK ZEMİNİ: tarama hiç dosya görmezse "listesiz yok" VAKUMEN doğru olur.
  check(
    "§1e Körlük zemini: route dizini tarandı ve kapı taşıyan dosya bulundu",
    tumRouteDosyalari.length >= 50 && kapiTasiyan.length >= 10,
    `${tumRouteDosyalari.length} route dosyası · ${kapiTasiyan.length} kapı taşıyor · ${anilan.size} listede anılı`,
  );
  check(
    `⭐ §1e \`${KAPI}\` taşıyan her dosya listede ANILIR`,
    listesiz.length === 0,
    listesiz.length === 0 ? `${kapiTasiyan.length} taşıyıcının ${kapiTasiyan.length}'i anılı` : listesiz.join(", "),
  );
  if (listesiz.length > 0) {
    console.log(
      "   YAPILACAK: dosyayı `KAPILI`ya (mount adresiyle) ekle. Kapıyı taşımaması\n" +
        "   gerekiyorsa kapıyı SİL ve `BILINCLI_KAPISIZ`a gerekçesiyle yaz — ikisi de\n" +
        "   bir KARAR; bu kol yalnız 'hiçbir yerde yazılı değil' hâlini yasaklar.",
    );
  }

  // ── §2 ⭐ KAPI VAR · KİMLİKTEN SONRA · TÜM UÇLARDAN ÖNCE ──────────────────
  for (const k of KAPILI) {
    const o = routerKapiOlcumu(path.join(SRC, k.dosya), KAPI);
    check(
      `§2 ⭐ ${k.mount} → kapı router seviyesinde ve verifyToken'dan SONRA`,
      o.kapiVar,
      o.kapiVar ? `router=${o.routerAdi}` : `\`router.use(verifyToken, ${KAPI})\` satırı YOK`,
    );
    // ⚠️ Uç sayısı zemini: kapı bulunup uç bulunamazsa "hepsi kapıdan sonra"
    // vakumen doğru olurdu (0 elemanlı `every`).
    check(
      `§2b ${k.mount} → körlük zemini: kapılı router'ın uçları sayıldı`,
      o.ucSayisi >= 1,
      `uç=${o.ucSayisi}`,
    );
    check(
      `§2c ⭐ ${k.mount} → HER uç kapıdan SONRA tanımlı (Express kayıt sırası)`,
      o.hepsiKapidanSonra,
      o.hepsiKapidanSonra
        ? ""
        : "kapıdan ÖNCE tanımlı uç kapıyı HİÇ görmez — hata da log da üretmez",
    );
  }

  // ── §3 ⭐ BİLİNÇLİ KAPISIZ GERÇEKTEN KAPISIZ ──────────────────────────────
  const yanlislikla = BILINCLI_KAPISIZ.filter((b) =>
    new RegExp(`\\b${KAPI}\\b`).test(yorumlariSok(fs.readFileSync(path.join(SRC, b.dosya), "utf8"))),
  );
  check(
    "§3 ⭐ 'Bilinçli kapısız' yüzeylerin hiçbiri kapı taşımıyor",
    yanlislikla.length === 0,
    yanlislikla.length
      ? `KAPILANMIŞ: ${yanlislikla.map((b) => b.mount).join(", ")} — bu bir KARARDI; ` +
        "kapı takmak istiyorsan önce K6b listesini ve middleware başlığını güncelle"
      : "",
  );
  const gerekcesiz = BILINCLI_KAPISIZ.filter((b) => b.neden.trim().length < 20);
  check(
    "§3b Her 'bilinçli kapısız' satırın gerekçesi yazılı",
    gerekcesiz.length === 0,
    gerekcesiz.map((b) => b.mount).join(", "),
  );

  // ── §4 ⭐ LİSTE ↔ MIDDLEWARE BAŞLIĞI BİREBİR ──────────────────────────────
  // Kapının kapsamı İKİ yerde yaşıyor: burada (mekanik) ve middleware'in başlık
  // yorumunda (okunan). Ayrışırlarsa okuyan kişi yanlış bilgilenir.
  const mwSrc = fs.readFileSync(MW, "utf8");
  const eksikMount = BILINCLI_KAPISIZ.filter((b) => !mwSrc.includes(b.mount));
  check(
    "§4 ⭐ 'Bilinçli kapısız' listesi middleware başlığında da yazılı",
    eksikMount.length === 0,
    eksikMount.length ? `başlıkta YOK: ${eksikMount.map((b) => b.mount).join(", ")}` : "",
  );
  check(
    "§4b Middleware başlığı 'BİLİNÇLİ KAPISIZ' bloğunu taşıyor",
    mwSrc.includes("BİLİNÇLİ KAPISIZ"),
    "blok silinirse liste tek yerde kalır ve gerekçeler kaybolur",
  );

  for (const b of BILINCLI_KAPISIZ) console.log(`   ℹ️  bilinçli kapısız: ${b.mount} — ${b.neden}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
