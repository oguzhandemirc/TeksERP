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
// Kaynak ölçülür, davranış değil: pwsh her ortamda yok, 5.1 hiç yok.
// =============================================================================
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { psTara, kapsayanFonksiyon } from "./lib/ps-tarama";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

/** Fabrika/müşteri sunucusunda koşan PowerShell betikleri (geliştirme makinesinde koşan `paketle.ps1` hariç). */
const SUNUCU_PS1 = ["deploy/kur.ps1", "deploy/ilk-kurulum.ps1", "deploy/yedekle.ps1"];

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
    t.satirlar.length > 60 && t.fonksiyonlar.length >= 2 && son?.derinlik === 0,
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
  const pakete = (ad: string) => pk.satirlar.some((s) =>
    s.kod.trim() === `Copy-Item "$repo\\deploy\\${ad}" "$stage\\"`);
  const eksikDosya = ["ilk-kurulum.ps1", "yedekle.ps1", "pm2-boot.cmd"].filter((a) => !pakete(a));
  check("§5d paketle.ps1 `ilk-kurulum.ps1` + `yedekle.ps1` + `pm2-boot.cmd`i pakete koyuyor (sunucuya repo ağacı taşınmaz)",
    eksikDosya.length === 0, eksikDosya.length ? `eksik: ${eksikDosya.join(", ")}` : "üçü de");
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
  const tasi = yed.findIndex((k) => k.trim().startsWith("Move-Item $yarim $hedef"));
  const sakla = yed.findIndex((k) => k.trim() === "Sakla $yedekDir $desen");
  check("§10c ⭐ yedekle.ps1: dökümü `.part`a yazar → `pg_restore --list` → ancak SONRA `.dump` adı → ancak SONRA saklama",
    yarim >= 0 && liste > yarim && tasi > liste && sakla > tasi,
    `f ${yarim + 1} · list ${liste + 1} · taşı ${tasi + 1} · sakla ${sakla + 1}`);
  check("§10d yedekle.ps1 saklaması en yeni N'i yaşına bakmadan korur (3), 30 gün, yalnız kendi desenine dokunur",
    yed.some((k) => k.includes("Select-Object -Skip $EnAzTut")) && yed.some((k) => k.includes("[int]$EnAzTut = 3")) &&
      yed.some((k) => k.includes("[int]$SaklamaGun = 30")) && yed.some((k) => k.includes("_\\d{8}_\\d{6}\\.dump$")));
  check("§10e pm2-boot.cmd: PM2_HOME kur.ps1'inkiyle aynı (<kök>\\pm2-home), `pm2 resurrect`, tamamı ASCII",
    cmd.includes('set "PM2_HOME=%KOK%pm2-home"') && cmd.includes('pm2\\node_modules\\.bin\\pm2.cmd" resurrect') &&
      !/[^\x00-\x7F]/.test(cmd));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
