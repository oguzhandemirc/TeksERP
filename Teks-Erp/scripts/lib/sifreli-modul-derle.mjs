// Faz 2d — şifreli modül paketinin esbuild SINIRI (build-korumali.mjs + bekçi ORTAK kullanır).
//   modulPaketiDerle: modülün KENDİ dosyaları paketlenir; DISARIDA listesi gerçek dış bağımlılık kalır;
//     GERİ KALAN her içe aktarma (çekirdek src dosyası ya da npm paketi) `tekserp-host:<anahtar>` olur —
//     çalışma anında çekirdeğin AYNI örneğinden gelir (ikinci prisma/zod/express kopyası yok).
//   cekirdekEklentisi: çekirdek derlemesinde modülün giriş importunu şifreli kapıya çevirir ve
//     `tekserp:module-host` sanal modülünü (anahtar → çekirdekteki örnek) kurar.
import fs from 'node:fs';
import path from 'node:path';

export const HOST_ONEKI = 'tekserp-host:';

export function katalogOku(proj) {
  const k = JSON.parse(fs.readFileSync(path.join(proj, 'src/lib/license/sifreli-moduller.json'), 'utf8'));
  return k.paketler;
}

function srcAnahtari(proj, abs) {
  const rel = path.relative(path.join(proj, 'src'), abs).split(path.sep).join('/');
  return `src:${rel.replace(/\.(ts|js|json)$/, '')}`;
}

/** Modül paketini (düz CJS) üretir; ev sahibi anahtarlarını döndürür: anahtar → {tur:'src', yol} | {tur:'npm', ad}. */
export async function modulPaketiDerle({ esbuild, proj, giris, dosyalar, outfile, disarida, minify = true, target = 'node24' }) {
  const kendi = new Set(dosyalar.map((d) => path.join(proj, 'src', d)));
  const girisAbs = path.join(proj, 'src', giris);
  const ev = new Map();
  const eklenti = {
    name: 'tekserp-modul-siniri',
    setup(b) {
      b.onResolve({ filter: /.*/ }, async (a) => {
        if (a.kind === 'entry-point' || a.pluginData?.tekserpIc) return undefined;
        if (disarida.some((d) => a.path === d || a.path.startsWith(`${d}/`))) return { path: a.path, external: true };
        if (a.path.startsWith('node:')) return { path: a.path, external: true };
        const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, pluginData: { tekserpIc: true } });
        if (r.errors.length) return { errors: r.errors };
        if (kendi.has(r.path)) return { path: r.path };
        const yerel = r.path.startsWith(path.join(proj, 'src') + path.sep);
        const anahtar = yerel ? srcAnahtari(proj, r.path) : `npm:${a.path}`;
        ev.set(anahtar, yerel ? { tur: 'src', yol: r.path } : { tur: 'npm', ad: a.path });
        return { path: `${HOST_ONEKI}${anahtar}`, external: true };
      });
    },
  };
  const sonuc = await esbuild.build({
    entryPoints: [girisAbs],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target,
    minify,
    sourcemap: 'external',
    legalComments: 'none',
    logLevel: 'warning',
    metafile: true,
    absWorkingDir: proj,
    plugins: [eklenti],
  });
  const paketlenen = Object.keys(sonuc.metafile.inputs).map((i) => path.resolve(proj, i));
  const yabanci = paketlenen.filter((p) => !kendi.has(p));
  if (yabanci.length) throw new Error(`Şifreli modül sınırı delindi — pakete çekirdek dosyası girdi: ${yabanci.join(', ')}`);
  return { ev };
}

/** Çekirdek derlemesi eklentisi: giriş importu → kapı; `tekserp:module-host` → ev sahibi haritası. */
export function cekirdekEklentisi({ proj, paketler, ev }) {
  const girisler = new Map(paketler.map((p) => [path.join(proj, 'src', p.giris), p.paket]));
  const routerYolu = path.join(proj, 'src/lib/license/encrypted-module-router.ts');
  return {
    name: 'tekserp-sifreli-kapi',
    setup(b) {
      b.onResolve({ filter: /^tekserp:module-host$/ }, () => ({ path: 'ev-sahibi', namespace: 'tekserp-host' }));
      b.onLoad({ filter: /.*/, namespace: 'tekserp-host' }, () => {
        const satirlar = [...ev.entries()].map(([k, v]) => `  ${JSON.stringify(k)}: () => require(${JSON.stringify(v.tur === 'src' ? v.yol : v.ad)}),`);
        return { contents: `module.exports = {\n${satirlar.join('\n')}\n};\n`, loader: 'js', resolveDir: proj };
      });
      const adlar = paketler.map((p) => path.basename(p.giris).replace(/\.ts$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      b.onResolve({ filter: new RegExp(`(${adlar.join('|')})(\\.ts)?$`) }, async (a) => {
        if (a.pluginData?.tekserpIc || a.kind === 'entry-point') return undefined;
        const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, pluginData: { tekserpIc: true } });
        const paket = girisler.get(r.path);
        return paket ? { path: paket, namespace: 'tekserp-sifreli' } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: 'tekserp-sifreli' }, (a) => ({
        contents: `import { encryptedModuleRouter } from ${JSON.stringify(routerYolu)};\nexport default encryptedModuleRouter(${JSON.stringify(a.path)});\n`,
        loader: 'ts',
        resolveDir: path.join(proj, 'src'),
      }));
    },
  };
}
