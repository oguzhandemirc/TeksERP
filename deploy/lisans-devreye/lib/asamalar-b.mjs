// Aşama 3–5 kontrolleri: yayıncı anahtarı (Mac) · testfabrika backend (thinkpad-1) · kanal yayını (VDS). SALT OKUMA.
import fs from 'node:fs';
import path from 'node:path';
import { evYolu } from './ag.mjs';
import { GUNCELLEME_KOK, I, O, U, birlestir, gucDegerlendir, httpSonuc, izin600, s, satirlar, uzakSonuc, PS_GUC } from './ortak.mjs';

/** JSON dosyasının yalnız ANAHTAR adları ve beyan edilen sır-dışı alanları okunur; değer basılmaz. */
function jsonOku(dosya) {
  try {
    return JSON.parse(fs.readFileSync(evYolu(dosya), 'utf8'));
  } catch {
    return null;
  }
}

export const ASAMA_3 = [
  { no: '3.1', ad: 'yayıncı ayarı ~/.tekserp/yayinci/ayar.json (0600; adres satıcının /yayin/bildirim)', yerel: (g) => {
    const f = '~/.tekserp/yayinci/ayar.json';
    const iz = izin600(f);
    if (iz.sonuc !== U) return iz;
    const j = jsonOku(f);
    if (!j || !j.adres || !j.kid || !j.anahtar) return s(I, 'ayar.json adres/kid/anahtar taşımıyor');
    // `anahtar` ayar.json'un dizinine göre çözülür (yayin-bildirim.mjs ayarOku ile aynı).
    const sonuclar = [izin600(path.resolve(path.dirname(evYolu(f)), j.anahtar))];
    if (j.adres !== `${g.saticiKok}/yayin/bildirim`) sonuclar.push(s(I, `adres ${j.adres} (beklenen ${g.saticiKok}/yayin/bildirim)`));
    return birlestir([...sonuclar, s(U, `kid ${j.kid}`)]);
  } },
  { no: '3.2', ad: 'yayın belirteci kaynağı (yerel hazırlık dizini, 0600)', yerel: () => {
    const f = '~/.tekserp/yayin-belirteci-kaynagi.json';
    const iz = izin600(f);
    if (iz.sonuc !== U) return iz;
    const j = jsonOku(f);
    if (j?.tur !== 'yerel') return s(I, `tur ${j?.tur ?? 'yok'} (hazırlıkta "yerel")`);
    return fs.existsSync(evYolu(j.dizin ?? '')) ? s(U, j.dizin) : s(I, `dizin yok: ${j.dizin}`);
  } },
  { no: '3.3', ad: 'modül anahtarı dosyası (şifreli modül provası için; 0600)', yerel: () => {
    const d = evYolu('~/.tekserp/satici-hazirlik/modul-anahtarlari');
    const dosyalar = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')) : [];
    return dosyalar.length ? birlestir(dosyalar.map((f) => izin600(`${d}/${f}`))) : s(O, 'modül anahtarı yok (şifreli modül provası atlanır)');
  } },
];

const PS_PAKET = [
  "$a = 'C:\\TeksERP\\app'",
  "$k = Get-Content \"$a\\PAKET.json\" -Raw | ConvertFrom-Json",
  "'surum=' + $k.uygulamaSurumu",
  "'korumali=' + [string]$k.korumali",
  "'kanal=' + $k.backendKanal",
  "'butunlukKid=' + $k.butunlukKid",
  "'native=' + [string](Test-Path \"$a\\native\\lisans-cekirdek.win32-x64-msvc.node\")",
  "'jws=' + [string](Test-Path \"$a\\butunluk.jws\")",
  "'liste=' + [string](Test-Path \"$a\\butunluk-liste.txt\")",
  "'jsc=' + [string](Test-Path \"$a\\dist\\server.jsc\")",
  "'lisansDizini=' + [string](Test-Path 'C:\\TeksERP\\lisans')",
  "$u = Get-Content \"$a\\.env\" | Where-Object { $_ -match '^LICENSE_SERVER_URL=' } | Select-Object -First 1",
  "'saticiAdresi=' + ([string]$u -replace '^LICENSE_SERVER_URL=', '' -replace '\"', '')",
  "$n = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User }",
  "'nodeSahipleri=' + (($n | Sort-Object -Unique) -join ',')",
].join('\n');

export const ASAMA_4 = [
  { no: '4.1', ad: 'thinkpad-1 prizde + pwsh 7 (uzun işten ÖNCE)', kos: (ag) => ag.tp(PS_GUC), degerlendir: gucDegerlendir },
  { no: '4.2', ad: '/health sürümü beklenen', kos: (ag, g) => ag.http(`${g.tpKok}/health`), degerlendir: (r, g) => {
    const h = httpSonuc(r);
    if (h) return h;
    const v = r.json?.version;
    if (!g.backendSurum) return s(O, `beklenen sürüm verilmedi (--backend-surum); çalışan ${v}`);
    return v === g.backendSurum && r.json?.db === 'UP' ? s(U, v) : s(I, `çalışan ${v} db=${r.json?.db} (beklenen ${g.backendSurum})`);
  } },
  { no: '4.3', ad: 'korumalı paket: native + imzalı liste (--paket-kid) + bayt kodu + LICENSE_SERVER_URL (--satici-kok) + SYSTEM', kos: (ag) => ag.tp(PS_PAKET), degerlendir: (r, g) => {
    const u = uzakSonuc(r);
    if (u) return u;
    const m = satirlar(r.cikti);
    if (m.surum === undefined) return s(O, 'PAKET.json okunamadı');
    const kotu = [];
    for (const k of ['korumali', 'native', 'jws', 'liste', 'jsc', 'lisansDizini']) if (m[k] !== 'True') kotu.push(`${k}=${m[k]}`);
    if (!(m.butunlukKid ?? '').startsWith(g.paketKidOnek)) kotu.push(`butunlukKid=${m.butunlukKid || 'yok'} (beklenen ${g.paketKidOnek}…)`);
    if (m.saticiAdresi !== g.saticiKok) kotu.push(`LICENSE_SERVER_URL=${m.saticiAdresi || 'yok'} (beklenen ${g.saticiKok})`);
    if (m.nodeSahipleri !== 'SYSTEM') kotu.push(`node sahipleri ${m.nodeSahipleri}`);
    return kotu.length ? s(I, kotu.join(', ')) : s(U, `${m.surum} kanal=${m.kanal}`);
  } },
  { no: '4.4', ad: 'lisans motoru: native çekirdek · bütünlük GECERLI · motor CALISIYOR', bearer: true, kos: (ag, g) => ag.http(`${g.tpKok}/api/admin/health`, { belirtec: g.belirtec }), degerlendir: (r) => {
    const h = httpSonuc(r);
    if (h) return h;
    const l = r.json?.data?.license ?? r.json?.license;
    if (!l) return s(O, 'health yükünde license bloğu yok');
    const kotu = [];
    if (l.cekirdek !== 'native') kotu.push(`cekirdek=${l.cekirdek}`);
    if (l.butunluk !== 'GECERLI') kotu.push(`butunluk=${l.butunluk} ${l.butunlukKod ?? ''}`.trim());
    if (l.motor !== 'CALISIYOR') kotu.push(`motor=${l.motor} ${l.motorNeden ?? ''}`.trim());
    if (l.kip !== 'gozlem') kotu.push(`kip=${l.kip} (GÖZLEM bekleniyor)`);
    return kotu.length ? s(I, kotu.join(', ')) : s(U, `paketId ${l.paketId}`);
  } },
];

export const ASAMA_5 = [
  { no: '5.1', ad: 'testfabrika panel kanalı latest.yml sürümü (VDS diski, yayıncı hesabı)', kos: (ag) => ag.ssh(`head -3 ${GUNCELLEME_KOK}/html/testfabrika/electron/latest.yml`, { hedef: 'yayin' }), degerlendir: (r, g) => {
    const u = uzakSonuc(r);
    if (u) return u;
    const v = /version:\s*(\S+)/.exec(r.cikti)?.[1];
    if (!v) return s(O, 'latest.yml okunamadı');
    if (!g.panelSurum) return s(O, `beklenen panel sürümü verilmedi (--panel-surum); yayında ${v}`);
    return v === g.panelSurum ? s(U, v) : s(I, `yayında ${v} (beklenen ${g.panelSurum})`);
  } },
  { no: '5.2', ad: 'testfabrika yayın defterinin son satırları (bilgi)', kos: (ag) => ag.ssh(`tail -4 ${GUNCELLEME_KOK}/defter/testfabrika-YAYIN-DEFTERI.tsv`, { hedef: 'yayin' }), degerlendir: (r) => uzakSonuc(r) ?? s(U, `${r.cikti}`.trim().split('\n').pop()) },
];
