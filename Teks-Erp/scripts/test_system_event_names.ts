// =============================================================================
// BEKÇİ — SİSTEM OLAYI ADLARI (beyan edilmiş sözleşmeye UYUM)
// =============================================================================
// Sözleşme: `src/constants/system-events.ts` (`SYSTEM_EVENT` + `ARCHIVED_EVENTS`).
// Çalıştır: npx tsx scripts/test_system_event_names.ts
//
// ⚠️ BU BEKÇİ KÜMEYİ KEŞFETMEZ. Küme ölçülerek bulunamıyor: kaynakta dizge arayan
// tarama adı SABİTTEN kurulan çağrıyı görmez (6 ad), DB yalnız KOŞMUŞ yolu görür
// (15 meşru ad hiç yazılmamış), ikisinin birleşimi bile eksikti. Bu yüzden küme
// BEYAN edilir, bekçi yalnız UYUMU ölçer.
//
// ⚠️ TİPİN YAKALADIĞINI BEKÇİ TEKRAR YAKALAMAZ. `action: SystemEventName` imzası
// 51 çağrı yerinin tamamını derleyiciye bağlar (ölçüldü: `system_logs`a yazan TEK
// yol `AuditService`). Bekçi yalnız tipin göremediği beş şeyi tutar:
//   §1 AYNA      — her ad Electron `EVENT_ACTION_LABELS`te Türkçesini taşıyor mu
//                  (tip repolar arasına geçemez)
//   §2 KAÇIŞ     — çağrı yerinde tip susturulmuş mu (`as`, `@ts-expect-error`)
//   §3 ÖLÜ DOĞUM — birlikte olup HİÇBİR çağrı yeri olmayan ad (tip "kimse
//                  çağırmıyor"u görmez) → ya çağrılır ya `ARCHIVED_EVENTS`e taşınır
//   §4 BAYPAS    — `system_logs`a `AuditService` DIŞINDAN yazan yol
//   §5 BAĞ       — sabitler birliğe `satisfies` ile bağlı mı (bağ koparsa kaçak döner)
//
// ⚠️ NE YAKALAMAZ (bilerek; bir sonraki okuyan temizlemeye kalkmasın):
//   • Bir kod yolunun KOŞUP koşmadığını. Birliğin 15 adı hiç yazılmamış ve hepsi
//     meşru (`AUDIT_ARCHIVE` 6 ayda bir · `UNCAUGHT_EXCEPTION` felaket yolu).
//     **"DB'de yok" BİR BULGU DEĞİLDİR.**
//   • Türkçe etiketin DOĞRU olduğunu — yalnız VAR olduğunu ölçer.
//   • Arşiv kararının kendisini: bir adın yazan kodunun gerçekten kaldırıldığı
//     insan ölçümüdür (§3 "çağrı yeri yok"u görür, "olmalı mıydı"yı görmez).
//   • Repo dışından DB'ye doğrudan yazan süreci (başka kurulum, elle SQL).
//   • §3'ün kendi zayıflığı: "kullanılıyor" ölçütü adın literal geçmesidir ⇒ adı
//     alakasız bir yerde geçen ad "kullanılıyor" görünür (yanlış NEGATİF üretir,
//     yanlış pozitif üretmez).
//
// ⚠️ İKİ SORU, İKİ KAPSAM (karıştırmak ilk koşumda yanlış kırmızı verdi):
//   • §0/§2/§4 ÇAĞRI YERİ sayar → yalnız `src/` (servis kodu; bekçilerdeki ad
//     listeleri `logEvent` çağrısı sanılmasın).
//   • §3 ÖLÜ AD arar → `src/` + `scripts/` (yedi onarım izi YALNIZ betiklerden
//     yazılır; `src/` ile sınırlı tarama onları "çağrısız" gösterirdi).
// Her iki kapsamda SÖZLEŞME DOSYASI ve BU BEKÇİ dışlanır (yoksa araç gözlenenin
// içinde kalır ve her ad "kullanılıyor" görünür). Yorumlar ofset bozulmadan
// sökülür — `superadmin.job.ts` bir YORUM içinde `logEvent` yazıyor.
//
// ⭐ NEGATİF SONDA (2026-09-13, ölçüldü):
//   (a) birliğe etiketsiz uydurma ad → §1 KIRMIZI
//   (b) bir çağrı yerini `as SystemEventName` ile sustur → §2 KIRMIZI
//   (c) birliğe hiç çağrılmayan ad → §3 KIRMIZI
//   Üçü de geri alındığında yeşile döndü.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { SYSTEM_EVENT, ARCHIVED_EVENTS, ALL_EVENT_NAMES } from "../src/constants/system-events";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const KOK = path.resolve(__dirname, "..", "..");
const SRC = path.join(KOK, "Teks-Erp/src");
const SOZLESME = path.join(SRC, "constants/system-events.ts");
const ETIKET = path.join(KOK, "Electron/src/lib/audit-labels.ts");

/** Yorumları söker, OFSETLERİ korur (dosya:satır doğru kalsın). */
const yorumSok = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));

function tsDosyalari(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) tsDosyalari(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const dosyalar = tsDosyalari(SRC);
const satirNo = (s: string, i: number): number => s.slice(0, i).split("\n").length;

interface Cagri {
  yer: string;
  ifade: string;
  kacis: boolean;
}
const cagrilar: Cagri[] = [];
for (const f of dosyalar) {
  const src = yorumSok(fs.readFileSync(f, "utf8"));
  const rel = path.relative(KOK, f);
  for (const m of src.matchAll(/logEvent\s*\(/g)) {
    const pencere = src.slice(m.index!, m.index! + 1500);
    const am = pencere.match(/\baction:\s*([^\n]+)/);
    if (!am) continue;
    const ifade = am[1]!.trim().replace(/,\s*$/, "");
    // İmzanın kendisi (`action: SystemEventName;`) bir çağrı DEĞİLDİR.
    if (/^SystemEventName;?$/.test(ifade)) continue;
    cagrilar.push({
      yer: `${rel}:${satirNo(src, m.index!)}`,
      ifade,
      kacis:
        /\bas\s+(any|string|SystemEventName)\b/.test(ifade) ||
        /@ts-(expect-error|ignore)/.test(pencere.slice(0, 200)),
    });
  }
}

console.log("=== Sistem olayı adları — sözleşmeye uyum ===\n");

console.log("--- §0 körlük zemini ---");
const yazilabilir = Object.values(SYSTEM_EVENT);
check(`sözleşmede yazılabilir ad var (${yazilabilir.length})`, yazilabilir.length >= 40, `${yazilabilir.length}`);
check(`kaynakta logEvent çağrı yeri bulundu (${cagrilar.length})`, cagrilar.length >= 45, `${cagrilar.length}`);
check(`taranan dosya sayısı makul (${dosyalar.length})`, dosyalar.length >= 200, `${dosyalar.length}`);

console.log("\n--- §1 Etiket aynası (iki yönlü) ---");
const etiketSrc = fs.readFileSync(ETIKET, "utf8");
const blok = etiketSrc.match(/export const EVENT_ACTION_LABELS[^{]*\{([\s\S]*?)\n\};/);
check("EVENT_ACTION_LABELS okunabildi", blok !== null);
const etiketler = new Set(
  [...(blok ? blok[1]! : "").matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*:/gm)].map((m) => m[1]!),
);
check(`etiket sözlüğü dolu (${etiketler.size})`, etiketler.size >= 45, `${etiketler.size}`);
const etiketsiz = ALL_EVENT_NAMES.filter((a) => !etiketler.has(a));
check("sözleşmedeki HER adın Türkçesi var (arşiv dâhil)", etiketsiz.length === 0, etiketsiz.join(", "));
const sozlesmesiz = [...etiketler].filter((e) => !ALL_EVENT_NAMES.includes(e));
check("etiket sözlüğünde sözleşme DIŞI ad yok", sozlesmesiz.length === 0, sozlesmesiz.join(", "));

console.log("\n--- §2 Tip kaçışı ---");
const kacanlar = cagrilar.filter((c) => c.kacis);
check(
  "hiçbir çağrı yeri tipi susturmuyor (`as` / @ts-expect-error yok)",
  kacanlar.length === 0,
  kacanlar.map((c) => `${c.yer} → ${c.ifade.slice(0, 40)}`).join(" · "),
);

console.log("\n--- §3 Ölü doğum (çağrı yeri olmayan ad) ---");
// ⚠️ KULLANIM TARAMASI `scripts/` DAHİL: onarım/backfill izleri (7 ad) YALNIZ
// betiklerden yazılıyor; yalnız `src/` taranırsa o yedi ad "çağrısız" görünür ve
// kapı YANLIŞ kırmızı verir (ilk koşumda tam bu oldu). Çağrı yeri SAYMAK için
// `src/` yeterliydi, ÖLÜ AD aramak için değil — iki soru, iki kapsam.
// ⚠️ SÖZLEŞME DOSYASI ve BU BEKÇİ dışlanır; yoksa ikisi de her adı "kullanılıyor"
// gösterir (araç gözlenenin içinde). Kalan zayıflık kabul: adı alakasız bir yerde
// (ör. başka bir bekçinin listesinde) geçen ad "kullanılıyor" görünür — yanlış
// NEGATİF üretir, yanlış pozitif üretmez.
const kullanimMetni = [...dosyalar, ...tsDosyalari(path.join(KOK, "Teks-Erp/scripts"))]
  .filter(
    (f) => path.resolve(f) !== path.resolve(SOZLESME) && path.resolve(f) !== path.resolve(__filename),
  )
  .map((f) => yorumSok(fs.readFileSync(f, "utf8")))
  .join("\n");
const cagrisizlar = yazilabilir.filter(
  (ad) => !kullanimMetni.includes(`"${ad}"`) && !kullanimMetni.includes(`'${ad}'`),
);
check(
  "yazılabilir her adın en az bir çağrı yeri var (yoksa ARCHIVED_EVENTS'e taşınır)",
  cagrisizlar.length === 0,
  cagrisizlar.join(", "),
);
const arsivCagrili = Object.values(ARCHIVED_EVENTS).filter((ad) => kullanimMetni.includes(`"${ad}"`));
check(
  "arşiv adlarının çağrı yeri YOK (varsa arşivden çıkarılmalı)",
  arsivCagrili.length === 0,
  arsivCagrili.join(", "),
);

console.log("\n--- §4 Baypas (tek yazar) ---");
const yazanlar: string[] = [];
for (const f of dosyalar) {
  if (path.basename(f) === "audit.service.ts") continue;
  const src = yorumSok(fs.readFileSync(f, "utf8"));
  const rel = path.relative(KOK, f);
  if (/systemLog\.(create|createMany|upsert)\s*\(/.test(src)) yazanlar.push(rel);
  if (/insert\s+into\s+"?system_logs/i.test(src)) yazanlar.push(`${rel} (ham SQL)`);
}
check("`system_logs`a yazan TEK yer audit.service.ts", yazanlar.length === 0, yazanlar.join(", "));

console.log("\n--- §5 Sabit birliğe BAĞLI ---");
const ayarSrc = fs.readFileSync(path.join(SRC, "services/settings-password.service.ts"), "utf8");
check(
  "SETTINGS_PASSWORD_EVENTS `satisfies` ile birliğe bağlı",
  /SETTINGS_PASSWORD_EVENTS[\s\S]{0,600}satisfies\s+Record<[^>]*SystemEventName>/.test(ayarSrc),
  "bağ koparsa sabitten kurulan ad yine görünmez olur",
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
