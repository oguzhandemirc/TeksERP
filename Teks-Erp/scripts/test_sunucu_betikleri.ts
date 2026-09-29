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
const SUNUCU_PS1 = ["deploy/kur.ps1", "deploy/ilk-kurulum.ps1", "deploy/yedekle.ps1", "deploy/uzaktan-kos.ps1", "deploy/bakim-rolu.ps1"];

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
    t.satirlar.length > 60 && t.fonksiyonlar.length >= 1 && son?.derinlik === 0,
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

// §11 — web paneli + API güvenlik duvarı (bulgu 13, 18). `dist-web` pakette ama
//   `.env`e WEB_DIST_DIR yazılmıyordu (panel sunulmuyordu); 4000 kuralı elle ve
//   profilsiz açılıyordu; Tailscale-In kuralı Private profilde her portu açabiliyor.
{
  const ilk = psTara(readFileSync(join(KOK, "deploy/ilk-kurulum.ps1"), "utf8")).satirlar.map((s) => s.kod);
  const kur = psTara(readFileSync(join(KOK, "deploy/kur.ps1"), "utf8")).satirlar.map((s) => s.kod);
  check("§11a ⭐ yeni .env WEB_DIST_DIR'i kurulum kökünden MUTLAK yazar (-WebPanelKapali hariç); mevcut .env'de yoksa söyler",
    ilk.some((k) => k.includes("if (-not $WebPanelKapali) { $satirlar += \"WEB_DIST_DIR=") && k.includes("/app/dist-web")) &&
      ilk.some((k) => k.includes("mevcut .env'de WEB_DIST_DIR yok")));
  check("§11b ⭐ kur.ps1 WEB_DIST_DIR'in index.html taşıdığını ölçer (yoksa kök sessizce durum sayfası olur)",
    kur.some((k) => k.includes("WEB_DIST_DIR\\s*=")) && kur.some((k) => k.includes('(Join-Path $wd "index.html")')));
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
    ["ScramDogrulayici", [ilkT, bakT]],
    ["Pbkdf2Sha256", [ilkT, bakT]],
    ["SoruSorabilir", [ilkT, bakT]],
    ["EnvDeger", [ilkT, bakT, yedT]],
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
  const KUR_KULTUR_BORCU = 8;
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

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
