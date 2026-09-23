// =============================================================================
// Backend test koşucusu — TÜM scripts/test_*.ts'i SIRAYLA çalıştırır, sonuçları
// toplar, özet basar, herhangi biri başarısızsa exit 1.
// Çalıştır: npx tsx scripts/run-all-tests.ts   (veya npm test)
//
// NEDEN sıralı: testler aynı dev DB'sini paylaşır; her biri kendi business-key
// fixture'ını yaratıp finally'de temizler. Paralel koşum fixture çakışması
// yaratabilir → sıralı koşum güvenli. (jest/vitest YOK — CLAUDE.md kuralı.)
// =============================================================================
// .env'i BURADA da yükle. Koşucu bugüne kadar yalnız süreç başlatıyordu ve
// `DATABASE_URL`'i hiç okumuyordu — onu her test kendi içinde `src/lib/prisma`
// üzerinden alıyor. `productionDbGate()` hedefi koşumdan ÖNCE bilmek zorunda,
// yani bu import olmadan geçit her yerel koşumda "DATABASE_URL yok" deyip
// fail-closed düşerdi (2026-08-09'da negatif sondayla ölçüldü).
// Çocuk süreçlere `env: process.env` aynen geçtiği için davranış değişmez:
// dotenv var olan değişkenin ÜSTÜNE YAZMAZ.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agacAdi, dbAdi, defteYaz, rejimAdi } from "./lib/siklik-defteri";
import {
  FABRIKA_HACIM_ESIGI,
  fixtureHedefEngeli,
  hacimHedefEngeli,
  hedefDbAdi,
  semaHizasi,
} from "./lib/hedef-db-kapisi";
// STRICT anahtarı TEK KAYNAKTIR ([TD-10c]): ikinci bir bayrak ya da ikinci bir
// `process.env` okuması açılmaz — iki koşum iki farklı şey iddia ederdi.
import { BILINMEYEN_BEYAN, strictMi } from "./lib/atlama";

const SCRIPTS_DIR = join(__dirname);
const PER_TEST_TIMEOUT_MS = 180_000;
// spawnSync varsayılanı 1 MiB; aşılınca Node çocuğu öldürüp ENOBUFS döner ve
// çıktı ORTADAN kesilir → teşhis imkânsızlaşır. Ölçüm: en konuşkan test 5 KB,
// yani mutlu yolda ulaşılmıyor. Ama hata yolunda ulaşılabilir:
// PrismaClientValidationError tüm sorguyu basar (onlarca KB), döngü içinde stack
// basan testler var, ve `env: process.env` aynen geçtiği için ortamda DEBUG açan
// biri anında 1 MiB'ı aşar. Ucuz sigorta.
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

// SESSİZ YEŞİL DEVRALINAN — tanecik DOSYA (1e hükmü 2026-09-13). Ölçüldü (d9, 534
// bekçi ulaşılamaz DB ile): kusur 0 — iki üye vardı (`test_audit_p0` ·
// `test_p1b_barcode_collision`), `c0f743bf` ile beyanlı hâle geldi. Mandal 0'dan
// başlar; yalnız KÜÇÜLÜR. Üye artık sessiz değilse ölü muaf → kırmızı (iki yönlü).
const SESSIZ_YESIL_DEVRALINAN: ReadonlySet<string> = new Set<string>([]);

// Windows'ta `npx` = `npx.cmd`; spawnSync onu shell olmadan çözemez (ENOENT →
// her test 0.0s'de "çıkış kodu null" ile düşer). shell:true Windows'ta npx'i
// cmd.exe üzerinden çözer; Linux/CI'da (shell:false) doğrudan çalışır.
const IS_WIN = process.platform === "win32";

/** ❌ satırı + altındaki `↳` teşhis satırları (≤5), toplam ≤400 karakter; ❌ yoksa undefined. */
export function ilkKirmiziBlogu(out: string, enCokTeshis = 5, enCokKarakter = 400): string | undefined {
  const satirlar = out.split("\n");
  const i = satirlar.findIndex((l) => /^\s*(❌|✗)\s/.test(l));
  if (i < 0) return undefined;
  const blok = [satirlar[i]!.trim()];
  for (let j = i + 1; j < satirlar.length && blok.length <= enCokTeshis; j++) {
    const t = satirlar[j]!.trim();
    if (!t.startsWith("↳")) break;
    blok.push(t);
  }
  return blok.join("\n         ").slice(0, enCokKarakter);
}

/**
 * TİP KONTROLÜ GEÇİDİ — paketten ÖNCE koşar (~28sn).
 *
 * NEDEN GEÇİT: `scripts/` uzun süre HİÇBİR tsconfig'in `include`'unda değildi
 * (kök config `src/**\/*` ile sınırlı, `npm run lint` de `eslint src`). Sonuç:
 * bir servisin imzası ya da bir enum değişince `src` yeşil kalıyor, testler de
 * yeşil kalıyor — ama testin doğruladığı ŞEY sessizce boşa düşüyordu. 2026-08-01
 * denetiminde bulunan 87 tip hatasının içinde şunlar vardı: var olmayan bir enum
 * üyesiyle süzme (Prisma `undefined` koşulu atar → süzgeç no-op), yanlış ilişki
 * adıyla `deleteMany` (+ `.catch(() => {})` → temizlik sessizce hiç koşmadı),
 * `typeof err` ile `never`'a inen hata gövdesi kontrolleri, zorunlu hâle gelmiş
 * bir parametrenin `undefined` gitmesi. Hepsi YEŞİL test olarak raporlanıyordu.
 *
 * ⚠️ AYNI SINIF `data:` İÇİNDE DE VAR ve orada DAHA SESSİZ (2026-09-13, 6e ölçtü;
 * bugün gerçek bir hata geçirdi). Prisma `data` içindeki `undefined` alanı
 * SESSİZCE ATAR:
 *     RollStatus.DISPATCHED  → öyle bir üye YOK (doğrusu SHIPPED) → undefined
 *     update({ data: { status: undefined, warehouseId: null } })
 *     ⇒ warehouseId null oldu, status DEĞİŞMEDİ — fikstürün "topu stok dışına
 *       çıkar" adımı HİÇ ÇALIŞMADI
 * Ayrım load-bearing: **süzgeç no-op'u SONUCU değiştirir, `data` no-op'u
 * FİKSTÜRÜ değiştirir** — yani bekçi ölçmediği şeyi yeşil raporlar ve kırmızı
 * verecek bir şey kalmadığı için daha da sessizdir.
 * ⇒ Panzehir POZİTİF KONTROL: ***fikstürünü kendi kuran her bekçi, KURDUĞUNU
 *   ölçmek zorundadır.*** (6e'yi yalnız kendi koyduğu `§6p1 Sonda kurulumu:
 *   top stok kümesinin DIŞINDA` kontrolü yakaladı; tip kapısı filtre yüzünden
 *   koşmuyordu — yukarıdaki GEÇİT ATLANDI beyanı tam bu yüzden eklendi.)
 *
 * Tip hatası varken paketi koşmak yanıltıcıdır (yeşil ama anlamsız) → HIZLI DÜŞ.
 * Tek test koşarken (filtre argümanı) geçit ATLANIR — iterasyon hızlı kalsın.
 * Acil durumda: `SKIP_TYPECHECK=1 npm test`.
 */
function typecheckGate(): boolean {
  const started = Date.now();
  console.log("→ Tip kontrolü (scripts + prisma + src) …");
  const res = spawnSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.scripts.json"], {
    encoding: "utf8",
    cwd: join(SCRIPTS_DIR, ".."),
    env: process.env,
    shell: IS_WIN,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0 && !res.error) {
    console.log(`✅ Tip kontrolü temiz (${secs}s)\n`);
    return true;
  }
  console.log(`❌ TİP KONTROLÜ BAŞARISIZ (${secs}s) — test paketi KOŞULMADI.`);
  console.log("   Tip hatası varken testler yeşil görünse bile doğruladıkları şey");
  console.log("   sessizce boşa düşmüş olabilir. Önce aşağıdakileri düzelt:\n");
  console.log(`${(res.stdout ?? "") + (res.stderr ?? "")}`.trimEnd().replace(/^/gm, "   | "));
  console.log("\n   (Yalnız tip kontrolü: npm run typecheck:scripts)");
  return false;
}

/**
 * MİGRATION DURUMU GEÇİDİ — tip kontrolünden SONRA, paketten ÖNCE (~3sn).
 *
 * NEDEN GEÇİT (2026-09-05 ölçümü): dev DB iki migration geride olduğunda 453
 * bekçinin 134'ü kırmızı verdi ve teşhis, kullanıcının okuması gereken şey
 * "şemanız eski" iken, `TableDoesNotExist` stack'i olarak bırakıldı. Kırmızının
 * sebebi 6,5 dakika sonra ve 134 ayrı hata bloğu içinde anlaşılıyordu.
 *
 * Kapı tam da bu yüzden ÖNDE: eksik migration bir test arızası değil, ORTAM
 * arızasıdır ve paketi koşmak zaman kaybıdır.
 *
 * Tek test koşarken (filtre argümanı) ATLANIR — iterasyon hızlı kalsın (kapı
 * ~3sn, tek bekçi ~2sn; her koşuma eklemek döngüyü ikiye katlardı).
 * Acil durumda: `SKIP_MIGRATION_GATE=1 npm test`.
 */
function migrationGate(): boolean {
  const started = Date.now();
  console.log("→ Migration durumu …");
  const res = spawnSync("npx", ["prisma", "migrate", "status"], {
    encoding: "utf8",
    cwd: join(SCRIPTS_DIR, ".."),
    env: process.env,
    shell: IS_WIN,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  if (res.status === 0 && !res.error) {
    console.log(`✅ Migration durumu güncel (${secs}s)\n`);
    return true;
  }
  console.log(`❌ MİGRATION DURUMU GERİDE ya da BOZUK (${secs}s) — test paketi KOŞULMADI.`);
  console.log("   Eksik migration'la koşan paket, ilgisiz onlarca testte");
  console.log("   'TableDoesNotExist' olarak görünür (2026-09-05: 134/453).\n");
  console.log(out.trimEnd().replace(/^/gm, "   | "));
  console.log("\n   Çözüm: npm run prisma:migrate   (uygulanmamışları uygular)");
  return false;
}

/**
 * ÜRETİM VERİTABANI GEÇİDİ — HER ŞEYDEN ÖNCE koşar, FAIL-CLOSED.
 *
 * NEDEN: bu paket mock KULLANMAZ. 273 testin 235'i `src/lib/prisma`'yı doğrudan
 * import eder ve `DATABASE_URL` ne gösteriyorsa oraya YAZAR. Testlerde toplam
 * 1.539 `deleteMany` çağrısı var (209 dosyada). 2026-08-09 denetiminde ölçüldü:
 * dosyaların HİÇBİRİNDE ortam kontrolü yoktu — yani `DATABASE_URL` yanlışlıkla
 * saha sunucusunu gösterirse `npm test` canlı fabrika verisine 1.539 silme
 * gönderir. Tek koruma KONVANSİYONdu (silme kararları `TEST-`/`TST-` kod önekine
 * bakıyor); konvansiyon bir sed değildir.
 *
 * KURAL: yalnız YEREL host'a izin verilir. Gerekçe ölçümle seçildi —
 *   • dev  : yerel port, fabrikanın canlı YEDEĞİNİ taşıyan veritabanı
 *   • CI   : yerel port, CI'ın kendi veritabanı  (.github/workflows/ci.yml)
 *   • saha : fabrika sunucusu — sabit LAN IP + makine adı (docs/ops/DEPLOY-RUNBOOK.md)
 * ⚠️ HOST AYAĞI TEK BAŞINA YETMEZ ve bu cümle 2026-09-12'de düzeltildi: dev
 * hedefi artık fabrikanın canlı yedeği ve O DA localhost'ta. Bu yüzden ad ayağı
 * (`_test` ya da kabul kümesindeki `teks_ci`) ve hacim ayağı eklendi; CI ADIYLA
 * kabul kümesindedir, yoksa bu kapı CI'yı ilk ifadede düşürürdü.
 *
 * FAIL-CLOSED: `DATABASE_URL` yoksa ya da çözümlenemiyorsa DURUR. "Bilinmeyen
 * hedef" ile "güvenli hedef" aynı yeşile çıkmamalı.
 *
 * KAÇIŞ: uzak bir test DB'si gerçekten gerekiyorsa `ALLOW_NONLOCAL_TEST_DB=1`.
 * Bilinçli ve görünür bir karardır; geçtiğinde ekrana uyarı basar.
 * NODE_ENV/APP_ENV `production` ise kaçış anahtarı DA çalışmaz — orada
 * yanılma payı bırakmıyoruz.
 */
function productionDbGate(): void {
  const url = process.env.DATABASE_URL;
  const dur = () => {
    console.error("\n⛔ TEST PAKETİ DURDURULDU — üretim veritabanı koruması.\n");
    process.exit(1);
  };

  const nodeEnv = process.env.NODE_ENV ?? "";
  const appEnv = process.env.APP_ENV ?? "";
  if (nodeEnv === "production" || appEnv === "production") {
    console.error(
      `\n❌ NODE_ENV/APP_ENV "production" — test paketi üretim ortamında KOŞTURULAMAZ.\n` +
        `   (NODE_ENV=${nodeEnv || "<yok>"}, APP_ENV=${appEnv || "<yok>"})\n` +
        `   Bu kontrol ALLOW_NONLOCAL_TEST_DB ile atlanamaz.`
    );
    dur();
  }

  if (!url) {
    console.error(
      "\n❌ DATABASE_URL tanımlı değil. Hedef veritabanı bilinmiyor → fail-closed."
    );
    dur();
  }

  let host: string;
  let dbName: string;
  try {
    // postgresql:// şeması URL ile çözülür; hostname IPv6'da köşeli parantezsiz gelir.
    const u = new URL(url as string);
    host = u.hostname.toLowerCase();
    dbName = decodeURIComponent(u.pathname.replace(/^\//, "")) || "<isimsiz>";
  } catch {
    console.error(
      `\n❌ DATABASE_URL çözümlenemedi → hedefin yerel olduğu DOĞRULANAMIYOR (fail-closed).`
    );
    dur();
    return;
  }

  // ⚠️ AD AYAĞI DAL SEÇİMİNDEN ÖNCE: eskiden yalnız "yerel" dalının içindeydi ve
  // `ALLOW_NONLOCAL_TEST_DB=1` onu SESSİZCE kapatıyordu — o anahtar "yerel değil"
  // iddiasını gevşetmek içindir, "fixture değil" iddiasını değil. Unix soket
  // URL'inde `hostname` boş döndüğü için soketle koşan operatör de o kaçışı
  // vermek zorunda kalıyor, yani ad ayağını kapatmaya itiliyordu.
  const adEngeli = fixtureHedefEngeli();
  if (adEngeli) {
    console.error(`\n❌ ${adEngeli}\n`);
    dur();
  }
  if (process.env.BEKCI_HEDEF_ONAY === "1") {
    console.warn(`\n⚠️  FIXTURE OLMAYAN HEDEFE KOŞULUYOR: ${dbName} (BEKCI_HEDEF_ONAY=1)\n`);
  }

  const YEREL = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  if (YEREL.has(host)) {
    console.log(`→ Hedef DB: ${dbName} @ ${host} (yerel) ✅\n`);
    return;
  }

  if (process.env.ALLOW_NONLOCAL_TEST_DB === "1") {
    console.warn(
      `\n⚠️  UZAK VERİTABANINA TEST KOŞULUYOR: ${dbName} @ ${host}\n` +
        `   ALLOW_NONLOCAL_TEST_DB=1 ile bilinçli olarak geçildi.\n` +
        `   Bu paket ${"1.539"} adet deleteMany çağrısı içerir. Hedefin doğru olduğundan emin ol.\n`
    );
    return;
  }

  console.error(
    `\n❌ Test hedefi YEREL DEĞİL: ${dbName} @ ${host}\n\n` +
      `   Bu paket gerçek veritabanına yazar ve siler (1.539 deleteMany, 209 dosyada).\n` +
      `   Yerel olmayan bir hedefe koşmak canlı fabrika verisini yok edebilir.\n\n` +
      `   İzin verilen host'lar: ${[...YEREL].join(", ")}\n` +
      `   Gerçekten uzak bir TEST veritabanıysa: ALLOW_NONLOCAL_TEST_DB=1 npm test`
  );
  dur();
}

/**
 * ÜÇÜNCÜ AYAK — HACİM ve FAIL-CLOSED. Ad kapısı yanılabilir (fabrikanın bir
 * kopyası `..._test` adıyla doğabilir); veri hacmi yanılmaz. Ölçüm DÜŞERSE de
 * durulur: "ölçemedim" yokluk değil YANLIŞ HEDEF riskidir ve tek gerçek koruma
 * tam ihtiyaç anında açılmamalı. Kaçış `BEKCI_HEDEF_ONAY=1`; o hâlde not basılır.
 */
async function hacimGeciti(): Promise<void> {
  const { engel, topSayisi, olcumNotu } = await hacimHedefEngeli();
  if (engel) {
    console.error(`\n❌ ${engel}\n`);
    console.error("⛔ TEST PAKETİ DURDURULDU — hedef doğrulanamadı.\n");
    process.exit(1);
  }
  if (olcumNotu) {
    console.warn(`⚠️  Hedef hacmi ÖLÇÜLEMEDİ (${olcumNotu}) — BEKCI_HEDEF_ONAY=1 ile geçildi.\n`);
    return;
  }
  if (process.env.BEKCI_HEDEF_ONAY === "1" && (topSayisi ?? 0) > FABRIKA_HACIM_ESIGI) {
    console.warn(
      `\n⚠️  FABRİKA ÖLÇEĞİNDE HEDEFE KOŞULUYOR: ${hedefDbAdi()} ` +
        `(${topSayisi} top, eşik ${FABRIKA_HACIM_ESIGI}) — BEKCI_HEDEF_ONAY=1\n`,
    );
    return;
  }
  // Bu kapı TEK soruya cevap verir: "yazmak yıkıcı mı". Sayıyı "hedef güvenli"
  // diye okumak ayrı bir soruya (plan/performans bekçileri anlamlı mı) yanlış
  // cevap üretir — 1 satırlık tabloda PostgreSQL index seçmez. İkinci sert eşik
  // EKLENMEZ: güvenlik kapısına kalite kontrolü eklemek kaçışı ucuzlatır.
  console.log(
    `→ Hedef hacim: yıkıcı değil (eşik ${FABRIKA_HACIM_ESIGI}) ✅ · ` +
      `TEMSİLİLİK ölçülmedi: ${topSayisi} top\n`,
  );
}

/**
 * Şemanın SEMANTİK imzası — model/enum adları + alan adları kümesi.
 * Biçime ve öznitelik sırasına DUYARSIZ, alan EKSİKLİĞİNE duyarlı.
 */
function semaImzasi(yol: string): string | null {
  try {
    const satirlar = readFileSync(yol, "utf8").split("\n");
    const adlar: string[] = [];
    for (const l of satirlar) {
      const m = /^\s*(?:model|enum)\s+([A-Za-z][A-Za-z0-9_]*)/.exec(l) ?? /^\s{2}([a-zA-Z][A-Za-z0-9_]*)/.exec(l);
      if (m) adlar.push(m[1]!);
    }
    return createHash("sha256").update(adlar.sort().join("\n")).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** Ağaç ↔ üretilmiş istemci hizası: BEYAN eder, çıkış kodunu ETKİLEMEZ. */
function istemciHizasiBeyani(): void {
  const agac = semaImzasi(join(SCRIPTS_DIR, "..", "prisma", "schema.prisma"));
  const istemci = semaImzasi(join(SCRIPTS_DIR, "..", "node_modules", ".prisma", "client", "schema.prisma"));
  // İstemci kopyası yoksa SESSİZ KALMA: "ölçemedim" ile "hizalı" aynı değil.
  if (!agac || !istemci) {
    console.log("⚠️  İSTEMCİ HİZASI ÖLÇÜLEMEDİ — şema ya da üretilmiş kopya okunamadı (hüküm YOK)");
    return;
  }
  // ⚠️ HİZALI HÂLİ DE BASILIR — ve bu, kalemin KENDİ doktrininin dördüncü hâli.
  // Sessiz bırakınca "hizalı" ile "hiç koşmadı" çıktıda AYNI görünüyordu (1e
  // doğrularken tam buna düştü: satır yok → "kapı koşmuyor" sandı, oysa ağacı
  // hizalıydı). Üçüncü hizanın GÖRÜNMEZ olması bu kalemin var olma sebebiydi;
  // sağlıklı hâlini görünmez bırakmak aynı sorunu BİR KAT YUKARIDA kurardı.
  // ⚠️ TEK SATIR: kayma hâli uzun kalır (ne yapılacağını söyler), hizalı hâli
  // kısa — `Hedef DB` / `Hedef hacim` satırlarıyla aynı blokta ENVANTERDİR.
  // Ve çağrı bir gün refactor'da düşerse SATIRIN YOKLUĞU fark edilir.
  if (agac === istemci) {
    console.log(`→ İstemci hizası: ✅ hizalı (${agac})`);
    return;
  }
  console.log(
    "⚠️  ÜRETİLMİŞ İSTEMCİ ŞEMANDAN FARKLI — ayrışan şey ALAN KÜMESİ (biçim DEĞİL).\n" +
      `      ağaç ${agac} ↔ istemci ${istemci}\n` +
      "      Ortak `node_modules/.prisma` en son `generate` koşanın hâlini taşır.\n" +
      "      ⇒ Çözüm TEK KOMUT: npm run prisma:generate\n" +
      "      (Bu bir İHLAL değil HİZA KAYMASIDIR; çıkış kodu etkilenmez.)",
  );
}

/**
 * ŞEMA HİZASI BEYANI — `istemciHizasiBeyani`nin DB ayağı.
 *
 * Üç hizadan üçüncüsü: AĞAÇ ↔ ÜRETİLMİŞ İSTEMCİ zaten ölçülüyordu, AĞAÇ ↔ DB
 * yalnız filtresiz tam pakette (`migrationGate`, ~3 sn'lik ayrı süreç). Bu beyan
 * UCUZDUR (bir `readdir` + bir sorgu) ve FİLTRELİ koşumda da basılır — kapının
 * bilinçli yokluğunu SESSİZLİK yerine tek satıra çevirir.
 *
 * ⚠️ ÜÇ SONUÇ: hizalı · geride · ÖLÇÜLEMEDİ. Hizalı hâli de BASILIR — satırın
 * yokluğu, `istemciHizasiBeyani`nin dersiyle aynı sebeple fark edilebilir olmalı.
 */
async function semaHizasiBeyani(): Promise<void> {
  const h = await semaHizasi();
  if (h.durum === "hizali") {
    console.log(`→ Şema hizası: ✅ DB ağaçla hizalı (${h.agacta} migration)`);
    return;
  }
  if (h.durum === "olculemedi") {
    console.log(`⚠️  ŞEMA HİZASI ÖLÇÜLEMEDİ — ${h.neden} (hüküm YOK)`);
    return;
  }
  const liste = h.eksik.slice(0, 5).join(", ") + (h.eksik.length > 5 ? ` … (+${h.eksik.length - 5})` : "");
  console.log(
    `⚠️  DB AĞACIN ${h.eksik.length} MİGRATION GERİSİNDE (ağaçta ${h.agacta}) — eksik: ${liste}\n` +
      "      Eksik şemayla koşan bekçi, ORTAM arızasını MANTIK hatası gibi gösterir\n" +
      "      (ölçüldü: `test_zincir_uctan_uca` → `lot=undefined kg=0`).\n" +
      "      ⇒ Çözüm TEK KOMUT: npm run prisma:migrate\n" +
      "      (Bu bir İHLAL değil HİZA KAYMASIDIR; çıkış kodu etkilenmez.)",
  );
}

async function main() {
  // Opsiyonel filtre: `npx tsx scripts/run-all-tests.ts <substring>` → yalnız
  // adı eşleşen test'leri koşar (tek test/alt-küme doğrulaması için).
  const filter = process.argv[2];
  const haricListesi = (process.env.TEKSERP_HARIC ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  // SIKLIK DEFTERİ bağlamı — bir kez çözülür. Kirli ağaç `+` ile işaretlenir:
  // aynı sha'nın iki koşumu ayrışıyorsa, ağacın kirli olup olmadığı ④ sorusunun
  // ("AYNI sha ile ayrışıyor mu") cevabını değiştirir.
  const shaRes = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: SCRIPTS_DIR });
  const kirliRes = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", cwd: SCRIPTS_DIR });
  const HEAD_SHA = `${(shaRes.stdout ?? "?").trim() || "?"}${(kirliRes.stdout ?? "").trim() ? "+" : ""}`;
  // REJİM ve AĞAÇ defterin KAPSAM eksenleridir: bir kayıt, üretildiği rejimin
  // (yerel/CI) ya da ağacın dışında sayılamaz — iki ağacın dosyası ayrıdır.
  const REJIM = rejimAdi();
  const AGAC = agacAdi(SCRIPTS_DIR);
  let sonKosan: string | null = null;

  // Geçit SIRASI load-bearing: DB koruması tip kontrolünden ÖNCE ve filtreden
  // BAĞIMSIZ koşar. Tek test koşmak da yazma yapar — tehlike filtreyle azalmaz.
  productionDbGate();
  await hacimGeciti();

  // ⚠️ ÜRETİLMİŞ İSTEMCİ HİZASI — BEYAN, KAPI DEĞİL (2026-09-13, 6e'nin vakası).
  //
  // VAKA: 6e'nin tam paketinde 55 kırmızı çıktı ve çoğu fasonla İLGİSİZDİ; hepsi
  // aynı hatayı veriyordu — `ColumnNotFound: skipCustomerName of relation
  // quality_grades`. Kök sebep: `node_modules/.prisma` DOKUZ OTURUMUN ORTAK
  // MUTASYON NOKTASI; son `generate` koşan herkesin istemcisini değiştirir.
  //
  // ⚠️ EN SİNSİ YANI: `prisma migrate status` **"up to date"** diyordu ve HAKLIYDI
  // — ağaca göre doğru. ⇒ ÜÇ ŞEYİN hizası ölçülmeli: AĞAÇ · DB · ÜRETİLMİŞ
  // İSTEMCİ. Bugüne dek ikisini ölçen bir disiplinimiz vardı ve üçüncüyü
  // görmüyordu.
  //
  // ⚠️ NEDEN HAM sha DEĞİL — ölçüldü ve KENDİ ağacımda yanlış pozitif verdi:
  //     ham sha256                 : 7d6d87f1… ≠ 72228d6c…   FARKLI
  //     boşluk normalize edilmiş   : 222ac021… ≠ 6321985a…   HÂLÂ FARKLI
  //     model+enum+ALAN ADI kümesi : e69b4996…  = e69b4996…   AYNI  ← doğru yüklem
  //   ve istemcim GERÇEKTE sağlamdı (`skipCustomerName` iki tarafta da var).
  //   Prisma kopyalarken şemayı YENİDEN BİÇİMLENDİRİYOR; fark biçim + öznitelik
  //   sırası. Ham sha ile yazılsaydı kapı DOĞDUĞU GÜN yanlış kişiyi durdururdu.
  //   ⇒ *İki dosyanın sha'sı farklı olabilir ve yine de aynı ŞEYİ söyleyebilir —
  //     karşılaştırma neyi sorduğunu bilmeli.*
  //   Pozitif kontrol: şemadan `skipCustomerName` çıkarılınca imza DEĞİŞTİ
  //   (`e69b4996…` → `f4d88acd…`) ⇒ yüklem gerçek vakayı yakalıyor.
  //
  // ⚠️ VE BU BİR KAPI DEĞİL: kayma BAŞKASININ MEŞRU eyleminden doğuyor ve
  // düzeltmesi TEK KOMUT. *Bir kaymanın kaynağı başkasının meşru eylemiyse,
  // yaptırım o kaymayı YAŞAYANA verilmez.* Çıkış kodu ETKİLENMEZ (ölçüldü: 14 ms).
  istemciHizasiBeyani();
  await semaHizasiBeyani();

  // ⚠️ ATLANAN GEÇİT BEYAN EDİLİR (2026-09-13, 6e'nin ölçümü — ve bugün bir hata
  // geçirdi). Bu iki geçit filtreli koşumda BİLEREK atlanıyor (iterasyon hızlı
  // kalsın) ama eskiden **tek satır bile basılmıyordu**: geliştirme döngüsünün
  // tamamı (`run-all-tests.ts <ad>`) tip kapısız koşuyor ve koşan kimse bunu
  // göremiyordu.
  //
  // Bu dosya aynı doktrini BEKÇİLERE zaten uyguluyor (`, N atlandı` sayacı) ama
  // KENDİ geçitlerine uygulamıyordu — kapının ölüm biçimlerinden biri:
  //   ⇒ *kendi kapsam kaybını duyurmayan kapı.*
  // Yeşil "ölçüldü" sanılır; oysa "bakılmadı"dır. `atla()` ile aynı cümle.
  const gecitAtlandi: string[] = [];
  if (filter) gecitAtlandi.push("tip + migration geçidi (filtreli koşum)");
  else {
    if (process.env.SKIP_TYPECHECK) gecitAtlandi.push("tip geçidi (SKIP_TYPECHECK=1)");
    if (process.env.SKIP_MIGRATION_GATE) gecitAtlandi.push("migration geçidi (SKIP_MIGRATION_GATE=1)");
  }
  for (const g of gecitAtlandi) {
    console.log(`⏭️  GEÇİT ATLANDI — ${g}\n      ↳ bu koşum TAM KAPSAM DEĞİL; tam kapsam: npm test`);
  }

  if (!filter && !process.env.SKIP_TYPECHECK && !typecheckGate()) process.exit(1);
  if (!filter && !process.env.SKIP_MIGRATION_GATE && !migrationGate()) process.exit(1);

  const files = readdirSync(SCRIPTS_DIR)
    .filter((f) => /^test_.*\.ts$/.test(f))
    .filter((f) => !filter || f.includes(filter))
    // ⚠️ DIŞLAMA — ve BEYANLI. `TEKSERP_HARIC` virgülle ayrılmış alt-dizgeler alır
    // ve eşleşen bekçileri koşmaz. TEK MEŞRU KULLANIMI: düzeltmesi OTURUMLARA
    // YASAK olan kapıları (kullanıcının denetim yüzeyi) ayrı bir CI job'una
    // taşımak. ⚠️ BUGÜN KULLANAN YOK: ilk kullanıcısı `test_hook_config`ti, kalem
    // `a8ce49ca` ile kapandı ve bekçi ana pakete DÖNDÜ — `ci.yml`de dışlama yok.
    // ⭐ NEDEN VAR (ölçüldü 2026-09-13): duran bir kırmızı tüm iş-düzeyi sinyalini
    // doyuruyordu — 36 CI koşumunun 36'sı da `failure`, biri TASARIMI GEREĞİ. ⇒
    // Yeni bir gerçek arıza ile duran kırmızı AYIRT EDİLEMİYORDU. ⇒ *Bir
    // kırmızının maliyeti, onu gösteren KAPIDA değil onu TAŞIYAN SİNYALDE ölçülür.*
    // ⛔ YENİDEN KULLANIRSAN, ayrı job bekçiyi BU KOŞUCUYLA ÇAĞIRMASIN: koşucunun
    // hedef-DB ön kapısı, DB'ye HİÇ dokunmayan bir bekçiyi de durdurur ⇒ job kapıya
    // ULAŞAMADAN ölür ve kırmızısı "kapı ısırdı" değil "job'ın DB'si yok" der
    // (gerçekleşti). Doğrudan `npx tsx scripts/test_x.ts` ile koş — ve job'ın
    // çıktısındaki "yeşile dönerse karar verilmiştir" türü her İDDİA ancak job o
    // yeşile ULAŞABİLİYORSA doğrudur; ulaşamıyorsa iddiayı metinden ÇIKAR.
    // ⚠️ Dışlanan her ad ÖZETTE ADIYLA basılır (aşağıda) — bir muafiyet kabı,
    // ne aldığını söylemiyorsa DOLAR.
    .filter((f) => !haricListesi.some((h) => f.includes(h)))
    .sort();

  // ⚠️ DIŞLANAN BEKÇİLER ADIYLA BASILIR — bu koşum onları ÖLÇMEDİ ve bunu
  // söylemek zorunda. Sessiz bir dışlama, muafiyet kabını çöp kutusuna çevirir.
  if (haricListesi.length > 0) {
    console.log(
      `\n⚠️  DIŞLANDI (TEKSERP_HARIC): ${haricListesi.join(", ")} — bu koşum onları ÖLÇMEDİ.\n` +
        `    Bu yeşil "hepsi temiz" DEMEZ; dışlananların sonucu kendi job'undadır.`,
    );
  }
  if (files.length === 0) {
    console.error("Hiç test_*.ts bulunamadı.");
    process.exit(1);
  }

  console.log(`\n=== Backend test suite — ${files.length} dosya ===\n`);

  const results: { file: string; ok: boolean; summary: string; ms: number; flaky: boolean; skipped: number; bilinmeyenAtlama: boolean; sessizYesil: boolean; ilkKirmizi?: string }[] = [];

  /**
   * Süreç anormal mi bitti ve neden? Tek ayırt edici `res.error.code` — ÖLÇÜLDÜ
   * (2026-07-30, macOS + Windows'ta aynı kodlar):
   *
   *   durum                 status  signal  error.code
   *   timeout (SIGTERM)      143     null    ETIMEDOUT
   *   maxBuffer taşması        0     null    ENOBUFS      ← DİKKAT: status 0!
   *   npx bulunamadı         null    null    ENOENT
   *   gerçek exit(1)           1     null    undefined
   *
   * ⚠️ `status === null` KONTROLÜ YETMEZ — araya `npx` (bir Node wrapper'ı) girdiği
   * için sinyal ölümü 128+N çıkış koduna çevriliyor ve `signal` her zaman null
   * geliyor. Bu yüzden gate YALNIZ `error.code`.
   *
   * ⚠️ Daha kötüsü: maxBuffer taşmasında `status: 0` → eski kodda `ok = (status===0)`
   * TRUE olurdu, yani çıktısı ORTADAN kesilmiş bir test "GEÇTİ" diye raporlanırdı
   * (sessiz yanlış-BAŞARI). Bu yüzden aşağıda `ok` da `!res.error` istiyor.
   *
   * `signal` Windows'ta gerçek POSIX sinyali değildir (libuv TerminateProcess
   * yaparken kullandığı killSignal adını raporlar) → varsa "biz nasıl öldürdük"
   * olarak sunulur, "OS ne gönderdi" olarak DEĞİL.
   */
  function abnormalReason(res: ReturnType<typeof spawnSync>): string | null {
    const code = (res.error as { code?: string } | undefined)?.code;
    if (!code) return null; // normal çıkış (kod 0 ya da != 0)
    const sig = res.signal ? ` (${res.signal} ile öldürüldü)` : "";
    if (code === "ETIMEDOUT")
      return (
        `ZAMAN AŞIMI ${PER_TEST_TIMEOUT_MS / 1000}s${sig}` +
        // Windows'ta shell:true cmd.exe'yi araya koyduğu için öldürülen şey
        // cmd.exe'dir; node torunu YETİM kalıp PG bağlantısı tutmaya devam
        // edebilir ve sonraki testleri "too many clients" ile zehirler.
        (IS_WIN ? " — DİKKAT: node torunu yetim kalmış olabilir (PG bağlantısı tutuyor)" : "")
      );
    if (code === "ENOBUFS") {
      const mib = MAX_OUTPUT_BYTES / 1024 / 1024;
      const limit = mib >= 1 ? `${mib} MiB` : `${MAX_OUTPUT_BYTES / 1024} KiB`;
      return `ÇIKTI TAŞMASI (${limit} maxBuffer aşıldı; çıktı KESİK)${sig}`;
    }
    if (code === "ENOENT") return `KOMUT BULUNAMADI (npx)${sig}`;
    return `ANORMAL BİTİŞ — ${code}${sig}`;
  }

  /** Tek test dosyasını koş; exit kodu + özet satırı + tam çıktıyı döndür. */
  function runOnce(file: string): {
    ok: boolean;
    status: number | null;
    summary: string;
    out: string;
    killed: string | null;
    skipped: number;
    bilinmeyenAtlama: boolean;
    sessizYesil: boolean;
  } {
    // `--no-maglev`: Node v26 V8 hatası — process.exit anında Maglev arka plan derlemesi ile GC karşılıklı
    // bekleyip süreci asıyor (upstream; 900 koşuda 5 asılma → bayrakla 0). NODE_OPTIONS bayrağı kabul etmez.
    const res = spawnSync("npx", ["tsx", "--no-maglev", join(SCRIPTS_DIR, file)], {
      encoding: "utf8",
      timeout: PER_TEST_TIMEOUT_MS,
      env: process.env,
      shell: IS_WIN, // Windows npx.cmd çözümü (bkz. IS_WIN notu)
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const killed = abnormalReason(res);
    // DOĞRULUK KAYNAĞI = exit kodu (her test process.exit(fail>0?1:0)) **VE**
    // `error`'ın yokluğu. `!res.error` şartı load-bearing: maxBuffer taşmasında
    // status 0 döner (ölçüldü) → o şart olmadan çıktısı kesilmiş test GEÇTİ sayılır.
    const ok = res.status === 0 && !res.error;
    // Testler farklı özet formatı kullanıyor:
    //   "Sonuç: N geçti, M başarısız" · "SONUÇ: N geçti, M kaldı" · "N/T geçti"
    const m =
      out.match(/(?:Sonuç|SONUÇ):\s*(\d+)\s*geçti,\s*(\d+)\s*(?:başarısız|kaldı)/i) ||
      out.match(/(\d+)\s*geçti,\s*(\d+)\s*(?:başarısız|kaldı)/i);
    const slash = out.match(/(\d+)\/(\d+)\s*geçti/);
    // ATLANAN KONTROL SAYISI (2026-09-05) — beş bekçi kendi HTTP bölümünü sunucu
    // yoksa atlıyor ve bunu özet satırında ", N atlandı" olarak yazıyordu; koşucu
    // o kısmı REGEX'İN DIŞINDA bırakıp yutuyordu. Sonuç: "✅ 82 geçti, 0 başarısız"
    // satırı, o koşumda 34 kontrolün HİÇ ölçülmediğini gizliyordu → yeşil ≠ kapsandı.
    // ⚠️ ÖZET SATIRINA DEMİRLİ (2026-09-06): serbest regex çıktının HERHANGİ bir
    // yerindeki ilk "N atlandı"yı alıyordu ve üç dosyada HAYALET sayı üretiyordu —
    // test_label_bulk_seed bir check MESAJINDA "3 atlandı" yazar (hiçbir şey
    // atlamaz), test_finance_flag_off "§2/§3/§5 atlandı" der (regex 5'i yakalar,
    // gerçek 6), test_label_dirty_sources "D2-7 atlandı" der. Gerçek sayaç DAİMA
    // `Sonuç:` satırındadır (`, N atlandı ===`). Kapsam kaybını görünür kılan
    // mekanizmanın kendisi ölçülmemiş sayı basamaz.
    const skippedM = out.match(/(?:Sonuç|SONUÇ):[^\n]*?,\s*(\d+)\s*atlandı/i);
    const skipped = skippedM ? Number(skippedM[1]) : 0;
    // SAYILAMAYAN ATLAMA — aynı gerekçeyle ÖZET SATIRINA DEMİRLİ: serbest arama
    // bir check MESAJINDAKİ beyanı gerçek sanardı. `atlama.ts` bu eki yalnız
    // `ozetEki()` üzerinden üretir, elle yazılmaz.
    const bilinmeyenAtlama = new RegExp(`(?:Sonuç|SONUÇ):[^\\n]*?${BILINMEYEN_BEYAN}`, "i").test(out);
    // ANORMAL BİTİŞTE KAZINAN ÖZET YALAN SÖYLER — kullanma.
    // 188/214 test `Sonuç:` satırını `await prisma.$disconnect()`'ten ÖNCE basar.
    // `$disconnect()` asılırsa (havuz drenajı / iptal edilmiş statement) süreç
    // 180sn'de SIGTERM alır ve stdout SAĞLAM kalır → regex "7 geçti, 0 başarısız"
    // bulur ve özet bloğu `❌ dosya — 7 geçti, 0 başarısız` basardı: kendi özeti
    // "hiçbir şey düşmedi" diyen bir HATA satırı. Anormal-bitiş sebebi kazınanı EZER.
    const summary = killed
      ? killed
      : m
        ? `${m[1]} geçti, ${m[2]} başarısız`
        : slash
          ? `${slash[1]}/${slash[2]} geçti`
          : ok
            ? "geçti (exit 0)"
            : "BAŞARISIZ";
    // SESSİZ YEŞİL (2026-09-13, d9 ölçtü): çıkış 0 ∧ 0 kontrol ∧ BEYAN YOK — bekçi
    // hiçbir şey ölçmeden yeşil çıktı (iki emsal: `finally { process.exit(0) }`
    // hatayı yuttu, "0 geçti, 0 başarısız" basıldı). Yüklem ÜÇ terimli: `atla()`
    // beyanı (", N atlandı" / BİLİNMEYEN) taşıyan 0/0 MEŞRUDUR — üç sonuçlu doğru
    // davranış iki sonuçlu yanlıştan ancak üçüncü terimle ayrılır (d9'un ilk
    // yüklemi kendi onardığı dosyayı ihlal saydı). Kontrol sayısı YUKARIDAKİ
    // ayrıştırıcılardan — ikinci bir ayrıştırıcı iki koşumun iki şey iddia etmesidir.
    const kontrolSayisi = m ? Number(m[1]) + Number(m[2]) : slash ? Number(slash[2]) : null;
    const beyanVar = skipped > 0 || bilinmeyenAtlama;
    const sessizYesil = ok && !beyanVar && (kontrolSayisi === 0 || kontrolSayisi === null);
    if (sessizYesil && !SESSIZ_YESIL_DEVRALINAN.has(file)) {
      return {
        ok: false,
        status: res.status,
        summary: `SESSİZ YEŞİL — çıkış 0 ∧ ${kontrolSayisi === null ? "özet satırı yok" : "0 kontrol"} ∧ beyan yok (ölçmeden yeşil; atla() ile beyan et ya da kırmızı düş)`,
        out,
        killed,
        skipped,
        bilinmeyenAtlama,
        sessizYesil: true,
      };
    }
    return { ok, status: res.status, summary, out, killed, skipped, bilinmeyenAtlama, sessizYesil };
  }

  /** Başarısız çıktı ALTYAPI arızası mı (DB bağlantısı) yoksa gerçek assertion mı? */
  function looksInfrastructural(out: string): boolean {
    return /timeout exceeded when trying to connect|ECONNREFUSED|too many clients|Can't reach database server/i.test(
      out,
    );
  }

  for (const file of files) {
    const start = Date.now();
    let r = runOnce(file);
    let flaky = false;

    // TEK YENİDEN DENEME — yalnız altyapı arızasında. 199 test process'i sırayla
    // yerel Postgres'e havuz açıyor; makine yüklüyken (dev sunucu + Electron +
    // Expo) pool'un connectionTimeoutMillis=5s'i ara sıra aşılıyor ve konuyla
    // ilgisiz bir test düşüyor. Assertion hatası ASLA yeniden denenmez — gerçek
    // regresyonu maskelemesin.
    let retried = false;
    let firstSummary = "";
    if (!r.ok && looksInfrastructural(r.out)) {
      console.log(`⏳ ${file.padEnd(42)} altyapı hatası (DB bağlantısı) — 1 kez yeniden deneniyor`);
      firstSummary = r.summary; // 1. denemenin teşhisi KAYBOLMASIN
      retried = true;
      const retry = runOnce(file);
      if (retry.ok) flaky = true;
      r = retry;
    }

    const ms = Date.now() - start;
    // NOT: retry olduysa `ms` İKİ denemenin toplamıdır (bu yüzden aşağıda "2 deneme"
    // etiketi basılıyor — 360sn'lik bir satır sessizce şaşırtmasın).
    const retryNote = retried ? (flaky ? " (2. denemede)" : ` (2 deneme de düştü; 1.: ${firstSummary})`) : "";
    // İLK KIRMIZI = ❌ satırı + hemen altındaki `↳` teşhis satırları (en çok 5), 400
    // karakter. Tek satır + 150 ile ÇOK SATIRLI HİÇBİR TEŞHİS koşucudan geçemiyordu:
    // test_superadmin_provision'ın "(A) SIZINTI mı (B) ÇAKIŞMA mı" ayrımı CI'da
    // basıldı ama ❌ satırında `—`'den sonrası boştu, güvenlik sınıfı bir kırmızı
    // sınıflandırılamadan bekledi (d9 ölçtü, 2026-09-13). Bekçinin söylemek istediğini
    // koşucunun özeti kesmez: ne etiketi (fold_catalog vakası) ne teşhisi (bu vaka).
    const ilkKirmizi = ilkKirmiziBlogu(r.out);
    results.push({ file, ok: r.ok, summary: r.summary + retryNote, ms, flaky, skipped: r.skipped, bilinmeyenAtlama: r.bilinmeyenAtlama, sessizYesil: r.sessizYesil, ilkKirmizi });
    // SIKLIK DEFTERİ — yalnız `IZLENEN` haritasındaki bekçi için (bugün BOŞ),
    // zaten koşmuş bir sonuçtan tek satır: EKSTRA KOŞUM YOK. Karar kuralı ve iki
    // tasarım gerekçesi `scripts/lib/siklik-defteri.ts` başlığında ve o kural
    // defterde TEK KAYIT oluşmadan ÖNCE commit edildi.
    defteYaz({
      dosya: file,
      sha: HEAD_SHA,
      mod: filter ? "tek" : "tam",
      db: dbAdi(process.env.DATABASE_URL),
      rejim: REJIM,
      agac: AGAC,
      sonuc: r.ok ? "yesil" : "kirmizi",
      ozet: r.summary + retryNote,
      ilk: ilkKirmizi ?? null,
      onceki: sonKosan,
      sira: results.length,
      ms,
      yeniden: retried,
    });
    sonKosan = file;
    const icon = r.ok ? (flaky ? "⚠️" : "✅") : "❌";
    const skipNote = r.skipped > 0 ? ` ⚠️ ${r.skipped} atlandı` : "";
    console.log(
      `${icon} ${file.padEnd(42)} ${(r.summary + retryNote).padEnd(24)} ${(ms / 1000).toFixed(1)}s${skipNote}`,
    );
    if (!r.ok) {
      // Başarısız testin son satırlarını göster (teşhis). 16 satır: hata mesajı
      // ("Error: <mesaj>" ilk satırda) + stack + {statusCode} objesi sığsın —
      // CI'da bu blok PR yorumuna gider, tek bakışta kök neden görülsün.
      // (Eski `&& r.status !== 0` koşulu ÖLÜ kodu: `ok === (status === 0)` olduğu
      // için zaten örtük. Öldürülen testte de tail İSTİYORUZ — timeout kill'inde
      // stdout sağlam kalır, yani asılmadan hemen önceki satırlar teşhisin ta kendisi.)
      // ⚠️ KIRMIZI YÜKLEMİN ADI — KUYRUKTAN ÖNCE (2026-09-13).
      // Kuyruk son 16 satırdır ve bekçi 25 kontrol basıyorsa kırmızı yüklem
      // ORTADA kalır: CI raporu `24 geçti, 1 başarısız` der ve HANGİSİ olduğunu
      // söylemez. ÖLÇÜLDÜ — `test_fold_catalog` bir hafta bu yüzden teşhissiz
      // kaldı; sayı bir TEŞHİS DEĞİLDİR, bir ADRES gerekir.
      const kirmiziYuklemler = r.out
        .split("\n")
        .filter((l) => /^\s*(❌|✗)\s/.test(l))
        .map((l) => l.trim());
      if (kirmiziYuklemler.length > 0) {
        console.log(`   ↳ KIRMIZI YÜKLEM (${kirmiziYuklemler.length}):`);
        for (const y of kirmiziYuklemler.slice(0, 10)) console.log(`   | ${y}`);
        if (kirmiziYuklemler.length > 10) console.log(`   | (+${kirmiziYuklemler.length - 10} yüklem daha)`);
      }
      const tail = r.out.trim().split("\n").slice(-16).join("\n");
      const head = r.killed ? `   ↳ ${r.killed}` : `   ↳ çıkış kodu ${r.status}`;
      console.log(`${head}\n${tail.replace(/^/gm, "   | ")}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  const flakes = results.filter((r) => r.flaky);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  console.log(`\n=== ÖZET: ${results.length - failed.length}/${results.length} dosya geçti · ${(totalMs / 1000).toFixed(0)}s ===`);
  if (failed.length > 0) {
    console.log("Başarısız:");
    // Özet satırı da ADRES taşır: "hangi dosya" yetmez, "hangi yüklem" gerekir.
    for (const f of failed) {
      console.log(`  ❌ ${f.file} — ${f.summary}`);
      if (f.ilkKirmizi) console.log(`       ↳ ${f.ilkKirmizi}`);
    }
  }
  // ATLANAN KONTROLLER exit kodunu düşürmez ama GİZLENMEZ: beş bekçi (finance /
  // module_flag_off / module_profile / settings_password / superadmin) HTTP
  // bölümünü ayrı bir sunucu ister ve sunucu yoksa SESSİZCE atlar. Toplamı burada
  // basılır ki "hepsi yeşil" cümlesi "hepsi ölçüldü" sanılmasın.
  const skippedFiles = results.filter((r) => r.skipped > 0);
  let strictAtlamaKirmizisi = false;
  // ⚠️ SAYILAMAYAN ATLAMA AYRI BEYANDIR, TOPLAMA GİRMEZ (2026-09-13).
  // Erken `return` ile düşen bölümlerde kaç kontrolün koşmadığı YAPISAL OLARAK
  // bilinemez — o kontroller hiç doğmaz. Bugüne dek `0 atlandı` ile "bilinmeyen
  // sayıda atlandı" AYNI satırı basıyordu. `N atlandı` sessizce N'i BİLDİĞİMİZİ
  // iddia eder; bilinmeyeni oraya katmak ya da 0 yazmak aynı yalanın küçük
  // puntolusudur. Bekçi bunu `Sonuç:` satırında BILINMEYEN_BEYAN ile bildirir.
  // SESSİZ YEŞİL — iki yönlü: devralınan üye artık sessiz DEĞİLSE ölü muaftır, kırmızı
  // (liste sessizce şişmesin, "muaf" bir gün "bakılmadı" demesin).
  const sessizler = results.filter((r) => r.sessizYesil);
  const oluMuaf = [...SESSIZ_YESIL_DEVRALINAN].filter((f) => !results.some((r) => r.file === f && r.sessizYesil));
  if (sessizler.length > 0 || oluMuaf.length > 0) {
    console.log(`\n⚠️  SESSİZ YEŞİL: ${sessizler.length} dosya çıkış 0 ∧ 0 kontrol ∧ beyan yok (devralınan ${SESSIZ_YESIL_DEVRALINAN.size})`);
    for (const f of sessizler) console.log(`  ${SESSIZ_YESIL_DEVRALINAN.has(f.file) ? "⚠️  devralınan" : "❌"} ${f.file}`);
    if (oluMuaf.length > 0) {
      console.log(`  ❌ ÖLÜ MUAF (artık sessiz değil, listeden düş): ${oluMuaf.join(" · ")}`);
    }
  }
  const oluMuafKirmizisi = oluMuaf.length > 0;
  const bilinmeyenler = results.filter((r) => r.bilinmeyenAtlama);
  if (bilinmeyenler.length > 0) {
    console.log(
      `⚠️  SAYILAMAYAN ATLAMA: ${bilinmeyenler.length} dosyada BİLİNMEYEN sayıda kontrol koşmadı` +
        ` — bu sayı yukarıdaki toplama GİRMEZ (erken \`return\`; kaç kontrol düştüğü bilinemez)`,
    );
    for (const f of bilinmeyenler) console.log(`  ⚠️  ${f.file} — bilinmeyen sayıda`);
  }
  if (skippedFiles.length > 0) {
    const total = skippedFiles.reduce((sum, r) => sum + r.skipped, 0);
    console.log(
      `⚠️  ATLANAN KONTROL: ${skippedFiles.length} dosyada toplam ${total} — yeşil ≠ kapsandı`,
    );
    for (const f of skippedFiles) console.log(`  ⚠️  ${f.file} — ${f.skipped} atlandı`);
    console.log("     (HTTP ayaklı bekçiler kendi portunda sunucu ister: 4100/4101/4104/4112/4122)");
    // STRICT: "yeşil = kapsandı" iddiası ancak SIFIR atlamayla kurulur. Anahtarın
    // anlamı [TD-10c]'de tanımlı; burada yalnız ATLAMA sayısına bakılır — "sunucu
    // ayakta ama başka DB'ye bakıyor" sınıfı zaten hedef kapısında, strict'i
    // beklemeden kırmızıdır.
    if (strictMi()) {
      strictAtlamaKirmizisi = true;
      console.log(
        "❌ TEKSERP_STRICT=1 — atlanan kontrol KIRMIZIDIR: paket kararı bu koşumdan verilemez.",
      );
    }
  }
  // Flake'ler exit kodunu düşürmez ama GİZLENMEZ — hangi test kaç kez koştu görünsün.
  if (flakes.length > 0) {
    console.log(`Altyapı flake'i (2. denemede geçti — DB bağlantı timeout'u): ${flakes.length}`);
    for (const f of flakes) console.log(`  ⚠️  ${f.file}`);
  }
  process.exit(failed.length > 0 || strictAtlamaKirmizisi || oluMuafKirmizisi ? 1 : 0);
}

void main();
