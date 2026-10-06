// =============================================================================
// P-TAKIMI (HTTP ayağı) — profile duyarsız dumanlar: açılış · uç kapıları · belge önizleme
// =============================================================================
// Matris koşucusu (`profil-matrisi.ts`) her profil için sunucuyu açar ve bunu koşar.
// Beklentiler profilden TÜRER (sabit sayı yok): modül kapısı haritası + profilin ayarları.
//   TEST_API_URL · DATABASE_URL (`_test`) · PM_PROFIL ortamdan ZORUNLU.
// Veri tutarlılığı (`test_db_invariants`) ve üretim akışı (`test_e2e_full_flow`) matris
// tarafından AYRI süreçlerde koşulur; bu dosya yalnız HTTP yüzünü ölçer.
// Çıktı: `✅/❌` satırları + son satır `Sonuç: N geçti, M başarısız` (koşucu okur).
// =============================================================================
import { beklenenModulDurumu, MODUL_SONDALARI } from "./lib/profil-kapi-haritasi";
import { profilOku } from "./lib/profil";

let gecti = 0;
let basarisiz = 0;
function kontrol(etiket: string, ok: boolean, ayrinti = ""): void {
  if (ok) {
    gecti++;
    console.log(`✅ ${etiket}${ayrinti ? ` — ${ayrinti}` : ""}`);
  } else {
    basarisiz++;
    console.error(`❌ ${etiket}${ayrinti ? ` — ${ayrinti}` : ""}`);
  }
}

interface Yanit { durum: number; govde: unknown; metin: string }

async function cagir(base: string, yol: string, token?: string, govde?: unknown): Promise<Yanit> {
  const r = await fetch(`${base}${yol}`, {
    method: govde === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(govde === undefined ? {} : { "Content-Type": "application/json" }) },
    body: govde === undefined ? undefined : JSON.stringify(govde),
    signal: AbortSignal.timeout(30_000),
  });
  const metin = await r.text();
  let j: unknown = null;
  try { j = JSON.parse(metin); } catch { /* html olabilir */ }
  return { durum: r.status, govde: j, metin };
}

const kod = (y: Yanit): string | undefined => (y.govde as { details?: { code?: string } } | null)?.details?.code;

async function main(): Promise<void> {
  const base = process.env.TEST_API_URL;
  const profilAdi = process.env.PM_PROFIL;
  if (!base || !profilAdi) {
    console.error("❌ TEST_API_URL ve PM_PROFIL ortamdan zorunlu.");
    process.exit(2);
  }
  const profil = profilOku(profilAdi);

  // ── 1. AÇILIŞ ──────────────────────────────────────────────────────────────
  const saglik = await cagir(base, "/health");
  kontrol("açılış: /health 200 + db UP", saglik.durum === 200 && (saglik.govde as { db?: string })?.db === "UP");
  const giris = await cagir(base, "/api/auth/login", undefined, { username: "admin", password: "123123", clientType: "electron" });
  const token = (giris.govde as { data?: { token?: string } } | null)?.data?.token;
  kontrol("açılış: admin girişi", giris.durum === 200 && !!token, `durum=${giris.durum}`);
  if (!token) {
    console.log(`\n=== Sonuç: ${gecti} geçti, ${basarisiz} başarısız ===`);
    process.exit(1);
  }
  const bayrak = await cagir(base, "/api/feature-flags", token);
  const alanlar = ((bayrak.govde as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
  kontrol("açılış: /api/feature-flags 200", bayrak.durum === 200);
  const sapma = Object.entries(profil.ayarlar).filter(([k, v]) => v !== null && JSON.stringify(alanlar[k]) !== JSON.stringify(v));
  kontrol(
    `açılış: profil ayarları sunucuda görünüyor (${Object.keys(profil.ayarlar).length} ayar)`,
    sapma.length === 0,
    sapma.slice(0, 5).map(([k, v]) => `${k}: beklenen ${JSON.stringify(v)} gelen ${JSON.stringify(alanlar[k])}`).join("; "),
  );

  // ── 2. UÇ KAPI MATRİSİ ─────────────────────────────────────────────────────
  for (const m of MODUL_SONDALARI) {
    // PM_SONDA=kapi-ters: koşucunun negatif sondası — ilk modülün beklentisi BİLEREK tersine çevrilir.
    const acik = beklenenModulDurumu(m.alan, profil.ayarlar) !== (process.env.PM_SONDA === "kapi-ters" && m === MODUL_SONDALARI[0]);
    for (const uc of m.uclar) {
      const y = await cagir(base, uc, token);
      const ok = acik ? y.durum >= 200 && y.durum < 300 : y.durum === 403 && kod(y) === "MODULE_DISABLED";
      kontrol(
        `kapı: ${m.alan} ${acik ? "AÇIK" : "KAPALI"} → GET ${uc}`,
        ok,
        ok ? `${y.durum}` : `beklenen ${acik ? "2xx" : "403 MODULE_DISABLED"}, gelen ${y.durum} ${kod(y) ?? ""}`,
      );
    }
  }

  // ── 3. BELGE / ETİKET ÖNİZLEME DUMANI ──────────────────────────────────────
  const { SAMPLE_PRINTED_DOCS } = await import("../src/services/document-render/sample-data");
  // TRAVELER_CARD'ın HTML'i printed-document yolunda değil; kendi uçtan (aşağıda) ölçülür.
  for (const docType of Object.keys(SAMPLE_PRINTED_DOCS).filter((d) => d !== "TRAVELER_CARD")) {
    const y = await cagir(base, `/api/printed-documents/${docType}/sample-html`, token, {});
    const html = y.metin.length > 200 && /<html|<!doctype|<div/i.test(y.metin);
    kontrol(`belge önizleme: ${docType}`, y.durum === 200 && html, `durum=${y.durum} uzunluk=${y.metin.length}`);
  }
  const kart = await cagir(base, "/api/traveler-cards/sample-html", token, {});
  kontrol("belge önizleme: refakat kartı", kart.durum === 200 && kart.metin.length > 200, `durum=${kart.durum}`);

  console.log(`\n=== Sonuç: ${gecti} geçti, ${basarisiz} başarısız ===`);
  process.exit(basarisiz === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`❌ P-takımı beklenmedik hata: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
