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
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ARACLAR = [
  { giris: "scripts/superadmin-olustur.ts", cikti: "dist/tools/superadmin-olustur.cjs" },
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
