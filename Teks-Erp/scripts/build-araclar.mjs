// =============================================================================
// Sunucu araclari - tek dosyalik, platformdan BAGIMSIZ derleme
// =============================================================================
// NEDEN VAR (2026-09-04 ev provasi, BULGU-2): `npm run superadmin:kur` sahadaki
// pakette CALISMIYORDU. Komut `tsx scripts/superadmin-olustur.ts` idi; pakette
// ne `scripts/` klasoru ne de `tsx` vardi (`npm ci --omit=dev` tsx'i eler).
// Satici hesabinin TEK dogus yolu bu script oldugu icin kurulum hesapsiz
// kaliyordu ve runbook, paketin saglayamadigi bir adimi zorunlu tutuyordu.
//
// NEDEN TSX'I PAKETE KOYMUYORUZ: tsx, esbuild'in PLATFORMA OZGU ikilisini
// tasir (`@esbuild/darwin-arm64` vs `@esbuild/win32-x64`). macOS'ta uretilen
// paket Windows'ta calismazdi - yani duzeltmeye calistigimiz hatanin aynisi.
// Duz JS ciktisi platformdan bagimsizdir (Prisma 7'nin WASM derleyicisi gibi).
//
// NEDEN `src/` ALTINA TASIMIYORUZ: `test_superadmin_hidden_single_source §6`
// `isSystemAccount` YAZAN kodun `src/` agacinda olmamasini sart kosuyor. Sebep
// bicimsel degil: `src/` altindaki her sey sunucu paketine girer ve bir route'a
// baglanabilir hale gelir. Yazici disarida kalirsa ikinci bir dogus yolu
// KAZAYLA acilamaz. Bu derleme o ozelligi korur - cikti ayri bir dosyadir ve
// `dist/server.js` onu HIC import etmez.
// =============================================================================
import { build } from "esbuild";
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ARACLAR = [
  { giris: "scripts/superadmin-olustur.ts", cikti: "dist/tools/superadmin-olustur.cjs" },
  // Yayin gunu veri adimlari: pakette `scripts/` ve `tsx` yok, sunucuda internet olmayabilir.
  // Son taslagin YAYIN GUNU bolumunde adi gecen her betik burada olmali (test_sunucu_betikleri §5).
  // bkz. arsiv 2026-09-27 thinkpad-1 provasi (ayri arac paketi neden secilmedi).
  { giris: "scripts/backfill_roll_status_events.ts", cikti: "dist/tools/backfill_roll_status_events.cjs" },
  { giris: "scripts/backfill_roll_fold_and_reason.ts", cikti: "dist/tools/backfill_roll_fold_and_reason.cjs" },
  { giris: "scripts/fix_tambur_undo_cancel_marker.ts", cikti: "dist/tools/fix_tambur_undo_cancel_marker.cjs" },
  { giris: "scripts/backfill_workorder_events.ts", cikti: "dist/tools/backfill_workorder_events.cjs" },
  { giris: "scripts/kartela_durum_anomali.ts", cikti: "dist/tools/kartela_durum_anomali.cjs" },
  // Yedek sifreleme (.tkenc): yedekle.ps1, kur.ps1 ve panelin geri yukleme komutu bunu cagirir.
  // Yalniz node:crypto kullanir - paketlenmis sunucuda node_modules olmadan da kosar.
  { giris: "scripts/yedek-sifrele.ts", cikti: "dist/tools/yedek-sifrele.cjs" },
];

// Calisma aninda node_modules'ten cozulecekler. Hepsi URETIM bagimliligidir
// (`npm ci --omit=dev` sonrasi da durur) ve platformdan bagimsizdir.
const DISARIDA = ["@prisma/client", ".prisma/client", ".prisma/client/default", "prisma", "bwip-js"];

for (const arac of ARACLAR) {
  const giris = path.join(kok, arac.giris);
  if (!existsSync(giris)) {
    console.error(`X Arac kaynagi yok: ${arac.giris}`);
    process.exit(1);
  }
  await build({
    entryPoints: [giris],
    outfile: path.join(kok, arac.cikti),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: DISARIDA,
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
  });
  const kb = (statSync(path.join(kok, arac.cikti)).size / 1024).toFixed(0);
  console.log(`  + ${arac.cikti}  (${kb} KB)`);
}

// Tek liste: `paketle.ps1` her aracin pakette oldugunu bundan dogrular ve PAKET.json'a
// yazar; PowerShell'de ikinci bir kopya ayrisirdi.
writeFileSync(
  path.join(kok, "dist", "tools", "araclar.json"),
  JSON.stringify(ARACLAR.map((a) => ({ ad: path.basename(a.cikti, ".cjs"), dosya: a.cikti.replace(/^dist\//, "") })), null, 2) + "\n",
);
