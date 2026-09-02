// =============================================================================
// ÇOKLU DEPO REJİM KAPISI BEKÇİSİ — `depo.multiEnabled` kapalıyken depolar
// ARASI transfer ULAŞILAMAZ mı? Depo TANIMI/DEFTERİ ise kapısız KALIYOR mu?
// =============================================================================
// BU DOSYANIN ASIL İŞİ BİR AYRIMI KİLİTLEMEK. İki kardeş yüzey var ve ikisi
// FARKLI sorulardır:
//
//   • `/api/warehouses`, `/api/warehouses/movements`  → depo TANIMI ve DEFTERİ.
//     Defteri fabrika yolları yazıyor (KK1 girişi · top iptali · sevk · iade) →
//     KAPI KONULAMAZ, yoksa fabrikada YAZILAN defter fabrikada OKUNAMAZ olur.
//   • `/api/warehouse-transfers/*`                    → ÇOKLU DEPO yüzeyi.
//     Tek depolu bir kurulumda taşınacak ikinci depo yoktur → KAPILI.
//
// Bu ayrım yalnız iki dosyanın YORUMUNDA yaşasaydı, "tutarsızlık" sanılıp
// birinden biri düzeltilirdi (ya kapı sökülür ya deftere kapı takılır; ikisi de
// gerileme). Burada mekanik: §2 transferin kapılı, §4 defterin kapısız
// olduğunu AYNI koşumda ölçer.
//
// ⚠️ Bu modülün bir VERİ TÜREVİNİN yerine geçtiğini unutma: panel eskiden
// "aktif depo sayısı > 1" diye türetiyordu ve grandfathering migration'ı
// mevcut kurulumun değerini tam o türevi ÖLÇEREK damgaladı. Bundan sonra
// ikinci depo açmak yüzeyleri KENDİLİĞİNDEN açmaz (bilinçli).
//
// Tarayıcı ORTAK: `scripts/lib/regime-gate-scan.ts`.
// Salt-okunur: DB'ye dokunmaz, HTTP atmaz.
// Koşum: npx tsx scripts/test_depo_multi_regime_gate.ts
//
// NEGATİF SONDALAR — 2026-09-02'de koşuldu:
//   ① transfer kapısı silinirse:
//      sed -i '' 's/^router.use(verifyToken, requireDepoMultiEnabled);//' \
//        src/routes/warehouse-transfer.routes.ts                   → SONDA-5
//   ② depo defterine kapı TAKILIRSA (ters yön — §4):
//      warehouse.routes.ts'e `router.use(verifyToken, requireDepoMultiEnabled)` → SONDA-6
// SONDA TABLOSU (ölçüldü — md5 ile birebir geri alındı):
//   SONDA-5 → çıkış 1 · 2 ❌ · §2 + §4a (transfer kapısı silindi)
//   SONDA-6 → çıkış 1 · 2 ❌ · §3b + §4b (defterE kapı takıldı — TERS yön de yakalanıyor)
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
const KAPI = "requireDepoMultiEnabled";

/** ÇOKLU DEPO'YA ÖZEL Prisma model erişimcileri. */
const DEPO_MODELLERI = new Set(["warehouseTransfer", "warehouseTransferLine"]);

const MUAF: ReadonlyArray<{ dosya: string; neden: string }> = [
  {
    dosya: "routes/warehouse.routes.ts",
    neden:
      "DEPO TANIMI + HAREKET DEFTERİ → rejim kapısı KONULAMAZ (gerekçe " +
      "`services/warehouse.service.ts` başlığında yazılı). Defterin satırlarını `inventory` " +
      "(KK1 girişi, top iptali), `shipping` (sevk + storno), `return.service` (müşteri iadesi) " +
      "ve `subcontractor` üretir — dördü de fabrika yollarıdır ve çoklu depo KAPALIYKEN de " +
      "koşar. `warehouseTransfer` dokunuşu SALT-OKUMADIR ve tek daldan gelir: depo silme " +
      "bağımlılık guard'ı iki `warehouseTransfer.count` sorgusuyla 'bu depoya bağlı transfer " +
      "var mı' diye sorar. Yazma yüzeyi SIFIR.",
  },
];

/** Kapısı ADLA beklenen router'lar. */
const ADLA_BEKLENEN_KAPILI: ReadonlyArray<{ dosya: string; neden: string }> = [
  {
    dosya: "routes/warehouse-transfer.routes.ts",
    neden:
      "DEPOLAR ARASI TRANSFER (2026-09-02'de kapılandı; bugüne kadar KAPISIZDI). Fabrikada 0 " +
      "aktif depo ve HİÇ transfer yok; UI karosu da zaten gizliydi (`multiWarehouse` yüklemi). " +
      "Kapı `verifyToken`dan SONRA gelir, yani kimliksiz istek 401 alır — 403 değil.",
  },
];

function main(): void {
  console.log("=== ÇOKLU DEPO REJİM KAPISI BEKÇİSİ (depo.multiEnabled) ===\n");

  const tarama = rejimTaramasiKur({ src: SRC, modeller: DEPO_MODELLERI, kapiAdlari: [KAPI] });
  const ilgili = tarama.ilgiliRouterlar();

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  // ⚠️ Eşik BİLEREK ≥1: bu modülün evreni yalnız iki router ve ikisi de aşağıda
  // ADLA ölçülüyor. ≥2 yazılsaydı, depo silme guard'ının meşru bir refactor'ü
  // (count sorgusunun servise taşınması) bekçiyi yanlış kırmızıya düşürürdü.
  check(
    "§1a Körlük zemini: router dosyaları tarandı",
    tarama.routerlar.length >= 40,
    `router=${tarama.routerlar.length}`,
  );
  check(
    "§1b Körlük zemini: çoklu-depo router'ları TÜRETİLEBİLDİ",
    ilgili.length >= 1,
    `bulunan=${ilgili.length} → ${ilgili.map((x) => path.basename(x.f)).join(", ")}`,
  );

  // ── §2 ⭐ ASIL KONTROL ────────────────────────────────────────────────────
  const muafSet = new Set(MUAF.map((m) => path.join(SRC, m.dosya)));
  const kapisiz = ilgili.filter((x) => !muafSet.has(x.f) && !tarama.kapiliMi(x.f));
  check(
    "§2 ⭐ Transfer modeline dokunan HER router rejim kapısı taşıyor",
    kapisiz.length === 0,
    kapisiz.length === 0
      ? `${ilgili.length - muafSet.size} router kapılı`
      : `KAPISIZ: ${kapisiz.map((x) => path.relative(SRC, x.f)).join(", ")}`,
  );

  // ── §3 MUAF LİSTESİ BAYATLIK DENETİMİ ─────────────────────────────────────
  const olu = MUAF.filter((m) => !fs.existsSync(path.join(SRC, m.dosya)));
  check("§3a Muaf listesinde ölü satır yok", olu.length === 0, olu.map((m) => m.dosya).join(", "));
  const gereksiz = MUAF.filter((m) => {
    const f = path.join(SRC, m.dosya);
    return fs.existsSync(f) && (tarama.kapiliMi(f) || tarama.modelDokunusu(f) === null);
  });
  check(
    "§3b Muaf listesinde gereksiz satır yok",
    gereksiz.length === 0,
    gereksiz.map((m) => m.dosya).join(", "),
  );
  const gerekcesiz = MUAF.filter((m) => !m.neden || m.neden.trim().length < 20);
  check(
    "§3c Her muafın GEREKÇESİ yazılı",
    gerekcesiz.length === 0,
    gerekcesiz.map((m) => m.dosya).join(", "),
  );

  // ── §4 ⭐ AYRIMIN İKİ UCU — biri kapılı, diğeri kapısız KALMALI ────────────
  for (const b of ADLA_BEKLENEN_KAPILI) {
    const f = path.join(SRC, b.dosya);
    check(`§4a ⭐ ${b.dosya} rejim kapısı TAŞIYOR`, fs.existsSync(f) && tarama.kapiliMi(f));
  }
  const defterDosyasi = path.join(SRC, "routes/warehouse.routes.ts");
  check(
    "§4b ⭐ DEPO DEFTERİ kapısız KALIYOR (fabrikada yazılan defter fabrikada okunabilmeli)",
    fs.existsSync(defterDosyasi) && !tarama.kapiDosyadaVar(defterDosyasi),
    "kapı takıldıysa: defteri KK1/sevk/iade de yazıyor — çoklu depo kapalı fabrikada okunamaz olur",
  );

  for (const m of MUAF) console.log(`   ℹ️  muaf: ${m.dosya} — ${m.neden}`);
  for (const b of ADLA_BEKLENEN_KAPILI) console.log(`   ℹ️  adla beklenen: ${b.dosya} — ${b.neden}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
