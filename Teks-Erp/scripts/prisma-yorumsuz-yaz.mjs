// =============================================================================
// PRISMA ŞEMA — YORUMSUZ KOPYA (korumalı paket, Faz 2b)
// =============================================================================
// Üretilmiş Prisma istemcisi şemanın 4.640 yorum satırını ÜÇ kanaldan taşır
// (2a ölçümü KOD-KORUMA-OLCUM.md §4): `.prisma/client/schema.prisma`,
// `index.js` inlineSchema, `index.d.ts` JSDoc; ayrıca paketteki `prisma/schema.prisma`
// dördüncü kanal. Korumalı paket bunları soyar: sahneye şemanın YORUMSUZ kopyası
// yazılır, `prisma generate` ondan çalışınca üretilmiş istemci de yorumsuz olur.
// Çalışma anı veri modeli BİREBİR aynıdır (2a: runtimeDataModel + migrate diff 0).
//
//   node scripts/prisma-yorumsuz-yaz.mjs <kaynak-schema> <hedef-schema>
//
// ÇIKIŞ: 0 tamam · 1 hata. Yorum sayısını (soyulan) STDOUT'a basar.
// =============================================================================

import fs from 'node:fs';

/** Satır sonu yorumunu dizge içindeki `//`i koruyarak keser. */
function stripLineComment(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i).trimEnd();
  }
  return line;
}

/** `//` ve `///` yorum satırlarını (dizge içi `//` korunur) soyar; boş satır yığılmaz. */
export function stripSchemaComments(src) {
  const out = [];
  for (const raw of src.split('\n')) {
    const line = stripLineComment(raw);
    if (line.trim() === '' && raw.trim() !== '') continue; // yalnız yorumdan ibaret satır
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function main() {
  const [kaynak, hedef] = process.argv.slice(2);
  if (!kaynak || !hedef) {
    console.error('Kullanım: node scripts/prisma-yorumsuz-yaz.mjs <kaynak-schema> <hedef-schema>');
    process.exit(1);
  }
  let ham;
  try {
    ham = fs.readFileSync(kaynak, 'utf8');
  } catch (e) {
    console.error(`kaynak şema okunamadı: ${e.message}`);
    process.exit(1);
  }
  const yorum = ham.split('\n').filter((l) => /^\s*\/\//.test(l)).length;
  const yorumsuz = stripSchemaComments(ham);
  const kalan = yorumsuz.split('\n').filter((l) => /^\s*\/\//.test(l)).length;
  if (kalan !== 0) {
    console.error(`YORUMSUZ KOPYADA HALA ${kalan} yorum satırı — soyma eksik, paket üretilmez.`);
    process.exit(1);
  }
  fs.writeFileSync(hedef, yorumsuz.endsWith('\n') ? yorumsuz : yorumsuz + '\n');
  console.log(`prisma şema yorumsuz kopya: ${yorum} yorum satırı soyuldu → ${hedef}`);
}

main();
