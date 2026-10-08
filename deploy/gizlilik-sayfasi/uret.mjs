#!/usr/bin/env node
// Gizlilik sayfası üreticisi — docs/legal/GIZLILIK-POLITIKASI.md (tek kaynak) → html/gizlilik.html. Paket yok.
// Kaynağın baştaki `>` iç notu sayfaya GİRMEZ. Desteklenen alt küme: #, ##, "- " madde (2 boşluk devam),
// paragraf, **kalın**, `kod`, https bağlantısı, e-posta (email_off içinde). Başka biçim → hata (sessiz bozulma yerine).
//   node deploy/gizlilik-sayfasi/uret.mjs            # html'i yaz
//   node deploy/gizlilik-sayfasi/uret.mjs --denetle  # yazma; fark varsa 1

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const KAYNAK_REL = 'docs/legal/GIZLILIK-POLITIKASI.md';
export const HTML_REL = 'deploy/gizlilik-sayfasi/html/gizlilik.html';

const kacis = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function satirIci(ham) {
  let s = kacis(ham);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/https:\/\/[^\s<]*[^\s<.,;:)]/g, (u) => `<a href="${u}">${u}</a>`);
  // Cloudflare e-posta karartması adresi çözücü betiğe bağlar; CSP betiği engeller → adres görünmez. email_off onu kapatır.
  s = s.replace(/(^|[\s(])([a-z0-9._-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi, '$1<!--email_off--><a href="mailto:$2">$2</a><!--/email_off-->');
  return s;
}

const IZIN = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };
/** "8. Hesaplar ve silme" → "hesaplar-ve-silme" (Play formundaki `#hesaplar-ve-silme` bağı buna dayanır). */
export function capa(baslik) {
  return baslik.replace(/^\d+\.\s*/, '').toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, (h) => IZIN[h])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Saf çeviri: markdown metni → tam HTML belgesi. */
export function uret(md) {
  const satirlar = md.replace(/\r\n/g, '\n').split('\n');
  const govde = [];
  const capalar = new Set();
  let baslik = null;
  let i = 0;
  const bos = (x) => x === undefined || x.trim() === '';
  while (i < satirlar.length) {
    const s = satirlar[i];
    if (bos(s)) { i++; continue; }
    if (s.startsWith('> ') || s === '>') {
      if (govde.length > 1) throw new Error(`satır ${i + 1}: alıntı yalnız baştaki iç notta olabilir`);
      i++;
      continue;
    }
    if (s.startsWith('# ')) {
      if (baslik !== null) throw new Error(`satır ${i + 1}: ikinci # başlık`);
      baslik = s.slice(2).trim();
      govde.push(`<h1>${satirIci(baslik)}</h1>`);
      i++;
      continue;
    }
    if (s.startsWith('## ')) {
      const b = s.slice(3).trim();
      const id = capa(b);
      if (!id || capalar.has(id)) throw new Error(`satır ${i + 1}: başlıktan tekil çapa çıkmadı (${id})`);
      capalar.add(id);
      govde.push(`<h2 id="${id}">${satirIci(b)}</h2>`);
      i++;
      continue;
    }
    if (s.startsWith('- ')) {
      const maddeler = [];
      while (i < satirlar.length && satirlar[i].startsWith('- ')) {
        let m = satirlar[i].slice(2).trim();
        i++;
        while (i < satirlar.length && /^ {2}\S/.test(satirlar[i])) { m += ` ${satirlar[i].trim()}`; i++; }
        maddeler.push(`  <li>${satirIci(m)}</li>`);
      }
      govde.push(`<ul>\n${maddeler.join('\n')}\n</ul>`);
      continue;
    }
    if (/^(#{3,}|\s|\d+\.\s|\*\s|\||```)/.test(s)) throw new Error(`satır ${i + 1}: desteklenmeyen biçim: ${s.slice(0, 40)}`);
    const p = [];
    while (i < satirlar.length && !bos(satirlar[i]) && !/^(#|- |>)/.test(satirlar[i])) {
      const t = satirIci(satirlar[i].trim());
      // Künye satırları (**Etiket:** değer) ayrı satırda kalır; düz satırlar paragrafa katılır.
      p.push(p.length === 0 ? t : satirlar[i].startsWith('**') ? `<br>\n${t}` : ` ${t}`);
      i++;
    }
    govde.push(`<p>${p.join('')}</p>`);
  }
  if (baslik === null) throw new Error('# başlık yok');
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${kacis(baslik)}</title>
<style>
body { margin: 0; background: #f6f7f9; color: #1d2330; font: 16px/1.6 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 18px 48px; background: #fff; }
h1 { font-size: 1.6em; line-height: 1.3; margin: 0.4em 0 0.8em; }
h2 { font-size: 1.15em; margin: 1.8em 0 0.5em; padding-top: 0.6em; border-top: 1px solid #e3e6eb; }
ul { padding-left: 1.3em; }
li { margin: 0.35em 0; }
code { font-size: 0.92em; background: #eef0f3; padding: 0 4px; border-radius: 3px; word-break: break-all; }
a { color: #1a56b0; word-break: break-word; }
</style>
</head>
<body>
<main>
${govde.join('\n')}
</main>
</body>
</html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = uret(fs.readFileSync(path.join(KOK, KAYNAK_REL), 'utf8'));
  const hedef = path.join(KOK, HTML_REL);
  if (process.argv.includes('--denetle')) {
    const var_ = fs.existsSync(hedef) ? fs.readFileSync(hedef, 'utf8') : null;
    if (var_ !== html) { console.log(`❌ ${HTML_REL} kaynaktan üretilenle aynı değil — node deploy/gizlilik-sayfasi/uret.mjs`); process.exit(1); }
    console.log(`✅ ${HTML_REL} kaynakla bayt-eşit`);
  } else {
    fs.writeFileSync(hedef, html);
    console.log(`yazıldı: ${HTML_REL}`);
  }
}
