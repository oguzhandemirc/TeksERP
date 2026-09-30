#!/usr/bin/env node
// =============================================================================
// Senaryo T4 — GÖZLEM KİPİ SÜREKLİ ÖLÇÜM (testfabrika). Runbook: docs/ops/LISANS-DEVREYE-ALMA-TESTFABRIKA.md §8
// =============================================================================
// Aralıkla `/api/license/detay` + `/api/admin/health` (yalnız GET) okur, her örneği TSV'ye yazar ve özetler:
// yoklama başarı oranı, parmak izi kararı/etken maskesi kararlılığı, YANLIŞ POZİTİF (lisanslı kurulumda
// geçerlilik ≠ GECERLI · kademe ≠ NORMAL · gözlem sayacı artışı). Etkinleşmemiş kurulumun örneği ayrı sayılır, yanlış
// pozitif sayılmaz — gözlem etkinleştirmeden önce başlatılabilir. Bekleme kapısı DEĞİLDİR — faz ilerler, ölçüm sürer.
//
//   node deploy/lisans-devreye/t4-gozlem.mjs [--olc] --belirtec-dosyasi=~/.tekserp/testfabrika-gozlem.jwt
//        [--adres=http://100.70.47.46:4000] [--aralik-sn=300] [--sure-dk=1440] [--cikti=<tsv>]
//   node deploy/lisans-devreye/t4-gozlem.mjs --ozet=<tsv>        (ağsız: var olan ölçümü özetler)
//
// Varsayılan KURU: plan basar, ağa çıkmaz, dosya yazmaz. Belirteç dosyası (0600) HER örnekte yeniden okunur —
// süresi dolan belirteç koşumu durdurmadan yenilenir; okunamayan örnek ÖLÇÜLEMEDİ sayılır (hüküm yok).
// Çıkış: 0 UYUMLU · 1 yanlış pozitif (IHLAL) · 2 ölçülemeyen örnek var · 3 salt-okuma sözleşmesi · 64 kullanım.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as bekle } from 'node:timers/promises';
import { Ag, SozlesmeIhlali, belirtecOku, evYolu, kipOku } from './lib/ag.mjs';
import { ozet, ozetYaz, satirKur, tsvBaslik, tsvOku, tsvSatir } from './lib/gozlem.mjs';
import { VARSAYILAN } from './lib/ortak.mjs';

const arg = (argv, ad) => argv.find((a) => a.startsWith(`--${ad}=`))?.slice(ad.length + 3);
const CIKIS = { UYUMLU: 0, IHLAL: 1, OLCULEMEDI: 2 };

export async function main(argv) {
  const ozetDosyasi = arg(argv, 'ozet');
  if (ozetDosyasi) {
    const o = ozet(tsvOku(evYolu(ozetDosyasi)));
    console.log(ozetYaz(o));
    return CIKIS[o.sonuc];
  }
  const { olc } = kipOku(argv);
  const adres = arg(argv, 'adres') ?? VARSAYILAN.tpKok;
  const aralikSn = Number(arg(argv, 'aralik-sn') ?? 300);
  const sureDk = Number(arg(argv, 'sure-dk') ?? 1440);
  const belirtecDosyasi = arg(argv, 'belirtec-dosyasi');
  if (!Number.isInteger(aralikSn) || aralikSn < 30 || !Number.isInteger(sureDk) || sureDk < 1 || (olc && !belirtecDosyasi)) {
    console.error('Kullanım: --belirtec-dosyasi=<0600> [--aralik-sn>=30] [--sure-dk>=1] [--olc] | --ozet=<tsv>');
    return 64;
  }
  const damga = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const cikti = evYolu(arg(argv, 'cikti') ?? `~/.tekserp/testfabrika-t4/gozlem-${damga}.tsv`);
  const ornekSayisi = Math.max(1, Math.floor((sureDk * 60) / aralikSn));
  const ag = new Ag({ olc, zamanAsimiMs: 20_000 });

  if (!olc) {
    await ag.http(`${adres}/api/license/detay`, { belirtec: '(kuru)' });
    await ag.http(`${adres}/api/admin/health`, { belirtec: '(kuru)' });
    console.log(`▶ KURU — ağa çıkılmaz, dosya yazılmaz. Gerçek ölçüm: --olc\n  ${ornekSayisi} örnek × ${aralikSn} sn → ${cikti}`);
    for (const p of ag.plan) console.log(`  ${p}`);
    return 0;
  }

  fs.mkdirSync(path.dirname(cikti), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(cikti)) fs.writeFileSync(cikti, tsvBaslik(), { mode: 0o600 });
  console.log(`▶ T4 ölçüm: ${ornekSayisi} örnek × ${aralikSn} sn → ${cikti}`);
  for (let i = 0; i < ornekSayisi; i += 1) {
    let satir;
    try {
      const belirtec = belirtecOku(belirtecDosyasi);
      const detay = await ag.http(`${adres}/api/license/detay`, { belirtec });
      const saglik = await ag.http(`${adres}/api/admin/health`, { belirtec });
      satir = satirKur(new Date().toISOString(), detay, saglik);
    } catch (e) {
      if (e instanceof SozlesmeIhlali && !/belirteç/.test(e.message)) throw e;
      satir = satirKur(new Date().toISOString(), { durum: null, hata: e.message }, { durum: null });
    }
    fs.appendFileSync(cikti, tsvSatir(satir));
    console.log(`  ${satir.zaman} ${satir.durum}${satir.etkin === false ? ' ETKINLESMEMIS' : ''} ${satir.gecerlilik || satir.hata} ${satir.kademe} karar=${satir.karar} yoklama=${satir.sonBasari || '-'}`);
    if (i + 1 < ornekSayisi) await bekle(aralikSn * 1000);
  }
  const o = ozet(tsvOku(cikti));
  console.log(ozetYaz(o));
  return CIKIS[o.sonuc];
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
