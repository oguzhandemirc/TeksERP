// =============================================================================
// İPLİK REJİM KAPISI BEKÇİSİ — `iplik.enabled` kapalıyken kg defteri
// ULAŞILAMAZ mı? Ve deftere yazan motorun ÇAĞIRANLARI kim?
// =============================================================================
// İplik ticaret paketinin bir parçasıdır (`MODULE_DEPENDENCIES.iplikEnabled =
// ticaretEnabled`): kg defteri, alış/satış yüzeyleri olmadan tek başına
// anlamsızdır. Kapı `requireIplikEnabled` ve o middleware ÖNCE ticareti
// ölçer — bu bekçi kapının VARLIĞINI, `test_module_flag_off` ise SIRASINI ve
// 403 gövdesini ölçer.
//
// ⚠️ KAPI ADI KÜMESİ BİLEREK TEK ELEMANLI (`requireIplikEnabled`).
// `requireTicaretEnabled`i de "kapı" saymak muaf listesini 7'den 4'e
// düşürürdü ve KULAĞA temizlik gibi gelirdi — ama ölçüm bunun bir kör nokta
// olduğunu söyledi: ticaret AÇIK + iplik KAPALI bir kurulumda `goods-receipt`
// ve `stock-count` kg defterine yazmaya DEVAM ediyordu. Ticaret kapısını iplik
// kapısı saymak, tam da o boşluğu bekçinin gözünden gizlerdi.
//
// ⚠️ O AÇIK KENAR 2026-09-02'de KAPANDI ve kapı ROUTE'a DEĞİL SERVİSE kondu:
// `applyYarnMovementTx` gövdesinin ilk işi `readIplikEnabled` (§4d). Route
// kapısı yanlış cevaptı — kumaş mal kabulünü ve kumaş sayımını da iplik
// modülüne bağlardı. Bu yüzden §4 artık "boşluğu izleyen" bir bölüm değil,
// kapıyı POZİTİF ölçen bir bölümdür; iki muaf satırı da o gerekçeyle duruyor.
//
// Tarayıcı ORTAK: `scripts/lib/regime-gate-scan.ts`.
// Salt-okunur: DB'ye dokunmaz, HTTP atmaz — boş CI veritabanında da tam koşar.
// Koşum: npx tsx scripts/test_iplik_regime_gate.ts
//
// NEGATİF SONDALAR — 2026-09-02'de koşuldu (çıkış kodu ölçüldü, `git checkout`
// ile geri alındı):
//   ① yarn kapısı silinirse:
//      sed -i '' 's/^router.use(verifyToken, requireIplikEnabled);//' \
//        src/routes/yarn.routes.ts                               → SONDA-4
//   ② deftere YENİ bir yazar eklenirse (beklenti listesi bayatlar):
//      `applyYarnMovementTx` çağrısı taşıyan yeni bir servis eklemek → §4a
//   ③ motorun KENDİ kapısı silinirse (ticaret açık + iplik kapalı kurulumda
//      mal kabul ve sayım kg defterine yazmaya devam eder):
//      `applyYarnMovementTx` başındaki `readIplikEnabled` bloğunu sil → SONDA-24
// SONDA TABLOSU (ölçüldü — cp+md5 ile birebir geri alındı; taban 13/0, çıkış 0):
//   SONDA-4  → çıkış 1 · 1 ❌ · §2 "KAPISIZ: routes/yarn.routes.ts (→ yarnMovement)"
//   SONDA-4b → çıkış 1 · 1 ❌ · §4a "LİSTEDE OLMAYAN yazar: services/invoice.service.ts"
//              (beklenti listesinden bir satır silindi — yani deftere yazan yeni bir
//               yüzeyin bekçiyi kırmızı yapacağı DOĞRUDAN ölçüldü)
//   SONDA-24 → çıkış 1 · 2 ❌ · §4d + §4e — 2026-09-03
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { rejimTaramasiKur, yorumlariSok } from "./lib/regime-gate-scan";

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
const KAPI = "requireIplikEnabled";

/** İPLİK-ÖZEL Prisma model erişimcileri (kg defteri). */
const IPLIK_MODELLERI = new Set(["yarnStock", "yarnMovement"]);

// -----------------------------------------------------------------------------
// MUAF LİSTESİ — gerekçeli, iki yönlü denetlenir (§3)
// -----------------------------------------------------------------------------
const MUAF: ReadonlyArray<{ dosya: string; neden: string }> = [
  {
    dosya: "routes/demo.routes.ts",
    neden:
      "DEMO senaryo üreticileri. İplik modeline dokunuş GEÇİŞLİ ve YANILTICI (InventoryService " +
      "zinciri). Router'ın KENDİ kapısı daha DARdır: `requireDemoMode` — fabrikada tüm uçlar " +
      "403 döner, yazma yüzeyi SIFIRDIR.",
  },
  {
    dosya: "routes/boss.routes.ts",
    neden:
      "PATRON ÖZETİ. İplik modeline dokunuş GEÇİŞLİ ve YANILTICI; router'da tek bir GET var, " +
      "hiçbir tabloya INSERT/UPDATE üretmez. Rejim kapısı KONULAMAZ: özet, iplik kullanmayan " +
      "üretici fabrikada çalışmak zorundadır.",
  },
  {
    dosya: "routes/inventory.routes.ts",
    neden:
      "Envanter FABRİKANIN ana router'ıdır → rejim kapısı KONULAMAZ. İplik izi geçişlidir " +
      "(mal kabul/PO zinciri); envanterin kendi uçları kg defterine yazmaz.",
  },
  {
    dosya: "routes/purchase-order.routes.ts",
    neden:
      "ALIŞ SİPARİŞİ. Kendi rejim kapısını taşır (`requireTicaretEnabled`) ve iplik dokunuşu " +
      "SALT-OKUMADIR: `purchase-order.service` tek bir `yarnMovement.groupBy` ile siparişin " +
      "ne kadarının teslim alındığını (kg rollup) sayar. Yazma yok; iplik kapalıyken sorgu " +
      "0 satır döner.",
  },
  {
    dosya: "routes/warp-beam.routes.ts",
    neden:
      "LEVENT (devere 1b). Kendi rejim kapısını taşır (`requireDevereEnabled`; iplik/ticarete BAĞLI DEĞİL — " +
      "hazır/fason levent iplik tüketmez, 1e K3 2026-09-14). İplik defterine YALNIZ aksiyon anında dokunur: " +
      "içeride sarım `applyYarnMovementTx` üzerinden yazar ve iplik kapalıysa motorun içindeki kapı 403 " +
      "MODULE_DISABLED(iplik) verir (§4d); fason/hazır alım sarımı iplik satırı yazmaz. Route kapısı EKLENEMEZ.",
  },
  {
    dosya: "routes/warp-beam-mount.routes.ts",
    neden:
      "LEVENT TEZGAH BAĞI (devere Faz 3) — `warp-beam.routes.ts`in ALT yönlendiricisi, aynı `requireDevereEnabled` " +
      "kapısının ardında takılıdır. İplik dokunuşu SALT-OKUMADIR: levent DTO'su (`WARP_BEAM_SELECT`) lot listesini " +
      "yarnMovements'tan okur; tak/sök/tüket/bitir/hurda iplik defterine YAZMAZ (kg zaten sarımda düştü).",
  },
  {
    dosya: "routes/finance.routes.ts",
    neden:
      "ÖN MUHASEBE. Kendi rejim kapısını taşır (`requireFinanceEnabled`). İplik dokunuşu " +
      "satış faturasının stok düşümüdür ve TEK RESOLVER'DAN geçer: " +
      "`resolveYarnOutOnInvoiceEnabled` = finance && ticaret && iplik && altBayrak (K10). " +
      "Yani iplik KAPALIYKEN bu yol zaten no-op'tur ve §4b bunu mekanik ölçer. Route kapısı " +
      "EKLENEMEZ: fatura kesmek iplik modülü olmadan da meşrudur (kumaş faturası).",
  },
  {
    dosya: "routes/goods-receipt.routes.ts",
    neden:
      "MAL KABUL. Router `requireTicaretEnabled` taşır, İPLİK kapısı TAŞIMAZ ve bu DOĞRU: " +
      "route kapısı konulsaydı KUMAŞ mal kabulü de iplik modülüne bağlanırdı. Kapı SERVİS " +
      "düzeyinde ve TEK YAZARIN İÇİNDE: `applyYarnMovementTx` gövdesinin ilk işi " +
      "`readIplikEnabled` (2026-09-02). ⚠️ ÖNCEKİ HÂLİ AÇIK KENARDI ve ölçüldü: ticaret " +
      "AÇIK + iplik KAPALI bir kurulumda bu yüzey kg defterine GERÇEKTEN yazıyordu " +
      "(K10'un fatura için kapattığı sızıntının ikizi). §4d o kapıyı ADIYLA izliyor.",
  },
  {
    dosya: "routes/subcontractor-weaving.routes.ts",
    neden:
      "FASON DOKUMA (G2, 2026-09-14). Kendi rejim kapısını taşır (`requireDokumaEnabled`); iplik dokunuşu " +
      "GEÇİŞLİ ve YANILTICIDIR: `createInitialEntry` (inventory zinciri) ve `nextPrefixedSequenceTx` " +
      "(subcontractor.service) üzerinden. Bu yüzey kg defterine YAZMAZ; levent kalemi F1 defterine yazar, iplik kalemi G1'de " +
      "kendi kapısıyla gelir. Route kapısı KONULAMAZ: dokuma fasonu iplik/ticaret modülü olmadan meşrudur.",
  },
  {
    dosya: "routes/stock-count.routes.ts",
    neden:
      "STOK SAYIMI — mal kabulle AYNI SINIF. Router `requireTicaretEnabled` taşır; " +
      "`stock-count.service` YARN kalemli sayım farkını `applyYarnMovementTx` " +
      "(ADJUST_IN/ADJUST_OUT) ile deftere yazar. Route kapısı KONULAMAZ (aynı sayım " +
      "fişinde kumaş satırları da var); kapı TEK YAZARIN içindedir (§4d).",
  },
];

/**
 * KG DEFTERİNE YAZAN TEK MOTOR `applyYarnMovementTx` — çağıranları BEKLENTİ
 * LİSTESİYLE kilitli.
 *
 * NEDEN: route kapısı bu modülde tek başına yetmiyor (yukarıdaki iki açık
 * kenar). Bekçinin işi boşluğu gizlemek değil, boşluğun BÜYÜMESİNİ engellemek:
 * deftere yazan yeni bir yüzey eklendiği gün bu liste bayatlar ve kırmızı olur
 * — o an "bu yüzeyin iplik kapısı ne" sorusu sorulmak ZORUNDA kalır.
 */
const DEFTER_YAZARLARI: ReadonlyArray<{ dosya: string; neden: string }> = [
  { dosya: "services/yarn.service.ts", neden: "MOTORUN KENDİSİ (tek yazar) — uçları `requireIplikEnabled` kapılı." },
  { dosya: "services/goods-receipt.service.ts", neden: "Mal kabul YARN kalemi → IN. Ticaret kapılı; iplik kapısı motorun İÇİNDE (§4d)." },
  { dosya: "services/helpers/yarn-receipt-reversal.helper.ts", neden: "Mal kabul iplik kaleminin GERİ SARIMI (ADJUST_OUT, lot kopyalı) — goods-receipt.service'ten taşındı; kapısı çağıranınki: ticaret kapılı, iplik kapısı motorun İÇİNDE (§4d)." },
  { dosya: "services/stock-count.service.ts", neden: "Sayım farkı → ADJUST_IN/ADJUST_OUT. Ticaret kapılı; iplik kapısı motorun İÇİNDE (§4d)." },
  { dosya: "services/stock-count-reversal.service.ts", neden: "Sayım stornosu → sayımın net iplik farkının ters ADJUST'u. Ticaret kapılı; iplik kapısı motorun İÇİNDE (§4d), önizleme kapalı modülü engel olarak listeler." },
  { dosya: "services/invoice.service.ts", neden: "Satış faturası stok düşümü → `resolveYarnOutOnInvoiceEnabled` KAPILI (K10)." },
  { dosya: "services/warp-beam-wind.service.ts", neden: "Levent sarımı (IN_HOUSE) → WARP_ISSUE/WARP_RETURN, iptali → tersleri. Devere kapılı; iplik kapısı AKSİYON ANINDA motorun İÇİNDE (§4d) — devere→iplik bağımlılığı yok (K3)." },
  { dosya: "services/helpers/warp-beam-wind-write.helper.ts", neden: "Sarımın YAZIM KOLU (WOUND satırı + iplik payı; raşel takımında aynı tx'te N kez) — `warp-beam-wind.service`ten bölündü (lint tavanı). Kapı aynı: devere route kapısı + motorun içindeki iplik kapısı (§4d); yeni yüzey DEĞİL." },
  { dosya: "services/subcontractor-yarn.service.ts", neden: "Fason G1: iplik kalemi (kind=YARN) → SUBCONTRACT_OUT/_CANCEL/RETURN/_CANCEL. Fason router'ı KAPISIZ (top/levent yolları ipliğe dokunmaz); iplik satırı gövde kapısı (`readIplikEnabled` 403) + iplik kapısı AKSİYON ANINDA motorun İÇİNDE (§4d); dönüş/bakiye uçları `requireIplikEnabled` kapılı." },
];

function main(): void {
  console.log("=== İPLİK REJİM KAPISI BEKÇİSİ (iplik.enabled) ===\n");

  const tarama = rejimTaramasiKur({ src: SRC, modeller: IPLIK_MODELLERI, kapiAdlari: [KAPI] });
  const ilgili = tarama.ilgiliRouterlar();

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  check(
    "§1a Körlük zemini: router dosyaları tarandı",
    tarama.routerlar.length >= 40,
    `router=${tarama.routerlar.length}`,
  );
  check(
    "§1b Körlük zemini: iplik-özel router'lar TÜRETİLEBİLDİ",
    ilgili.length >= 3,
    `bulunan=${ilgili.length} → ${ilgili.map((x) => path.basename(x.f)).join(", ")}`,
  );

  // ── §2 ⭐ ASIL KONTROL ────────────────────────────────────────────────────
  const muafSet = new Set(MUAF.map((m) => path.join(SRC, m.dosya)));
  const kapisiz = ilgili.filter((x) => !muafSet.has(x.f) && !tarama.kapiliMi(x.f));
  check(
    "§2 ⭐ İplik modeline dokunan HER router rejim kapısı taşıyor",
    kapisiz.length === 0,
    kapisiz.length === 0
      ? `${ilgili.length - muafSet.size} router kapılı`
      : `KAPISIZ: ${kapisiz.map((x) => `${path.relative(SRC, x.f)} (→ ${x.model})`).join(", ")}`,
  );

  // ── §3 MUAF LİSTESİ BAYATLIK DENETİMİ ─────────────────────────────────────
  const olu = MUAF.filter((m) => !fs.existsSync(path.join(SRC, m.dosya)));
  check("§3a Muaf listesinde ölü satır yok", olu.length === 0, olu.map((m) => m.dosya).join(", "));
  const gereksiz = MUAF.filter((m) => {
    const f = path.join(SRC, m.dosya);
    return fs.existsSync(f) && (tarama.kapiliMi(f) || tarama.modelDokunusu(f) === null);
  });
  check(
    "§3b Muaf listesinde gereksiz satır yok (artık kapılı ya da ipliğe dokunmuyor)",
    gereksiz.length === 0,
    gereksiz.map((m) => m.dosya).join(", "),
  );
  const gerekcesiz = MUAF.filter((m) => !m.neden || m.neden.trim().length < 20);
  check(
    "§3c Her muafın GEREKÇESİ yazılı",
    gerekcesiz.length === 0,
    gerekcesiz.map((m) => m.dosya).join(", "),
  );

  // ── §4 ⭐ DEFTERE YAZAN MOTORUN ÇAĞIRANLARI ───────────────────────────────
  const servisDosyalari: string[] = [];
  (function yuru(dir: string): void {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (e.name.endsWith(".ts")) servisDosyalari.push(tam);
    }
  })(SRC);
  // ⚠️ YORUMLAR SÖKÜLÜR: `yarn-balance-guard.helper.ts` ve `invoice.service.ts`
  // motorun adını AÇIKLAMA satırlarında da yazıyor. Sökülmeseydi bu bölüm
  // "yazar" olmayan iki dosyayı yazar sayardı (yanlış kırmızı).
  const cagriRe = new RegExp("\\bapplyYarnMovementTx\\s*\\(");
  const gercekYazarlar = servisDosyalari
    .filter((f) => cagriRe.test(yorumlariSok(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();
  check(
    "§4 Körlük zemini: `applyYarnMovementTx` çağıranları bulundu",
    gercekYazarlar.length >= 3,
    `bulunan=${gercekYazarlar.length} → ${gercekYazarlar.join(", ")}`,
  );
  const beklenen = new Set(DEFTER_YAZARLARI.map((d) => d.dosya));
  const yeniYazar = gercekYazarlar.filter((f) => !beklenen.has(f));
  check(
    "§4a ⭐ Kg defterine yazan YENİ bir yüzey yok (beklenti listesi güncel)",
    yeniYazar.length === 0,
    yeniYazar.length
      ? `LİSTEDE OLMAYAN yazar: ${yeniYazar.join(", ")} — bu yüzeyin iplik kapısı NE? ` +
        "(route kapısı mı, resolveYarnOutOnInvoiceEnabled gibi servis resolver'ı mı) " +
        `karar verip DEFTER_YAZARLARI listesine gerekçesiyle ekle`
      : "",
  );
  const olenYazar = DEFTER_YAZARLARI.filter((d) => !gercekYazarlar.includes(d.dosya));
  check(
    "§4b Beklenti listesinde ölü satır yok (artık deftere yazmayan dosya)",
    olenYazar.length === 0,
    olenYazar.map((d) => d.dosya).join(", "),
  );
  // K10 köprüsü: fatura yolu alt bayrağı DOĞRUDAN okumaz.
  const invoiceSrc = yorumlariSok(
    fs.readFileSync(path.join(SRC, "services/invoice.service.ts"), "utf8"),
  );
  check(
    "§4c ⭐ Fatura yolu iplik kapısını RESOLVER'DAN geçer (alt bayrağı doğrudan okumaz)",
    invoiceSrc.includes("resolveYarnOutOnInvoiceEnabled(") &&
      !invoiceSrc.includes("readFinanceYarnOutOnInvoiceEnabled("),
    "K10: `finance && ticaret && iplik && altBayrak` tek fonksiyonda çözülür",
  );

  // ── §4d ⭐ MOTORUN KENDİ KAPISI — GÖVDENİN İLK İŞİ ────────────────────────
  // Route kapısı bu modülde tek başına YETMİYOR: mal kabul ve stok sayımı
  // meşru olarak yalnız `requireTicaretEnabled` taşır. Kararı çağıranlara
  // dağıtmak yerine TEK YAZARIN içine koyduk — "yeni çağıran kapısız doğamaz"
  // (eksi bakiye guard'ıyla aynı gerekçe). SIRA da ölçülür: kontrol ilk `await`
  // olmalı, yoksa reddedilen bir hareket önce başka sorgular koşturur ve
  // kapının "hiçbir şey yazılmadan durdurur" iddiası zayıflar.
  const yarnSrc = yorumlariSok(
    fs.readFileSync(path.join(SRC, "services/yarn.service.ts"), "utf8"),
  );
  const fnIdx = yarnSrc.indexOf("export async function applyYarnMovementTx");
  const sonrakiExport = yarnSrc.indexOf("\nexport ", fnIdx + 10);
  const govde = fnIdx >= 0 ? yarnSrc.slice(fnIdx, sonrakiExport > 0 ? sonrakiExport : undefined) : "";
  check("§4d Körlük zemini: `applyYarnMovementTx` gövdesi bulundu", govde.length > 200, `${govde.length} karakter`);
  const okumaIdx = govde.indexOf("readIplikEnabled(");
  const ilkAwaitIdx = govde.indexOf("await ");
  check(
    "§4d ⭐ `applyYarnMovementTx` gövdesinin İLK işi `readIplikEnabled` (modül kapalıysa 403)",
    okumaIdx >= 0 && ilkAwaitIdx >= 0 && okumaIdx > ilkAwaitIdx && okumaIdx - ilkAwaitIdx < 40,
    okumaIdx < 0
      ? "çağrı YOK — ticaret AÇIK + iplik KAPALI kurulumda mal kabul ve stok sayımı " +
        "kg defterine yazmaya DEVAM eder (ölçülmüş sızıntı, 2026-09-02)"
      : okumaIdx <= ilkAwaitIdx || okumaIdx - ilkAwaitIdx >= 40
        ? "çağrı var ama İLK await değil — kapı, reddedeceği bir hareket için önce sorgu koşturuyor"
        : "tek kaynak: çağıranlara ayrıca kontrol EKLENMEZ",
  );
  check(
    "§4e Kapı 403 + `MODULE_DISABLED` ile reddediyor (istemci `details.code` okur)",
    /AppError\.forbidden\(/.test(govde) && govde.includes('code: "MODULE_DISABLED"'),
    "400/500 dönmek panelin 'modül kapalı' ile 'geçersiz istek' farkını ayırt etmesini engellerdi",
  );

  for (const m of MUAF) console.log(`   ℹ️  muaf: ${m.dosya} — ${m.neden}`);
  for (const d of DEFTER_YAZARLARI) console.log(`   ℹ️  defter yazarı: ${d.dosya} — ${d.neden}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
