// =============================================================================
// MODÜL ANAHTARLARI — TEK KAYNAK SÖZLEŞMESİ
// =============================================================================
// `src/constants/module-flags.ts` yedi modül şalterinin TEK KAYNAĞIDIR ve
// BEŞ tüketicisi var: `setFeatureFlags` bağımlılık doğrulaması · `admin.routes`
// ham ayar ucunun reddi (K7) · middleware kapıları · grandfathering migration'ı ·
// `feature-flag.routes.ts` `flagWriteGuard`ının SÜPERADMİN dalı (2026-09-03 —
// modül anahtarını yalnız sistem hesabı yazar; ayrı bekçi `test_superadmin.ts`).
// Bu bekçi o dosyanın gerçeği söylediğini ölçer.
//
// ⚠️ EN ÖNEMLİ KONTROL §2: `MODULE_SETTING_KEYS` DB anahtarlarını DÜZ STRING
// tutar ve bu BİLİNÇLİDİR — `system-setting.service` bu dosyayı import ettiği
// için ters yön dairesel bağımlılık kurardı ve CommonJS'te modül init sırasına
// göre `undefined` bir Set üretirdi (yani K7 kapısı SESSİZCE açılırdı, hiçbir
// hata vermeden). İkiliğin bedeli budur: iki liste ayrışabilir. §2 tam olarak
// o ayrışmayı ölçer — sabit dosyadaki her DB anahtarı `SETTING_KEYS`te de
// olmalı ve tersi.
//
// ⚠️ §3 "yeni rejim anahtarı sessizce doğamaz": `<modül>.enabled` biçimindeki
// HER `SETTING_KEYS` değeri modül kümesinde olmak zorundadır. Bu, "sekizinci
// modülü ekledim ama sabit dosyaya yazmayı unuttum" hatasını yazıldığı gün
// kırmızı yapar — o hata sessiz olsaydı ham ayar ucu o anahtarı yazmaya devam
// ederdi.
//
// Salt-okunur: DB'ye BAĞLANMAZ, HTTP atmaz — boş CI veritabanında da tam koşar
// (küme A'yı, yani API'nin çalışma anındaki çıktısını `test_feature_flag_contract`
// ölçüyor; burada kaynak metni ve Zod şeması yeterli).
// Koşum: npx tsx scripts/test_module_flags.ts
//
// NEGATİF SONDALAR — 2026-09-02'de koşuldu (çıkış kodu ölçüldü, `git checkout`
// ile geri alındı):
//   ① sabit dosyadan bir anahtar düşerse:
//      sed -i '' '/"depoMultiEnabled",/d' src/constants/module-flags.ts  → SONDA-10
//   ② migration açıklaması servisten AYRIŞIRSA (§6):
//      sed -i '' "s/'İplik modülü (kg defteri — iplik stok ve hareketleri)'/'İplik'/" \
//        prisma/migrations/20260902230000_*/migration.sql                → SONDA-11
//   ③ K7 reddi kalkarsa (§5):
//      sed -i '' 's/if (MODULE_SETTING_KEYS.has(key)) {/if (false) {/' \
//        src/routes/admin.routes.ts                                      → SONDA-12
// SONDA TABLOSU (ölçüldü — md5 ile birebir geri alındı):
//   SONDA-10  → çıkış 1 · 3 ❌ · §1a + §1b + §6b (alan kümesinden düştü)
//   SONDA-10b → çıkış 1 · 2 ❌ · §1b + §3b (DB anahtarı kümesinden düştü — "yeni rejim
//               anahtarı sessizce doğamaz" kuralının doğrudan ölçümü)
//   SONDA-11  → çıkış 1 · 1 ❌ · §6d (migration açıklaması servisten ayrıştı)
//   SONDA-12  → çıkış 1 · 1 ❌ · §5a (ham ayar ucunun reddi kalktı)
//   SONDA-25  → çıkış 1 · 1 ❌ · §9b — 2026-09-03. `readIplikEnabled` ETKİN değer
//               döndürüldü (`asBoolean(...) && (await readTicaretEnabled(tx))`), yani
//               K4'ün "HAM değer döner" kararı tersine çevrildi. D2 bu bozulmayı
//               denemiş ve ÜÇ bekçi de yeşil kalmıştı; §9 tam bu boşluk için var.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import {
  MODULE_FLAG_KEYS,
  MODULE_SETTING_KEYS,
  MODULE_DEPENDENCIES,
  MODULE_LABELS,
} from "../src/constants/module-flags";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import {
  middlewareGovdeAnalizi,
  migrationDamgaDegerleri,
  yorumlariSok,
} from "./lib/regime-gate-scan";

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
const SERVIS = path.join(SRC, "services/system-setting.service.ts");
const MW = path.join(SRC, "middlewares/module.middleware.ts");
const ADMIN_ROUTES = path.join(SRC, "routes/admin.routes.ts");
/**
 * MODÜL ANAHTARINI DAMGALAYAN MIGRATION'LAR — TEK DOSYA DEĞİL LİSTE (2026-09-12).
 *
 * ⚠️ NEDEN LİSTE: `20260902230000` UYGULANMIŞTIR ve değiştirilemez (checksum).
 * O damgadan sonra doğan her modül (ilki `devere.enabled`) kendi migration'ında
 * damgalanmak ZORUNDA. Tek dosyaya sabitlenmiş bekçi, yeni modülü "damgasız"
 * sayıp kırmızı verirdi ve tek çıkış yolu onu muaf listesine yazmak olurdu —
 * yani kuralı ölçmeyi bırakmak. Metinler BİRLEŞTİRİLEREK okunur.
 */
const MIGRASYONLAR: string[] = [
  "20260902230000_modul_anahtarlari_grandfathering",
  "20260912120000_devere_modul_anahtari",
  "20260913260000_dokuma_modul_anahtari",
  "20260915051000_emanet_modul_anahtari",
].map((d) => path.join(KOK, "prisma/migrations", d, "migration.sql"));

/**
 * `<modül>.enabled` biçiminde OLUP modül anahtarı OLMAYAN ayarlar.
 * Bugün BOŞ; doldurulursa gerekçe ZORUNLU (§3c iki yönlü denetler).
 */
const MODUL_OLMAYAN_ENABLED: Record<string, string> = {};

/** Migration'ın damgalamadığı modül anahtarları (gerekçeli). */
const MIGRASYON_DISI: Record<string, string> = {
  "finance.enabled":
    "Ön muhasebe anahtarı 2026-08-13'te DOĞDUĞUNDA damgalanmadı ve fabrikada bugün satırı YOK; " +
    "davranış `asBoolean(undefined) → false` kod sigortasından geliyor. Grandfathering migration'ı " +
    "GEÇMİŞİ değiştirmez, yalnız YENİ anahtarları kayda geçirir. Bu satırı migration'a eklemek, " +
    "fabrikanın 'ön muhasebeyi hiç açmadım' durumunu bir KARARA dönüştürürdü (aynı sonuç, ama " +
    "artık panelde 'kapatıldı' diye görünür) — bilinçli olarak yapılmadı.",
};

function servisMetni(): string {
  return yorumlariSok(fs.readFileSync(SERVIS, "utf8"));
}

/** `this.set(SETTING_KEYS.X, input.Y, "AÇIKLAMA", userId)` → { camelCase: açıklama }. */
function servisAciklamalari(): Map<string, string> {
  const kod = servisMetni();
  const out = new Map<string, string>();
  const re =
    /this\.set\(\s*SETTING_KEYS\.([A-Z0-9_]+),\s*input\.([A-Za-z0-9_]+),\s*"([^"]+)"/g;
  for (const m of kod.matchAll(re)) out.set(m[2]!, m[3]!);
  return out;
}

/** `src/routes` altındaki tüm route dosyaları (yorumları sökülmüş metinle). */
function tumRouteMetinleri(): Array<[string, string]> {
  const kok = path.join(SRC, "routes");
  const out: Array<[string, string]> = [];
  const yuru = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (e.name.endsWith(".routes.ts")) {
        out.push([path.relative(SRC, tam), yorumlariSok(fs.readFileSync(tam, "utf8"))]);
      }
    }
  };
  yuru(kok);
  return out;
}

function main(): void {
  console.log("=== MODÜL ANAHTARLARI — TEK KAYNAK SÖZLEŞMESİ ===\n");

  const flagKeys = [...MODULE_FLAG_KEYS].sort();
  const settingKeys = [...MODULE_SETTING_KEYS].sort();

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  check("§1a Körlük zemini: MODULE_FLAG_KEYS dolu", flagKeys.length >= 7, `n=${flagKeys.length}`);
  check(
    "§1b Körlük zemini: MODULE_SETTING_KEYS dolu",
    settingKeys.length === flagKeys.length,
    `alan=${flagKeys.length} dbAnahtar=${settingKeys.length}`,
  );
  check("§1c Körlük zemini: servis kaynağı okunabildi", servisMetni().length > 10000);
  const migrasyonEksik = MIGRASYONLAR.filter((p) => !fs.existsSync(p));
  check(
    "§1d Körlük zemini: damga migration'larının hepsi var",
    migrasyonEksik.length === 0,
    migrasyonEksik.length === 0
      ? `${MIGRASYONLAR.length} dosya`
      : `EKSİK: ${migrasyonEksik.join(", ")}`,
  );

  // ── §2 ⭐ İKİ AD UZAYI AYRIŞMIYOR (dairesel bağımlılık bedeli) ────────────
  const sk = SETTING_KEYS as unknown as Record<string, string>;
  const skDegerleri = new Set(Object.values(sk));
  const dbdeYok = settingKeys.filter((k) => !skDegerleri.has(k));
  check(
    "§2a ⭐ MODULE_SETTING_KEYS'teki her DB anahtarı SETTING_KEYS'te de var",
    dbdeYok.length === 0,
    dbdeYok.length ? `SETTING_KEYS'te YOK: ${dbdeYok.join(", ")} — düz string yazım hatası` : "",
  );
  // Ters yön §3'te (biçimden türetilerek) ölçülür.

  // ── §3 YENİ REJİM ANAHTARI SESSİZCE DOĞAMAZ ───────────────────────────────
  const rejimBicimi = /^[A-Za-z]+\.(enabled|multiEnabled)$/;
  const bicimseRejim = Object.values(sk).filter((v) => rejimBicimi.test(v)).sort();
  check(
    "§3a Körlük zemini: rejim biçimli SETTING_KEYS değeri bulundu",
    bicimseRejim.length >= 7,
    `bulunan=${bicimseRejim.length} → ${bicimseRejim.join(", ")}`,
  );
  const kacan = bicimseRejim.filter(
    (v) => !MODULE_SETTING_KEYS.has(v) && !MODUL_OLMAYAN_ENABLED[v],
  );
  check(
    "§3b ⭐ `<modül>.enabled` biçimli her ayar MODULE_SETTING_KEYS'te (ya da gerekçeli muaf)",
    kacan.length === 0,
    kacan.length
      ? `KÜMEDE YOK: ${kacan.join(", ")} — modül anahtarıysa sabit dosyaya ekle, değilse ` +
        "MODUL_OLMAYAN_ENABLED'a GEREKÇESİYLE yaz (ham ayar ucu aksi halde onu yazmaya devam eder)"
      : "",
  );
  const oluMuaf = Object.keys(MODUL_OLMAYAN_ENABLED).filter((k) => !skDegerleri.has(k));
  check(
    "§3c Muaf listesinde ölü satır yok",
    oluMuaf.length === 0,
    oluMuaf.join(", "),
  );

  // ── §4 DÖRT KAPI (şema + servis + etiket) ────────────────────────────────
  const B = Object.keys(updateSchema.shape);
  const semadaYok = flagKeys.filter((k) => !B.includes(k));
  check(
    "§4a ⭐ Her modül alanı `updateSchema`da (yoksa panelden AÇILAMAZ ve KAPATILAMAZ)",
    semadaYok.length === 0,
    semadaYok.join(", "),
  );
  const tipGevsek = flagKeys.filter((k) => {
    const kabul = updateSchema.safeParse({ [k]: true }).success;
    const reddet = !updateSchema.safeParse({ [k]: "evet" }).success;
    return !(kabul && reddet);
  });
  check(
    "§4b Modül alanları şemada boolean doğruluyor (true kabul · metin red)",
    tipGevsek.length === 0,
    tipGevsek.join(", "),
  );
  const kod = servisMetni();
  const yazmaDaliYok = flagKeys.filter(
    (k) => !kod.includes(`hasOwnProperty.call(input, "${k}")`),
  );
  check(
    "§4c ⭐ Her modül alanının `setFeatureFlags` yazma dalı var (hasOwnProperty kalıbıyla)",
    yazmaDaliYok.length === 0,
    yazmaDaliYok.length
      ? `dal YOK: ${yazmaDaliYok.join(", ")} — döngüsel/destructuring yazım sözleşme bekçisini KÖR bırakır`
      : "",
  );
  const payloadYok = flagKeys.filter((k) => !new RegExp(`\\b${k}:\\s*await\\s+read`).test(kod));
  check(
    "§4d Her modül alanı `getFeatureFlags` yükünde dönüyor",
    payloadYok.length === 0,
    payloadYok.join(", "),
  );
  const etiketsiz = flagKeys.filter((k) => !MODULE_LABELS[k]);
  check("§4e Her modülün Türkçe adı var (MODULE_LABELS)", etiketsiz.length === 0, etiketsiz.join(", "));

  // ── §5 ⭐ HAM AYAR UCU MODÜL ANAHTARINI REDDEDİYOR (K7) ───────────────────
  const adminKod = yorumlariSok(fs.readFileSync(ADMIN_ROUTES, "utf8"));
  // ⚠️ DESEN İKİ ADI DA KABUL EDER ve bu bilinçli (ölçüldü 2026-09-15): küme
  // `MODULE_SETTING_KEYS`ten `SUPERADMIN_ONLY_SETTING_KEYS`e GENİŞLETİLDİĞİNDE
  // (Raporlar K3: rapor görünürlük listesi de ham uçtan yazılamaz) tek terime
  // bağlı desen KIRMIZI VERMEDEN kör kaldı — koruma yerindeydi, bekçi göremiyordu.
  // Bu, "sessiz kapı ölümü"nün terim-yeniden-adlandırma biçimidir; çare dar bir
  // desen değil, korumanın ANLAMINI yakalayan bir desendir.
  check(
    "§5a ⭐ `PUT /api/admin/settings/:key` modül anahtarını reddediyor",
    /(MODULE_SETTING_KEYS|SUPERADMIN_ONLY_SETTING_KEYS)\.has\(\s*key\s*\)/.test(adminKod)
      && /code: "MODULE_KEY_RESERVED"/.test(adminKod),
    "reddedilmezse modül şalteri düz string (`\"true\"`) olarak yazılabilir ve bağımlılık " +
      "doğrulaması KOMPLE atlanır",
  );
  check(
    "§5b Reddin kodu `MODULE_KEY_RESERVED` (istemci `details.code` okur)",
    adminKod.includes('code: "MODULE_KEY_RESERVED"'),
  );
  check(
    "§5c Ret mesajı doğru yüzeyi gösteriyor (Genel Ayarlar → Modüller)",
    adminKod.includes("Genel Ayarlar → Modüller"),
  );

  // ── §6 ⭐ MIGRATION AÇIKLAMALARI SERVİSLE BİREBİR ─────────────────────────
  // Ayrışırsa AYNI satır, damgayı atan kurulumda bir açıklamayla, panelden ilk
  // düzenlemeden sonra BAŞKASIYLA görünür.
  const sql = MIGRASYONLAR.map((p) => fs.readFileSync(p, "utf8")).join("\n");
  const aciklamalar = servisAciklamalari();
  check(
    "§6a Körlük zemini: servis açıklamaları ayrıştırıldı",
    aciklamalar.size >= 20,
    `n=${aciklamalar.size}`,
  );
  const damgalanacak = flagKeys.filter((k) => {
    const dbKey = servisDbAnahtari(kod, k);
    return dbKey !== null && !MIGRASYON_DISI[dbKey];
  });
  check(
    "§6b Körlük zemini: damgalanması beklenen modül sayısı",
    damgalanacak.length >= 6,
    `n=${damgalanacak.length} → ${damgalanacak.join(", ")}`,
  );
  // ⚠️ "DAMGALANDI" = VALUES demetinin ilk elemanı olmak. Düz `sql.includes`
  // YETMEZ ve 2026-09-02'de yetmediği ölçüldü: ticaret/iplik değeri artık
  // `finance.enabled`i OKUYARAK türetiliyor, yani o anahtar SQL metninde
  // geçiyor ama DAMGALANMIYOR. Metin araması §6e'yi ("muaf listesinde ölü
  // satır yok") yanlış kırmızıya düşürürdü — okunan ile yazılan aynı sayılırdı.
  const damgalananlar = migrationDamgaDegerleri(sql);
  const eksikAnahtar = damgalanacak.filter((k) => {
    const dbKey = servisDbAnahtari(kod, k)!;
    return !damgalananlar.has(dbKey);
  });
  check(
    "§6c ⭐ Migration her modül anahtarını damgalıyor",
    eksikAnahtar.length === 0,
    eksikAnahtar.length ? `damgada YOK: ${eksikAnahtar.join(", ")}` : "",
  );
  const aciklamaSapmasi = damgalanacak.filter((k) => {
    const d = aciklamalar.get(k);
    return !d || !sql.includes(d);
  });
  check(
    "§6d ⭐ Migration `description` metinleri `setFeatureFlags` ile BİREBİR",
    aciklamaSapmasi.length === 0,
    aciklamaSapmasi.length
      ? `sapan: ${aciklamaSapmasi.map((k) => `${k}="${aciklamalar.get(k) ?? "—"}"`).join(" · ")}`
      : "",
  );
  const oluMigrasyonMuaf = Object.keys(MIGRASYON_DISI).filter(
    (k) => !MODULE_SETTING_KEYS.has(k) || damgalananlar.has(k),
  );
  check(
    "§6e Migration muaf listesinde gereksiz/ölü satır yok",
    oluMigrasyonMuaf.length === 0,
    oluMigrasyonMuaf.join(", "),
  );

  // ── §7 ⭐ BAĞIMLILIK HARİTASI ↔ MIDDLEWARE SIRASI ─────────────────────────
  const mw = yorumlariSok(fs.readFileSync(MW, "utf8"));
  for (const [bagimli, onKosul] of Object.entries(MODULE_DEPENDENCIES)) {
    check(
      `§7a Bağımlılık hedefi modül kümesinde: ${bagimli} → ${onKosul}`,
      MODULE_FLAG_KEYS.has(bagimli) && MODULE_FLAG_KEYS.has(onKosul),
    );
    const mwAdi = `require${bagimli.charAt(0).toUpperCase()}${bagimli.slice(1)}`;
    const govdeIdx = mw.indexOf(`export async function ${mwAdi}(`);
    if (govdeIdx < 0) {
      // Yer tutucu modülün middleware'i YOK ve bu BİLİNÇLİ (ölü kapı yazmıyoruz).
      // ⚠️ Ama "middleware yok" iddiası ölçülmeli: route'lardan biri o adı
      // kullanıyorsa ortada import edilemeyen bir kapı var demektir ve o dosya
      // derlenmez/patlar. Vakumen yeşil bir `|| true` yazmak, tam da bu bekçinin
      // önlediği hata sınıfı olurdu.
      const kullanan = tumRouteMetinleri().filter(([, t]) =>
        new RegExp(`\\b${mwAdi}\\b`).test(t),
      );
      check(
        `§7b ${bagimli} yer tutucu: ${mwAdi} ne tanımlı ne de bir route'ta kullanılıyor`,
        kullanan.length === 0,
        kullanan.length ? `kullanan route: ${kullanan.map(([f]) => f).join(", ")}` : "",
      );
      continue;
    }
    const govde = mw.slice(govdeIdx, govdeIdx + 1600);
    const onKosulOkuyucu = `read${onKosul.charAt(0).toUpperCase()}${onKosul.slice(1)}(`;
    const bagimliOkuyucu = `read${bagimli.charAt(0).toUpperCase()}${bagimli.slice(1)}(`;
    const iOn = govde.indexOf(onKosulOkuyucu);
    const iBag = govde.indexOf(bagimliOkuyucu);
    check(
      `§7c ⭐ ${mwAdi} ÖNCE ön koşulu (${onKosul}) ölçüyor`,
      iOn >= 0 && iBag >= 0 && iOn < iBag,
      iOn < 0
        ? `${onKosulOkuyucu} çağrısı YOK — tutarsız çift (elle SQL / eski dump) kapıdan geçer`
        : iBag < 0
          ? `${bagimliOkuyucu} çağrısı YOK`
          : "sıra ters: mesaj yanlış anahtarı söyler ve operatör yanlış toggle'a gider",
    );
    check(
      `§7d ${mwAdi} eksik olan anahtarı söylüyor (dependent alanı)`,
      govde.includes(`dependent:`),
      "403 gövdesi hangi modülün eksik olduğunu taşımazsa panel doğru yönlendiremez",
    );
  }

  // ── §8 ⭐ KÖPRÜ BAYRAĞI TEK RESOLVER'DA (K10) ─────────────────────────────
  const srcDosyalari: string[] = [];
  (function yuru(dir: string): void {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (e.name.endsWith(".ts")) srcDosyalari.push(tam);
    }
  })(SRC);
  const altBayrakCagiranlar = srcDosyalari
    .filter((f) =>
      /\breadFinanceYarnOutOnInvoiceEnabled\s*\(/.test(yorumlariSok(fs.readFileSync(f, "utf8"))),
    )
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"));
  check(
    "§8 ⭐ Köprü alt bayrağı YALNIZ `resolveYarnOutOnInvoiceEnabled` içinde okunuyor",
    altBayrakCagiranlar.length === 1 &&
      altBayrakCagiranlar[0] === "services/system-setting.service.ts",
    `okuyan dosyalar: ${altBayrakCagiranlar.join(", ") || "(hiç — okuyucu silinmiş olabilir)"}`,
  );

  // ── §8b ⭐ MODÜL ALTI BAYRAKLAR TEK RESOLVER'DA (§3.6 / D8) ───────────────
  // §8'in genelleştirilmişi. Ebeveyni olan alt bayrakların HAM okuyucusu, ETKİN
  // değeri çözen resolver'ın DIŞINDA çağrılmamalı — çağrılırsa modül KAPALIYKEN
  // de o bayrağın kuralı koşar. Ölçüldü (Dilim 2 keşfi): `requireProductionEnabled`
  // taşımayan route'lardan 443 kaynak dosyanın 350'sine hâlâ ulaşılıyor, yani
  // "router zaten kapılı" cümlesi bu bayraklar için YETERLİ DEĞİL.
  //
  // ⚠️ `yorumlariSok` ŞART: `cash-balance-guard.helper` ve `yarn-balance-guard.helper`
  // `readTamburOverQuantityEnabled`i yalnız YORUMDA "emsali" diye anıyor; ham
  // metin taraması bu iki dosyayı "tüketici" sanıp düzeltilemez kırmızı verirdi
  // (aynı körlük `test_feature_flag_contract §14`te de vardı, aynı gün kapandı).
  const RESOLVER_ALTI: Record<string, { resolver: string; ebeveyn: string }> = {
    readPurchaseBlockOverReceiptEnabled: {
      resolver: "resolvePurchaseBlockOverReceiptEnabled",
      ebeveyn: "ticaret",
    },
    readGoodsReceiptRequirePriceEnabled: {
      resolver: "resolveGoodsReceiptRequirePriceEnabled",
      ebeveyn: "ticaret",
    },
    readKursunBypassEnabled: { resolver: "resolveKursunBypassEnabled", ebeveyn: "üretim" },
    readTamburOverQuantityEnabled: {
      resolver: "resolveTamburOverQuantityEnabled",
      ebeveyn: "üretim",
    },
    readTamburUndoFullSameDayOnly: {
      resolver: "resolveTamburUndoFullSameDayOnly",
      ebeveyn: "üretim",
    },
    readBatchShortNumberEnabled: {
      resolver: "resolveBatchShortNumberEnabled",
      ebeveyn: "üretim",
    },
    // ⚠️ İPLİK KÖPRÜSÜ DE BU TABLODA (2026-09-03). §8 onun yalnız TEKLİĞİNİ
    // ölçüyordu — resolver'ın gerçekten modül şalterini okuduğunu ve
    // `getFeatureFlags`in HAM değeri döndürdüğünü HİÇ ölçmüyordu. Yani D8'in
    // ilk resolver'ı, D8 için yazılan tablonun dışında kalmıştı.
    readFinanceYarnOutOnInvoiceEnabled: {
      resolver: "resolveYarnOutOnInvoiceEnabled",
      ebeveyn: "ticaret+iplik",
    },
    // Z1 üretim belge zinciri (2026-09-18): üç kapı `helpers/production-chain-gates.helper` yalnız resolver okur.
    readDevereBeamWeavingLinkRequired: { resolver: "resolveBeamWeavingLinkRequired", ebeveyn: "ticaret+iplik+devere" },
    readDokumaRunWeavingOrderRequired: { resolver: "resolveRunWeavingOrderRequired", ebeveyn: "üretim+dokuma" },
    readDokumaOrderLineLinkRequired: { resolver: "resolveOrderLineLinkRequired", ebeveyn: "üretim+dokuma" },
    // n irsaliye → 1 fatura (2026-09-18): onay toleransı muhasebe modülünün davranış bayrağı.
    readFinanceInvoiceMatchTolerance: { resolver: "resolveInvoiceMatchToleranceEnabled", ebeveyn: "finans" },
    // İplik lotu kalite bekletme (2026-09-18): doğuş + çıkış kapısı yalnız resolver okur.
    readGoodsReceiptYarnQualityHoldEnabled: { resolver: "resolveYarnQualityHoldEnabled", ebeveyn: "ticaret+iplik" },
  };

  const servisKodu = yorumlariSok(fs.readFileSync(SERVIS, "utf8"));
  /** §8c tamlık taraması — yorumlar SÖKÜLMÜŞ hâl (yorumdaki örnek imza sayılmasın). */
  const servisKaynagiHam = servisKodu;

  // ── §8c ⭐ TABLO TAMLIĞI: İKİ YÖNLÜ ────────────────────────────────────────
  // §8b'nin kör noktası tablonun KENDİSİYDİ: yeni bir modül-altı resolver
  // yazılırsa (ya da mevcut biri yeniden adlandırılırsa) bekçi onu HİÇ görmez
  // ve "tek resolver" kuralı sessizce yalnız eski beşlik için geçerli kalır.
  // Ölçüm kaynağa bakar, listeye değil.
  //   ① kaynaktaki HER `resolve*` tabloda mı (yeni resolver kaçamaz)
  //   ② tablodaki HER resolver kaynakta var mı (ölü satır tabloyu şişirmesin)
  const kaynaktakiResolverlar = [
    ...servisKaynagiHam.matchAll(/export\s+async\s+function\s+(resolve[A-Za-z0-9_]*)\s*\(/g),
  ].map((m) => m[1]);
  const tablodakiResolverlar = Object.values(RESOLVER_ALTI).map((v) => v.resolver);
  const tabloDisi = kaynaktakiResolverlar.filter((r) => !tablodakiResolverlar.includes(r));
  check(
    "§8c ⭐ system-setting.service'teki HER `resolve*` §8b tablosunda (yeni resolver bekçiden kaçamaz)",
    tabloDisi.length === 0,
    tabloDisi.length > 0
      ? `tabloya eklenmemiş: ${tabloDisi.join(", ")}`
      : `${kaynaktakiResolverlar.length} resolver kapsandı`,
  );
  const oluSatir = tablodakiResolverlar.filter((r) => !kaynaktakiResolverlar.includes(r));
  check(
    "§8c ⭐ tablodaki HER resolver kaynakta GERÇEKTEN var (ölü satır yok)",
    oluSatir.length === 0,
    oluSatir.length > 0 ? `kaynakta bulunamadı: ${oluSatir.join(", ")}` : "",
  );
  check(
    "§8c-zemin: resolver taraması boş dönmedi (regex bozulursa §8c vakumen yeşil kalır)",
    kaynaktakiResolverlar.length >= 5,
    `${kaynaktakiResolverlar.length} resolver bulundu`,
  );
  for (const [hamOkuyucu, { resolver, ebeveyn }] of Object.entries(RESOLVER_ALTI)) {
    const cagiranlar = srcDosyalari
      .filter((f) => new RegExp(`\\b${hamOkuyucu}\\s*\\(`).test(yorumlariSok(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    check(
      `§8b ⭐ ${hamOkuyucu} YALNIZ system-setting.service içinde okunuyor (${ebeveyn} altı)`,
      cagiranlar.length === 1 && cagiranlar[0] === "services/system-setting.service.ts",
      `okuyan dosyalar: ${cagiranlar.join(", ") || "(hiç — okuyucu silinmiş olabilir)"} — ` +
        `enforcement noktaları ${resolver} çağırmalı`,
    );
    // Resolver GERÇEKTEN modül şalterini soruyor mu? "resolve" adını taşıyıp
    // ham değeri döndüren bir gövde §8b'yi vakumen yeşile düşürürdü.
    const govde = middlewareGovdeAnalizi(SERVIS, resolver);
    check(
      `§8b ${resolver} tanımlı ve modül şalterini okuyor`,
      // Modül şalterleri: üretim · ticaret · muhasebe (`REGIME_GATES` ile aynı küme; finans 2026-09-18'de eklendi).
      govde.bulundu && govde.okuyucular.some((o) => /^read(Production|Ticaret|Finance)Enabled$/.test(o.ad)),
      govde.bulundu
        ? `gövdedeki okuyucular: ${govde.okuyucular.map((o) => o.ad).join(", ") || "(hiç)"}`
        : "fonksiyon bulunamadı",
    );
    check(
      `§8b ${resolver} alt bayrağın HAM okuyucusunu çağırıyor`,
      servisKodu.includes(`return ${hamOkuyucu}(tx)`),
      "resolver alt bayrağı okumuyorsa modül açıkken bile yanlış cevap verir",
    );
  }
  // `getFeatureFlags` HAM değeri döndürmeye DEVAM etmeli (P1/K4): panel kendi
  // yazdığını geri okur. Etkin değer dönseydi, modülü kapalı bir kurulumda
  // kullanıcı bayrağı açar ve toggle kapalı görünmeye devam ederdi.
  const ffGovde = servisKodu.slice(
    servisKodu.indexOf("async getFeatureFlags("),
    servisKodu.indexOf("async getFeatureFlags(") + 12000,
  );
  for (const [hamOkuyucu, { resolver }] of Object.entries(RESOLVER_ALTI)) {
    check(
      `§8b ⭐ getFeatureFlags HAM değeri döndürüyor: ${hamOkuyucu}`,
      ffGovde.includes(`${hamOkuyucu}(cacheClient)`) && !ffGovde.includes(`${resolver}(cacheClient)`),
      "panel kendi yazdığı değeri geri okumak zorunda (K4)",
    );
  }

  // ── §9 ⭐ OKUYUCULAR HAM DEĞER DÖNER (K4 sözleşmesi) ──────────────────────
  // `readIplikEnabled` ETKİN değeri (`ticaret && iplik`) DÖNMEZ: birleşimin TEK
  // çözüm noktası middleware'dir (panel toggle'ı kendi yazdığını geri okumak
  // zorunda — etkin değer dönseydi kullanıcı ipliği açar, anahtar kapalı
  // görünmeye devam ederdi). Ölçüldü: `return asBoolean(...) && (await
  // readTicaretEnabled(tx))` yazımı ÜÇ bekçiyi de yeşil bırakıyordu.
  // Yüklem basit ve mekanik: bir modül okuyucusunun gövdesi BAŞKA bir
  // `read*Enabled(` çağırmaz.
  for (const alan of flagKeys) {
    const okuyucu = `read${alan.charAt(0).toUpperCase()}${alan.slice(1)}`;
    const analiz = middlewareGovdeAnalizi(SERVIS, okuyucu);
    check(`§9a Körlük zemini: ${okuyucu} tanımlı`, analiz.bulundu);
    if (!analiz.bulundu) continue;
    const cagrilar = [...new Set(analiz.okuyucular.map((o) => o.ad))];
    check(
      `§9b ⭐ ${okuyucu} HAM değer döner (başka bayrak okumaz)`,
      cagrilar.length === 0,
      cagrilar.length
        ? `çağırdığı okuyucular: ${cagrilar.join(", ")} — etkin değer BURADA çözülmez; ` +
          "bağımlılık birleşimi middleware'e (ve Electron'da `useOperationsVisibility`e) aittir"
        : "",
    );
  }

  console.log("\n   Migration dışı bırakılan modül anahtarları:");
  for (const [k, why] of Object.entries(MIGRASYON_DISI)) console.log(`     · ${k} — ${why}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

/** camelCase alan → `this.set(SETTING_KEYS.X, input.<alan>` zincirinden DB anahtarı. */
function servisDbAnahtari(kod: string, alan: string): string | null {
  const m = new RegExp(
    `this\\.set\\(\\s*SETTING_KEYS\\.([A-Z0-9_]+),\\s*input\\.${alan}\\b`,
  ).exec(kod);
  if (!m) return null;
  return (SETTING_KEYS as unknown as Record<string, string>)[m[1]!] ?? null;
}

main();
