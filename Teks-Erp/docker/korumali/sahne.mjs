// =============================================================================
// KORUMALI LINUX İMAJI — SAHNE KURUCUSU (Faz 2f; yalnız Dockerfile'ın `derle` aşamasında koşar)
// =============================================================================
// Çalışma imajına girecek ağacı `/sahne/app`te kurar; kaynak (src · tsx · seed .ts ·
// .map) SAHNEYE HİÇ GİRMEZ — imaj bekçisi (`scripts/test_korumali_imaj.mjs`) sonucu ölçer.
//   1. build-korumali (linux-x64 · native zorunlu) → dist/server.js (yükleyici) + server.jsc
//   2. build-araclar --korumali → dist/tools/*.cjs, ardından HER araç esbuild ile karartılır
//      (2b'nin --korumali bayrağı yoksa da `// src/...` yol yorumu pakete girmesin)
//   3. seed aracı (entrypoint §2'nin ilk kurulum seed'i) → dist/tools/seed.cjs, karartılmış
//   4. prisma (YORUMSUZ şema + migration SQL + üretim config'i) · public · assets · native
// Paketin RUNTIME Node'uyla koşar (V8 kilidi: .jsc onunla üretilir, onunla açılır).
//   node docker/korumali/sahne.mjs /sahne/app
// =============================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAHNE = path.resolve(process.argv[2] || '/sahne/app');
const NATIVE = 'lisans-cekirdek.linux-x64-gnu.node';
// build-araclar.mjs ile AYNI küme: çalışma anında prod node_modules'ten çözülür.
const DISARIDA = ['@prisma/client', '.prisma/client', '.prisma/client/default', 'prisma', 'bwip-js'];

function dur(msg) {
  console.error(`\n  ✖ SAHNE KURULAMADI: ${msg}\n`);
  process.exit(1);
}
function kos(args, env = {}) {
  console.log(`$ node ${args.join(' ')}`);
  execFileSync(process.execPath, args, { cwd: PROJ, stdio: 'inherit', env: { ...process.env, ...env } });
}
function kopyala(kaynak, hedef) {
  if (!fs.existsSync(kaynak)) dur(`kaynak yok: ${kaynak}`);
  fs.cpSync(kaynak, hedef, { recursive: true });
}

async function main() {
  fs.rmSync(SAHNE, { recursive: true, force: true });
  fs.mkdirSync(SAHNE, { recursive: true });
  const dist = path.join(SAHNE, 'dist');

  // --- 1. Sunucu: .jsc + yükleyici + künye -------------------------------------
  kos(['scripts/build-korumali.mjs', '--hedef=linux-x64', `--cikti=${dist}`]);
  const kunye = JSON.parse(fs.readFileSync(path.join(dist, 'server-kunye.json'), 'utf8'));
  if (!kunye.jscUretildi || !fs.existsSync(path.join(dist, 'server.jsc'))) dur('server.jsc üretilmedi (host linux/x64 değil mi?)');
  if (fs.existsSync(path.join(dist, 'server.cjs'))) dur('bytenode öncesi server.cjs sahnede kaldı');

  // --- 2. Araçlar: derle + karart ------------------------------------------------
  kos(['scripts/build-araclar.mjs', '--korumali']);
  const { build, transform } = await import('esbuild');
  const araclarDir = path.join(PROJ, 'dist', 'tools');
  const hedefTools = path.join(dist, 'tools');
  fs.mkdirSync(hedefTools, { recursive: true });
  for (const ad of fs.readdirSync(araclarDir)) {
    const kaynak = path.join(araclarDir, ad);
    if (!ad.endsWith('.cjs')) {
      fs.copyFileSync(kaynak, path.join(hedefTools, ad));
      continue;
    }
    const { code } = await transform(fs.readFileSync(kaynak, 'utf8'), {
      loader: 'js', format: 'cjs', platform: 'node', minify: true, legalComments: 'none',
    });
    fs.writeFileSync(path.join(hedefTools, ad), code);
  }

  // --- 3. İlk kurulum seed'i (entrypoint §2) ------------------------------------
  await build({
    entryPoints: [path.join(PROJ, 'prisma', 'seed.ts')],
    outfile: path.join(hedefTools, 'seed.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: `node${process.versions.node.split('.')[0]}`,
    packages: 'external', external: DISARIDA,
    minify: true, sourcemap: false, legalComments: 'none', logLevel: 'warning',
  });
  for (const ad of fs.readdirSync(hedefTools).filter((a) => a.endsWith('.cjs'))) {
    const metin = fs.readFileSync(path.join(hedefTools, ad), 'utf8');
    if (/^\s*\/\/ (src|scripts|prisma)\//m.test(metin)) dur(`araç karartılmamış (kaynak yol yorumu): tools/${ad}`);
  }

  // --- 4. Prisma · public · assets · package · native ----------------------------
  fs.mkdirSync(path.join(SAHNE, 'prisma'), { recursive: true });
  kos(['scripts/prisma-yorumsuz-yaz.mjs', 'prisma/schema.prisma', path.join(SAHNE, 'prisma', 'schema.prisma')]);
  kopyala(path.join(PROJ, 'prisma', 'migrations'), path.join(SAHNE, 'prisma', 'migrations'));
  kopyala(path.join(PROJ, 'deploy', 'prisma.config.prod.js'), path.join(SAHNE, 'prisma.config.js'));
  kopyala(path.join(PROJ, 'public'), path.join(SAHNE, 'public'));
  kopyala(path.join(PROJ, 'assets'), path.join(SAHNE, 'assets'));
  kopyala(path.join(PROJ, 'package.json'), path.join(SAHNE, 'package.json'));
  kopyala(path.join(PROJ, 'package-lock.json'), path.join(SAHNE, 'package-lock.json'));
  fs.mkdirSync(path.join(SAHNE, 'native'), { recursive: true });
  kopyala(path.join(PROJ, 'native', 'lisans-cekirdek', 'dist-uretim', NATIVE), path.join(SAHNE, 'native', NATIVE));

  // --- Kapı: sahnede kaynak/harita yok ------------------------------------------
  const yasak = [];
  const yuru = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) yuru(p);
      else if (/\.(ts|map|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) yasak.push(path.relative(SAHNE, p));
    }
  };
  yuru(SAHNE);
  if (yasak.length) dur(`sahnede kaynak/harita: ${yasak.slice(0, 5).join(', ')}`);
  const mig = fs.readdirSync(path.join(SAHNE, 'prisma', 'migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  console.log(`\n  ✓ sahne: ${SAHNE} · server.jsc ${(kunye.jscBayt / 1024).toFixed(0)} KB · V8 ${kunye.v8Taban} · araç ${fs.readdirSync(hedefTools).length} · migration ${mig} · native ${NATIVE}`);
}

main().catch((e) => dur(e && e.stack ? e.stack : String(e)));
