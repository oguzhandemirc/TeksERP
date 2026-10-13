// =============================================================================
// KORUMALI İMAJ — ARAÇLAR V8 BAYT KODUNA (G6; yalnız sahne.mjs çağırır, paketin runtime Node'uyla)
// =============================================================================
// Karartılmış araç bile okunur JS'tir (lisans/kimlik/sır yolları dahil). Her `dist/tools/<ad>.cjs`
// `<ad>.jsc`ye (bytenode) derlenir; `.cjs` küçük bir YÜKLEYİCİYE dönüşür → `node dist/tools/<ad>.cjs`
// sözleşmesi (entrypoint, yedek servisi, güncelleyici araçları) aynen kalır.
// Yükleyici `.jsc`yi ANA MODÜL olarak açar (bytenode require.main'i `process.main`den verir): araçların
// `require.main === module` kapısı tutar.
// `.jsc` V8'e kilitli → yükleyici sunucu yükleyicisiyle AYNI künye kapısını (../server-kunye.json) uygular.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';

/** Yükleyicinin her araçta aynı olan imi — imaj bekçisi (test_korumali_imaj K12) bunu arar. */
export const ARAC_YUKLEYICI_IMI = 'KORUMALI ARAÇ YÜKLEYİCİSİ';

export function aracYukleyicisi(ad) {
  return `"use strict";
// ${ARAC_YUKLEYICI_IMI} (G6) — arac-jsc.mjs üretir, ELLE DÜZENLENMEZ. Gövde ${ad}.jsc (V8 bayt kodu).
const fs = require("fs");
const path = require("path");
const Module = require("module");
function taban(v8) { var m = /^(\\d+\\.\\d+\\.\\d+\\.\\d+)/.exec(String(v8 || "")); return m ? m[1] : null; }
var kunye;
try {
  kunye = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server-kunye.json"), "utf8"));
} catch (e) {
  console.error("KORUMALI ARAÇ: server-kunye.json okunamadı — paket bozuk.", e && e.message);
  process.exit(78);
}
if (process.platform !== kunye.platform || process.arch !== kunye.arch || taban(process.versions.v8) !== kunye.v8Taban) {
  console.error("KORUMALI ARAÇ bu Node ile AÇILAMAZ (paket: " + kunye.platform + "/" + kunye.arch + " V8 " + kunye.v8Taban + "; bu: " + process.platform + "/" + process.arch + " V8 " + process.versions.v8 + "). Paketin kendi Node'uyla koşun.");
  process.exit(78);
}
require("bytenode");
// Ana modül olarak yükle: bytenode gövdeye require.main'i \`process.main\`den verir (araçların require.main === module kapısı).
var dosya = path.join(__dirname, ${JSON.stringify(`${ad}.jsc`)});
var ana = new Module(dosya, null);
ana.id = ".";
ana.filename = dosya;
ana.paths = Module._nodeModulePaths(__dirname);
process.main = ana;
Module._cache[dosya] = ana;
ana.load(dosya);
`;
}

/** `dizin`deki her `.cjs`yi `.jsc` + yükleyiciye çevirir; üretilen adları döner. */
export async function araclariJscYap(dizin, bytenode) {
  const adlar = [];
  for (const dosya of fs.readdirSync(dizin).filter((a) => a.endsWith('.cjs')).sort()) {
    const ad = dosya.slice(0, -4);
    const cjs = path.join(dizin, dosya);
    const jsc = path.join(dizin, `${ad}.jsc`);
    if (fs.readFileSync(cjs, 'utf8').includes(ARAC_YUKLEYICI_IMI)) throw new Error(`zaten yükleyici: ${dosya}`);
    fs.rmSync(jsc, { force: true });
    await bytenode.compileFile({ filename: cjs, output: jsc });
    if (!fs.existsSync(jsc) || fs.statSync(jsc).size === 0) throw new Error(`bytenode .jsc üretemedi: ${dosya}`);
    fs.writeFileSync(cjs, aracYukleyicisi(ad));
    adlar.push(ad);
  }
  return adlar;
}

// Doğrudan koşum (ölçüm/prova): node arac-jsc.mjs <tools-dizini> — bytenode o dizinin ağacından çözülür.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dizin = path.resolve(process.argv[2] || '');
  const { createRequire } = await import('node:module');
  const bytenode = createRequire(path.join(dizin, '_'))('bytenode');
  const adlar = await araclariJscYap(dizin, bytenode);
  console.log(`  ✓ ${adlar.length} araç .jsc: ${adlar.join(', ')}`);
}
