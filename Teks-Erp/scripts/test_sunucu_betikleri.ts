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
const SUNUCU_PS1 = ["deploy/kur.ps1", "deploy/ilk-kurulum.ps1"];

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
    t.satirlar.length > 100 && t.fonksiyonlar.length >= 3 && son?.derinlik === 0,
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
  check("§5d paketle.ps1 `ilk-kurulum.ps1`i pakete koyuyor (sunucuya repo ağacı taşınmaz)",
    pk.satirlar.some((s) => /^\s*Copy-Item\s+"\$repo\\deploy\\ilk-kurulum\.ps1"\s+"\$stage\\"/.test(s.kod)));
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

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
