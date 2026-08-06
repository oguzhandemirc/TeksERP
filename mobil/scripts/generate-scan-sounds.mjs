#!/usr/bin/env node
// =============================================================================
// Okutma geri bildirim sesleri — üretici
// =============================================================================
// `assets/sounds/scan-*.wav` dosyalarını buradan ÜRETİYORUZ, indirmiyoruz:
// depoya kaynağı bilinmeyen ses dosyası koymak, tonu değiştirmek gerektiğinde
// (sahada "ret sesi kabul sesine benziyor" denirse) elde düzenlenemeyen bir
// binary bırakır. Tonlar burada sayı olarak durur ve tekrar üretilebilir.
//
//   node scripts/generate-scan-sounds.mjs
//
// Ton seçimi endüstriyel el terminali geleneğini izler:
//   • KABUL    — tek, kısa, TİZ bip. "Okundu" evrensel işareti.
//   • MÜKERRER — orta perdeden ÇİFT bip. "Okudum ama zaten vardı" — kabulden
//                ayrışması gerekir, yoksa operatör topu iki kez saydığını sanır.
//   • RET      — PES ve uzun. Alçalan iki ton; gürültülü fabrikada tizle
//                karışmaz ve "bir şey ters gitti" sezgisi kültürel olarak pes
//                seslere bağlıdır.
// Süreler bilerek kısa: seri okutmada ses, okumanın kendisinden uzun sürmemeli.
// =============================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

/** [frekans Hz, süre ms] dizisi → mono 16-bit PCM. 0 Hz = sessizlik. */
function renderTones(segments, { volume = 0.55 } = {}) {
  const samples = [];
  for (const [freq, ms] of segments) {
    const n = Math.round((SAMPLE_RATE * ms) / 1000);
    // Kenar yumuşatma (5 ms): sert kesim hoparlörde "tık" üretir ve operatör
    // bunu ikinci bir sinyal sanar.
    const fade = Math.min(Math.round(SAMPLE_RATE * 0.005), Math.floor(n / 2));
    for (let i = 0; i < n; i++) {
      if (freq === 0) {
        samples.push(0);
        continue;
      }
      let a = volume * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
      if (i < fade) a *= i / fade;
      else if (i > n - fade) a *= (n - i) / fade;
      samples.push(Math.max(-1, Math.min(1, a)));
    }
  }
  // Buffer YERİNE Uint8Array/DataView — `Buffer` Node'a özgü bir global ve
  // projenin eslint yapılandırmasında tanımlı değil; standart tiplerle yazınca
  // betik ek yapılandırma istemeden temiz geçiyor.
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, Math.round(s * 32767), true));
  return pcm;
}

function wav(pcm) {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk boyu
  v.setUint16(20, 1, true); // format = PCM
  v.setUint16(22, 1, true); // kanal = mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true); // byte/sn
  v.setUint16(32, 2, true); // blok hizası
  v.setUint16(34, 16, true); // bit derinliği
  ascii(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

const SOUNDS = {
  'scan-accept': [[2000, 85]],
  'scan-duplicate': [
    [1150, 65],
    [0, 55],
    [1150, 65],
  ],
  'scan-reject': [
    [420, 150],
    [300, 190],
  ],
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, segments] of Object.entries(SOUNDS)) {
  const buf = wav(renderTones(segments));
  const file = join(OUT_DIR, `${name}.wav`);
  writeFileSync(file, buf);
  console.log(`${name}.wav — ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log(`\n→ ${OUT_DIR}`);
