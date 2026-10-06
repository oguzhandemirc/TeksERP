// =============================================================================
// Test: PROFİL TAMLIĞI — her ayarın açık-değeri var; profil dosyaları allowlist'e uyar
// =============================================================================
// Matris koşucusunun (`profil-matrisi.ts`) girdisi olan test profillerinin sözleşmesi
// (TEK-ORTAK-PAKET §6): ① `PATCH /api/feature-flags` şemasındaki HER anahtarın hepsi-açık
// tablosunda (`lib/hepsi-acik.ts`) bir satırı var — yeni bayrak tabloya girmezse KIRMIZI ·
// ② açık değerler şemadan geçer, boolean bayrak ancak gerekçeli istisnayla `true` olmaz,
// dokuz modül açık ve bağımlılıkları sağlıyor · ③ diskteki profiller biçim/allowlist/sır
// kurallarına uyar; `kapali` boş, `acik` tablodan ÜRETİLMİŞ (elle sapma kırmızı) ·
// ④ negatif sondalar: ihlalli girdiler gerçekten RED almalı (yüklem kördür diye yeşil olmasın) ·
// ⑤ dışa aktarma (`profil-disa-aktar.ts`): `_test` hedef kapısı + allowlist süzgeci, sondalı.
// Çalıştır: npx tsx scripts/test_profil_tamligi.ts
// =============================================================================
import { MODULE_DEPENDENCIES, MODULE_FLAG_KEYS } from "../src/constants/module-flags";
import { HEPSI_ACIK, hepsiAcikAyarlar } from "./lib/hepsi-acik";
import { FIXTURE_OLMAYAN_DB } from "./lib/hedef-db-kapisi";
import {
  bayraklardanAyarlar,
  disaAktarmaHedefEngeli,
  evrenHatalari,
  profilAdlari,
  profilHatalari,
  profilOku,
  URETILMIS_PROFILLER,
} from "./lib/profil";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Boolean bayrakta `true` dışı değer yalnız burada beyanlıdır (gerekçe tabloda yazılı). */
const BOOLEAN_ISTISNALARI: ReadonlySet<string> = new Set(["demoModeEnabled"]);

async function main(): Promise<void> {
  process.env.JWT_SECRET ??= "profil-tamligi-test-sirri-0123456789abcdef";
  const { updateSchema } = await import("../src/routes/feature-flag.routes");
  const shape = updateSchema.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>;
  const semaAnahtarlari = Object.keys(shape);

  // ── ① evren ────────────────────────────────────────────────────────────────
  check("şema evreni kör değil (≥ 100 anahtar)", semaAnahtarlari.length >= 100, `${semaAnahtarlari.length} anahtar`);
  const evren = evrenHatalari(semaAnahtarlari);
  check("her şema anahtarının hepsi-açık satırı var; ölü satır yok", evren.length === 0, evren.slice(0, 5).join(" | "));

  // ── ② açık değerler ────────────────────────────────────────────────────────
  const acik = hepsiAcikAyarlar();
  const sema = updateSchema.safeParse(acik);
  check("açık ayarlar PATCH şemasından geçer", sema.success, sema.success ? `${Object.keys(acik).length} ayar` : JSON.stringify(sema.error.issues.slice(0, 3)));
  const booleanlar = Object.keys(HEPSI_ACIK).filter((k) => shape[k]?.safeParse(true).success && !shape[k]?.safeParse("x").success && !shape[k]?.safeParse(5).success);
  const booleanKusurlu = booleanlar.filter((k) => acik[k] !== true && !BOOLEAN_ISTISNALARI.has(k));
  check("her boolean bayrak açık profilde true (beyanlı istisna dışında)", booleanKusurlu.length === 0 && booleanlar.length > 60, `${booleanlar.length} boolean; kusurlu: ${booleanKusurlu.join(", ") || "yok"}`);
  const modulKapali = [...MODULE_FLAG_KEYS].filter((k) => acik[k] !== true);
  check("on modül anahtarı açık profilde AÇIK", modulKapali.length === 0 && MODULE_FLAG_KEYS.size === 10, modulKapali.join(", "));
  const bagimlilik = Object.entries(MODULE_DEPENDENCIES).filter(([b, o]) => acik[b] === true && acik[o] !== true);
  check("açık profil modül bağımlılıklarını sağlar", bagimlilik.length === 0, bagimlilik.map(([b, o]) => `${b}→${o}`).join(", "));

  // ── ③ diskteki profiller ───────────────────────────────────────────────────
  const adlar = profilAdlari();
  check("kapali ve acik profilleri var", adlar.includes("kapali") && adlar.includes("acik"), adlar.join(", "));
  const gercek = adlar.filter((a) => !URETILMIS_PROFILLER.has(a));
  check("en az bir gerçek fabrika profili var (yedek kopyasından)", gercek.length > 0, gercek.join(", ") || "yok");
  for (const ad of adlar) {
    const p = profilOku(ad);
    const h = profilHatalari(p, updateSchema);
    check(`profil '${ad}' biçim/allowlist/sır/şema kurallarına uyar`, h.length === 0 && p.ad === ad, h.slice(0, 4).join(" | "));
  }
  if (adlar.includes("kapali")) check("kapali profili boş (hepsi varsayılan)", Object.keys(profilOku("kapali").ayarlar).length === 0);
  if (adlar.includes("acik")) {
    const diskte = JSON.stringify(profilOku("acik").ayarlar);
    check("acik.json tablodan üretilmiş (elle sapma yok)", diskte === JSON.stringify(acik), "sapma varsa: npx tsx scripts/profil-matrisi.ts --acik-yaz");
  }

  // ── ④ NEGATİF SONDALAR ─────────────────────────────────────────────────────
  const temel = { ad: "sonda", kaynak: "sonda", alinma: "2026-10-06", ayarlar: {} as Record<string, unknown> };
  const reddi = (ayarlar: Record<string, unknown>, ek: Record<string, unknown> = {}): boolean =>
    profilHatalari({ ...temel, ...ek, ayarlar }, updateSchema).length > 0;
  check("sonda: allowlist dışı anahtar RED", reddi({ olmayanBirBayrak: true }));
  check("sonda: sır anahtarı RED", reddi({ settingsPassword: "x" }) && reddi({ quickPinHmac: "x" }));
  check("sonda: profil-dışı (nesne değerli) anahtar RED", reddi({ loginMethods: { enabled: ["pin"], primary: "pin" } }));
  check("sonda: ilkel olmayan değer RED", reddi({ financeEnabled: { a: 1 } }));
  check("sonda: şemaya aykırı değer RED", reddi({ shippingOrderRequirement: "yok-boyle-bir-deger" }));
  check("sonda: bilinmeyen üst alan RED", reddi({}, { sirlar: "x" }));
  check("sonda: geçerli profil KABUL (yüklem her şeyi reddetmiyor)", !reddi({ financeEnabled: true }));
  check("sonda: tabloda karşılığı olmayan yeni şema anahtarı KIRMIZI", evrenHatalari([...semaAnahtarlari, "yeniBayrakEnabled"]).length > 0);
  check("sonda: şemadan düşen anahtar ölü satır olarak KIRMIZI", evrenHatalari(semaAnahtarlari.filter((k) => k !== "financeEnabled")).length > 0);

  // ── ⑤ DIŞA AKTARMA ─────────────────────────────────────────────────────────
  const engel = (ad: string): boolean => disaAktarmaHedefEngeli(ad, FIXTURE_OLMAYAN_DB) !== null;
  check("sonda: dışa aktarma `_test` ile bitmeyen hedefi RED", engel("tekserp_demo") && engel("tekserp") && engel("tekserp_test_x"));
  check("sonda: dışa aktarma fabrika yedeği sınıfını RED (`_test` ekli olsa da)", engel("tekserp_fabrika_0923") && engel("tekserp_fabrika_kopya_test"));
  check("sonda: dışa aktarma matris seed DB'sini RED", engel("tekserp_pm_kapali_test"));
  check("dışa aktarma kendi kopyasını KABUL eder", !engel("tekserp_o13b_kaynak_test"));
  const suz = bayraklardanAyarlar({ financeEnabled: true, license: { x: 1 }, settingsPasswordHash: "h", loginMethods: { a: 1 }, factoryTimezone: "dilim", labelCopies: 2 });
  check(
    "dışa aktarma süzgeci: allowlist girer; sır · profil-dışı · çıktıya özgü anahtar girmez",
    JSON.stringify(suz.ayarlar) === JSON.stringify({ financeEnabled: true, labelCopies: 2 }) && Object.keys(suz.atlanan).length === 4,
    JSON.stringify(suz.ayarlar),
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`TEST HATASI: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
