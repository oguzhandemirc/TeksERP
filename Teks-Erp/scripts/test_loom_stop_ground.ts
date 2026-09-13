// =============================================================================
// MANDAL: tablette tezgah duruş EKRANI varsa gömülü ZEMİN boş olamaz
// Çalıştır: npx tsx scripts/run-all-tests.ts loom_stop_ground
// =============================================================================
// NEDEN (dokuma P2b-2, 2026-09-13): tasarım (`dokuma.md` § Tablet) `MACHINE_STOP`
// için APK'ya gömülü zemini ZORUNLU sayar — sunucusuzken katalog boş dönerse
// sebep zorunlu olan duruş kaydedilemez ve tezgah EKRANDA KİLİTLENİR. O risk
// bir TABLET EKRANI varken doğar; bugün ekran YOK (Faz 2) ve zemin bilerek BOŞ
// (`useReasonPresets.ts` `case 'MACHINE_STOP': return []`) — ekransız zemin,
// okuyucusu olmayan 23 satırlık ölü koddur.
//
// ⚠️ Kapanma koşulu YORUMDA kalmasın diye bu mandal var: ekranı yazan kişi o
// yorumu görmeyebilir ve o gün kilitlenme uyarısı gerçek olur. "Bunu biliyorum"
// bir kapı değildir.
//
// İKİ UÇLU YÜKLEM (ikisi de ölçülür, biri değil):
//   ekran VAR  ∧ zemin BOŞ   → KIRMIZI  (tasarımın cümlesini basar)
//   ekran VAR  ∧ zemin DOLU  → yeşil
//   ekran YOK  ∧ zemin BOŞ   → yeşil    ← BUGÜN (mandal, tavan 0)
//   ekran YOK  ∧ zemin DOLU  → yeşil + UYARI (okuyucusuz zemin; sunucu kataloğuyla
//                               sessizce ayrışır — kırmızı değil, çünkü zararsız)
// Yalnız zemini ölçen bir mandal bugün kırmızı olurdu (erken sertlik); yalnız
// ekranı ölçen hiçbir şey demezdi.
//
// EKRANIN VARLIĞI = `mobil/src/navigation/MainNavigator.tsx`te bir route kaydı
// (`require('../screens/…')`) ve o ekranın `MACHINE_STOP` kind'ını okuması.
// Yalnız dosya varlığı YETMEZ: yazılmış ama bağlanmamış ekran kilitlenme
// üretmez. Yalnız kind okuması da yetmez: ekransız bir hook çağrısı da olabilir.
// Kaynak dosyalar okunur, DB'ye bağlanmaz.
// =============================================================================
import fs from "fs";
import path from "path";
import { yorumlariSok } from "./lib/regime-gate-scan";

const ROOT = path.resolve(__dirname, "../..");
const NAVIGATOR = path.join(ROOT, "mobil/src/navigation/MainNavigator.tsx");
const HOOK = path.join(ROOT, "mobil/src/hooks/useReasonPresets.ts");
const SCREENS_DIR = path.join(ROOT, "mobil/src/screens");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** Navigator'da kayıtlı ekran modül yolları (`require('../screens/X/Y')`). */
function kayitliEkranlar(src: string): string[] {
  return [...src.matchAll(/require\(['"]\.\.\/screens\/([^'"]+)['"]\)/g)].map((m) => m[1]);
}

/** Bu ekran dosyalarından herhangi biri MACHINE_STOP kind'ını okuyor mu? */
function ekranMachineStopOkuyorMu(modulYollari: string[]): string[] {
  const okuyanlar: string[] = [];
  for (const rel of modulYollari) {
    const base = path.join(SCREENS_DIR, rel);
    const aday = [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")].find((f) => fs.existsSync(f));
    if (!aday) continue;
    // Ekran dizininin tamamı: ekran alt bileşenlere bölünmüş olabilir.
    const dizin = path.dirname(aday);
    const dosyalar = fs.readdirSync(dizin).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    for (const f of dosyalar) {
      const src = yorumlariSok(fs.readFileSync(path.join(dizin, f), "utf8"));
      if (/['"]MACHINE_STOP['"]/.test(src)) okuyanlar.push(path.relative(ROOT, path.join(dizin, f)));
    }
  }
  return okuyanlar;
}

/** `builtin()` switch'inin MACHINE_STOP dalı boş dizi mi döndürüyor? */
function zeminBosMu(hookSrc: string): { bulundu: boolean; bos: boolean } {
  const src = yorumlariSok(hookSrc);
  const m = /case\s+['"]MACHINE_STOP['"]\s*:\s*([\s\S]*?)(?=\n\s*case\s+['"]|\n\s*\}\s*\n)/.exec(src);
  if (!m) return { bulundu: false, bos: true };
  return { bulundu: true, bos: /return\s*\[\s*\]\s*;/.test(m[1]) };
}

function main(): void {
  // ── Körlük zemini: iki kaynak da okunabilmeli ─────────────────────────────
  const navSrc = fs.readFileSync(NAVIGATOR, "utf8");
  const hookSrc = fs.readFileSync(HOOK, "utf8");
  const ekranlar = kayitliEkranlar(yorumlariSok(navSrc));
  check("navigator'da kayıtlı ekran bulundu (körlük zemini)", ekranlar.length >= 3, `${ekranlar.length} ekran`);
  const zemin = zeminBosMu(hookSrc);
  check("hook'ta MACHINE_STOP dalı bulundu (körlük zemini)", zemin.bulundu);

  // ── İKİ UÇLU MANDAL ───────────────────────────────────────────────────────
  const okuyanlar = ekranMachineStopOkuyorMu(ekranlar);
  const ekranVar = okuyanlar.length > 0;
  console.log(`   ekran: ${ekranVar ? "VAR → " + okuyanlar.join(", ") : "YOK (Faz 2)"} · zemin: ${zemin.bos ? "BOŞ" : "DOLU"}`);

  if (ekranVar && zemin.bos) {
    check(
      "tezgah duruş EKRANI varken gömülü zemin BOŞ OLAMAZ",
      false,
      "tasarım (dokuma.md § Tablet): sunucusuzken katalog boş döner, sebep zorunlu duruş kaydedilemez, " +
        "tezgah EKRANDA KİLİTLENİR — `useReasonPresets.ts` `case 'MACHINE_STOP'` GERÇEK katalog " +
        "kodlarıyla doldurulmalı (`constants/loomStopReasons.ts`, WORK_ORDER_REWORK kalıbı)",
    );
  } else {
    check(
      "tezgah duruş EKRANI varken gömülü zemin BOŞ OLAMAZ",
      true,
      ekranVar ? "ekran var, zemin dolu" : "ekran yok ⇒ mandal yeşil (tavan 0); ekran gelince zemin de gelmeli",
    );
  }
  if (!ekranVar && !zemin.bos) {
    console.log("   ⚠️  UYARI: ekran yokken zemin DOLU — okuyucusu olmayan katalog sunucuyla sessizce ayrışır.");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
