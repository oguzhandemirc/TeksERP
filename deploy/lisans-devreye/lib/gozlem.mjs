// T4 sürekli gözlem: örnek satırı (/api/license/detay + /api/admin/health lisans bloğu) ve TSV özeti.
// Özet AĞSIZDIR (dosyadan) — bekçi aynı fonksiyonu sahte satırlarla ölçer.
import fs from 'node:fs';

export const KOLONLAR = Object.freeze(['zaman', 'durum', 'hata', 'etkin', 'kip', 'gecerlilik', 'kademe', 'nedenler', 'sonDeneme', 'sonBasari',
  'sonHataKodu', 'karar', 'eslesen', 'olculebilen', 'olculen', 'reddedilecekIstek', 'reddedilecekModul', 'butunluk', 'cekirdek', 'zil']);

const temiz = (v) => (v === null || v === undefined ? '' : String(v).replace(/[\t\r\n]/g, ' '));

/** Bir örnek: iki yanıttan satır; biri ölçülemediyse satır OLCULEMEDI (hüküm yok, sayı düşmez). */
export function satirKur(zaman, detayR, saglikR) {
  const bos = Object.fromEntries(KOLONLAR.map((k) => [k, '']));
  const hataAl = (r, ad) => (r.durum === 200 ? null : `${ad}:${r.durum ?? r.hata ?? '?'}`);
  const hata = [hataAl(detayR, 'detay'), hataAl(saglikR, 'saglik')].filter(Boolean).join(' ');
  if (hata) return { ...bos, zaman, durum: 'OLCULEMEDI', hata };
  const d = detayR.json?.data ?? {};
  const l = saglikR.json?.license ?? saglikR.json?.data?.license ?? {};
  const fp = d.parmakIzi ?? {};
  const y = d.yoklama ?? {};
  const maske = fp.olculen ? ['f1', 'f2', 'f3', 'f4', 'f5'].map((f) => (fp.olculen[f] ? '1' : '0')).join('') : '';
  return {
    ...bos, zaman, durum: 'OLCULDU', etkin: d.kurulum?.etkin, kip: l.kip, gecerlilik: l.gecerlilik, kademe: l.uygulananKademe,
    nedenler: (l.nedenler ?? []).join(','), sonDeneme: y.sonDeneme, sonBasari: y.sonBasari, sonHataKodu: y.sonHataKodu,
    karar: fp.karar, eslesen: fp.eslesen, olculebilen: fp.olculebilen, olculen: maske,
    reddedilecekIstek: d.gozlem?.reddedilecekIstek, reddedilecekModul: d.gozlem?.reddedilecekModul,
    butunluk: l.butunluk, cekirdek: l.cekirdek, zil: l.zilBagli,
  };
}

export const tsvBaslik = () => `${KOLONLAR.join('\t')}\n`;
export const tsvSatir = (r) => `${KOLONLAR.map((k) => temiz(r[k])).join('\t')}\n`;

export function tsvOku(dosya) {
  const [bas, ...govde] = fs.readFileSync(dosya, 'utf8').split('\n').filter(Boolean);
  const kol = bas.split('\t');
  return govde.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [kol[i], v])));
}

/**
 * Yanlış pozitif = motorun LİSANSLI bir kurulumu kısıtlayacak olması: geçerlilik GECERLI değil, uygulanan
 * kademe NORMAL değil ya da gözlem sayacı (reddedilecek istek/modül) arttı. Nedenler ayrıca bilgi olarak sayılır.
 * Etkinleşmemiş kurulumun örneği (`etkin=false`) lisanslı değildir: AYRI sayılır, hükme girmez; hiç etkin örnek
 * yoksa sonuç ÖLÇÜLEMEDİ. `etkin` kolonu olmayan eski TSV bugünkü gibi etkin sayılır.
 */
export function ozet(satirlar) {
  const olculen = satirlar.filter((r) => r.durum === 'OLCULDU');
  const denemeler = new Map();
  for (const r of olculen) {
    if (!r.sonDeneme) continue;
    const basarili = Boolean(r.sonBasari) && r.sonBasari >= r.sonDeneme;
    denemeler.set(r.sonDeneme, (denemeler.get(r.sonDeneme) ?? false) || basarili);
  }
  const basariliDeneme = [...denemeler.values()].filter(Boolean).length;
  const yp = [];
  let onceki = null;
  let oncekiEtkin = null; // sayaç artışı yalnız ardışık ETKİN örnekler arasında
  let izDegisimi = 0;
  let etkinlesmemis = 0;
  const kararlar = {};
  const nedenler = {};
  for (const r of olculen) {
    if (onceki && (onceki.karar !== r.karar || onceki.olculen !== r.olculen)) izDegisimi += 1;
    kararlar[r.karar || '-'] = (kararlar[r.karar || '-'] ?? 0) + 1;
    onceki = r;
    if (String(r.etkin) === 'false') { // TSV'den metin, satirKur'dan boolean
      etkinlesmemis += 1;
      oncekiEtkin = null;
      continue;
    }
    const sebep = [];
    if (r.gecerlilik !== 'GECERLI') sebep.push(`gecerlilik=${r.gecerlilik}`);
    if (r.kademe !== 'NORMAL') sebep.push(`kademe=${r.kademe}`);
    if (oncekiEtkin && Number(r.reddedilecekIstek) > Number(oncekiEtkin.reddedilecekIstek)) sebep.push('reddedilecekIstek arttı');
    if (oncekiEtkin && Number(r.reddedilecekModul) > Number(oncekiEtkin.reddedilecekModul)) sebep.push('reddedilecekModul arttı');
    if (sebep.length) yp.push({ zaman: r.zaman, sebep: sebep.join(', ') });
    for (const n of (r.nedenler || '').split(',').filter(Boolean)) nedenler[n] = (nedenler[n] ?? 0) + 1;
    oncekiEtkin = r;
  }
  const etkinOrnek = olculen.length - etkinlesmemis;
  const sonuc = yp.length > 0 ? 'IHLAL' : etkinOrnek === 0 || olculen.length < satirlar.length ? 'OLCULEMEDI' : 'UYUMLU';
  return {
    sonuc, ornek: satirlar.length, olculen: olculen.length, olculemeyen: satirlar.length - olculen.length, etkinlesmemis,
    yoklamaDenemesi: denemeler.size, basariliDeneme, basariOrani: denemeler.size ? basariliDeneme / denemeler.size : null,
    parmakIziKararlari: kararlar, parmakIziDegisimi: izDegisimi, nedenler, yanlisPozitif: yp,
  };
}

export function ozetYaz(o) {
  const oran = o.basariOrani === null ? 'ölçülemedi' : `%${(o.basariOrani * 100).toFixed(1)}`;
  return [
    `T4 özet: ${o.sonuc} · örnek ${o.ornek} (ölçülen ${o.olculen}, ölçülemeyen ${o.olculemeyen}, etkinleşmemiş ${o.etkinlesmemis} — hüküm dışı)`,
    `  yoklama: ${o.basariliDeneme}/${o.yoklamaDenemesi} başarılı (${oran}; örnekler arasında kalan deneme görülmez)`,
    `  parmak izi: kararlar ${JSON.stringify(o.parmakIziKararlari)} · karar/etken değişimi ${o.parmakIziDegisimi}`,
    `  nedenler (bilgi, etkin örnekler): ${Object.keys(o.nedenler).length ? JSON.stringify(o.nedenler) : 'yok'}`,
    `  yanlış pozitif: ${o.yanlisPozitif.length}${o.yanlisPozitif.slice(0, 5).map((y) => `\n    ${y.zaman} ${y.sebep}`).join('')}`,
  ].join('\n');
}
