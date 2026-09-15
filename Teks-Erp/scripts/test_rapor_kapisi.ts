// =============================================================================
// RAPOR KAPISI — sözleşme, sıra, kapsama ve YAZMA kapısı (Raporlar R1)
// =============================================================================
// `test_module_flag_off` kalıbı: İKİ AYAK, ikisi de gerekli ve rolleri farklı.
//   • STATİK (her zaman koşar, DB/HTTP gerektirmez) → ASIL güvence. Kapı
//     sözleşmesi · `verifyToken → rapor kapısı → izin` sırası · 29 ucun
//     KAPSAMASI (iki yönlü) · yazma kapısının kümesi ve reddi.
//   • HTTP (sunucu ya da yerel DB yoksa ATLANIR) → ek kanıt; gerçek reddi ve
//     gerçek hata kodunu yalnız o görebilir.
//
// ⚠️ ASIL ÖLÇÜM NEDEN STATİK: HTTP kısmı CI'da (sunucusuz) hiç koşmaz. "kapı
// reddediyor" iddiasını yalnız HTTP'ye bağlamak bekçiyi CI'da SÜSE çevirirdi.
//
// ⚠️ KAPSAMA İKİ YÖNLÜ: katalogda beyan edilip kapısı OLMAYAN uç kırmızı;
// `routes/reports/**` altında `router.get` olup katalogda BEYAN EDİLMEYEN uç da
// kırmızı. Tek yön ölçen bir kapı, eksik kapıyı görür ama KAPISIZ YENİ UCU
// göremez — ve kapısız yeni uç tam olarak bu fazın kapattığı arızadır.
//
// ⚠️ ÜÇ SONUÇ, İKİ DEĞİL: kapı "açık · kapalı · ÖLÇÜLEMEDİ" döner. §1'in bir
// kolu tam olarak bunu ölçer — `olculemedi` dalı silinip liste boş diziye
// düşürülseydi, bozuk bir satırda KAPALI raporlar sessizce AÇILIRDI ve hiçbir
// başka kol bunu görmezdi.
//
// ⚠️ CANLI AYAK ÇALIŞMA AĞACINI DEĞİL AYAKTAKİ SÜRECİ ÖLÇER (ölçüldü 2026-09-15):
// §7'ye dayanarak yapılan bir negatif sonda, sunucu mutasyondan ÖNCE başladıysa
// YEŞİL kalır. Sondan sonra sunucuyu YENİDEN BAŞLAT; statik kollar (§1–§6) bu
// tuzağı taşımaz ve asıl güvence odur.
//
// Koşum: npx tsx scripts/test_rapor_kapisi.ts
//        (HTTP ayağı için: PORT=4101 … npx tsx src/server.ts &)
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPORT_CATALOG } from "../src/constants/report-catalog";
import { SUPERADMIN_ONLY_FLAG_KEYS, SUPERADMIN_ONLY_SETTING_KEYS, MODULE_FLAG_KEYS } from "../src/constants/module-flags";
import { atlamaDefteri } from "./lib/atlama";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import prisma from "../src/lib/prisma";
import { Prisma } from "@prisma/client";

const KOK = join(__dirname, "..");
const ORTA = join(KOK, "src/middlewares/report.middleware.ts");
const ROTA_KOK = join(KOK, "src/routes/reports");
let pass = 0;
let fail = 0;
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

/** Bir `router.get("<yol>", …)` çağrısının ARA KATMAN metnini döndürür (handler'a kadar). */
function araKatman(kaynak: string, yol: string): string | null {
  const desen = new RegExp(`router\\.get\\(\\s*"${yol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*,([\\s\\S]*?)(?:async\\s*\\(|\\(\\s*(?:_?req|_?_req))`);
  const m = kaynak.match(desen);
  return m ? m[1]! : null;
}

const BASE = process.env.TEST_API_URL ?? "http://localhost:4101";
const SONDA_ANAHTARI = "audit/system-log-summary";
const SONDA_UCU = "/api/reports/audit/system-log-summary?dateFrom=2026-01-01T00:00:00.000Z&dateTo=2026-01-02T00:00:00.000Z";
const DB_ANAHTARI = "reports.closedKeys";

/** `details.code` — ⚠️ `body.code` HEP undefined'dır (error.middleware `details` altına basar). */
async function kodu(r: Response): Promise<string | undefined> {
  const g = (await r.json().catch(() => ({}))) as { details?: { code?: string } };
  return g.details?.code;
}

async function main(): Promise<void> {
  console.log("=== RAPOR KAPISI ===\n");
  const orta = readFileSync(ORTA, "utf8");

  // ── §1 KAPI SÖZLEŞMESİ ────────────────────────────────────────────────────
  check("§1z körlük zemini: kapı dosyası okundu", orta.length > 1000, `${orta.length} karakter`);
  check("§1a kapı 403 döner (404 değil: kaynak VAR, bu kurulumda kapalı)",
    orta.includes("AppError.forbidden"));
  check("§1b kapalı rapor kodu `REPORT_DISABLED` ve `details` altında",
    /code: "REPORT_DISABLED"/.test(orta),
    /code: "REPORT_DISABLED"/.test(orta) ? "" : "`body.code` hep undefined okunur (sahte yeşil)");
  check("§1c ⭐ ÜÇÜNCÜ SONUÇ var: liste okunamazsa AYRI kod (`REPORT_GATE_UNAVAILABLE`)",
    /code: "REPORT_GATE_UNAVAILABLE"/.test(orta) && /durum === "olculemedi"/.test(orta),
    "\"ölçemedim\"i \"kapalı\" ya da \"açık\" diye basmak kapıyı yanlış yönde bozar");
  check("§1d okuma ÖNBELLEKSİZ (argümansız `readReportsClosedKeys()`)",
    /readReportsClosedKeys\(\)/.test(orta) && !/(let|const)\s+\w*[Bb]ellek|Date\.now\(\)/.test(orta),
    "görünürlük acil kapatma anahtarı — etkisi BİR SONRAKİ istekte görünmeli");
  check("§1e kapı KENDİ listesini okur (modül bayrağı değil)",
    /readReportsClosedKeys/.test(orta) && !/readDokumaEnabled|readProductionEnabled|readFinanceEnabled/.test(orta));
  check("§1f BAYAT anahtar okumada YOK SAYILIR (kapı katalog üyeliğini ŞART KOŞMAZ)",
    !/REPORT_BY_KEY\.has\(/.test(orta),
    "silinmiş bir rapor 29 ucun hepsini 500'e düşürmemeli; tipo'yu YAZMA ucu reddeder");

  // ── §2 SIRA ve §3 KAPSAMA ────────────────────────────────────────────────
  const beyan = new Map<string, { dosya: string; yol: string }[]>();
  for (const r of REPORT_CATALOG) if (r.kapiTasiyici) beyan.set(r.key, [...r.kapiTasiyici]);
  const beyanliUc = new Set([...beyan.values()].flat().map((k) => `${k.dosya}|${k.yol}`));
  check("§2z körlük zemini: katalog kapı taşıyıcısı beyan ediyor",
    beyanliUc.size >= 25, `${beyanliUc.size} uç · ${beyan.size} rapor`);

  const siraSapan: string[] = [];
  const kapisiz: string[] = [];
  for (const [key, tasiyicilar] of beyan) {
    for (const t of tasiyicilar) {
      let kaynak: string;
      try { kaynak = readFileSync(join(KOK, t.dosya), "utf8"); }
      catch { siraSapan.push(`${key}: ÖLÇÜLEMEDİ — ${t.dosya} okunamadı`); continue; }
      const zincir = araKatman(kaynak, t.yol);
      if (zincir === null) { siraSapan.push(`${key}: ÖLÇÜLEMEDİ — ${t.dosya}${t.yol} çağrısı bulunamadı`); continue; }

      // İki kalıp var ve ikisi de meşru: (A) dosya içi `reportGate(key)` fabrikası,
      // (B) router seviyesinde `verifyToken` + uç seviyesinde kapı.
      if (/\.\.\.reportGate\(/.test(zincir)) {
        if (!zincir.includes(`reportGate("${key}")`)) { kapisiz.push(`${t.dosya}${t.yol}: yanlış anahtar (${key} bekleniyordu)`); continue; }
        const fab = kaynak.match(/const reportGate = \(key: ReportKey\) => \[([^\]]*)\]/);
        if (!fab) { siraSapan.push(`${key}: ÖLÇÜLEMEDİ — \`reportGate\` fabrikası çözülemedi`); continue; }
        const i1 = fab[1]!.indexOf("verifyToken");
        const i2 = fab[1]!.indexOf("requireReportOpen");
        const i3 = fab[1]!.indexOf("requirePermission");
        if (!(i1 >= 0 && i2 > i1 && i3 > i2)) siraSapan.push(`${key}: sıra bozuk — ${fab[1]!.trim()}`);
        continue;
      }
      if (!zincir.includes(`requireReportOpen("${key}")`)) { kapisiz.push(`${t.dosya}${t.yol}: kapı YOK`); continue; }
      const uc = kaynak.indexOf("router.get(");
      const kimlik = kaynak.slice(0, uc).match(/router\.use\(\s*verifyToken/);
      if (!kimlik) { siraSapan.push(`${key}: kimlik kapısı router seviyesinde bulunamadı`); continue; }
      const iKapi = zincir.indexOf("requireReportOpen");
      const iIzin = zincir.search(/\bguard\b|requirePermission/);
      if (!(iIzin > iKapi)) siraSapan.push(`${key}: rapor kapısı izinden SONRA — ${zincir.trim()}`);
    }
  }
  check("§2 ⭐ sıra: kimlik → RAPOR KAPISI → izin (her taşıyıcıda)",
    siraSapan.length === 0 && kapisiz.length === 0,
    [...siraSapan, ...kapisiz].join(" · ") || `${beyanliUc.size} uç`);

  // Ters yön: dosyalardaki HER `router.get` katalogda beyan edilmiş mi?
  const gercekUc = new Set<string>();
  for (const ad of readdirSync(ROTA_KOK)) {
    if (!ad.endsWith(".ts")) continue;
    const kaynak = readFileSync(join(ROTA_KOK, ad), "utf8");
    for (const m of kaynak.matchAll(/router\.get\(\s*"([^"]+)"/g)) gercekUc.add(`src/routes/reports/${ad}|${m[1]!}`);
  }
  check("§3z körlük zemini: route taraması bir şey gördü", gercekUc.size >= 25, `${gercekUc.size} uç`);
  const beyansiz = [...gercekUc].filter((u) => !beyanliUc.has(u)).sort();
  const oluBeyan = [...beyanliUc].filter((u) => !gercekUc.has(u)).sort();
  check("§3 ⭐ KAPSAMA İKİ YÖNLÜ (kapısız yeni uç da, ölü beyan da kırmızı)",
    beyansiz.length === 0 && oluBeyan.length === 0,
    [beyansiz.length ? `BEYANSIZ UÇ: ${beyansiz.join(", ")}` : "",
     oluBeyan.length ? `ÖLÜ BEYAN: ${oluBeyan.join(", ")}` : ""].filter(Boolean).join(" · ")
    || `${gercekUc.size} uç birebir`);

  // ── §4 YAZMA KAPISI ──────────────────────────────────────────────────────
  check("§4a `reportsClosedKeys` süperadmin kümesinde",
    SUPERADMIN_ONLY_FLAG_KEYS.has("reportsClosedKeys"));
  check("§4b ⭐ modül kümesi KİRLENMEDİ (rapor listesi modül anahtarı DEĞİL)",
    !MODULE_FLAG_KEYS.has("reportsClosedKeys") && MODULE_FLAG_KEYS.size === 9,
    `MODULE_FLAG_KEYS ${MODULE_FLAG_KEYS.size} · SUPERADMIN_ONLY ${SUPERADMIN_ONLY_FLAG_KEYS.size}`);
  check("§4c ham ayar anahtarı da rezerve (`reports.closedKeys`)",
    SUPERADMIN_ONLY_SETTING_KEYS.has("reports.closedKeys"));
  const bayrakRota = readFileSync(join(KOK, "src/routes/feature-flag.routes.ts"), "utf8");
  check("§4d ⭐ `flagWriteGuard` GENİŞ kümeyi okur (dar küme kalsaydı rapor listesi `admin:settings`e düşerdi)",
    /keys\.some\(\(k\) => SUPERADMIN_ONLY_FLAG_KEYS\.has\(k\)\)/.test(bayrakRota));
  check("§4e `updateSchema` alanı taşır (yoksa `strictObject` PATCH'i 400 yapar — KAPATAMAMA arızası)",
    /reportsClosedKeys: z\.array\(z\.string\(\)\)\.optional\(\)/.test(bayrakRota));
  const adminRota = readFileSync(join(KOK, "src/routes/admin.routes.ts"), "utf8");
  check("§4f ham ayar ucu reddeder (`SUPERADMIN_ONLY_SETTING_KEYS` → `MODULE_KEY_RESERVED`)",
    /SUPERADMIN_ONLY_SETTING_KEYS\.has\(key\)/.test(adminRota) && /code: "MODULE_KEY_RESERVED"/.test(adminRota));

  // ── §5 BİLİNMEYEN ANAHTAR — YAZMADA 400, OKUMADA YOK SAY ─────────────────
  const servis = readFileSync(join(KOK, "src/services/system-setting.service.ts"), "utf8");
  check("§5a yazmada tanınmayan anahtar 400 `REPORT_KEY_UNKNOWN` ve ADIYLA",
    /code: "REPORT_KEY_UNKNOWN", keys: bilinmeyen/.test(servis) && /REPORT_BY_KEY\.has\(k\)/.test(servis));
  check("§5b `null` YAZILAMAZ (null yalnız okuma tarafının \"ölçülemedi\" işareti)",
    /!Array\.isArray\(incoming\)/.test(servis));
  check("§5c liste KÜME olarak saklanır (tekil + sıralı — sahte \"değişti\" audit satırı doğmasın)",
    /\[\.\.\.new Set\(incoming\)\]\.sort\(\)/.test(servis));
  check("§5d okuma ÜÇ SONUÇLU (`okundu` / `olculemedi`) ve satır-yok ⇒ HEPSİ AÇIK",
    /durum: "okundu"; kapali: string\[\]/.test(servis)
    && /if \(!setting\) return \{ durum: "okundu", kapali: \[\] \}/.test(servis));
  check("§5e `getFeatureFlags` alanı döner ve ölçülemedi ⇒ `null`",
    /reportsClosedKeys: string\[\] \| null/.test(servis) && /o\.durum === "okundu" \? o\.kapali : null/.test(servis));

  // ⭐ ÜÇÜNCÜ SONUCUN İKİ DALI DA AYRI AYRI ÖLÇÜLÜR. Bu kol bir SONDA BOŞLUĞUNDAN
  // doğdu: `olculemedi` dallarından biri `{durum:"okundu", kapali:[]}`a çevrildiğinde
  // §1c (kapı dosyasına bakar), §5d (tip beyanına bakar) ve §7c (CANLI sunucuya bakar)
  // ÜÇÜ DE YEŞİL kaldı — üçüncüsü çünkü koşan sunucu MUTASYONDAN ÖNCE başlamıştı.
  // ⇒ Canlı ayak, çalışma ağacını değil AYAKTAKİ SÜRECİ ölçer; sondası sunucuyu
  // yeniden başlatmadan geçerli değildir. Statik kol o boşluğu kapatır.
  const olcDallari = (servis.match(/return \{ durum: "olculemedi"/g) ?? []).length;
  check("§5f ⭐ okuyucunun İKİ `olculemedi` dalı da duruyor (dizi değil · öge string değil)",
    olcDallari === 2 && /!Array\.isArray\(ham\)/.test(servis) && /typeof x === "string"/.test(servis),
    `${olcDallari} dal`);

  // ── §6 BOOT DENETİMİ ─────────────────────────────────────────────────────
  const job = readFileSync(join(KOK, "src/jobs/report-catalog.job.ts"), "utf8");
  check("§6a boot bayat anahtarı DUYURUR ama YAZMAZ (liste temizliği süperadmin kararı)",
    /REPORT_BY_KEY\.has\(k\)/.test(job) && !/systemSetting\.(update|upsert|delete|create)/.test(job));
  check("§6b boot denetimi best-effort (DB yoksa sunucuyu DURDURMAZ)",
    /catch \(e\)/.test(job) && /uyari\(/.test(job));
  const server = readFileSync(join(KOK, "src/server.ts"), "utf8");
  check("§6c boot'ta ÇAĞRILIYOR (yazılıp çağrılmayan denetim bir kapı değildir)",
    /warnStaleReportKeys\(\)/.test(server));

  // ── §7 HTTP TURU (sunucu yoksa ATLANIR) ──────────────────────────────────
  // ⚠️ BU TUR GLOBAL DURUM YAZAR (`reports.closedKeys` satırı) — yazdığını
  // `finally`de GERİ ALIR, geri alamazsa BUNU SÖYLER. Sızan bir bayrak kendi
  // onarımını maskeler: "yeşil" ölçümün geçerliliği o satırın geri konmasına bağlı.
  const HTTP_KONTROL = 5;
  const engel = hedefDbEngeli();
  if (engel) {
    ATLAMA.atla("§7 canlı tur", engel, HTTP_KONTROL);
  } else {
    // ⚠️ İKİ ÖN KOŞUL, İKİSİ DE ŞART (ölçüldü: mandal koşumunda sunucu AYAKTA ama
    // `DATABASE_URL` ulaşılamaz bir adrese çevrilmişti — tur başladı ve sondanın
    // KENDİ yazması düştü). Tur, sunucunun gördüğü listeye YAZAR: yerel Prisma
    // erişimi olmadan "kapalı rapor" durumu hiç kurulamaz.
    let dbVar = true;
    try { await prisma.$queryRaw`SELECT 1`; } catch { dbVar = false; }
    if (!dbVar) {
      ATLAMA.atla("§7 canlı tur", "yerel veritabanına erişilemedi — tur listeye YAZAR, yazamadan ölçemez", HTTP_KONTROL);
      ATLAMA.atla("§7f bilinmeyen anahtar 400 (canlı)", "yerel veritabanı yok", 1);
      console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
      process.exit(fail === 0 ? 0 : 1);
    }
    const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_KONTROL });
    if (kapi.kirmizi) {
      check("§7 HTTP ayağı ölçülebildi", false, kapi.kirmizi);
      ATLAMA.atla("§7 canlı tur", "kapı kırmızı verdi — ayak hiç koşmadı", HTTP_KONTROL);
    } else if (!kapi.token) {
      ATLAMA.atla("§7 canlı tur", kapi.atlaSebebi ?? "ölçüm yapılamadı", HTTP_KONTROL);
    } else {
      const auth = { Authorization: `Bearer ${kapi.token}` };
      const ilk = await prisma.systemSetting.findUnique({ where: { key: DB_ANAHTARI }, select: { value: true } });
      try {
        const acik = await fetch(`${BASE}${SONDA_UCU}`, { headers: auth });
        check("§7a AÇIK rapor kapıdan geçiyor (kapı her şeyi kesmiyor)",
          acik.status !== 403 || (await kodu(acik.clone() as Response)) === undefined,
          `HTTP ${acik.status}`);

        await prisma.systemSetting.upsert({
          where: { key: DB_ANAHTARI },
          update: { value: [SONDA_ANAHTARI] },
          create: { key: DB_ANAHTARI, value: [SONDA_ANAHTARI], description: "bekçi sondası" },
        });
        const kapali = await fetch(`${BASE}${SONDA_UCU}`, { headers: auth });
        const kapaliKod = await kodu(kapali);
        check("§7b ⭐ KAPALI rapor 403 `REPORT_DISABLED` (canlı)",
          kapali.status === 403 && kapaliKod === "REPORT_DISABLED", `HTTP ${kapali.status} · code=${kapaliKod ?? "—"}`);

        await prisma.systemSetting.update({ where: { key: DB_ANAHTARI }, data: { value: "bozuk" } });
        const olculemedi = await fetch(`${BASE}${SONDA_UCU}`, { headers: auth });
        const olcKod = await kodu(olculemedi);
        check("§7c ⭐ BOZUK liste ÜÇÜNCÜ SONUCU verir (403 `REPORT_GATE_UNAVAILABLE`, `REPORT_DISABLED` DEĞİL)",
          olculemedi.status === 403 && olcKod === "REPORT_GATE_UNAVAILABLE", `HTTP ${olculemedi.status} · code=${olcKod ?? "—"}`);

        // ⚠️ ÖNCE SUPABIN DURUMU ÖLÇÜLÜR, SONRA İDDİA KURULUR (bu bekçi bunu ilk
        // koşumda öğrendi: sistem hesabı OLMAYAN bir DB'de yönetici PATCH'i 200
        // döndü ve sonda "kapı bozuk" diye yanlış bir hikâye anlatacaktı).
        // `flagWriteGuard`ın EMNİYET SUPABI kuralı: sistem hesabı hiç yoksa kilit
        // devre dışıdır — yoksa modül anahtarını HİÇ KİMSE değiştiremezdi. Yani
        // "kilit gelmedi" burada iki ayrı şey olabilir ve ikisi ayrılmadan ölçüm yok.
        const sistemHesabiVar = (await prisma.user.count({ where: { isSystemAccount: true } })) > 0;
        const yonetici = await fetch(`${BASE}/api/feature-flags`, {
          method: "PATCH",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ reportsClosedKeys: [] }),
        });
        const yonKod = await kodu(yonetici);
        if (sistemHesabiVar) {
          check("§7d ⭐ `admin:settings` taşıyan yönetici listeyi YAZAMAZ (403 `MODULE_FLAG_SUPERADMIN_ONLY`)",
            yonetici.status === 403 && yonKod === "MODULE_FLAG_SUPERADMIN_ONLY", `HTTP ${yonetici.status} · code=${yonKod ?? "—"}`);
        } else {
          // Supap AÇIK — ama sessiz geçmeyiz: en azından isteğin ① DALINA girdiğini
          // ölçeriz. Anahtar o kümede olmasaydı denetim olayı hiç yazılmazdı.
          const supapIzi = await prisma.systemLog.count({
            where: { action: "SUPERADMIN_ABSENT_MODULE_WRITE", createdAt: { gte: new Date(Date.now() - 60_000) } },
          });
          check("§7d ⭐ süperadmin dalına GİRİLDİ (supap açıkken bile anahtar o kümede)",
            supapIzi > 0, supapIzi > 0 ? `denetim izi var (HTTP ${yonetici.status})` : "SUPERADMIN_ABSENT_MODULE_WRITE denetim satırı YOK ⇒ anahtar ① dalına hiç girmedi");
          ATLAMA.atla("§7d2 kilitli dal (403 `MODULE_FLAG_SUPERADMIN_ONLY`)",
            "bu veritabanında sistem hesabı YOK ⇒ `flagWriteGuard` emniyet supabı açık; kilit ölçülemez "
            + "(süperadmin kurulu bir DB'de koş)", 1);
        }

        const ham = await fetch(`${BASE}/api/admin/settings/${DB_ANAHTARI}`, {
          method: "PUT",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ value: [] }),
        });
        const hamKod = await kodu(ham);
        check("§7e ham ayar ucu ikinci yazma yüzeyi AÇMIYOR (400 `MODULE_KEY_RESERVED`)",
          ham.status === 400 && hamKod === "MODULE_KEY_RESERVED", `HTTP ${ham.status} · code=${hamKod ?? "—"}`);
      } finally {
        // GERİ ALMA — ve geri almanın KENDİSİ ölçülür (sessiz teardown, sızan bayrak demektir).
        try {
          // ⚠️ JSON `null` ile SATIR YOK ayrı şeylerdir: ilki "değer null yazılmış", ikincisi
          // "hiç yazılmamış" ve kapı için ikisi de boş listeye çözülür — ama GERİ ALMA
          // ikisini karıştıramaz, yoksa sonda ölçtüğü durumu değil başka bir durumu bırakır.
          if (ilk) await prisma.systemSetting.update({ where: { key: DB_ANAHTARI }, data: { value: ilk.value === null ? Prisma.JsonNull : ilk.value } });
          else await prisma.systemSetting.deleteMany({ where: { key: DB_ANAHTARI } });
          const son = await prisma.systemSetting.findUnique({ where: { key: DB_ANAHTARI }, select: { value: true } });
          const ayni = JSON.stringify(son?.value ?? null) === JSON.stringify(ilk?.value ?? null);
          check("§7z ⭐ sonda yazdığını GERİ ALDI (sızan bayrak kendi onarımını maskeler)", ayni,
            ayni ? "satır ilk hâline döndü" : `ARTIK: ${JSON.stringify(son?.value)} (beklenen ${JSON.stringify(ilk?.value ?? null)})`);
        } catch (e) {
          check("§7z ⭐ sonda yazdığını GERİ ALDI", false, `geri alma DÜŞTÜ: ${(e as Error).message}`);
        }
      }
    }
  }
  // Süperadmin gereken TEK senaryo — sözleşme ADIYLA yazılı: sistem hesabı token'ıyla
  // `PATCH /api/feature-flags { reportsClosedKeys: ["yok/boyle-rapor"] }` → 400
  // `details.code === "REPORT_KEY_UNKNOWN"` ve gövde BİLİNMEYEN ANAHTARI ADIYLA sayar.
  ATLAMA.atla("§7f bilinmeyen anahtar 400 (canlı)",
    "sistem hesabı token'ı gerekir (`flagWriteGuard` yöneticiyi zaten 403'le keser, servise ulaşılmaz); "
    + "statik kolu §5a ölçüyor", 1);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

void main().finally(() => prisma.$disconnect());
