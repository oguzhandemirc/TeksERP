#!/usr/bin/env node
// =============================================================================
// Lisans devreye alma (testfabrika) — AŞAMA DOĞRULAYICI. Runbook: docs/ops/LISANS-DEVREYE-ALMA-TESTFABRIKA.md
// =============================================================================
// Her aşamanın SALT-OKUMA ölçümü; hiçbir şeyi değiştirmez. Varsayılan KURU: ağa hiç çıkmaz, koşacağı ölçümleri
// basar (komutların salt-okuma sözleşmesi kuru kipte de denetlenir). Gerçek ölçüm yalnız `--olc` ile.
//
//   node deploy/lisans-devreye/asama-dogrula.mjs --asama=2 [--olc] [--satici-sha=<12>] [--backend-surum=<x>]
//        [--panel-surum=<x>] [--belirtec-dosyasi=~/.tekserp/testfabrika-gozlem.jwt] [--t4-tsv=<dosya>]
//        [--traefik-baslangic=<ISO önek>] [--vds-taban=<dizin>] [--satici-kok=<url>] [--tp-kok=<url>] [--portal-kok=<url>]
//        [--hak-sinif=<TEST|URETIM|…>] [--paket-kid=<önek>]   (üretim satıcısına geçişten sonra: URETIM · paket-2026)
//   --asama: 1..8 | hepsi (virgülle birden çok: --asama=1,2)
//
// Çıkış: 0 hepsi UYUMLU (ya da kuru plan) · 1 en az bir IHLAL (DUR) · 2 IHLAL yok ama ÖLÇÜLEMEDİ var ·
//        3 salt-okuma sözleşmesi ihlali (betik hatası; hiçbir şey koşulmadı) · 64 kullanım.
// =============================================================================
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ag, SozlesmeIhlali, belirtecOku, kipOku } from './lib/ag.mjs';
import { ASAMA_1, ASAMA_2 } from './lib/asamalar-a.mjs';
import { ASAMA_3, ASAMA_4, ASAMA_5 } from './lib/asamalar-b.mjs';
import { ASAMA_6, ASAMA_7, ASAMA_8 } from './lib/asamalar-c.mjs';
import { I, O, U, VARSAYILAN, birlestir, s } from './lib/ortak.mjs';

export const ASAMALAR = Object.freeze({ 1: ASAMA_1, 2: ASAMA_2, 3: ASAMA_3, 4: ASAMA_4, 5: ASAMA_5, 6: ASAMA_6, 7: ASAMA_7, 8: ASAMA_8 });
const BASLIK = {
  1: 'Önkoşullar ve kapılar', 2: 'VDS satıcı (lisans-test) A2 imajı', 3: 'Yayıncı anahtarı (Mac)', 4: 'testfabrika backend (korumalı)',
  5: 'Panel + tablet testfabrika kanalı', 6: 'Portal: müşteri → tesis → kurulum → HAK → kod', 7: 'Etkinleştirme (GÖZLEM)', 8: 'Senaryo T',
};

const arg = (argv, ad) => argv.find((a) => a.startsWith(`--${ad}=`))?.slice(ad.length + 3);

export function parametreler(argv) {
  const g = {
    ...VARSAYILAN,
    saticiKok: arg(argv, 'satici-kok') ?? VARSAYILAN.saticiKok,
    tpKok: arg(argv, 'tp-kok') ?? VARSAYILAN.tpKok,
    portalKok: arg(argv, 'portal-kok') ?? VARSAYILAN.portalKok,
    traefikBaslangic: arg(argv, 'traefik-baslangic') ?? VARSAYILAN.traefikBaslangic,
    vdsTaban: arg(argv, 'vds-taban') ?? VARSAYILAN.vdsTaban,
    saticiSha: arg(argv, 'satici-sha') ?? null,
    backendSurum: arg(argv, 'backend-surum') ?? null,
    panelSurum: arg(argv, 'panel-surum') ?? null,
    belirtecDosyasi: arg(argv, 'belirtec-dosyasi') ?? null,
    t4Tsv: arg(argv, 't4-tsv') ?? null,
    hakSinif: arg(argv, 'hak-sinif') ?? VARSAYILAN.hakSinif,
    paketKidOnek: arg(argv, 'paket-kid') ?? VARSAYILAN.paketKidOnek,
    belirtec: null,
  };
  const secim = arg(argv, 'asama');
  const asamalar = !secim ? [] : secim === 'hepsi' ? Object.keys(ASAMALAR) : secim.split(',');
  return { g, asamalar };
}

/** Tek kontrolü koşar; kuru kipte ağ kontrolü `PLAN` döner (sonuç sayılmaz). */
export async function kontrolKos(k, ag, g) {
  try {
    if (k.yerel && !ag.olc) {
      ag.plan.push('yerel (ağsız): dosya varlığı/izni + JSON anahtar adları — değer basılmaz');
      return { sonuc: 'PLAN', not: '' };
    }
    if (k.yerel) return k.yerel(g);
    const r = await k.kos(ag, g);
    if (r?.kuru) return { sonuc: 'PLAN', not: '' };
    return k.degerlendir(r, g);
  } catch (e) {
    if (e instanceof SozlesmeIhlali) throw e;
    return s(O, `koşum hatası: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function main(argv) {
  const { olc } = kipOku(argv);
  const { g, asamalar } = parametreler(argv);
  if (!asamalar.length || asamalar.some((a) => !ASAMALAR[a])) {
    console.error('Kullanım: --asama=1..8|hepsi [--olc] … (ayrıntı dosya başında)');
    return 64;
  }
  const ag = new Ag({ olc });
  if (olc && g.belirtecDosyasi) g.belirtec = belirtecOku(g.belirtecDosyasi);
  if (!olc) g.belirtec = '(kuru)';
  console.log(olc ? '▶ ÖLÇÜM (salt okuma)' : '▶ KURU — ağa çıkılmaz; koşulacak ölçümler aşağıda. Gerçek ölçüm: --olc');
  const tum = [];
  for (const a of asamalar) {
    console.log(`\n── Aşama ${a} · ${BASLIK[a]}`);
    for (const k of ASAMALAR[a]) {
      const sonuc = olc && k.bearer && !g.belirtec ? s(O, 'belirteç yok (--belirtec-dosyasi=<0600 dosya>)') : await kontrolKos(k, ag, g);
      if (sonuc.sonuc === 'PLAN') {
        console.log(`  ${k.no} ${k.ad}\n      ${ag.plan.pop()}`);
        continue;
      }
      tum.push(sonuc);
      const isaret = { [U]: '✅', [I]: '❌', [O]: '⚠️ ' }[sonuc.sonuc];
      console.log(`  ${isaret} ${k.no} ${k.ad}${sonuc.not ? `\n      ${sonuc.not}` : ''}`);
    }
  }
  if (!tum.length) return 0;
  const toplam = birlestir(tum);
  console.log(`\nSonuç: ${toplam.sonuc}${toplam.sonuc === I ? ' — DUR (runbook §9 durdurma koşulları)' : ''}`);
  return toplam.sonuc === U ? 0 : toplam.sonuc === I ? 1 : 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (kod) => process.exit(kod),
    (e) => {
      console.error(`⛔ ${e instanceof SozlesmeIhlali ? 'SALT-OKUMA SÖZLEŞMESİ: ' : ''}${e instanceof Error ? e.message : String(e)}`);
      process.exit(e instanceof SozlesmeIhlali ? 3 : 1);
    },
  );
}
