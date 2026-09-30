// Aşama 6–8 kontrolleri: portal (geri döngü tüneli) · etkinleştirme (gözlem kipi) · Senaryo T. SALT OKUMA.
import fs from 'node:fs';
import { evYolu } from './ag.mjs';
import { ozet, tsvOku } from './gozlem.mjs';
import { I, O, U, httpSonuc, s, vdsDogrulaDegerlendir, vdsDogrulaKos } from './ortak.mjs';

const detay = (ag, g) => ag.http(`${g.tpKok}/api/license/detay`, { belirtec: g.belirtec });
const veri = (r) => r.json?.data ?? r.json ?? {};

export const ASAMA_6 = [
  { no: '6.1', ad: 'portal sağlığı (tünel: node deploy/satici/portal-baglan.mjs açık olmalı)', kos: (ag, g) => ag.http(`${g.portalKok}/portal/saglik`), degerlendir: (r) => {
    if (r.durum === null || r.durum === undefined) return s(O, 'tünel kapalı — portal-baglan.mjs açılmadan ölçülemez');
    const h = httpSonuc(r);
    if (h) return h;
    const p = veri(r).anahtarlar ?? {}; // satıcı /portal/saglik: data.anahtarlar.{capa, altGecerli, uyariSayisi}
    const kotu = [];
    if (p.capa !== 'gomulu') kotu.push(`capa=${p.capa}`);
    if (!(Number(p.altGecerli) >= 1)) kotu.push(`altGecerli=${p.altGecerli}`);
    if (Number(p.uyariSayisi) !== 0) kotu.push(`uyariSayisi=${p.uyariSayisi}`);
    return kotu.length ? s(I, kotu.join(', ')) : s(U);
  } },
  { no: '6.2', ad: "testfabrika'nın açık modülleri (HAK tavanına aynen; patron-bulut EKLENMEZ)", bearer: true, kos: (ag, g) => ag.http(`${g.tpKok}/api/admin/module-profile`, { belirtec: g.belirtec }), degerlendir: (r) => {
    const h = httpSonuc(r);
    if (h) return h;
    const values = veri(r).values;
    if (!values) return s(O, 'module-profile yükünde values yok');
    const acik = Object.entries(values).filter(([k, v]) => v === true || v === 'true' || (k === 'production.enabled' && (v === null || v === undefined))).map(([k]) => k);
    return s(U, `açık: ${acik.join(', ') || 'yok'}`);
  } },
];

export const ASAMA_7 = [
  { no: '7.1', ad: 'etkin · HAK sınıfı (--hak-sinif) · kira var · satıcı (--satici-kok) · son yoklama başarılı', bearer: true, kos: detay, degerlendir: (r, g) => {
    const h = httpSonuc(r);
    if (h) return h;
    const d = veri(r);
    const kotu = [];
    if (d.kurulum?.etkin !== true) kotu.push('etkin değil');
    if (d.hak?.sinif !== g.hakSinif) kotu.push(`hak.sinif=${d.hak?.sinif ?? 'yok'} (beklenen ${g.hakSinif})`);
    const patronBulut = (d.hak?.moduller ?? []).includes('patron-bulut');
    // Yalnız ÜRETİM sınıfı buluta gönderir: TEST/DEMO HAK'ında hak yanlış beyandır (runbook §6.1).
    if (patronBulut && d.hak?.sinif !== 'URETIM') kotu.push(`HAK patron-bulut taşıyor (${d.hak?.sinif} sınıfı gönderemez; eklenmez)`);
    if (!d.kira?.kiraId) kotu.push('kira yok');
    // Detay satıcıyı yalnız ana makine (host) olarak gösterir (license-view.service): kökün host'uyla karşılaştırılır.
    const saticiHost = new URL(g.saticiKok).host;
    if (d.yoklama?.saticiAdresi !== saticiHost) kotu.push(`satıcı ${d.yoklama?.saticiAdresi ?? 'yok'} (beklenen ${saticiHost})`);
    if (!d.yoklama?.sonBasari) kotu.push(`başarılı yoklama yok (son hata ${d.yoklama?.sonHataKodu ?? '-'})`);
    return kotu.length ? s(I, kotu.join(', ')) : s(U, `kurulum ${d.kurulum?.kurulumId} · kira bitiş ${d.kira?.bitis}${d.hak?.sinif === 'URETIM' ? ` · patron-bulut ${patronBulut ? 'var' : 'YOK'}` : ''}`);
  } },
  { no: '7.2', ad: 'GÖZLEM kipi · GECERLI · kademe NORMAL · gözlem sayacı 0', bearer: true, kos: detay, degerlendir: (r) => {
    const h = httpSonuc(r);
    if (h) return h;
    const d = veri(r);
    const kotu = [];
    if (d.durum?.kip !== 'gozlem') kotu.push(`kip=${d.durum?.kip}`);
    if (d.durum?.gecerlilik !== 'GECERLI') kotu.push(`gecerlilik=${d.durum?.gecerlilik}`);
    if (d.durum?.uygulananKademe !== 'NORMAL') kotu.push(`kademe=${d.durum?.uygulananKademe}`);
    const g0 = d.gozlem ?? {};
    if (Number(g0.reddedilecekIstek) || Number(g0.reddedilecekModul)) kotu.push(`gözlem sayacı ${JSON.stringify(g0)}`);
    const nedenler = (d.durum?.nedenler ?? []).map((n) => n.kod ?? n);
    return kotu.length ? s(I, kotu.join(', ')) : s(U, nedenler.length ? `nedenler (bilgi): ${nedenler.join(',')}` : '');
  } },
];

export const ASAMA_8 = [
  { no: '8.1', ad: 'T1: beş etken SYSTEM bağlamında ölçülüyor (f1..f5) ve eşleşti', bearer: true, kos: detay, degerlendir: (r) => {
    const h = httpSonuc(r);
    if (h) return h;
    const fp = veri(r).parmakIzi ?? {};
    if (!fp.olculen) return s(O, 'parmak izi henüz ölçülmedi');
    const olcmeyen = ['f1', 'f2', 'f3', 'f4', 'f5'].filter((f) => !fp.olculen[f]);
    if (olcmeyen.length) return s(I, `SYSTEM'de ölçülemeyen: ${olcmeyen.join(',')}`);
    return fp.karar === 'ESLESTI' ? s(U, `${fp.eslesen}/${fp.olculebilen} eşleşti`) : s(I, `karar=${fp.karar} uyuşmayan=${(fp.uyusmayan ?? []).join(',')}`);
  } },
  { no: '8.2', ad: "T3: uygulama rolü pg_control_system() çalıştırabiliyor (f5 ölçüldü ⇔ EXECUTE)", bearer: true, kos: detay, degerlendir: (r) => {
    const h = httpSonuc(r);
    if (h) return h;
    const f5 = veri(r).parmakIzi?.olculen?.f5;
    if (f5 === undefined) return s(O, 'parmak izi henüz ölçülmedi');
    return f5 ? s(U) : s(I, "f5 ölçülemedi — rolün pg_control_system() EXECUTE yetkisi yok (runbook §8 T3)");
  } },
  { no: '8.3', ad: 'T4: gözlem TSV özeti (--t4-tsv; yanlış pozitif 0)', yerel: (g) => {
    if (!g.t4Tsv) return s(O, 't4-gozlem.mjs çıktısı verilmedi (--t4-tsv=<dosya>)');
    const f = evYolu(g.t4Tsv);
    if (!fs.existsSync(f)) return s(O, `yok: ${f}`);
    const o = ozet(tsvOku(f));
    const oran = o.basariOrani === null ? '-' : `%${(o.basariOrani * 100).toFixed(1)}`;
    return s(o.sonuc, `${o.olculen}/${o.ornek} örnek · yoklama ${oran} · YP ${o.yanlisPozitif.length} · iz değişimi ${o.parmakIziDegisimi}`);
  } },
  { no: '8.4', ad: 'T6: vds-dogrula (adnansahin 0 fark)', kos: vdsDogrulaKos, degerlendir: vdsDogrulaDegerlendir },
];
