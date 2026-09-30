// =============================================================================
// BEKÇİ — GİRİŞ ÖNCESİ K5 (yönetici kararı d) + PANELİN K5 YÜZEYİ
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_k5_giris   (kendi _test DB'si; yalnız
// okur — login-methods ayarları; motor bellekte kurulur, geçici lisans dizini silinir)
//
// NE ÖLÇER:
//   §1 `isSuspendedBeforeLogin` doğruluk tablosu: yalnız zorla ∧ UYGULANAN DURDURULMUŞ → true;
//      gözlemde (hesaplanan K5 olsa da) · K4 · normal · motor hazır değil → false.
//   §2 `GET /api/auth/login-methods` (gerçek denetleyici): `lisansDurduruldu` BOOLEAN ve kimliksize
//      verilen TEK lisans bilgisi — yanıt anahtarları beyanlı kümenin dışına çıkmaz (kademe, gün,
//      modül, lisans no sızmaz).
//   §3 ⭐ Panelin K5 yüzeyi (App kökü + oturum-dışı router + "verilerimi al" sayfası) statik
//      taranır (`lib/panel-k5-cagrilari.ts`): çağırabildiği her `/api` ucu DURDURULMUŞ kademede
//      AÇIK olmalı — aksi hâlde K5 ekranı 403'le kırılır. Dışlanan her dal kanıt deseni taşır.
//   §4 kalıcı sondalar (✓K): yanıt denetçisi sızan anahtarı ve eksik sinyali yakalar; tarayıcı
//      dışlanan kabuğu (AppShell) giriş verince K5'te kapalı uç BULUR (körlük zemini).
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuthController } from "../src/controllers/auth.controller";
import { isSuspendedBeforeLogin } from "../src/services/license-view.service";
import { isOpenInTier } from "../src/constants/license-routes";
import { lisansHazirDegil, lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { REPO, k5CagrilariniTara, type K5Dislama, type K5Giris, type PanelCagrisi } from "./lib/panel-k5-cagrilari";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

/** Kimliksize açık login-methods yanıtının BEYANLI anahtarları; yeni anahtar bilinçli karar ister. */
const LOGIN_METHODS_KEYS = new Set(["enabled", "primary", "companyName", "lisansDurduruldu"]);

function yanitDenetle(data: Record<string, unknown>, beklenen: boolean): string[] {
  const hata: string[] = [];
  const fazla = Object.keys(data).filter((k) => !LOGIN_METHODS_KEYS.has(k));
  if (fazla.length) hata.push(`beyansız anahtar: ${fazla.join(",")}`);
  if (typeof data.lisansDurduruldu !== "boolean") hata.push("lisansDurduruldu boolean değil");
  else if (data.lisansDurduruldu !== beklenen) hata.push(`lisansDurduruldu=${String(data.lisansDurduruldu)} (beklenen ${beklenen})`);
  return hata;
}

async function loginMethods(): Promise<{ status: number; data: Record<string, unknown> }> {
  let status = 0;
  let body: { data?: Record<string, unknown> } = {};
  const res = {
    status(s: number) {
      status = s;
      return this;
    },
    json(b: { data?: Record<string, unknown> }) {
      body = b;
      return this;
    },
  } as unknown as Response;
  let hata: unknown = null;
  await AuthController.loginMethods({} as Request, res, ((e?: unknown) => (hata = e ?? null)) as NextFunction);
  if (hata) throw hata;
  return { status, data: body.data ?? {} };
}

async function girisSinyali(): Promise<void> {
  console.log("\n§1–§2 — giriş öncesi K5 sinyali");
  const durumlar = [
    { ad: "zorla + K5", kip: { zorlama: true, kademe: "K5" as const }, beklenen: true },
    { ad: "gözlem + K5 (hesaplanan DURDURULMUŞ, uygulanan NORMAL)", kip: { zorlama: false, kademe: "K5" as const }, beklenen: false },
    { ad: "zorla + K4", kip: { zorlama: true, kademe: "K4" as const }, beklenen: false },
    { ad: "zorla + normal", kip: { zorlama: true, kademe: null }, beklenen: false },
  ];
  for (const d of durumlar) {
    lisansKipKur(d.kip);
    check(`§1 ${d.ad} → ${d.beklenen}`, isSuspendedBeforeLogin() === d.beklenen);
    const r = await loginMethods();
    const hata = yanitDenetle(r.data, d.beklenen);
    check(`§2 ${d.ad}: login-methods 200, yalnız beyanlı anahtarlar, sinyal ${d.beklenen}`, r.status === 200 && hata.length === 0, hata.join(" · "));
  }
  lisansHazirDegil();
  check("§1 motor hazır değil → false (lisans belirsizliği girişi kapatmaz)", isSuspendedBeforeLogin() === false);
}

/** K5'te panelin gerçekten bağladığı yüzey: App kökü; bağlanmayan dallar kanıtla dışlanır. */
const GIRISLER: K5Giris[] = [{ dosya: "Electron/src/App.tsx", ad: "App" }];
const APP = "Electron/src/App.tsx";
const DISLAMALAR: K5Dislama[] = [
  { dosya: "Electron/src/components/layout/AppShell.tsx", ad: "AppShell", gerekce: "K5'te kabuk bağlanmaz (Root: oturum-dışı ⊇ K5)", kanit: { dosya: APP, desen: /const oturumDisi = [^;]*licenseSuspended;/ } },
  { dosya: "Electron/src/components/layout/BossShell.tsx", ad: "BossShell", gerekce: "patron kabuğu da yalnız oturum-içi dalda", kanit: { dosya: APP, desen: /if \(oturumDisi\) \{\s*kabuk = <RouterProvider router=\{authRouter\} \/>;/ } },
  { dosya: "Electron/src/components/layout/LicenseLockGate.tsx", ad: "LicenseLockGate", gerekce: "kısıtlı kip kilidi oturum-dışında çizilmez", kanit: { dosya: APP, desen: /\{!oturumDisi && <LicenseLockGate \/>\}/ } },
  { dosya: APP, ad: "FactoryTimezoneLoader", gerekce: "fabrika saat dilimi bayrak ucundan yalnız oturum-içi dalda yüklenir (K5'te varsayılan dilim)", kanit: { dosya: APP, desen: /\{!oturumDisi && <FactoryTimezoneLoader \/>\}/ } },
  { dosya: APP, ad: "ScanSeriesLoader", gerekce: "okutma seri tablosu K5'te yüklenmez", kanit: { dosya: APP, desen: /if \(!userId \|\| suspended\) return;/ } },
  { dosya: "Electron/src/providers/PreferencesProvider.tsx", ad: "PreferencesProvider", gerekce: "tercih sorgusu K5'te kapalı; kayıt yalnız ayar ekranlarından (kabuk)", kanit: { dosya: "Electron/src/providers/PreferencesProvider.tsx", desen: /const enabled = hydrated && !!user && !licenseSuspended;/ } },
];

const ornekYol = (yol: string): string => yol.replace(/:p/g, "ornek");
const kapali = (cagrilar: readonly PanelCagrisi[]): PanelCagrisi[] =>
  cagrilar.filter((c) => !isOpenInTier("DURDURULMUS", c.yontem, ornekYol(c.yol)));

function panelYuzeyi(): void {
  console.log("\n§3 — panelin K5 yüzeyi (statik tarama)");
  if (!existsSync(path.join(REPO, APP))) {
    console.log("⏭ Electron kaynağı yok — K5 yüzeyi ÖLÇÜLMEDİ (yokluk 'uyumlu' sayılmaz)");
    fail++;
    return;
  }
  for (const x of DISLAMALAR) {
    const metin = readFileSync(path.join(REPO, x.kanit.dosya), "utf8");
    check(`§3a dışlama kanıtı: ${x.ad} — ${x.gerekce}`, x.kanit.desen.test(metin), `${x.kanit.dosya} ${x.kanit.desen}`);
  }
  const t = k5CagrilariniTara(GIRISLER, DISLAMALAR);
  check("§3b körlük zemini: ≥ 300 dosya, ≥ 200 düğüm, ≥ 8 uç", t.dosyaSayisi >= 300 && t.taranan >= 200 && t.cagrilar.length >= 8, `${t.dosyaSayisi}/${t.taranan}/${t.cagrilar.length}`);
  check("§3c giriş/dışlama adlarının hepsi bulundu", t.bulunamayan.length === 0, t.bulunamayan.join(" | "));
  check("§3d yolu çıkarılamayan HTTP çağrısı yok", t.cozulemeyen.length === 0, t.cozulemeyen.join(" | "));
  const ihlal = kapali(t.cagrilar);
  check("§3e ⭐ K5 yüzeyinin çağırdığı her uç DURDURULMUŞ'ta açık", ihlal.length === 0, ihlal.map((c) => `${c.yontem} ${c.yol} @ ${c.yer}`).join(" | "));
  const gerekli = ["GET /api/license/durum", "GET /api/license/veri-disari", "POST /api/admin/backup", "GET /api/auth/me"];
  const gorulen = new Set(t.cagrilar.map((c) => `${c.yontem} ${c.yol}`));
  const eksik = gerekli.filter((g) => !gorulen.has(g));
  check("§3f 'verilerimi al' sayfasının uçları taramada görünüyor (tarayıcı kör değil)", eksik.length === 0, eksik.join(", "));
}

function sondalar(): void {
  console.log("\n§4 — kalıcı sondalar (✓K)");
  check("✓K1 sızan anahtar yakalanır", yanitDenetle({ enabled: [], primary: "list", lisansDurduruldu: true, kademe: "DURDURULMUS" }, true).length > 0);
  check("✓K2 eksik/yanlış tip sinyal yakalanır", yanitDenetle({ enabled: [], primary: "list" }, false).length > 0 && yanitDenetle({ lisansDurduruldu: "true" }, true).length > 0);
  check("✓K3 doğru yanıtta susar", yanitDenetle({ enabled: [], primary: "list", companyName: "X", lisansDurduruldu: false }, false).length === 0);
  if (!existsSync(path.join(REPO, APP))) return;
  const kabuk = k5CagrilariniTara([{ dosya: "Electron/src/components/layout/AppShell.tsx", ad: "AppShell" }], []);
  check("✓K4 dışlanan kabuk taranınca K5'te KAPALI uç bulunur (dışlama gerçekten bir şey dışlıyor)", kapali(kabuk.cagrilar).length > 0, `${kapali(kabuk.cagrilar).length} kapalı uç`);
}

async function main(): Promise<void> {
  console.log("=== Giriş öncesi K5 + panelin K5 yüzeyi ===");
  try {
    await girisSinyali();
  } finally {
    temizleLisansKipDizini();
  }
  panelYuzeyi();
  sondalar();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
