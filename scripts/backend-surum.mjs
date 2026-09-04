// =============================================================================
// Backend surum numarasi — paketleme aninda YAMA hanesini artirir
// =============================================================================
// Panel ve tablet 2026-09-02'den beri yama hanesini otomatik artiriyor; backend
// artirmiyordu ve `package.json` aylardir 2.9.0'da sabit kalmisti. Sonucu:
// "sunucuda hangi surum var" sorusunun tek cevabi commit kisaltmasiydi
// (`/health` de 2.9.0 basiyordu, yani her kurulumda ayni).
//
// TABAN GIT ETIKETI (`backend-v*`) — panel/tablet ile ayni gerekce:
// numara KODA aittir. Yerel dosyadan okunsaydi komutun her kosumu numarayi
// atlatirdi (paketleme bir turda birden cok kez kosar: agac kirli, derleme
// duser).
//
// ⚠️ ILK KOSUM: `backend-v*` etiketi HIC YOKKEN taban `package.json`dur.
// Aksi halde numara sifirdan baslar ve sahadaki 2.9.0'in GERISINE duserdi.
//
// ⚠️ YAYIN SUNUCUSU KIYASI YOK — backend'in yayin kanali yok, paket elden
// tasiniyor. Panel/tablette o kiyas "etiket defteri bayat mi" sorusunu
// cevapliyordu; burada sorunun karsiligi yok. Etiket TEK kaynak.
//
// Kullanim:
//   node scripts/backend-surum.mjs           -> sonraki surumu YAZDIRIR
//   node scripts/backend-surum.mjs --uygula  -> package.json'a YAZAR
//   node scripts/backend-surum.mjs --etiketle <surum>  -> backend-v<surum>
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sonrakiSurumEtiketten, yamaArtir, etiketAt } from './lib/surum.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(KOK, 'Teks-Erp', 'package.json');

function paketSurumu() {
  return JSON.parse(fs.readFileSync(PKG, 'utf8')).version;
}

export function sonrakiBackendSurumu() {
  const k = sonrakiSurumEtiketten('backend');
  if (k.surum) return k;
  // Etiket yok -> taban package.json (yukaridaki "ilk kosum" gerekcesi).
  const yeni = yamaArtir(paketSurumu());
  return { surum: yeni, artti: true, gerekce: `etiket yok — package.json ${paketSurumu()} → ${yeni}` };
}

const argv = process.argv.slice(2);
if (argv.includes('--etiketle')) {
  const s = argv[argv.indexOf('--etiketle') + 1];
  if (!s) { console.error('surum verilmedi'); process.exit(1); }
  const r = etiketAt('backend', s);
  console.log(r?.mesaj ?? `backend-v${s}`);
} else {
  const k = sonrakiBackendSurumu();
  if (!k.surum) { console.error(k.gerekce); process.exit(1); }
  const elle = argv.includes('--surum') ? argv[argv.indexOf('--surum') + 1] : null;
  if (elle) k.surum = elle;
  if (argv.includes('--uygula')) {
    const ham = fs.readFileSync(PKG, 'utf8');
    const yeni = ham.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${k.surum}"`);
    if (yeni === ham) { console.error('package.json > version yazilamadi'); process.exit(1); }
    fs.writeFileSync(PKG, yeni);
  }
  console.log(k.surum);
  if (process.env.BACKEND_SURUM_GEREKCE) console.error(k.gerekce);
}
