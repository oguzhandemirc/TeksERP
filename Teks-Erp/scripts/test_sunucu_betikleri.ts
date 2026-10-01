// =============================================================================
// BEKÇİ — SUNUCUDA KOŞAN BETİKLER Windows PowerShell 5.1'de KOŞABİLİR Mİ
// Çalıştır: npx tsx scripts/run-all-tests.ts sunucu_betikleri   (DB'siz)
// =============================================================================
// `kur.ps1` bu sözleşmelerin bir kısmını `test_deploy_log_rotation` §6'da
// taşıyordu; `ilk-kurulum.ps1` hiçbirini taşımıyordu ve 2026-09-27 thinkpad-1
// provası (yeni Windows 11, PowerShell 5.1) üçünü de ısırdı:
//   §1 stderr YÖNLENDİRMESİ yalnız EAP="Continue" yardımcısında. 5.1'de
//      EAP=Stop altında `2>&1` satırı ÖLÜMCÜL yapar; ilk bağlantı denemesinin
//      BEKLENEN hatası [3/8]'i hiç geçirmiyordu.
//   §2 yorum DIŞI metin ASCII. Dosyalar BOM'suz UTF-8; 5.1 onları ANSI okur ve
//      string içindeki Türkçe harf sessizce başka bir bayta döner (taslak ⑦'nin
//      `'Sürüm göçü%'` sorgusu tam bu yüzden 0 döndü).
//   §3 çıplak `npm` çağrısı YOK. `npm` → `npm.ps1` bir SCRIPT'tir ve yürütme
//      ilkesi Restricted'ta koşmaz; `npm.cmd` ilkeye tabi değil.
//   §4 `paketle.ps1 -Prova` yayın kaydı bırakmaz (etiket/push/`--uygula`/belge) ve
//      `kur.ps1` prova paketini `-ProvaKabul`suz kurmaz.
//   §5 son taslağın YAYIN GÜNÜ betikleri pakette derleniyor (`dist/tools`), paket
//      `ilk-kurulum.ps1`i taşıyor — sunucuya repo ağacı ve `tsx` gitmez.
//   §17 müşteri paketi (`PAKET.json`) üreticinin makine/kullanıcı adını taşımaz (derleme kaydında).
//   §18 `paketle.ps1 -Sifrele` (G5): varsayılan ŞİFRESİZ, yalnız -Korumali ile, CI'da reddedilir, anahtar dizini
//      repo içinde olamaz; CI iş akışı şifreleme bayrağı geçirmez (mühürleme anahtarı CI'a girmez).
//   §19 korumalı pakette `kur.ps1` sunucunun ecosystem'ini paketin Node'una BAĞLAR (birleştirme, [3/9] öncesi
//      karar, yedek önce, [8/9] delete+start, -GeriAl simetrik, korumasız dal aynen); §20 birleştiricinin davranışı.
//   §21 pm2 AD KAPISI: [1/9] ve -GeriAl dokunmadan önce pm2 listesini ölçer (aynı portta ikinci backend yok);
//      §22 aracın DAVRANIŞI (Node birim, sahte `pm2 jlist`).
//   §23 kurulum kaydının `yeniMigrationSayisi`si DB'de GERÇEKTEN uygulanan sayıdır ([7/9] önü/arkası) ve
//      [5/9] birleşik ecosystem'de "KORUNDU" başlığı basılmaz.
//   §24 pm2 yolu DONDURULDU (Dağıtım v2, geçiş dönemi çift yol): kur.ps1 · ilk-kurulum.ps1 · pm2-boot.cmd ·
//      ecosystem.config.js içeriği aşağıdaki özetlere bağlı + DONDURULDU başlığı taşır. Değişiklik yalnız düzeltme
//      için ve özet satırı GEREKÇESİYLE aynı commit'te güncellenerek yapılır (yeni özellik pm2 yoluna eklenmez).
//   §25 hizmet betikleri (backend-hizmeti.ps1 ↔ guncelleyici-hizmeti.ps1) ortak yardımcıları birebir ikiz.
//   §12d uzaktan-kos.ps1 geçiş kipi (D6): gecis.ps1 -Uygula görevde yalnız kuru koşumun -Onay <N>'iyle; çıktı logs\ dışında.
//   §26 VİRGÜLLÜ DÖNÜŞ (`return , $x`) yapan fonksiyonun çağrısı `@()` ile sarılmaz, boruya verilmez (iç içe dizi).
//   §27 `[Validate*]` öznitelikli parametrenin adı gövdede yerel değişken olarak ATANMAZ (ad büyük/küçük harf duyarsız).
//   §28 betik kapsamındaki `foreach ($x in …)` daha önce ATANMIŞ ve döngüden SONRA okunan bir değişkeni gölgelemez.
//   §29 `paketle.ps1` hata yolunda (Fail + betik kapsamı trap) yarım sahneyi (%TEMP%\tekserp-backend-*) siler.
//   §30 tür kısıtlı parametre (`[string]$Sonuc`) betik kapsamında (`$Sonuc` / `$script:Sonuc`) sözlük/dizi değeriyle ATANMAZ.
//   §31 bir icacls çağrısı `(OI)(CI)` izniyle `/T`yi BİRLİKTE taşımaz (dosyalarda DACL boş kalır); ağaç `/reset` ile.
// Kaynak ölçülür, davranış değil: pwsh her ortamda yok, 5.1 hiç yok.
// =============================================================================
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { psTara, kapsayanFonksiyon } from "./lib/ps-tarama";
import { INSTALL_HISTORY_FILE_NAME, INSTALL_RECORD_KINDS, InstallRecordSchema } from "../src/lib/license/protocol";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

/** Fabrika/müşteri sunucusunda koşan PowerShell betikleri (geliştirme makinesinde koşan `paketle.ps1` hariç; setup.exe'nin
 *  `deploy/kurulum/` betikleri de sunucuda YÖNETİCİ olarak koşar — D5). */
const SUNUCU_PS1 = ["deploy/kur.ps1", "deploy/ilk-kurulum.ps1", "deploy/yedekle.ps1", "deploy/uzaktan-kos.ps1", "deploy/bakim-rolu.ps1", "deploy/hizmet/backend-hizmeti.ps1", "deploy/hizmet/guncelleyici-hizmeti.ps1", "deploy/hizmet/kanal-adlari.ps1", "deploy/gecis/gecis.ps1", "deploy/kurulum/kurulum.ps1", "deploy/kurulum/kurulum-ortak.ps1", "deploy/kurulum/on-olcum.ps1", "deploy/kurulum/kaldir.ps1"];

/** Körlük zemini satır alt sınırı: varsayılan 60; bilerek küçük tek-işlevli kütüphane kendi sınırını taşır. */
const KORLUK_SATIR: Record<string, number> = { "deploy/hizmet/kanal-adlari.ps1": 25 };

const YONLENDIRME = /(?:^|\s)2>(?:&1|\$null)/;
const CIPLAK_NPM = /(?:^|[\s&(;|])npm(?=\s|$)/;

console.log("=== Sunucu betikleri — PowerShell 5.1 sözleşmesi ===\n");

for (const yol of SUNUCU_PS1) {
  const tam = join(KOK, yol);
  check(`§0 ${yol} var`, existsSync(tam));
  if (!existsSync(tam)) continue;
  const t = psTara(readFileSync(tam, "utf8"));
  const son = t.satirlar[t.satirlar.length - 1];
  check(`§0 ${yol} tarandı (körlük zemini: satır + fonksiyon + dengeli parantez)`,
    t.satirlar.length > (KORLUK_SATIR[yol] ?? 60) && t.fonksiyonlar.length >= 1 && son?.derinlik === 0,
    `${t.satirlar.length} satır · ${t.fonksiyonlar.length} fonksiyon · son derinlik ${son?.derinlik}`);

  // §1 — yönlendirme yalnız EAP=Continue + finally'de geri koyan yardımcıda
  const ihlal: string[] = [];
  let yonlendirmeSayisi = 0;
  for (const s of t.satirlar) {
    if (!YONLENDIRME.test(s.ciplak)) continue;
    yonlendirmeSayisi++;
    const f = kapsayanFonksiyon(t, s.no);
    if (!f) { ihlal.push(`${s.no} (fonksiyon dışı)`); continue; }
    const govde = t.satirlar.filter((x) => x.no >= f.bas && x.no <= f.son);
    const onceContinue = govde.some((x) => x.no < s.no && /\$ErrorActionPreference\s*=\s*"Continue"/.test(x.kod));
    const geriKoyar = govde.some((x) => /finally/.test(x.ciplak)) &&
      govde.some((x) => /\$ErrorActionPreference\s*=\s*\$eskiEAP/.test(x.kod));
    if (!onceContinue || !geriKoyar) ihlal.push(`${s.no} (${f.ad}: ${!onceContinue ? "EAP Continue yok" : "finally'de geri konmuyor"})`);
  }
  check(`§1 ⭐ ${yol}: stderr yönlendirmesi yalnız EAP="Continue" yardımcısında`, ihlal.length === 0,
    ihlal.length ? `satır ${ihlal.join(", ")}` : `${yonlendirmeSayisi} yönlendirme, hepsi yardımcıda`);

  // §2 — yorum dışı metin ASCII
  const asciiDisi = t.satirlar.filter((s) => /[^\x00-\x7F]/.test(s.kod)).map((s) => s.no);
  check(`§2 ⭐ ${yol}: yorum dışı metin ASCII (BOM'suz dosya 5.1'de ANSI okunur)`, asciiDisi.length === 0,
    asciiDisi.length ? `satır ${asciiDisi.slice(0, 10).join(", ")}` : "temiz");

  // §3 — çıplak npm yok
  const npmSatir = t.satirlar.filter((s) => CIPLAK_NPM.test(s.ciplak)).map((s) => s.no);
  check(`§3 ⭐ ${yol}: çıplak \`npm\` çağrısı YOK (\`npm.cmd\` — npm.ps1 yürütme ilkesine takılır)`, npmSatir.length === 0,
    npmSatir.length ? `satır ${npmSatir.join(", ")}` : "temiz");

  // §6 — psql'e giden SQL `NativeArg`tan geçer: 5.1 (Legacy kip) argümandaki `"`yi
  //   KAÇIRMAZ, psql `"updatedAt"` yerine `updatedAt` alır (deploy/test/native-arg.sh ölçer).
  const psqlSql = t.satirlar.filter((s) => /psql\.exe/.test(s.kod) && /\s-(?:tA)?c\s/.test(s.ciplak));
  const kacissiz = psqlSql.filter((s) => !/\(NativeArg\s/.test(s.ciplak)).map((s) => s.no);
  check(`§6 ⭐ ${yol}: psql'e SQL veren her çağrı \`NativeArg\`tan geçiyor`, kacissiz.length === 0,
    kacissiz.length ? `satır ${kacissiz.join(", ")}` : `${psqlSql.length} çağrı`);
}

// §1 körlük zemini: ölçülen yardımcı gerçekten yönlendiriyor ve kural onu geçiriyor.
{
  const t = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8"));
  const psql = t.fonksiyonlar.find((f) => f.ad === "Psql");
  const yonlendirir = !!psql && t.satirlar.some((s) => s.no >= psql.bas && s.no <= psql.son && YONLENDIRME.test(s.ciplak));
  check("§1 körlük zemini: ilk-kurulum `Psql` yardımcısı çıktıyı yakalamak için YÖNLENDİRİYOR (kural boşa ölçmüyor)", yonlendirir);
}

// §4 — paketle.ps1 PROVA KİPİ: prova yayın kaydı bırakmaz (bulgu 3, 2026-09-27).
//   Normal koşum etiketi atıp UZAĞA itiyor, repodaki package.json'a sürüm yazıyor ve
//   sürüm belgesini dolduruyordu; prova kipi üçünü de yapmamalı, kur.ps1 de prova
//   paketini açık izin olmadan kurmamalı.
{
  const t = psTara(readFileSync(join(KOK, "deploy/paketle.ps1"), "utf8"));
  const satirIdx = (re: RegExp, alan: "ciplak" | "kod" = "ciplak") => t.satirlar.findIndex((s) => re.test(s[alan]));
  /** Satırdan geriye `pencere` satır içinde, verilen koşulu açan bir `if/elseif` var mı. */
  const korunur = (idx: number, kosul: RegExp, pencere = 14) =>
    idx >= 0 && t.satirlar[idx]!.derinlik > 0 &&
    t.satirlar.slice(Math.max(0, idx - pencere), idx).some((s) => kosul.test(s.kod));
  check("§4 körlük zemini: paketle.ps1 `-Prova` parametresi tanımlı", t.satirlar.some((s) => /\[switch\]\$Prova\b/.test(s.kod)));
  const etiket = satirIdx(/--etiketle/);
  check("§4a ⭐ etiket çağrısı (`--etiketle`) prova ve kirli ağaç dalının ARDINDA (koşulsuz değil)",
    korunur(etiket, /^\s*if\s*\(\$Prova\)/) && korunur(etiket, /^\s*\}\s*elseif\s*\(\$kirli\)/),
    etiket >= 0 ? `satır ${t.satirlar[etiket]!.no}` : "etiket çağrısı YOK");
  const uygula = satirIdx(/backend-surum\.mjs.*--uygula/, "kod");
  check("§4b ⭐ repodaki package.json'a yazım (`--uygula`) yalnız `-not $Prova` dalında",
    korunur(uygula, /^\s*if\s*\(-not\s+\$Prova\)/, 8), uygula >= 0 ? `satır ${t.satirlar[uygula]!.no}` : "YOK");
  const belge = satirIdx(/^\s*Set-Content\s+\$surumBelgesi/);
  check("§4c ⭐ sürüm belgesine yazım prova dalının ARDINDA",
    korunur(belge, /^\s*if\s*\(\$Prova\)/, 10), belge >= 0 ? `satır ${t.satirlar[belge]!.no}` : "YOK");
  check("§4d manifest `prova` alanını taşıyor ve sürümü PAKETTEKİ package.json'dan okuyor",
    t.satirlar.some((s) => /^\s*prova\s*=\s*\[bool\]\$Prova/.test(s.kod)) &&
      t.satirlar.some((s) => /uygulamaSurumu\s*=.*\$stage\\package\.json/.test(s.kod)));
  const kur = psTara(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8"));
  const provaIdx = kur.satirlar.findIndex((s) => /if\s*\(\$m\.prova\)/.test(s.ciplak));
  check("§4e ⭐ kur.ps1 prova paketini `-ProvaKabul` olmadan kurmaz (Fail)",
    provaIdx >= 0 && kur.satirlar.slice(provaIdx, provaIdx + 4).some((s) => /-not\s+\$ProvaKabul/.test(s.ciplak)) &&
      kur.satirlar.slice(provaIdx, provaIdx + 5).some((s) => /^\s*Fail\b/.test(s.ciplak)));
}

// §5 — yayın günü araçları PAKETTE (bulgu 7). Pakette `scripts/` ve `tsx` yok; sürüm
//   notunun YAYIN GÜNÜ adımları `dist/tools/<ad>.cjs` derlemesinden koşar. En yüksek
//   sürümlü taslağın YAYIN GÜNÜ bölümünde adı geçen her `<ad>.ts`, build-araclar'ın
//   ARACLAR listesinde olmalı; eski taslaklar kapsam dışı (araç listesi küçülebilsin).
{
  const build = readFileSync(join(KOK, "Teks-Erp/scripts/build-araclar.mjs"), "utf8");
  const araclar = new Set([...build.matchAll(/giris:\s*"scripts\/([\w-]+)\.ts"/g)].map((m) => m[1]!));
  const dizin = join(KOK, "docs/surumler");
  const surumNo = (ad: string) => (/^(\d+)\.(\d+)\.(\d+)-taslak\.md$/.exec(ad) ?? []).slice(1).map(Number);
  const taslaklar = readdirSync(dizin).filter((f) => surumNo(f).length === 3).map((f) => {
    const metin = readFileSync(join(dizin, f), "utf8");
    const bas = metin.search(/^## YAYIN GÜNÜ/m);
    const govde = bas < 0 ? "" : metin.slice(bas, (() => { const s = metin.slice(bas + 3).search(/^## /m); return s < 0 ? metin.length : bas + 3 + s; })());
    const adlar = [...new Set([...govde.matchAll(/`(?:scripts\/)?([a-z][a-z0-9_]+)\.ts`/g)].map((m) => m[1]!))];
    return { f, v: surumNo(f), adlar };
  }).filter((t) => t.adlar.length > 0)
    .sort((a, b) => b.v[0]! - a.v[0]! || b.v[1]! - a.v[1]! || b.v[2]! - a.v[2]!);
  const hedef = taslaklar[0];
  check("§5 körlük zemini: YAYIN GÜNÜ'nde betik anan taslak bulundu ve ARACLAR okundu",
    !!hedef && araclar.size >= 2, hedef ? `${hedef.f}: ${hedef.adlar.length} betik · ARACLAR ${araclar.size}` : "taslak yok");
  if (hedef) {
    const eksik = hedef.adlar.filter((a) => !araclar.has(a));
    const kaynaksiz = hedef.adlar.filter((a) => !existsSync(join(KOK, "Teks-Erp/scripts", `${a}.ts`)));
    check(`§5a ⭐ ${hedef.f} YAYIN GÜNÜ betiklerinin hepsi pakette derleniyor (build-araclar ARACLAR)`, eksik.length === 0,
      eksik.length ? `eksik: ${eksik.join(", ")}` : hedef.adlar.join(", "));
    check("§5b taslakta anılan betiklerin kaynağı var (ad yanlış yazılmamış)", kaynaksiz.length === 0, kaynaksiz.join(", ") || "hepsi var");
  }
  const pk = psTara(readFileSync(join(KOK, "deploy/paketle.ps1"), "utf8"));
  check("§5c ⭐ paketle.ps1 araç listesini (araclar.json) doğruluyor ve eksikte Fail",
    pk.satirlar.some((s) => /araclar\.json/.test(s.kod)) &&
      pk.satirlar.some((s) => /Fail\s+"Arac uretilmedi/.test(s.kod)));
  // Paket içeriği TEK LİSTE (`$KOK_BETIKLERI`, D5): listede olan + döngünün kopyaladığı dosya pakettedir.
  const kokListe = /^\$KOK_BETIKLERI\s*=\s*@\(([^)]*)\)/m.exec(readFileSync(join(KOK, "deploy/paketle.ps1"), "utf8"));
  const liste = kokListe ? [...kokListe[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!) : [];
  const dongu = pk.satirlar.some((s) => /foreach \(\$b in \$KOK_BETIKLERI\)/.test(s.kod)) &&
    pk.satirlar.some((s) => /Copy-Item \$kaynak \(Join-Path \$stage \$b\)/.test(s.kod));
  const pakete = (ad: string) => dongu && liste.includes(ad);
  const sunucuDosyalari = ["ilk-kurulum.ps1", "yedekle.ps1", "pm2-boot.cmd", "uzaktan-kos.ps1", "bakim-rolu.ps1"];
  const eksikDosya = sunucuDosyalari.filter((a) => !pakete(a));
  check(`§5d paketle.ps1 sunucu dosyalarını pakete koyuyor (${sunucuDosyalari.join(" + ")}) — sunucuya repo ağacı taşınmaz`,
    eksikDosya.length === 0, eksikDosya.length ? `eksik: ${eksikDosya.join(", ")}` : "hepsi");
}

// §7 — `-Dump` fabrikanın KİMLİĞİNİ taşır (bulgu 8): amaç beyanı zorunlu, Kopya
//   kimliği yeniler ve makine dışı yedek hedefini boşaltır. Davranış yerel docker
//   PG'sine karşı `deploy/test/ilk-kurulum-yerel.sh` ile ölçülür; burada kaynak kilitlenir.
{
  const t = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8"));
  const kod = t.satirlar.map((s) => s.kod);
  const kapiIdx = kod.findIndex((k) => /^\s*if\s*\(\$Dump\s+-and\s+-not\s+\$DumpAmaci\)/.test(k));
  check("§7a ⭐ `-DumpAmaci` Kopya|Tasima ile sınırlı ve VARSAYILANI YOK",
    kod.some((k) => /\[ValidateSet\("Kopya",\s*"Tasima"\)\]\[string\]\$DumpAmaci\s*,/.test(k)));
  check("§7b ⭐ `-Dump` amaçsız verilirse hiçbir şeye dokunmadan DURUR",
    kapiIdx >= 0 && kod.slice(kapiIdx, kapiIdx + 2).some((k) => /\bDur\b/.test(k)) &&
      kapiIdx < kod.findIndex((k) => /^\s*Adim\s+"/.test(k)),
    kapiIdx >= 0 ? `satır ${kapiIdx + 1}` : "kapı YOK");
  check("§7c ⭐ Kopya dalı kurulum kimliğini YENİLER ve iki offsite anahtarını boşaltır (iz SystemLog'a)",
    kod.some((k) => /UPDATE system_settings SET value = jsonb_build_object\('installationId'/.test(k)) &&
      kod.some((k) => /'backup\.offsiteRemote',\s*'backup\.offsiteDir'/.test(k)) &&
      kod.some((k) => /INSERT INTO system_logs .*INSTALLATION_ID_REGENERATED/.test(k)));
}

// §8 — veritabanı + sunucu ayarları (bulgu 9, 14). pg_restore DB düzeyi ayarları
//   taşımaz; ilk kurulum kurar. Sıra load-bearing: restore'dan ÖNCE kurulan
//   statement_timeout restore'un index yaratımını keser. Sunucu geneli ayar yalnız
//   `-PgAyarla` ile yazılır; önceden ALTER SYSTEM ile konmuş farklı değer ezilmez.
{
  const t = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8"));
  const kod = t.satirlar.map((s) => s.kod);
  const adimIdx = (re: RegExp) => kod.findIndex((k) => /^\s*Adim\s+"/.test(k) && re.test(k));
  const dump = adimIdx(/dump/i);
  const dbAyar = adimIdx(/Veritabani ayarlari/);
  const pgAyar = adimIdx(/PostgreSQL sunucu ayarlari/);
  check("§8a ⭐ DB düzeyi ayarlar dump yüklemesinden SONRA (statement_timeout restore'u kesmesin)",
    dump >= 0 && dbAyar > dump, `dump satır ${dump + 1} · ayar satır ${dbAyar + 1}`);
  const hedef = (ad: string, deger: string) => kod.some((k) => new RegExp(`"${ad.replace(".", "\\.")}"\\s*=\\s*"${deger}"`).test(k));
  check("§8b ⭐ DB düzeyi hedefler: teks.audit_guard=on · statement_timeout=50s · idle_in_transaction_session_timeout=5min",
    hedef("teks.audit_guard", "on") && hedef("statement_timeout", "50s") && hedef("idle_in_transaction_session_timeout", "5min"));
  const alterSys = kod.findIndex((k) => /ALTER SYSTEM SET/.test(k));
  const raporDali = kod.findIndex((k) => /^\s*\}\s*elseif\s*\(-not\s+\$PgAyarla\)/.test(k));
  const sonElse = raporDali < 0 ? -1 : kod.slice(raporDali, alterSys).findIndex((k, i) => i > 0 && /^\s*\}\s*else\s*\{/.test(k));
  check("§8c ⭐ ALTER SYSTEM yalnız -PgAyarla dalında (varsayılan yalnız rapor)",
    pgAyar > dbAyar && alterSys > raporDali && raporDali >= 0 && sonElse > 0,
    alterSys >= 0 ? `ALTER SYSTEM satır ${alterSys + 1}` : "ALTER SYSTEM yok");
  check("§8d önceden ALTER SYSTEM ile konmuş (postgresql.auto.conf) farklı değer EZİLMEZ; DB düzeyinde var olan farklı değer ezilmez",
    kod.some((k) => /-like\s+"\*postgresql\.auto\.conf"/.test(k)) &&
      kod.some((k) => /var olan deger DOKUNULMADI/.test(k)));
}

// §9 — sır hijyeni (bulgu 10, 19): sır dosyaları yalnız SYSTEM + Administrators
//   (SID ile), kur.ps1 sırrı %TEMP%'e yazmaz, parola komut satırı dışından da gelir.
{
  const kurT = psTara(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8"));
  const ilkT = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8"));
  const kodK = kurT.satirlar.map((s) => s.kod);
  const kodI = ilkT.satirlar.map((s) => s.kod);
  const sidSozlesmesi = (kod: string[]) => kod.some((k) =>
    /icacls\.exe .*\/inheritance:r .*\*S-1-5-18:.*\*S-1-5-32-544:.*\/remove:g .*\*S-1-5-32-545.*\*S-1-5-11.*\*S-1-1-0/.test(k));
  check("§9a ⭐ iki betikte de izin daraltma SID'le: miras kesilir, SYSTEM + Administrators, Users/Authenticated Users/Everyone silinir",
    sidSozlesmesi(kodK) && sidSozlesmesi(kodI));
  const tempSir = kodK.map((k, i) => ({ k, i })).filter((x) => /\$env:TEMP/.test(x.k) && /env|ecosystem/i.test(x.k.replace(/\$env:TEMP/g, "")));
  check("§9b ⭐ kur.ps1 .env / ecosystem yedeğini %TEMP%'e YAZMAZ (bellekte tutar)", tempSir.length === 0,
    tempSir.length ? `satır ${tempSir.map((x) => x.i + 1).join(", ")}` : "temiz");
  const yaz = kodK.findIndex((k) => /WriteAllBytes\(\(Join-Path \$appDir "\.env"\)/.test(k));
  const daralt = kodK.findIndex((k) => /^\s*SirIzniDaralt \(Join-Path \$appDir "\.env"\)/.test(k));
  check("§9c ⭐ kur.ps1 yeni app\\.env'i yazdıktan SONRA izni daraltır", yaz >= 0 && daralt > yaz,
    `yaz ${yaz + 1} · daralt ${daralt + 1}`);
  const adim = kodI.findIndex((k) => /^\s*Adim\s+"Sir dosyalarinin izinleri/.test(k));
  const envAdim = kodI.findIndex((k) => /^\s*Adim\s+"app\\\.env/.test(k));
  const credAdim = kodI.findIndex((k) => /^\s*Adim\s+"db-credentials\.json/.test(k));
  const yollar = kodI.find((k) => /^\s*\$sirYollari\s*=/.test(k)) ?? "";
  check("§9d ⭐ ilk-kurulum izin adımı .env + pg-setup + backups'ı kapsıyor, ikisi yazıldıktan SONRA ve ÖLÇÜYOR (GenisErisim)",
    adim > envAdim && adim > credAdim && envAdim >= 0 && credAdim >= 0 &&
      /app\\\.env/.test(yollar) && /pg-setup/.test(yollar) && /backups/.test(yollar) &&
      kodI.some((k) => /\$g = GenisErisim \$k/.test(k)), `adım satır ${adim + 1}`);
  check("§9e ⭐ DB parolası zorunlu PARAMETRE değil; dosyadan (-DbParolaDosyasi) ya da gizli soruyla (SecureString) gelir",
    !kodI.some((k) => /Mandatory\s*=\s*\$true\)\]\[string\]\$DbParola/.test(k)) &&
      kodI.some((k) => /^\s*\[string\]\$DbParolaDosyasi/.test(k)) &&
      kodI.some((k) => /^\s*\[string\]\$PostgresParolaDosyasi/.test(k)) &&
      kodI.some((k) => /Read-Host -AsSecureString/.test(k)));
}

// §10 — açılış + gece yedeği görevleri (bulgu 12, 16, 17). Hiçbir betik kurmuyordu ve
//   paketteki ecosystem backend zamanlayıcısını KAPALI getiriyor: sıfırdan kurulumda
//   reboot'ta backend kalkmıyor, gece yedeği hiç alınmıyordu.
{
  const ilk = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const yed = psTara(readFileSync(join(KOK, "deploy/yedekle.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const cmdYol = join(KOK, "deploy/pm2-boot.cmd");
  const cmd = existsSync(cmdYol) ? readFileSync(cmdYol, "utf8") : "";
  check("§10a ⭐ ilk-kurulum iki görevi SYSTEM olarak kuruyor (açılış + günlük), var olanı ezmiyor",
    ilk.some((k) => k.includes('ad = "TeksERP-Backend-Boot"')) && ilk.some((k) => k.includes('ad = "TeksERP-DB-Backup"')) &&
      ilk.some((k) => k.includes('New-ScheduledTaskPrincipal -UserId "SYSTEM"')) &&
      ilk.some((k) => k.includes("New-ScheduledTaskTrigger -AtStartup")) &&
      ilk.some((k) => k.includes("New-ScheduledTaskTrigger -Daily -At $YedekSaati")) &&
      ilk.some((k) => k.includes("gorev zaten var, DOKUNULMADI")));
  check("§10b ⭐ gece yedeği saati varsayılanı 03:00 (fabrika dökümü damgası 03:00:01 ölçüldü)",
    ilk.some((k) => k.includes('[string]$YedekSaati = "03:00"')));
  const yarim = yed.findIndex((k) => k.includes('"-f", $yarim'));
  const liste = yed.findIndex((k) => k.includes('@("--list", $yarim)'));
  // Yayın iki biçimli: şifreleme yoksa/düşerse `.part` düz adı alır (koşullu satır).
  const tasi = yed.findIndex((k) => /(?:^\s*|\{\s*)Move-Item \$yarim \$hedef\b/.test(k));
  const sakla = yed.findIndex((k) => k.trim() === "Sakla $yedekDir $desen");
  check("§10c ⭐ yedekle.ps1: dökümü `.part`a yazar → `pg_restore --list` → ancak SONRA `.dump` adı → ancak SONRA saklama",
    yarim >= 0 && liste > yarim && tasi > liste && sakla > tasi,
    `f ${yarim + 1} · list ${liste + 1} · taşı ${tasi + 1} · sakla ${sakla + 1}`);
  check("§10d yedekle.ps1 saklaması en yeni N'i yaşına bakmadan korur (3), 30 gün, yalnız kendi desenine dokunur",
    yed.some((k) => k.includes("Select-Object -Skip $EnAzTut")) && yed.some((k) => k.includes("[int]$EnAzTut = 3")) &&
      yed.some((k) => k.includes("[int]$SaklamaGun = 30")) && yed.some((k) => k.includes("_\\d{8}_\\d{6}\\.dump(\\.tkenc)?$")));
  // §10f — yedek şifreleme (.tkenc): doğrulanmış `.part` şifrelenir, düz yayınlanmaz;
  //   şifreleme niyeti varken düşerse düz yedek KORUNUR ama ikinci hedefe gitmez, görev kırmızı.
  const sifrele = yed.findIndex((k) => /NativeKos \$node @\(\$sifreArac, "sifrele", "--girdi", \$yarim/.test(k));
  check("§10f ⭐ yedekle.ps1: şifreleme `pg_restore --list`ten SONRA, yayından ve saklamadan ÖNCE; girdi doğrulanmış `.part`",
    sifrele > liste && sifrele < tasi && tasi < sakla, `list ${liste + 1} · şifrele ${sifrele + 1} · taşı ${tasi + 1}`);
  check("§10g ⭐ yedekle.ps1: anahtar dizini yoksa şifreleme YOK (bugünkü davranış); şifrelenemeyen düz yedek ikinci hedefe gitmez, çıkış 3",
    yed.some((k) => k.includes("if (Test-Path $AnahtarDizini) {")) &&
      yed.some((k) => k.includes("if ($IkinciHedef -and $sifreHatasi) {")) &&
      yed.some((k) => k.includes("$cikis = if ($sifreHatasi) { 3 } else { 0 }")));
  check("§10e pm2-boot.cmd: PM2_HOME kur.ps1'inkiyle aynı (<kök>\\pm2-home), `pm2 resurrect`, tamamı ASCII",
    cmd.includes('set "PM2_HOME=%KOK%pm2-home"') && cmd.includes('pm2\\node_modules\\.bin\\pm2.cmd" resurrect') &&
      !/[^\x00-\x7F]/.test(cmd));
  // setlocal'li toplu dosyada call'siz .cmd cagrisi cagiranin baglamini bitirir: setlocal ortami (PM2_HOME) duser,
  // pm2 SYSTEM profiline gider, acilista backend kalkmaz (thinkpad-1 D8c, gercek gorevle yeniden uretildi).
  const callsizCagri = (metin: string): string[] => {
    const satirlar = metin.split(/\r?\n/);
    if (!satirlar.some((s) => /^\s*setlocal\b/i.test(s))) return [];
    return satirlar.filter((s) => /\.cmd"/i.test(s) && !/^\s*(rem\b|::|set\s|call\s)/i.test(s)).map((s) => s.trim());
  };
  const cagri = callsizCagri(cmd);
  check("§10e2 ⭐ pm2-boot.cmd: setlocal varken .cmd çağrısı `call`lı — çağrısız çağrıda PM2_HOME düşer, pm2 SYSTEM profilinde boş .pm2 ile doğar, açılışta backend kalkmaz",
    cmd.length > 0 && cagri.length === 0, cagri.join(" | ") || "call'lı");
  const sondaCallsiz = cmd.replace(/^call (?=")/m, "");
  check("§10e2 sonda: `call` silindi → kırmızı", sondaCallsiz !== cmd && callsizCagri(sondaCallsiz).length > 0, sondaCallsiz === cmd ? "MUTASYON UYGULANMADI" : "");
  const sondaSetlocalsiz = sondaCallsiz.replace(/^setlocal\r?\n/im, "");
  check("§10e2 sonda: setlocal'sız çıplak çağrı (SAHINSRV'nin elle düzenlenmiş biçimi) → yeşil, ortam düşmez",
    sondaSetlocalsiz !== sondaCallsiz && callsizCagri(sondaSetlocalsiz).length === 0, sondaSetlocalsiz === sondaCallsiz ? "MUTASYON UYGULANMADI" : "");
}

// §10h — premigrate yedeği ve ilk kurulum şifrelemesi: parola HİÇBİR betikte argümana
//   yazılmaz (araç terminalde sorar); kur.ps1 premigrate'i aynı araçla şifreler ve -GeriAl
//   şifreli yedeği çözdürür; ilk-kurulum adımı isteğe bağlıdır ve anahtar ezmez.
{
  const kur = psTara(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const ilk = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const yed = psTara(readFileSync(join(KOK, "deploy/yedekle.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const parolaArg = [...kur, ...ilk, ...yed].filter((k) => /yedek-sifrele|\$sifreArac|\$arac\b/.test(k) && /--parola(?!li)/.test(k));
  check("§10h ⭐ yedek parolası hiçbir betikte araca ARGÜMAN olarak verilmez", parolaArg.length === 0, parolaArg.join(" | "));
  const liste = kur.findIndex((k) => k.includes('--list $dump > $null'));
  const sifre = kur.findIndex((k) => /& node \$sifreArac sifrele --girdi \$dump --anahtar-dizini \$anahtarDizini --duzu-sil/.test(k));
  const esik = kur.findIndex((k) => k.includes("& node $prismaCli migrate deploy"));
  check("§10i ⭐ kur.ps1: premigrate yedeği doğrulandıktan SONRA, migration eşiğinden ÖNCE şifrelenir",
    liste >= 0 && sifre > liste && esik > sifre, `list ${liste + 1} · şifrele ${sifre + 1} · eşik ${esik + 1}`);
  check("§10j kur.ps1 -GeriAl şifreli premigrate'i çözdürür (araç sorar, `--anahtar-dizini`)",
    kur.some((k) => k.trim() === "PremigrateCoz") && kur.some((k) => /& node \$arac coz --girdi \$son\.FullName/.test(k)));
  check("§10k ilk-kurulum: `-YedekSifreleme` isteğe bağlı, var olan yerel anahtar EZİLMEZ, anahtar dizini sır izniyle daraltılır",
    ilk.some((k) => k.includes("[switch]$YedekSifreleme")) &&
      ilk.some((k) => k.includes("yerel anahtar zaten var, DOKUNULMADI")) &&
      ilk.some((k) => k.includes('$sirYollari = @(') && k.includes('"$Kok\\yedek-anahtar"')));
}

// §11 — web paneli + API güvenlik duvarı (bulgu 13, 18). Web paneli 2026-09-30'dan (B6) beri fabrika
//   paketine GİRMEZ (tek tüketicisi emekli tünelin patron kabuğuydu); 4000 kuralı elle ve profilsiz
//   açılıyordu; Tailscale-In kuralı Private profilde her portu açabiliyor.
{
  const ilk = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const kur = psTara(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const pak = psTara(readFileSync(join(KOK, "deploy/paketle.ps1"), "utf8")).satirlar.map((s) => s.kod);
  check("§11a ⭐ (B6) paket web panelini TAŞIMAZ ve yeni .env'e WEB_DIST_DIR YAZILMAZ",
    !pak.some((k) => k.includes("build:web") || k.includes("\\dist-web")) &&
      !ilk.some((k) => k.includes("WEB_DIST_DIR")));
  check("§11b ⭐ (B6) kur.ps1 eski .env'deki emekli anahtarları (WEB_DIST_DIR · REMOTE_PORT · CF_ACCESS_*) SÖYLER, .env'e dokunmaz",
    kur.some((k) => k.includes("@('WEB_DIST_DIR', 'REMOTE_PORT', 'CF_ACCESS_ENABLED', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD')")) &&
      kur.some((k) => k.includes("emekli (fabrika web paneli + uzaktan erisim tuneli kaldirildi)")));
  const profilVars = ilk.find((k) => k.includes("[string[]]$ApiAgProfili =")) ?? "";
  const adresVars = ilk.find((k) => k.includes("[string[]]$ApiIzinliAdres =")) ?? "";
  check("§11c ⭐ API kuralı varsayılanı Domain+Private ve LocalSubnet (Public ve 'Any' DEĞİL), kural bu parametrelerle kurulur",
    /@\("Domain", "Private"\)/.test(profilVars) && !/Public"\)?\s*$/.test(profilVars.split("=")[1] ?? "") &&
      /@\("LocalSubnet"\)/.test(adresVars) &&
      ilk.some((k) => k.includes("-Profile $ApiAgProfili -RemoteAddress $ApiIzinliAdres")));
  check("§11d Tailscale-In kuralı ÖLÇÜLÜR (üçüncü tarafın kuralı değiştirilmez, açık iş olarak söylenir)",
    ilk.some((k) => k.includes('Get-NetFirewallRule -DisplayName "Tailscale-In"')) &&
      !ilk.some((k) => /Set-NetFirewallRule[^\n]*Tailscale/.test(k)));
  check("§11e JWT_SECRET kriptografik üreteçten (Get-Random değil)",
    ilk.some((k) => k.includes("[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bayt)")) &&
      !ilk.some((k) => k.includes("$gizli") && k.includes("Get-Random")));
}

// §12 — SSH'tan kurulum (bulgu 11): Windows OpenSSH oturumu kapanınca alt süreçler
//   ölür; pm2 daemon o oturumda doğarsa backend onunla gider. kur.ps1 daemon yokken
//   DURUR (bilerek geçiş -SshKabul), iş SYSTEM görevine uzaktan-kos.ps1 ile verilir.
{
  const kur = psTara(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const uz = psTara(readFileSync(join(KOK, "deploy/uzaktan-kos.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const ssh = kur.findIndex((k) => k.includes("if ($env:SSH_CONNECTION -or $env:SSH_CLIENT)"));
  const ilkDegisim = kur.findIndex((k) => /^\s*if \(\$GeriAl\) \{/.test(k));
  const blok = ssh >= 0 ? kur.slice(ssh, ssh + 30) : [];
  check("§12a ⭐ kur.ps1 SSH oturumunda pm2 daemon'u ölçer ve YOKSA durur (-SshKabul kaçışı), hiçbir şeye dokunmadan önce",
    ssh >= 0 && ilkDegisim > ssh && blok.some((k) => k.includes("pm2[\\\\/]lib[\\\\/]Daemon\\.js")) &&
      blok.some((k) => /^\s*Fail "SSH oturumu ve pm2 daemon YOK/.test(k)) && blok.some((k) => k.includes("if (-not $SshKabul)")),
    `SSH satır ${ssh + 1} · GeriAl satır ${ilkDegisim + 1}`);
  check("§12b ⭐ uzaktan-kos.ps1 işi SYSTEM görevine verir, çıktıyı dosyaya yönlendirir, bitince görevi siler (koşarken silmez)",
    uz.some((k) => k.includes('New-ScheduledTaskPrincipal -UserId "SYSTEM"')) &&
      uz.some((k) => /> `"\$Log`" 2>&1/.test(k)) &&
      uz.some((k) => k.includes("Unregister-ScheduledTask -TaskName $gorevAd")) &&
      uz.some((k) => k.includes("gorev HALA kosuyor")));
  check("§12c uzaktan-kos.ps1 kur.ps1'i -Zorla/-GeriAl olmadan göreve vermez (onay sorusu görevde cevaplanamaz; kültür-bağımsız)",
    uz.some((k) => k.includes("[regex]::IsMatch($Argumanlar, '(^|\\s)-(Zorla|GeriAl)\\b', 'IgnoreCase, CultureInvariant')")) &&
      uz.some((k) => /-and -not \$onayli\)/.test(k)));
  // §12d (D6): geçiş de görevde etkileşimsiz — `-Uygula` kuru koşumun bastığı `-Onay <N>`sız göreve verilmez; çıktısı
  //   backend'in YAZABİLDİĞİ logs\ yerine betiğin klasöründe (görev SYSTEM'dir, D3 güvenilmez dizin kuralı).
  const uzIhlal = (u: string[]): string[] => {
    const ih: string[] = [];
    if (!u.some((k) => k.includes('$gecisMi = [string]::Equals((Split-Path $betikTam -Leaf), "gecis.ps1", [System.StringComparison]::OrdinalIgnoreCase)'))) ih.push("geçiş betiği kültür-bağımsız tanınmıyor");
    if (!u.some((k) => /if \(\$gecisMi -and \$uygulaMi -and -not \[regex\]::IsMatch\(\$Argumanlar, '\(\^\|\\s\)-Onay\\s\+\\d\+\\b', 'IgnoreCase, CultureInvariant'\)\) \{/.test(k))) ih.push("geçiş -Onay'sız göreve veriliyor");
    if (!u.some((k) => /\$dizin = if \(-not \$gecisMi -and \(Test-Path \$varsayilan\)\)/.test(k))) ih.push("geçişin çıktısı logs\\'e yazılıyor");
    return ih;
  };
  check("§12d ⭐ uzaktan-kos.ps1 geçiş kipi: gecis.ps1 -Uygula yalnız -Onay <N> ile, çıktı logs\\ DIŞINDA; kur.ps1 dalı aynen", uzIhlal(uz).length === 0, uzIhlal(uz).join(" | ") || "temiz");
  for (const [ad, u2] of [
    ["-Onay kapısı silindi", uz.filter((k) => !/if \(\$gecisMi -and \$uygulaMi/.test(k))],
    ["çıktı logs\\'e", uz.map((k) => k.replace("if (-not $gecisMi -and (Test-Path $varsayilan))", "if (Test-Path $varsayilan)"))],
  ] as const) check(`§12d sonda: ${ad} → kırmızı`, uzIhlal([...u2]).length > 0);
}

// §13 — yedek şifreleme niyeti tek kaynak (D13) + ilk kurulumun sır ve soru kapıları.
//   Gece görevi ile backend aynı `app\.env` BACKUP_KEY_DIR'i okur; satırı ilk-kurulum
//   .env doğduktan SONRA ve `-YedekSifreleme`den bağımsız yazar. Rol parolası argv'ye
//   girmez (STDIN + SCRAM); soru kapısı SSH PTY'sini de tanır (UserInteractive tek başına değil).
{
  const tara = (y: string) => psTara(readFileSync(join(KOK, y), "utf8"));
  const ilkT = tara("deploy/ilk-kurulum.ps1");
  const yedT = tara("deploy/yedekle.ps1");
  const bakT = tara("deploy/bakim-rolu.ps1");
  const ortT = tara("deploy/kurulum/kurulum-ortak.ps1"); // setup.exe (D5) aynı SCRAM gövdesini taşır
  const kurT = tara("deploy/kurulum/kurulum.ps1"); // setup.exe (D5) aynı .env okuyucusunu taşır
  const ilk = ilkT.satirlar.map((x) => x.kod);
  const yed = yedT.satirlar.map((x) => x.kod);
  const envOku = yed.findIndex((k) => /EnvDeger \(Get-Content \$envDosya -Encoding UTF8\) "BACKUP_KEY_DIR"/.test(k));
  const varsayilan = yed.findIndex((k) => /\$AnahtarDizini = Join-Path \$Kok "yedek-anahtar"/.test(k));
  const beyanHata = yed.findIndex((k) => /if \(\$beyanli -and -not \(Test-Path \$AnahtarDizini\)\)/.test(k));
  const sifrele = yed.findIndex((k) => /"sifrele", "--girdi", \$yarim/.test(k));
  check("§13a ⭐ yedekle.ps1 anahtar dizinini app\\.env BACKUP_KEY_DIR'den okur, yoksa <kök>\\yedek-anahtar; beyanlı ama dizin yoksa şifreleme HATASI (sessiz düz değil)",
    envOku >= 0 && varsayilan > envOku && beyanHata > varsayilan && sifrele > beyanHata &&
      !yed.some((k) => /\[string\]\$AnahtarDizini\s*=/.test(k)),
    `env ${envOku + 1} · varsayılan ${varsayilan + 1} · beyan ${beyanHata + 1} · şifrele ${sifrele + 1}`);
  const envAdim = ilk.findIndex((k) => /^\s*Adim\s+"app\\\.env/.test(k));
  const yazim = ilk.findIndex((k) => /Add-Content -Path \$envDosya -Value "BACKUP_KEY_DIR=/.test(k));
  const blok = yazim >= 0 ? ilkT.satirlar[yazim]! : null;
  const kosul = yazim > 0 ? ilk[yazim - 1] ?? "" : "";
  check("§13b ⭐ ilk-kurulum BACKUP_KEY_DIR'i .env adımından SONRA, `-YedekSifreleme` dalının DIŞINDA (derinlik 1), dizin varken ve satır yokken yazar",
    envAdim >= 0 && yazim > envAdim && blok?.derinlik === 1 &&
      /Test-Path \$anahtarDizini/.test(kosul) && /-not \$envAnahtar/.test(kosul) &&
      ilk.some((k) => /\$envAnahtar = .*EnvDeger \(Get-Content \$envDosya -Encoding UTF8\) "BACKUP_KEY_DIR"/.test(k)),
    `.env adımı ${envAdim + 1} · yazım ${yazim + 1} · derinlik ${blok?.derinlik}`);
  const sirliArgv = [...ilkT.satirlar, ...bakT.satirlar].filter((x) =>
    /(CREATE|ALTER) ROLE/.test(x.kod) && /PASSWORD/.test(x.kod) && !/PsqlStdin/.test(x.kod) && !/Write-Host/.test(x.kod));
  check("§13c ⭐ rol parolası psql ARGV'sine girmez: CREATE/ALTER ROLE … PASSWORD yalnız PsqlStdin + SCRAM doğrulayıcısıyla",
    sirliArgv.length === 0 &&
      ilk.some((k) => /PsqlStdin \$PostgresKullanici \$PostgresParola "postgres" .*CREATE ROLE .*ScramDogrulayici \$DbParola/.test(k)),
    sirliArgv.map((x) => x.no).join(", ") || "temiz");
  const govde = (t: typeof ilkT, ad: string): string | null => {
    const f = t.fonksiyonlar.find((x) => x.ad === ad);
    return f ? t.satirlar.filter((x) => x.no >= f.bas && x.no <= f.son).map((x) => x.kod.trim()).filter(Boolean).join("\n") : null;
  };
  for (const [ad, dosyalar] of [
    ["ScramDogrulayici", [ilkT, bakT, ortT]],
    ["Pbkdf2Sha256", [ilkT, bakT, ortT]],
    ["SoruSorabilir", [ilkT, bakT]],
    ["EnvDeger", [ilkT, bakT, yedT, kurT]],
  ] as const) {
    const g = dosyalar.map((t) => govde(t, ad));
    check(`§13d ⭐ \`${ad}\` ikizleri birebir aynı (${dosyalar.length} betik; biri düzelip öteki kalmasın)`,
      g.every((x) => x !== null && x.length > 20) && new Set(g).size === 1, g.map((x) => (x ? `${x.length} bayt` : "YOK")).join(" · "));
  }
  const ui = SUNUCU_PS1.flatMap((y) => {
    const t = tara(y);
    return t.satirlar.filter((x) => /UserInteractive/.test(x.ciplak) && kapsayanFonksiyon(t, x.no)?.ad !== "SoruSorabilir").map((x) => `${y}:${x.no}`);
  });
  check("§13e ⭐ soru kapısı tek yüklemde: `UserInteractive` yalnız `SoruSorabilir` içinde (SSH PTY'si de soru sorabilir)",
    ui.length === 0 && ilk.filter((k) => /-not \(SoruSorabilir\)/.test(k)).length >= 2, ui.join(", ") || "temiz");
}

// §14 — tr-TR kültür tuzağı (thinkpad-1): `-match/-replace/-split` ve `Select-String` büyük/küçük
//   harfe DUYARSIZ ve kültüre BAĞLIDIR; tr-TR'de 'I' 'i'ye inmez. deploy altındaki her .ps1'de
//   `-c…` biçimi ya da `-CaseSensitive`; duyarsızlık GEREKİYORSA `[regex]::IsMatch(…, 'IgnoreCase,
//   CultureInvariant')`. kur.ps1 Faz 2b'nin sahipliğinde: borcu sayılır, taban yalnız DÜŞER.
{
  const KUR_KULTUR_BORCU = 7;
  const DUYARSIZ = /(?:^|[^\w-])-i?(?:match|notmatch|replace|split)\b/i;
  const ps1 = (d: string): string[] => readdirSync(join(KOK, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? ps1(`${d}/${e.name}`) : e.name.endsWith(".ps1") ? [`${d}/${e.name}`] : []);
  const dosyalar = ps1("deploy");
  let kurSayi = 0;
  const ihlal: string[] = [];
  for (const y of dosyalar) {
    // `kod` (string içi korunur): `"$($x -replace …)"` alt ifadesi `ciplak`ta silinir ve kör kalırdı.
    for (const x of psTara(readFileSync(join(KOK, y), "utf8")).satirlar) {
      const kotu = DUYARSIZ.test(x.kod) || (/\bSelect-String\b/i.test(x.kod) && !/-CaseSensitive\b/i.test(x.kod));
      if (!kotu) continue;
      if (y === "deploy/kur.ps1") kurSayi++;
      else ihlal.push(`${y}:${x.no}`);
    }
  }
  check("§14 körlük zemini: deploy altındaki .ps1'ler tarandı (kur.ps1 dahil, alt dizinler dahil)",
    dosyalar.length >= 10 && dosyalar.includes("deploy/kur.ps1") && dosyalar.some((y) => y.startsWith("deploy/test/")), `${dosyalar.length} dosya`);
  check("§14a ⭐ kur.ps1 dışında kültüre bağlı duyarsız regex/Select-String YOK", ihlal.length === 0, ihlal.join(", ") || "temiz");
  check(`§14b kur.ps1 kültür borcu = ${KUR_KULTUR_BORCU} (Faz 2b; düzeltilince tabanı İNDİR, artarsa kırmızı)`,
    kurSayi === KUR_KULTUR_BORCU, `ölçülen ${kurSayi}`);
}

// §15 — paketle.ps1 PowerShell 7 ister (2b-D thinkpad-1 provası): 5.1'de `#Requires`
//   olmadan npm ci'den sonra anlaşılmaz hatayla düşer; -Korumali Windows x64'te bile
//   `$IsWindows` 5.1'de tanımsız olduğu için "bu hostta üretilemez" der.
{
  const pk = readFileSync(join(KOK, "deploy/paketle.ps1"), "utf8").split(/\r?\n/);
  const req = pk.findIndex((k) => /^#Requires -Version 7(\.0)?\s*$/.test(k));
  const param = pk.findIndex((k) => /^param\(/.test(k));
  check("§15 ⭐ paketle.ps1 `#Requires -Version 7` taşır (5.1'de ilk satırda, açık hatayla reddedilir)",
    req >= 0 && param > req, `#Requires satır ${req + 1} · param satır ${param + 1}`);
}

// §16 — KURULUM KAYDI (3d-2): kur.ps1'in yazdığı satır protokolün allowlist'iyle AYNI anahtar
//   kümesini taşır (iki yönlü: eksik alan da fazla alan da kırmızı), dosya kurulum kökündedir ve
//   yalnız EKLENİR; hem kurulum hem -GeriAl kayıt düşer, tür değerleri protokolün kümesinden.
{
  const metin = readFileSync(join(KOK, "deploy/kur.ps1"), "utf8");
  const t = psTara(metin);
  const fn = t.fonksiyonlar.find((f) => f.ad === "KurulumKaydiYaz");
  const govde = fn ? t.satirlar.filter((x) => x.no > fn.bas && x.no < fn.son) : [];
  const anahtar = new Set(govde.flatMap((x) => /^\s*([A-Za-z]+)\s+=\s/.exec(x.kod)?.[1] ?? []));
  const shape = InstallRecordSchema.shape;
  const beklenen = new Set([...Object.keys(shape), ...Object.keys(shape.geriDonus.shape)]);
  const eksik = [...beklenen].filter((k) => !anahtar.has(k));
  const fazla = [...anahtar].filter((k) => !beklenen.has(k));
  check("§16a körlük zemini: KurulumKaydiYaz bulundu ve gövdesi tarandı", Boolean(fn) && anahtar.size >= 10, `${anahtar.size} anahtar`);
  check("§16b ⭐ kur.ps1 kaydı = protokol allowlist'i (eksik YOK · fazla YOK)", eksik.length === 0 && fazla.length === 0,
    `eksik: ${eksik.join(",") || "-"} · fazla: ${fazla.join(",") || "-"}`);
  const dosya = new RegExp(`^\\$gecmisDosyasi = "\\$kok\\\\${INSTALL_HISTORY_FILE_NAME.replace(".", "\\.")}"`, "m");
  check("§16c geçmiş dosyası kurulum kökünde (app\\ DIŞI), ad protokolle aynı", dosya.test(metin));
  const yazimlar = t.satirlar.filter((x) => /\$gecmisDosyasi\b/.test(x.kod) && !/^\s*\$gecmisDosyasi =/.test(x.kod));
  check("§16d ⭐ dosya yalnız EKLENİR (AppendAllText; Set-Content/Out-File/WriteAllText YOK)",
    yazimlar.length >= 1 && yazimlar.every((x) => /AppendAllText\(\$gecmisDosyasi/.test(x.kod) || /Ok "kurulum kaydi eklendi/.test(x.kod)),
    yazimlar.map((x) => x.no).join(","));
  const turler = [...metin.matchAll(/KurulumKaydiYaz @\{\s*tur = "([A-Z_]+)"/g)].map((m) => m[1]);
  check("§16e ⭐ hem KURULUM hem GERI_ALMA kayıt düşer, türler protokolün kümesinden",
    turler.includes("KURULUM") && turler.includes("GERI_ALMA") && turler.every((x) => (INSTALL_RECORD_KINDS as readonly string[]).includes(x ?? "")),
    turler.join(","));
}

// §17 — müşteri paketi üreticinin KİMLİĞİNİ taşımaz (I6 kararı b): `PAKET.json` makine/kullanıcı adı
// taşımaz; derleme kimliği + commit + zaman kalır, üreticinin adı yalnız paketleyen makinenin derleme
// kaydında (`~/.tekserp/derleme-kayitlari`, paket DIŞI). Kaynak ölçülür; ihlal listesi döner.
function paketKimlikIhlalleri(paketle: string, kur: string): string[] {
  const satir = psTara(paketle).satirlar;
  const ih: string[] = [];
  const bas = satir.findIndex((x) => /^\$manifest = \[ordered\]@\{/.test(x.kod));
  const son = bas < 0 ? -1 : satir.findIndex((x, i) => i > bas && /^\}\s*$/.test(x.kod));
  if (bas < 0 || son < 0) return ["PAKET.json manifest bloğu bulunamadı (körlük)"];
  const manifest = satir.slice(bas, son + 1).map((x) => x.kod).join("\n");
  const KIMLIK = /MachineName|UserName|COMPUTERNAME|USERNAME|HOSTNAME|\$env:USER\b|whoami|^\s*ureten\s*=/m;
  if (KIMLIK.test(manifest)) ih.push("manifest üreticinin makine/kullanıcı adını taşıyor");
  for (const alan of ["derlemeKimligi", "commit", "uretimZamani"]) {
    if (!new RegExp(`^\\s*${alan}\\s*=`, "m").test(manifest)) ih.push(`manifestte ${alan} yok`);
  }
  const kayit = satir.findIndex((x) => /\.tekserp\/derleme-kayitlari/.test(x.kod));
  const kayitYaz = satir.findIndex((x, i) => i > kayit && /Out-File \(Join-Path \$kayitDir /.test(x.kod));
  const kimlikSatirlari = satir.map((x, i) => ({ i, k: x.kod })).filter((x) => /MachineName|UserName/.test(x.k));
  if (kayit < 0 || kayitYaz < 0) ih.push("derleme kaydı (paket dışı) yazılmıyor");
  else if (kimlikSatirlari.some((x) => x.i < kayit || x.i > kayitYaz)) ih.push("üreticinin adı derleme kaydı dışında kullanılıyor");
  if (psTara(kur).satirlar.some((x) => /\$m\.ureten\b/.test(x.kod))) ih.push("kur.ps1 hâlâ `ureten` okuyor");
  return ih;
}
{
  const pk = readFileSync(join(KOK, "deploy/paketle.ps1"), "utf8");
  const kr = readFileSync(join(KOK, "deploy/kur.ps1"), "utf8");
  const ih = paketKimlikIhlalleri(pk, kr);
  check("§17a ⭐ PAKET.json üreticinin kimliğini taşımaz; derleme kimliği + commit + zaman kalır, ad yalnız derleme kaydında", ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string, string]> = [
    ["manifeste ureten geri", pk.replace(/^(\s*derlemeKimligi\s*= \$derlemeKimligi)/m, '$1\r\n  ureten = "$([System.Environment]::MachineName)"'), kr],
    ["derleme kaydı silindi", pk.replace(/\.tekserp\/derleme-kayitlari/g, ".tekserp/baska"), kr],
    ["kur.ps1 ureten basar", pk, kr.replace("derleme $($m.derlemeKimligi)", "$($m.ureten)")],
  ];
  for (const [ad, p2, k2] of sondalar) {
    const uygulandi = p2 !== pk || k2 !== kr;
    check(`§17 sonda: ${ad} → kırmızı`, uygulandi && paketKimlikIhlalleri(p2, k2).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

// §18 — şifreli modül paketi (G5): `-Sifrele` → `build-korumali.mjs --sifrele`; bayrak yoksa bugünkü
// şifresiz korumalı paket. Mühürleme anahtarı CI'a girmez: betik CI'da reddeder, iş akışı bayrağı geçirmez.
function sifreleIhlalleri(paketle: string, isAkisi: string): string[] {
  const kod = psTara(paketle).satirlar.map((x) => x.kod).join("\n");
  const ih: string[] = [];
  if (!/\[switch\]\$Sifrele\b/.test(kod)) ih.push("-Sifrele anahtarı tanımlı değil");
  const kapi = /^if \(\$Sifrele\) \{\n([\s\S]*?)^\}/m.exec(kod)?.[1] ?? "";
  if (!/if \(-not \$Korumali\) \{ Fail /.test(kapi)) ih.push("-Sifrele -Korumali'sız kabul ediliyor");
  if (!/if \(\$env:CI -or \$env:GITHUB_ACTIONS\) \{ Fail /.test(kapi)) ih.push("-Sifrele CI'da reddedilmiyor");
  if (!/StartsWith\(\[System\.IO\.Path\]::GetFullPath\(\$repo\)[^\n]*\{ Fail /.test(kapi)) ih.push("anahtar dizini repo içinde kabul ediliyor");
  if (!/^\s*\$sifreArg = @\(\)\s*$/m.test(kod) || !/^\s*if \(\$Sifrele\) \{\s*\n\s*\$sifreArg \+= "--sifrele=\$SifreliPaketler"/m.test(kod)) ih.push("--sifrele varsayılanda geçiyor (bugünkü şifresiz davranış bozulur)");
  if (!/build-korumali\.mjs"\) [^\n]*@sifreArg/.test(kod)) ih.push("build-korumali çağrısı @sifreArg taşımıyor");
  if (/-Sifrele|--sifrele|modul-anahtar/i.test(isAkisi)) ih.push("CI iş akışı şifreleme bayrağı/anahtar dizini geçiriyor");
  return ih;
}
{
  const pk = readFileSync(join(KOK, "deploy/paketle.ps1"), "utf8");
  const wf = readFileSync(join(KOK, ".github/workflows/korumali-paket.yml"), "utf8");
  const ih = sifreleIhlalleri(pk, wf);
  check("§18a ⭐ -Sifrele: varsayılan şifresiz, yalnız -Korumali ile, CI'da ret, anahtar repo dışı; iş akışı bayraksız", ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string, string]> = [
    ["CI reddi silindi", pk.replace(/^\s*if \(\$env:CI -or \$env:GITHUB_ACTIONS\) \{ Fail .*\r?\n/m, ""), wf],
    ["varsayılan şifreli", pk.replace(/\$sifreArg = @\(\)/, '$sifreArg = @("--sifrele=hepsi")'), wf],
    ["çağrıdan düştü", pk.replace(" @filigranArg @sifreArg", " @filigranArg"), wf],
    ["iş akışı şifreliyor", pk, wf.replace("--cikti=../koruma-cikti/dist", "--cikti=../koruma-cikti/dist --sifrele=hepsi")],
  ];
  for (const [ad, p2, w2] of sondalar) {
    const uygulandi = p2 !== pk || w2 !== wf;
    check(`§18 sonda: ${ad} → kırmızı`, uygulandi && sifreleIhlalleri(p2, w2).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

// §19 — ECOSYSTEM BİRLEŞTİRME (thinkpad-1 2026-09-30: korunan eski dosya korumalı paketi sistem Node'uyla
// başlattı, yükleyici çıkış 78, [9/9] migration eşiğinden SONRA düştü). Runtime taşıyan pakette sunucunun
// dosyası paketin Node'uyla BİRLEŞTİRİLİR ([2/9], [3/9]'dan önce; okunamazsa Fail); yedek ÖNCE; yorumlayıcı
// değişince [8/9]'da yalnız bu uygulama delete + start (restart pm2 dökümündeki ESKİ yorumlayıcıyı korur);
// -GeriAl simetrik; korumasız dal bugünkü bayt-bayt kopya. Kaynak ölçülür; ihlal listesi döner.
function ecoJs(kur: string): string | null {
  const m = /^\$ecoBirlestirJs = @'\r?\n([\s\S]*?)\r?\n'@/m.exec(kur);
  return m ? m[1]!.replace(/\r\n/g, "\n") : null;
}
function ecoBirlestirmeIhlalleri(kur: string): string[] {
  const ih: string[] = [];
  const t = psTara(kur);
  const kod = t.satirlar.map((x) => x.kod);
  const ilk = (re: RegExp): number => kod.findIndex((x) => re.test(x));
  const js = ecoJs(kur);
  if (!js) return ["$ecoBirlestirJs here-string'i yok (körlük)"];
  if (!/const SABLON_ALANLARI = \[[^\]]*"interpreter"[^\]]*\]/.test(js)) ih.push("birleştirici interpreter'ı şablondan almıyor");
  const govde = (ad: string): string[] => {
    const f = t.fonksiyonlar.find((x) => x.ad === ad);
    return f ? t.satirlar.filter((x) => x.no > f.bas && x.no <= f.son).map((x) => x.kod) : [];
  };
  const hesap = govde("EcoBirlestirHesapla");
  if (!hesap.some((x) => /& \$nodeExe \$arac /.test(x))) ih.push("birleştirici verilen Node ile koşmuyor");
  const bas = ilk(/^\$paketRuntime = \$null/), rtSet = ilk(/^\s+\$paketRuntime = \$runtimeExe\s*$/), rtKapi = ilk(/^if \(Test-Path \$runtimeExe\) \{/);
  if (bas < 0 || rtSet < 0 || !(bas < rtKapi && rtKapi < rtSet)) ih.push("$paketRuntime yalnız doğrulanmış runtime dalında dolmuyor");
  const kapi = ilk(/^if \(\$paketRuntime -and \$ecoBayt\) \{/), cagri = ilk(/EcoBirlestirHesapla \$paketRuntime /);
  const adim3 = ilk(/^Adim "\[3\/9\]/), adim4 = ilk(/^Adim "\[4\/9\]/);
  if (kapi < 0 || cagri < kapi) ih.push("birleştirme runtime kapısının dışında (korumasız dal değişir)");
  if (cagri < 0 || adim3 < 0 || cagri > adim3 || cagri > adim4) ih.push("birleştirme kararı [3/9]/[4/9]'dan ÖNCE değil");
  const blok = kod.slice(kapi, kapi + 12).join("\n");
  if (!/catch \{\s*\n?\s*Fail /.test(blok)) ih.push("birleştirilemeyen dosyada Fail yok");
  if (!/^\$ecoBirlesikBayt = \$null/m.test(kod.join("\n"))) ih.push("$ecoBirlesikBayt varsayılanı $null değil");
  const yer = govde("EcoYerlestir");
  const yedek = yer.findIndex((x) => /WriteAllBytes\("\$ecoHedef\.onceki", \$sunucuBayt\)/.test(x));
  const birlesik = yer.findIndex((x) => /WriteAllBytes\(\$ecoHedef, \$birlesikBayt\)/.test(x));
  if (yedek < 0 || birlesik < 0 || yedek > birlesik) ih.push("yedek (.onceki) birleşik dosyadan ÖNCE yazılmıyor");
  if (!yer.some((x) => /^\s*\} else \{\s*$/.test(x)) || !yer.some((x) => /WriteAllBytes\(\$ecoHedef, \$sunucuBayt\)/.test(x))) ih.push("korumasız dal bayt-bayt kopya değil");
  if (ilk(/^\s+if \(\$ecoBayt\) \{ EcoYerlestir \$appDir \$ecoBayt \$ecoBirlesikBayt \}/) < 0) ih.push("[5/9] EcoYerlestir'i çağırmıyor");
  const adim8 = ilk(/^Adim "\[8\/9\]/), start8 = kod.findIndex((x, i) => i > adim8 && /^& \$pm2 start ecosystem\.config\.js/.test(x));
  const sil8 = kod.slice(adim8, start8).join("\n");
  if (adim8 < 0 || start8 < 0 || !/if \(\$ecoPlan -and \$ecoPlan\.Karar -ceq "BIRLESTIR"\) \{\s*\n\s*Pm2Kos delete \$uygulama/.test(sil8)) ih.push("[8/9] yorumlayıcı değişince start'tan önce delete yok");
  if (kod.some((x) => /(?:\$pm2|Pm2Kos)\s+(?:restart|reload)\b/.test(x))) ih.push("pm2 restart/reload kullanılıyor (dökümdeki eski yorumlayıcı)");
  const geri = ilk(/^if \(\$GeriAl\) \{/), gSil = kod.findIndex((x, i) => i > geri && /Pm2Kos delete \$uygulama/.test(x));
  const gOlc = kod.findIndex((x, i) => i > geri && /^\s+EcoGeriAlOlc \$appDir /.test(x));
  const gStart = kod.findIndex((x, i) => i > gOlc && gOlc > 0 && /^\s+& \$pm2 start ecosystem\.config\.js/.test(x));
  if (geri < 0 || !(gSil > geri && gOlc > gSil && gStart > gOlc) || !/^\s+& \$pm2 save/.test(kod[gStart + 1] ?? "")) ih.push("-GeriAl simetrik değil (delete → ölçüm → start → save)");
  if (!govde("EcoGeriAlOlc").some((x) => /ecosystem\.config\.js\.onceki/.test(x))) ih.push("-GeriAl birleştirme öncesi yedeği ölçmüyor");
  const ad = ilk(/^\$env:TEKSERP_PM2_AD = \$uygulama/);
  if (ad < 0 || ad > geri) ih.push("pm2 adı -GeriAl'den ÖNCE env'e yazılmıyor");
  return ih;
}
{
  const kr = readFileSync(join(KOK, "deploy/kur.ps1"), "utf8");
  const ih = ecoBirlestirmeIhlalleri(kr);
  check("§19a ⭐ korumalı pakette ecosystem birleştirilir: runtime kapısı, [3/9] öncesi karar + Fail, yedek önce, [8/9] delete+start, restart yok, -GeriAl simetrik, korumasız dal aynen",
    ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["runtime kapısı kalktı", kr.replace("if ($paketRuntime -and $ecoBayt) {", "if ($ecoBayt) {")],
    ["karar [3/9] sonrasına", kr.replace(/^(\$ecoPlan = \$null)/m, 'Adim "[3/9] erken"\r\n$1')],
    ["yedek yazımı silindi", kr.replace(/^\s+\[System\.IO\.File\]::WriteAllBytes\("\$ecoHedef\.onceki", \$sunucuBayt\)\r?\n/m, "")],
    ["[8/9] delete silindi", kr.replace(/(if \(\$ecoPlan -and \$ecoPlan\.Karar -ceq "BIRLESTIR"\) \{[\s\S]*?)Pm2Kos delete \$uygulama \| Out-Null/, "$1$null = 0")],
    ["restart eklendi", kr.replace("& $pm2 save    # ZORUNLU", "& $pm2 restart $uygulama\r\n& $pm2 save    # ZORUNLU")],
    ["-GeriAl ölçümü silindi", kr.replace(/^\s+EcoGeriAlOlc \$appDir .*\r?\n/m, "")],
    ["şablon interpreter'ı bırakıldı", kr.replace('"cwd", "interpreter", "exec_interpreter"]', '"cwd"]')],
    ["pm2 adı env'i global değil", kr.replace(/^\$env:TEKSERP_PM2_AD = \$uygulama\r?\n(?=\r?\n# --- KURULUM KAYDI)/m, "")],
  ];
  for (const [ad, k2] of sondalar) {
    const uygulandi = k2 !== kr;
    const ih2 = uygulandi ? ecoBirlestirmeIhlalleri(k2) : [];
    check(`§19 sonda: ${ad} → kırmızı`, ih2.length > 0, uygulandi ? ih2.join(" | ") : "MUTASYON UYGULANMADI");
  }
}

// §20 — birleştiricinin DAVRANIŞI (Node birim): kur.ps1'deki here-string AYNEN çıkarılır ve paketin
// gerçek şablonuyla koşulur. ① env'li eski dosya → env + sunucuya özgü alan korunur, interpreter paketten
// ② env'siz eski dosya → env EKLENMEZ, interpreter paketten ③ zaten bağlı dosya (birleşik çıktı dahil) →
// DOKUNMA, çıktı yazılmaz ④ JSON'a dönmeyen değer ve bağsız şablon → HATA (kur.ps1 [3/9] öncesi Fail).
function ecoBirimIhlalleri(js: string): string[] {
  const ih: string[] = [];
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "eco-birim-")));  // require __dirname'i gerçek yola çözer
  try {
    const rt = process.platform === "win32" ? ["runtime", "node.exe"] : ["runtime", "bin", "node"];
    const paketKok = join(dir, "paket"), app = join(dir, "kok", "app"), bagsiz = join(dir, "bagsiz");
    for (const d of [join(paketKok, ...rt.slice(0, -1)), join(app, ...rt.slice(0, -1)), bagsiz]) mkdirSync(d, { recursive: true });
    writeFileSync(join(paketKok, ...rt), ""); writeFileSync(join(app, ...rt), "");
    const sablon = join(KOK, "Teks-Erp/ecosystem.config.js");
    const arac = join(dir, "b.cjs"); writeFileSync(arac, js);
    const kos = (sunucu: string, kok = paketKok) => {
      const cikti = join(dir, `c-${Math.random().toString(36).slice(2)}.js`);
      const r = spawnSync(process.execPath, [arac, "--sunucu", sunucu, "--paket", sablon, "--app", app, "--paket-kok", kok, "--cikti", cikti], { encoding: "utf8" });
      let j: { karar?: string } = {};
      try { j = JSON.parse(r.stdout.trim().split("\n").pop() ?? ""); } catch { /* karar yok */ }
      return { kod: r.status, j, cikti: existsSync(cikti) ? cikti : null };
    };
    const oku = (eco: string): Record<string, unknown> => {
      const hedef = join(app, "ecosystem.config.js"); writeFileSync(hedef, readFileSync(eco));
      const r = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(require(process.argv[1]).apps[0]))", hedef],
        { encoding: "utf8", env: { ...process.env, TEKSERP_PM2_AD: "ad-sablondan" } });
      return JSON.parse(r.stdout || "{}");
    };
    const beklenenY = join(app, ...rt).replace(/\\/g, "/");
    const eskiEnv = { NODE_ENV: "production", PORT: "4100", BACKUP_RCLONE_REMOTE: "gdrive:TeksERP", PG_BIN_DIR: "D:/pg/bin" };
    const envli = join(dir, "envli.js");
    writeFileSync(envli, `const path=require("path");const KOK=path.resolve(__dirname,"..");\nmodule.exports={apps:[{name:"eski-ad",script:"dist/server.js",cwd:__dirname,max_memory_restart:"2G",out_file:KOK+"/logs/o.log",env:${JSON.stringify(eskiEnv)}}]};\n`);
    const a = kos(envli);
    if (a.j.karar !== "BIRLESTIR" || !a.cikti) ih.push(`① env'li eski dosya BIRLESTIR değil (${a.j.karar ?? a.kod})`);
    else {
      const m = oku(a.cikti);
      if (m.interpreter !== beklenenY) ih.push(`① interpreter paketten değil (${String(m.interpreter)})`);
      if (JSON.stringify(m.env) !== JSON.stringify(eskiEnv)) ih.push("① env bloğu AYNEN korunmadı");
      if (m.max_memory_restart !== "2G" || m.out_file !== join(dir, "kok") + "/logs/o.log") ih.push("① sunucuya özgü alan korunmadı");
      if (m.name !== "ad-sablondan" || m.cwd !== app || m.script !== "dist/server.js") ih.push("① name/cwd/script şablondan gelmiyor");
      const tekrar = kos(a.cikti);
      if (tekrar.j.karar !== "DOKUNMA" || tekrar.cikti) ih.push("③ birleşik çıktı ikinci kurulumda DOKUNMA değil");
    }
    const envsiz = join(dir, "envsiz.js");
    writeFileSync(envsiz, `module.exports={apps:[{name:"x",script:"dist/server.js",cwd:__dirname}]};\n`);
    const b = kos(envsiz);
    if (b.j.karar !== "BIRLESTIR" || !b.cikti) ih.push(`② env'siz eski dosya BIRLESTIR değil (${b.j.karar ?? b.kod})`);
    else {
      const m = oku(b.cikti);
      if (m.interpreter !== beklenenY) ih.push("② interpreter paketten değil");
      if ("env" in m) ih.push("② env'siz dosyaya şablonun env'i eklendi");
    }
    const c = kos(sablon);
    if (c.j.karar !== "DOKUNMA" || c.cikti || c.kod !== 0) ih.push(`③ zaten bağlı dosya DOKUNMA değil (${c.j.karar ?? c.kod})`);
    const fn = join(dir, "fn.js");
    writeFileSync(fn, `module.exports={apps:[{name:"x",script:"dist/server.js",env:{A:()=>1}}]};\n`);
    const d = kos(fn);
    if (d.j.karar !== "HATA" || d.kod === 0 || d.cikti) ih.push("④ JSON'a dönmeyen değer HATA vermedi");
    const e = kos(envli, bagsiz);
    if (e.j.karar !== "HATA" || e.kod === 0) ih.push("④ runtime bağı üretmeyen şablon HATA vermedi");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return ih;
}
{
  const js = ecoJs(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8")) ?? "";
  const ih = js ? ecoBirimIhlalleri(js) : ["here-string yok"];
  check("§20a ⭐ birleştirici: env'li → env + sunucu alanı korunur, interpreter paketten · env'siz → env eklenmez · bağlı → DOKUNMA · bozuk → HATA",
    ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["şablon interpreter'ı almıyor", js.replace('"cwd", "interpreter", "exec_interpreter"]', '"cwd", "exec_interpreter"]')],
    ["zaten doğru dosyaya da yazar", js.replace("if (mevcut === beklenen)", "if (false)")],
    ["env şablondan gelir", js.replace("const app = Object.assign({}, sunucu.app);", "const app = Object.assign({}, sunucu.app, { env: s.env });")],
    ["JSON denetimi kalktı", js.replace('jsonDuz(app, "apps[0]");', "")],
  ];
  for (const [ad, j2] of sondalar) {
    const uygulandi = j2 !== js && js !== "";
    const ih2 = uygulandi ? ecoBirimIhlalleri(j2) : [];
    check(`§20 sonda: ${ad} → kırmızı`, ih2.length > 0, uygulandi ? ih2.join(" | ") : "MUTASYON UYGULANMADI");
  }
}

// §21 — PM2 AD KAPISI (F2): -UygulamaAdi / varsayılan ad pm2'de BAŞKA adla çalışan backend'i hedeflerse
// [4/9] `delete` hiçbir şeyi durdurmaz, [8/9] `start` AYNI PORTA ikinci backend doğururdu (kök yasak: ikinci
// Node süreci). [1/9] ve -GeriAl hiçbir şeye dokunmadan ÖNCE pm2 listesini ölçer; ihlal ve ölçülemedi DURUR.
// Liste diske yazılmaz (env taşır), Node'a stdin'den gider. Kaynak ölçülür; ihlal listesi döner.
function pm2AdJs(kur: string): string | null {
  const m = /^\$pm2AdJs = @'\r?\n([\s\S]*?)\r?\n'@/m.exec(kur);
  return m ? m[1]!.replace(/\r\n/g, "\n") : null;
}
function pm2AdKapisiIhlalleri(kur: string): string[] {
  const ih: string[] = [];
  const t = psTara(kur);
  const kod = t.satirlar.map((x) => x.kod);
  const ilk = (re: RegExp, bas = 0): number => kod.findIndex((x, i) => i >= bas && re.test(x));
  if (!pm2AdJs(kur)) return ["$pm2AdJs here-string'i yok (körlük)"];
  const f = t.fonksiyonlar.find((x) => x.ad === "Pm2AdiDogrula");
  const govde = f ? t.satirlar.filter((x) => x.no > f.bas && x.no <= f.son).map((x) => x.kod) : [];
  if (!govde.length) return ["Pm2AdiDogrula yok (körlük)"];
  if (!govde.some((x) => /\$liste = \(@\(& \$pm2 jlist\) -join/.test(x))) ih.push("pm2 listesi `pm2 jlist`ten okunmuyor");
  if (!govde.some((x) => /\$liste \| & node \$arac --ad \$uygulama --app \$appDir /.test(x))) ih.push("liste Node'a stdin'den gitmiyor");
  if (govde.some((x) => /(WriteAll\w+|Set-Content|Out-File|Add-Content)[^\n]*\$liste/.test(x))) ih.push("pm2 listesi diske yazılıyor (env taşır)");
  if (!govde.some((x) => /^\s*else \{ Fail "pm2 ad kapisi/.test(x))) ih.push("tanınmayan karar (IHLAL/OLCULEMEDI) Fail değil");
  if (!govde.some((x) => /if \(-not \$r\) \{ Fail /.test(x))) ih.push("cevapsız araç Fail değil");
  const acik = ilk(/^\$adAcik\s+= \$PSBoundParameters\.ContainsKey\('UygulamaAdi'\)/);
  const ssh = ilk(/^if \(\$env:SSH_CONNECTION -or \$env:SSH_CLIENT\) \{/);
  const geri = ilk(/^if \(\$GeriAl\) \{/);
  if (acik < 0 || acik > geri) ih.push("$adAcik (ad açıkça verildi mi) -GeriAl'den önce ölçülmüyor");
  const gCagri = ilk(/^\s+Pm2AdiDogrula \(EcoPortu /, geri), gSil = ilk(/Pm2Kos delete \$uygulama/, geri), gSor = ilk(/Read-Host "Devam\?/, geri);
  if (geri < 0 || gCagri < 0 || !(gCagri > ssh && gCagri < gSil && gCagri < gSor)) ih.push("-GeriAl ad kapısı delete/onaydan ÖNCE değil");
  const a1 = ilk(/^Adim "\[1\/9\]/), a2 = ilk(/^Adim "\[2\/9\]/), a4 = ilk(/^Adim "\[4\/9\]/);
  const pCagri = ilk(/^Pm2AdiDogrula \(EcoPortu \$ecoPortKaynak\)/);
  if (pCagri < 0 || !(pCagri > a1 && pCagri < a2 && pCagri < a4 && pCagri > ssh)) ih.push("kurulum ad kapısı [1/9] içinde ([2/9]'dan önce) değil");
  return ih;
}
{
  const kr = readFileSync(join(KOK, "deploy/kur.ps1"), "utf8");
  const ih = pm2AdKapisiIhlalleri(kr);
  check("§21a ⭐ pm2 ad kapısı: [1/9] ve -GeriAl'de dokunmadan önce ölçer, liste stdin'den, ihlal/ölçülemedi Fail",
    ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["-GeriAl çağrısı silindi", kr.replace(/^\s+Pm2AdiDogrula \(EcoPortu \(Join-Path \$hedef .*\r?\n/m, "")],
    ["kurulum çağrısı [4/9] sonrasına", kr.replace(/^Pm2AdiDogrula \(EcoPortu \$ecoPortKaynak\)\r?\n/m, "").replace(/^(Adim "\[5\/9\])/m, "Pm2AdiDogrula (EcoPortu $$ecoPortKaynak)\r\n$1")],
    ["ihlal yalnız uyarır", kr.replace('else { Fail "pm2 ad kapisi', 'else { Uyar "pm2 ad kapisi')],
    ["liste diske yazılır", kr.replace("$satirlar = @($liste | & node $arac", "[System.IO.File]::WriteAllText(\"$arac.json\", $liste)\r\n    $satirlar = @($liste | & node $arac")],
    ["$adAcik ölçülmüyor", kr.replace(/^\$adAcik\s+= .*\r?\n/m, "")],
  ];
  for (const [ad, k2] of sondalar) {
    const uygulandi = k2 !== kr;
    const ih2 = uygulandi ? pm2AdKapisiIhlalleri(k2) : [];
    check(`§21 sonda: ${ad} → kırmızı`, ih2.length > 0, uygulandi ? ih2.join(" | ") : "MUTASYON UYGULANMADI");
  }
}

// §22 — pm2 ad kapısı aracının DAVRANIŞI (Node birim): kur.ps1'deki here-string AYNEN çıkarılır, sahte `pm2 jlist`
// çıktısı stdin'den verilir. ① aynı ad (Windows yolu, büyük/küçük harf) → UYUMLU ② pm2 günlük satırı + boş
// liste → ILK ③ thinkpad-1: bu kökte başka adla kayıtlı (çalışan ya da duran) → IHLAL + doğru -UygulamaAdi
// ④ başka kökte çalışan, ad açık değil → IHLAL ⑤ ad açık + başka kök: farklı port YAN_YANA, aynı/ölçülemeyen
// port IHLAL ⑥ TeksERP dışı pm2 uygulaması sayılmaz ⑦ bozuk/boş liste → OLCULEMEDI ⑧ aynı ad + aynı kökte
// ikinci çalışan → IHLAL ⑨ boş ad → IHLAL.
function pm2AdBirimIhlalleri(js: string): string[] {
  const ih: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "pm2-ad-"));
  try {
    const arac = join(dir, "a.cjs");
    writeFileSync(arac, js);
    const APP = "C:\\TeksERP\\app";
    const u = (name: string, status: string, cwd: string, port = "4000", betik = `${cwd}\\dist\\server.js`) =>
      ({ name, pm_id: 0, pm2_env: { status, pm_cwd: cwd, pm_exec_path: betik, env: { PORT: port } } });
    const kos = (jlist: string, ad: string, o: { port?: string; acik?: boolean } = {}) => {
      const r = spawnSync(process.execPath, [arac, "--ad", ad, "--app", APP, "--port", o.port ?? "4000", "--acik", o.acik ? "1" : "0"], { input: jlist, encoding: "utf8" });
      try { return JSON.parse(r.stdout.trim().split("\n").pop() ?? "") as { karar?: string; neden?: string }; } catch { return { karar: `cikis ${r.status}` }; }
    };
    const beklenen = (ad: string, r: { karar?: string; neden?: string }, k: string, icerir?: string) => {
      if (r.karar !== k || (icerir && !(r.neden ?? "").includes(icerir))) ih.push(`${ad}: ${r.karar} (beklenen ${k}${icerir ? ` + "${icerir}"` : ""})`);
    };
    const j = (...x: unknown[]) => JSON.stringify(x);
    beklenen("①", kos(j(u("tekserp-backend-yeni", "online", "c:/tekserp/APP/")), "tekserp-backend-yeni"), "UYUMLU");
    beklenen("②", kos(`[PM2] Spawning PM2 daemon with pm2_home=C:\\TeksERP\\pm2-home\n[PM2] PM2 Successfully daemonized\n[]\n`, "tekserp-backend-yeni"), "ILK");
    const tp = u("tekserp-backend-yeni", "online", APP);
    beklenen("③ çalışan", kos(j(tp), "tekserp-backend-testfabrika", { acik: true }), "IHLAL", "-UygulamaAdi tekserp-backend-yeni");
    beklenen("③ duran", kos(j({ ...tp, pm2_env: { ...tp.pm2_env, status: "stopped" } }), "tekserp-backend-testfabrika"), "IHLAL", "-UygulamaAdi tekserp-backend-yeni");
    const baska = u("tekserp-backend-eski", "online", "D:\\Eski\\app");
    beklenen("④", kos(j(baska), "tekserp-backend-yeni"), "IHLAL", "-UygulamaAdi tekserp-backend-eski");
    beklenen("⑤ farklı port", kos(j(baska), "tekserp-backend-yeni", { acik: true, port: "4100" }), "YAN_YANA");
    beklenen("⑤ aynı port", kos(j(baska), "tekserp-backend-yeni", { acik: true }), "IHLAL");
    beklenen("⑤ port ölçülemedi", kos(j(baska), "tekserp-backend-yeni", { acik: true, port: "" }), "IHLAL");
    beklenen("⑥", kos(j(u("yedek-izleyici", "online", "C:\\Araclar", "", "C:\\Araclar\\izle.js")), "tekserp-backend-yeni"), "ILK");
    beklenen("⑦ bozuk", kos("[PM2][ERROR] connect EPERM \\\\.\\pipe\\rpc.sock\n", "tekserp-backend-yeni"), "OLCULEMEDI");
    beklenen("⑦ boş", kos("", "tekserp-backend-yeni"), "OLCULEMEDI");
    beklenen("⑧", kos(j(tp, u("tekserp-backend-ikinci", "online", APP, "4000")), "tekserp-backend-yeni"), "IHLAL");
    beklenen("⑨", kos(j(tp), ""), "IHLAL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return ih;
}
{
  const js = pm2AdJs(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8")) ?? "";
  const ih = js ? pm2AdBirimIhlalleri(js) : ["here-string yok"];
  check("§22a ⭐ pm2 ad ölçümü: aynı ad UYUMLU · boş ILK · bu kökte başka ad / açık olmayan ad / aynı port IHLAL · farklı port YAN_YANA · bozuk liste OLCULEMEDI",
    ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["kök karşılaştırması kalktı", js.replace('const ayniKok = (x) => app !== "" && yolDuz(x.cwd) === app;', "const ayniKok = (x) => false;")],
    ["açık olmayan ad serbest", js.replace("if (calisan.length && !o.acik)", "if (false)")],
    ["bozuk liste boş sayılır", js.replace("  return null;\n}\nfunction yolDuz", "  return [];\n}\nfunction yolDuz")],
    ["port ölçülemedi serbest", js.replace('o.port === "" || x.port === "" || x.port === o.port', "x.port === o.port")],
    ["her pm2 uygulaması backend", js.replace("function backendMi(x) { return", "function backendMi(x) { return true ||")],
  ];
  for (const [ad, j2] of sondalar) {
    const uygulandi = j2 !== js && js !== "";
    const ih2 = uygulandi ? pm2AdBirimIhlalleri(j2) : [];
    check(`§22 sonda: ${ad} → kırmızı`, ih2.length > 0, uygulandi ? ih2.join(" | ") : "MUTASYON UYGULANMADI");
  }
}

// §23 — kurulum kaydı DB'de GERÇEKTEN uygulananı yazar, paket klasör farkını değil (DB paketin gerisinde
// ya da ilerisinde olabilir): [7/9]'da `migrate deploy`ın önünde ve arkasında `_prisma_migrations` sayılır
// (bitmiş, geri alınmamış). [5/9] birleşik ecosystem'e "sunucununki KORUNDU" demek operatörü yanıltır.
function kurulumOlcumIhlalleri(kur: string): string[] {
  const t = psTara(kur);
  const kod = t.satirlar.map((x) => x.kod);
  const metin = kod.join("\n");
  const ih: string[] = [];
  const ilk = (re: RegExp, bas = 0): number => kod.findIndex((x, i) => i >= bas && re.test(x));
  const f = t.fonksiyonlar.find((x) => x.ad === "DbMigrationSayisi");
  const govde = f ? t.satirlar.filter((x) => x.no > f.bas && x.no <= f.son).map((x) => x.kod).join("\n") : "";
  if (!f) ih.push("DbMigrationSayisi yok");
  else if (!/FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL/.test(govde)) ih.push("DB sayımı bitmiş + geri alınmamış satırlarla sınırlı değil");
  const adim7 = ilk(/^Adim "\[7\/9\]/);
  const dep = adim7 < 0 ? -1 : ilk(/^& node \$prismaCli migrate deploy/, adim7);
  const once = ilk(/^\$dbMigOnce = DbMigrationSayisi /), sonra = ilk(/^\$dbMigSonra = DbMigrationSayisi /);
  if (dep < 0 || !(adim7 < once && once < dep)) ih.push("DB sayımı migrate deploy'dan ÖNCE değil");
  if (dep < 0 || !(sonra > dep)) ih.push("DB sayımı migrate deploy'dan SONRA değil");
  if (!/yeniMigrationSayisi = \$dbMigUygulanan\b/.test(metin)) ih.push("kayıttaki yeniMigrationSayisi DB ölçümünden gelmiyor");
  if (/\$eskiMig\b/.test(metin)) ih.push("paket klasör farkı ($eskiMig) hâlâ hesaplanıyor");
  const korundu = kod.filter((x) => /sunucununki KORUNDU/.test(x)).length;
  const kosullu = /if \(\$ecoBirlesikBayt\) \{\s*\n\s*Write-Host "  ecosystem\.config\.js: BIRLESTIRILDI[^\n]*\n\s*\} else \{\s*\n\s*Write-Host "  ecosystem\.config\.js: sunucununki KORUNDU/.test(metin);
  if (!kosullu || korundu !== 1) ih.push("[5/9] birleşik ecosystem'de de 'sunucununki KORUNDU' basılıyor");
  return ih;
}
{
  const kr = readFileSync(join(KOK, "deploy/kur.ps1"), "utf8");
  const ih = kurulumOlcumIhlalleri(kr);
  check("§23a ⭐ yeniMigrationSayisi = [7/9]'da DB'ye GERÇEKTEN uygulanan (önce/sonra sayım) · [5/9] birleşikte başlık BIRLESTIRILDI",
    ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["paket farkına dönüş", kr.replace("yeniMigrationSayisi = $dbMigUygulanan", "yeniMigrationSayisi = $(if ($null -ne $eskiMig) { $yeniMig - $eskiMig } else { $null })")],
    ["sonra-sayım deploy'dan önce", kr.replace(/^(\$dbMigSonra = DbMigrationSayisi [^\r\n]*\r?\n)/m, "").replace(/^(\$dbMigOnce = DbMigrationSayisi [^\r\n]*\r?\n)/m, "$1$$dbMigSonra = DbMigrationSayisi $$pgbin $$cred $$dbKul $$dbPar\r\n")],
    ["geri alınmış satır da sayılır", kr.replace(" AND rolled_back_at IS NULL", "")],
    ["başlık koşulsuz KORUNDU", kr.replace(/if \(\$ecoBirlesikBayt\) \{\r?\n\s*Write-Host "  ecosystem\.config\.js: BIRLESTIRILDI[^\r\n]*\r?\n\s*\} else \{\r?\n/, "")],
  ];
  for (const [ad, k2] of sondalar) {
    const uygulandi = k2 !== kr;
    const ih2 = uygulandi ? kurulumOlcumIhlalleri(k2) : [];
    check(`§23 sonda: ${ad} → kırmızı`, ih2.length > 0, uygulandi ? ih2.join(" | ") : "MUTASYON UYGULANMADI");
  }
}

// §24 — pm2 yolu DONDURULDU (yönetici kararı 2026-10-01, geçiş dönemi çift yol). adnansahin ve demofabrika
//   pm2 düzeninde; geçişe kadar acil düzeltme ESKİ yolla (kur.ps1 -Paket) kurulabilmeli — o yüzden dosyalar
//   KALIR ve ÇALIŞIR, ama yeni özellik almaz. Özet LF'ye normalize içerikten (checkout CRLF'i fark yaratmaz).
//   Kaldırma koşulu: filoda pm2 düzeninde kurulum kalmaması (portal filo görünümü) — o gün bu tablo da gider.
const DONMUS: ReadonlyArray<{ dosya: string; sha256: string; gerekce: string }> = [
  { dosya: "deploy/kur.ps1", sha256: "0c56f34d39594a006e3fc01290ea20a134b6f5f26ffa07542fcc19b7401d68e5", gerekce: "D6 2026-10-01: dondurma başlığı + HizmetDuzeniIzi kapısı (bu kökü kullanan her TeksERP hizmeti)" },
  { dosya: "deploy/ilk-kurulum.ps1", sha256: "5a1e0803b1e08f7a88e6e71d178cc7053ff04a210703fd3c3f6eaa3831386640", gerekce: "D6 2026-10-01: dondurma başlığı + HizmetDuzeniIzi kapısı" },
  { dosya: "deploy/pm2-boot.cmd", sha256: "2659a7f160d0aeb1d7aa2a20b3fe3139b047391e1b2b4abb18794a79d90cf214", gerekce: "D8c 2026-10-01 DÜZELTME: pm2.cmd `call`lı — setlocal ortamı çağrısız çağrıda düşüyor, açılışta pm2 SYSTEM profiline gidip backend'i kaldırmıyordu (thinkpad-1, yönetici onayı)" },
  { dosya: "Teks-Erp/ecosystem.config.js", sha256: "aabeb95d3c4baf37b8bc48a6c36e688a8f411e5e4a2cc874ce86c6bcbefbfc3e", gerekce: "D6 2026-10-01: dondurma başlığı" },
];
function donmusOzet(metin: string): string {
  return createHash("sha256").update(metin.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}
function donmusIhlalleri(dosya: string, metin: string, beklenen: string): string[] {
  const ih: string[] = [];
  if (donmusOzet(metin) !== beklenen) ih.push(`${dosya} donmuş özetten farklı`);
  if (!/DONDURULDU \(Da[gğ][iı]t[iı]m v2, 2026-10-01\)/.test(metin)) ih.push(`${dosya} DONDURULDU başlığı yok`);
  return ih;
}
{
  for (const d of DONMUS) {
    const metin = readFileSync(join(KOK, d.dosya), "utf8");
    const ih = donmusIhlalleri(d.dosya, metin, d.sha256);
    check(`§24 ⭐ ${d.dosya} DONMUŞ (özet + başlık) — son gerekçe: ${d.gerekce}`, ih.length === 0,
      ih.length ? `${ih.join(" | ")} — düzeltmeyse özet satırını gerekçesiyle güncelle (ölçülen ${donmusOzet(metin)}); yeni özellikse pm2 yoluna EKLENMEZ` : "aynı");
    const sondalar: Array<[string, string]> = [
      ["satır eklendi", `${metin}\n# yeni ozellik\n`],
      ["başlık silindi", metin.replace(/DONDURULDU \(Da[gğ][iı]t[iı]m v2, 2026-10-01\)/, "pm2 yolu")],
    ];
    for (const [ad, m] of sondalar) {
      const uygulandi = m !== metin;
      check(`§24 sonda: ${d.dosya} ${ad} → kırmızı`, uygulandi && donmusIhlalleri(d.dosya, m, d.sha256).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
    }
  }
  // CRLF checkout'u (Windows sunucusu) özeti DEĞİŞTİRMEZ — aksi hâlde kapı satır sonuna bekçilik ederdi.
  const ilk = readFileSync(join(KOK, DONMUS[0]!.dosya), "utf8");
  check("§24 körlük zemini: CRLF'li kopya aynı özet", donmusOzet(ilk.replace(/\r?\n/g, "\r\n")) === donmusOzet(ilk));
}

// §25 — hizmet betiklerinin ortak yardımcıları İKİZ (biri düzelip öteki kalmasın): SID algoritması, etkin
//   erişim, geniş ACE, bağlantı ölçümü, ImagePath ayrıştırma, yol eşitliği.
{
  const t1 = psTara(readFileSync(join(KOK, "deploy/hizmet/backend-hizmeti.ps1"), "utf8"));
  const t2 = psTara(readFileSync(join(KOK, "deploy/hizmet/guncelleyici-hizmeti.ps1"), "utf8"));
  const govde = (t: ReturnType<typeof psTara>, ad: string): string | null => {
    const f = t.fonksiyonlar.find((x) => x.ad === ad);
    return f ? t.satirlar.filter((x) => x.no >= f.bas && x.no <= f.son).map((x) => x.kod.trim()).filter(Boolean).join("\n") : null;
  };
  for (const ad of ["HizmetSid", "Erisim", "GenisAce", "ReparseMi", "KomutParcala", "YolEsit"]) {
    const a = govde(t1, ad), b = govde(t2, ad);
    check(`§25 ⭐ \`${ad}\` ikizi birebir (backend-hizmeti.ps1 ↔ guncelleyici-hizmeti.ps1)`, a !== null && a.length > 20 && a === b,
      `${a ? a.length : "YOK"} · ${b ? b.length : "YOK"} bayt`);
  }
}

// §26 — VİRGÜLLÜ DÖNÜŞ (thinkpad-1 D8 2026-10-01): `return , $x` diziyi TEK nesne olarak verir. `@(F)` onu İÇ İÇE
//   diziye çevirir (Count hep 1; `[int[]]` bağlamada "Object[] → Int32" — ön ölçüm PG portunda düştü) ve
//   `F | Where-Object` öğeleri değil BÜTÜN diziyi süzer. Doğru çağrı `$x = F` ya da `(F)`.
{
  const taranan = SUNUCU_PS1.filter((y) => existsSync(join(KOK, y))).map((y) => ({ yol: y, t: psTara(readFileSync(join(KOK, y), "utf8")) }));
  const virgullu = new Set<string>();
  for (const { t } of taranan) {
    for (const f of t.fonksiyonlar) {
      if (t.satirlar.some((x) => x.no >= f.bas && x.no <= f.son && /\breturn\s*,/.test(x.ciplak))) virgullu.add(f.ad);
    }
  }
  const ihlal: string[] = [];
  for (const { yol, t } of taranan) {
    for (const x of t.satirlar) {
      for (const ad of virgullu) {
        const e = ad.replace(/[-]/g, "\\-");
        const sarili = new RegExp(`@\\(\\s*${e}\\b`).test(x.ciplak);
        const borulu = new RegExp(`(?:^|[=;{]\\s*|\\bin\\s+)${e}\\b[^|()]*\\|`).test(x.ciplak.trim());
        if (sarili || borulu) ihlal.push(`${yol}:${x.no} ${ad}`);
      }
    }
  }
  check(`§26 ⭐ virgüllü dönüşlü fonksiyon @() ile sarılmıyor, boruya verilmiyor`, virgullu.size >= 3 && ihlal.length === 0,
    ihlal.length ? ihlal.slice(0, 8).join(" · ") : `${virgullu.size} fonksiyon, çağrıları temiz`);
}

// §27 — DOĞRULAMALI PARAMETRE ADI (thinkpad-1 D8 2026-10-01): PowerShell değişken adı büyük/küçük harf DUYARSIZDIR;
//   `[ValidateSet(...)]$Hedef` parametresi olan betikte döngü değişkeni `$hedef = <yol>` öznitelik doğrulamasından
//   geçer ve betik orada düşer (`paketle.ps1` [3/6]: korumalı paket hiç üretilemiyordu). deploy/ altındaki BÜTÜN
//   betikler (geliştirme makinesinde koşan paketle.ps1 dahil).
{
  const yollar: string[] = [];
  const gez = (d: string): void => {
    for (const g of readdirSync(join(KOK, d), { withFileTypes: true })) {
      const r = `${d}/${g.name}`;
      if (g.isDirectory()) gez(r);
      else if (g.name.endsWith(".ps1")) yollar.push(r);
    }
  };
  gez("deploy");
  const ihlal: string[] = [];
  let parametreSayisi = 0;
  for (const yol of yollar) {
    const t = psTara(readFileSync(join(KOK, yol), "utf8"));
    const metin = t.satirlar.map((x) => x.ciplak).join("\n");
    const m = /(?:^|\n)\s*(?:\[CmdletBinding\([^)]*\)\]\s*)?param\s*\(/i.exec(metin);
    if (!m) continue;
    let i = m.index + m[0].length;
    let d = 1;
    while (i < metin.length && d > 0) {
      if (metin[i] === "(") d++;
      else if (metin[i] === ")") d--;
      i++;
    }
    const blok = metin.slice(m.index + m[0].length, i);
    const govde = metin.slice(i);
    for (const p of blok.matchAll(/\[Validate\w+\([^\]]*\)\][^$,]*\$(\w+)/g)) {
      parametreSayisi++;
      const ad = p[1];
      for (const a of govde.matchAll(new RegExp(`\\$${ad}\\s*=(?!=)`, "gi"))) {
        const satirNo = metin.slice(0, i + (a.index ?? 0)).split("\n").length;
        ihlal.push(`${yol}:${satirNo} $${ad}`);
      }
    }
  }
  check(`§27 ⭐ [Validate*] parametresinin adı gövdede atanmıyor (${yollar.length} betik)`, yollar.length >= 15 && parametreSayisi >= 3 && ihlal.length === 0,
    ihlal.length ? ihlal.slice(0, 8).join(" · ") : `${parametreSayisi} doğrulamalı parametre, atama yok`);
}

// §28 — DÖNGÜ DEĞİŞKENİ GÖLGESİ (thinkpad-1 D8 2026-10-01): PowerShell'de `foreach` blok kapsamı açmaz; betik
//   kapsamındaki `foreach ($ad in …)` önceki `$ad = <paket adı>`ı EZER. `paketle.ps1` hizmet ikilisi döngüsü paket adını
//   "tekserp-guncelleyici.exe" yaptı (zip adı + PAKET.json `ad` + derleme kaydı). Ölçü: fonksiyon DIŞI satırlarda, daha
//   önce `=` ile atanmış bir ad döngü değişkeni olur VE döngü kapandıktan sonra okunursa ihlal (yalnız döngüde kullanılan
//   yeniden kullanım serbest — kaldir.ps1 `$k` gibi).
{
  const yollar: string[] = [];
  const gez = (d: string): void => {
    for (const g of readdirSync(join(KOK, d), { withFileTypes: true })) {
      const r = `${d}/${g.name}`;
      if (g.isDirectory()) gez(r);
      else if (g.name.endsWith(".ps1")) yollar.push(r);
    }
  };
  gez("deploy");
  const ihlal: string[] = [];
  let donguSayisi = 0;
  for (const yol of yollar) {
    const t = psTara(readFileSync(join(KOK, yol), "utf8"));
    const icFonk = (no: number): boolean => t.fonksiyonlar.some((f) => no >= f.bas && no <= f.son);
    const satir = t.satirlar.filter((x) => !icFonk(x.no));
    const atanan = new Map<string, number>();
    for (let i = 0; i < satir.length; i++) {
      const x = satir[i];
      for (const m of x.ciplak.matchAll(/foreach\s*\(\s*\$(\w+)\s+in\b/gi)) {
        donguSayisi++;
        const ad = m[1].toLowerCase();
        if (!atanan.has(ad)) continue;
        let son = x.no;
        const acik = (x.ciplak.match(/\{/g) ?? []).length - (x.ciplak.match(/\}/g) ?? []).length;
        if (acik > 0) {
          for (let j = i + 1; j < satir.length; j++) {
            if (satir[j].derinlik <= x.derinlik && /\}/.test(satir[j].ciplak)) { son = satir[j].no; break; }
          }
        }
        const okuma = new RegExp(`\\$${m[1]}\\b`, "i");
        const yeniAtama = new RegExp(`(?:^|[;{(\\s])\\$${m[1]}\\s*=(?!=)`, "i");
        const sonra = satir.filter((y) => y.no > son && okuma.test(y.ciplak) && !yeniAtama.test(y.ciplak));
        if (sonra.length) ihlal.push(`${yol}:${x.no} $${m[1]} (atama ${atanan.get(ad)}, döngüden sonra okuma ${sonra[0].no})`);
      }
      for (const m of x.ciplak.matchAll(/(?:^|[;{(\s])\$(\w+)\s*=(?!=)/g)) {
        const ad = m[1].toLowerCase();
        if (!atanan.has(ad)) atanan.set(ad, x.no);
      }
    }
  }
  check(`§28 ⭐ betik kapsamında foreach değişkeni atanmış + sonradan okunan adı gölgelemiyor (${yollar.length} betik)`,
    donguSayisi >= 20 && ihlal.length === 0, ihlal.length ? ihlal.slice(0, 6).join(" · ") : `${donguSayisi} döngü temiz`);
}

// §29 — YARIM SAHNE (thinkpad-1 D8 2026-10-01): düşen dört korumalı derleme SystemTemp'te ~500 MB'lık dört sahne bıraktı.
//   Fail sahneyi siler, betik kapsamındaki trap da (Fail dışı sonlandırıcı hata); sahne yalnız TEMP altındaysa silinir.
{
  const t = psTara(readFileSync(join(KOK, "deploy/paketle.ps1"), "utf8"));
  const kod = t.satirlar.map((x) => x.ciplak).join("\n");
  const govdeAl = (ad: string): string => {
    const f = t.fonksiyonlar.find((x) => x.ad === ad);
    return f ? t.satirlar.filter((x) => x.no >= f.bas && x.no <= f.son).map((x) => x.ciplak).join("\n") : "";
  };
  const eksik: string[] = [];
  if (!/SahneyiTemizle/.test(govdeAl("Fail"))) eksik.push("Fail sahneyi temizlemiyor");
  const trapSatiri = t.satirlar.find((x) => /^\s*trap\s*\{/.test(x.ciplak) && !t.fonksiyonlar.some((f) => x.no >= f.bas && x.no <= f.son));
  if (!trapSatiri || !/SahneyiTemizle/.test(trapSatiri.ciplak)) eksik.push("betik kapsamında `trap { SahneyiTemizle …` yok");
  if (!/\$script:SahneYolu\s*=\s*\$stage\b/.test(kod)) eksik.push("sahne yolu kaydedilmiyor ($script:SahneYolu = $stage)");
  if (!/GetTempPath/.test(govdeAl("SahneyiTemizle"))) eksik.push("SahneyiTemizle TEMP sınırını ölçmüyor");
  check("§29 ⭐ paketle.ps1 hata yolunda yarım sahneyi siler (Fail + trap, yalnız TEMP altı)", eksik.length === 0, eksik.join(" · "));
}

// §30 — TÜR KISITLI PARAMETRE (thinkpad-1 D8 2026-10-01): `kurulum.ps1`in `-Sonuc` (INI yolu, [string]) parametresi ile
//   sonuç sözlüğü `$script:Sonuc` AYNI değişkendir; [string] kısıtı sözlüğü metne çevirdi ve ilk gerçek koşum OnKosul
//   sonunda "Unable to index into an object of type System.String" ile düştü. Ölçü: `[string|int|bool|switch…]$X`
//   parametresine (adı büyük/küçük harf duyarsız, `$script:` önekli de) `@{` · `[ordered]` · `@(` · `[pscustomobject]` atanmaz.
{
  const yollar: string[] = [];
  const gez = (d: string): void => {
    for (const g of readdirSync(join(KOK, d), { withFileTypes: true })) {
      const r = `${d}/${g.name}`;
      if (g.isDirectory()) gez(r);
      else if (g.name.endsWith(".ps1")) yollar.push(r);
    }
  };
  gez("deploy");
  const ihlal: string[] = [];
  let parametre = 0;
  for (const yol of yollar) {
    const t = psTara(readFileSync(join(KOK, yol), "utf8"));
    const metin = t.satirlar.map((x) => x.ciplak).join("\n");
    const m = /(?:^|\n)\s*(?:\[CmdletBinding\([^)]*\)\]\s*)?param\s*\(/i.exec(metin);
    if (!m) continue;
    let i = m.index + m[0].length;
    let d = 1;
    while (i < metin.length && d > 0) {
      if (metin[i] === "(") d++;
      else if (metin[i] === ")") d--;
      i++;
    }
    const blok = metin.slice(m.index + m[0].length, i);
    const govde = metin.slice(i);
    for (const p of blok.matchAll(/\[(string|int|int64|bool|switch|double|datetime)\]\s*\$(\w+)/gi)) {
      parametre++;
      const ad = p[2]!;
      // Fonksiyon içinde öneksiz `$x =` YEREL değişken doğurur (parametreye dokunmaz); `$script:x =` her yerde parametredir.
      for (const a of govde.matchAll(new RegExp(`\\$(script:)?${ad}\\s*=\\s*(?:@\\{|\\[ordered\\]|@\\(|\\[pscustomobject\\])`, "gi"))) {
        const no = metin.slice(0, i + (a.index ?? 0)).split("\n").length;
        const icFonk = t.fonksiyonlar.some((f) => no >= f.bas && no <= f.son);
        if (icFonk && !a[1]) continue;
        ihlal.push(`${yol}:${no} $${a[1] ?? ""}${ad} ([${p[1]}])`);
      }
    }
  }
  check(`§30 ⭐ tür kısıtlı parametreye sözlük/dizi atanmıyor (${yollar.length} betik)`, parametre >= 20 && ihlal.length === 0,
    ihlal.length ? ihlal.slice(0, 6).join(" · ") : `${parametre} tür kısıtlı parametre temiz`);
}

// §31 — AĞAÇ İZNİ (thinkpad-1 D8 2026-10-01, ÖLÇÜLDÜ): `icacls <dizin> /inheritance:r /grant:r *SID:(OI)(CI)F … /T` dizinlere
//   doğru uygulanır ama DOSYALARDA (OI)(CI) geçersizdir ve miras da kesildiği için dosyanın DACL'i BOŞ kalır — SYSTEM dahil
//   kimse okuyamaz (yarım kurulumun durum.json'u; AclKoru -Agac ile PG ikili/veri dizinlerinin dosyaları). Doğrusu: izin
//   dizine /T'siz, alt öğeler `icacls <dizin>\* /reset /T` ile mirası alır. Ölçü: aynı işlev gövdesinde (betik kapsamında
//   aynı satırda) "(OI)(CI)" ve "/T" birlikte → ihlal. DONMUŞ pm2 dosyasındaki borç beyanlı ve ölçülür (kapanınca çıkarılır).
{
  const BORC: ReadonlyArray<{ yol: string; islev: string; neden: string }> = [
    { yol: "deploy/ilk-kurulum.ps1", islev: "SirIzniDaralt", neden: "DONMUŞ pm2 dosyası (§24); D8 Senaryo 4'te pm2 kurulumunda ölçülüp düzeltilecek" },
  ];
  const yollar: string[] = [];
  const gez = (d: string): void => {
    for (const g of readdirSync(join(KOK, d), { withFileTypes: true })) {
      const r = `${d}/${g.name}`;
      if (g.isDirectory()) gez(r);
      else if (g.name.endsWith(".ps1")) yollar.push(r);
    }
  };
  gez("deploy");
  const ihlal: string[] = [];
  const borcGorulen = new Set<string>();
  // Çağrı düzeyinde: icacls satırı (OI)(CI)'yi doğrudan ya da onu taşıyan bir değişkenle, /T'yi doğrudan ya da onu
  // taşıyan bir değişkenle BİRLİKTE alıyorsa ihlal (ayrı /reset çağrısındaki /T serbest).
  const OICI = /\(OI\)\(CI\)/;
  const TBAYRAK = /(["'\s(,])\/T(["'\s),]|$)/;
  const cagriIhlali = (satirlar: string[], icacls: string): boolean => {
    const oiciVar = new Set<string>();
    const tVar = new Set<string>();
    for (const l of satirlar) {
      for (const m of l.matchAll(/\$(\w+)\s*\+?=\s*(.*)$/g)) {
        if (/icacls/i.test(m[2]!)) continue; // çağrının SONUCU (`$r = NativeKos "icacls.exe" …`) argüman değildir
        if (OICI.test(m[2]!)) oiciVar.add(m[1]!.toLowerCase());
        if (TBAYRAK.test(m[2]!)) tVar.add(m[1]!.toLowerCase());
      }
    }
    const argumanlar = icacls.slice(icacls.search(/icacls/i));
    const kullanilan = [...argumanlar.matchAll(/[$@](\w+)/g)].map((m) => m[1]!.toLowerCase());
    const oici = OICI.test(argumanlar) || kullanilan.some((v) => oiciVar.has(v));
    const tt = TBAYRAK.test(argumanlar) || kullanilan.some((v) => tVar.has(v));
    return oici && tt;
  };
  for (const yol of yollar) {
    const t = psTara(readFileSync(join(KOK, yol), "utf8"));
    const bolgeler: Array<{ ad: string; satirlar: typeof t.satirlar }> = t.fonksiyonlar.map((f) => ({ ad: f.ad, satirlar: t.satirlar.filter((x) => x.no >= f.bas && x.no <= f.son) }));
    bolgeler.push({ ad: "(betik kapsamı)", satirlar: t.satirlar.filter((x) => !t.fonksiyonlar.some((f) => x.no >= f.bas && x.no <= f.son)) });
    for (const b of bolgeler) {
      const kodlar = b.satirlar.map((x) => x.kod);
      for (const x of b.satirlar) {
        if (!/icacls/i.test(x.kod) || !cagriIhlali(kodlar, x.kod)) continue;
        if (BORC.some((r) => r.yol === yol && r.islev === b.ad)) { borcGorulen.add(`${yol}:${b.ad}`); continue; }
        ihlal.push(`${yol}:${x.no} (${b.ad})`);
      }
    }
  }
  const kapanan = BORC.filter((b) => !borcGorulen.has(`${b.yol}:${b.islev}`)).map((b) => `${b.yol}:${b.islev}`);
  check(`§31 ⭐ icacls (OI)(CI) izni /T ile birlikte verilmiyor (${yollar.length} betik; beyanlı borç ${borcGorulen.size})`, ihlal.length === 0 && kapanan.length === 0,
    [...ihlal.map((v) => `ihlal ${v}`), ...kapanan.map((v) => `borç kapanmış, BORC listesinden çıkar: ${v}`)].join(" · "));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
