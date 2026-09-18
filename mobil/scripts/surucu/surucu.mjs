// =============================================================================
// SÜRÜCÜ — ekran eylemleri (bul · tik · yaz · numpad · bekle · ekran) + adım koşucusu
// =============================================================================
// Güzergâh adımı: { id:'D1', ad, yap: async (s) => {...}, bekle?: [seçici…], dogrula?: async (api, s) => {...} }
//   yap     — ekran eylemleri (bu sınıfın yöntemleri); hata = adım KIRMIZI
//   bekle   — adım sonunda ekranda görünmesi gereken düğümler (seçici listesi; her biri `bekle` ile aranır)
//   dogrula — backend doğrulaması (fetch); dönen değer `sonuc.dogrulama`ya yazılır; throw = KIRMIZI
// Her adım başında ve sonunda ekran görüntüsü alınır (`<klasör>/<id>-once.png`, `<id>-sonra.png`);
// kırmızıda ayrıca `<id>-hata.png` + ağaç özeti `<id>-agac.txt`. Sonuç JSON: adım başına durum·süre·hata·dogrulama.
// =============================================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ayristir, bul, dokunulabilir, hepsiniBul, ozet } from './ekran-agaci.mjs';

const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

export class Surucu {
  /** @param cihaz Cihaz örneği  @param {{ ekranDizini: string, paket?: string, log?: (s:string)=>void }} ayar */
  constructor(cihaz, ayar) {
    this.cihaz = cihaz;
    this.ekranDizini = ayar.ekranDizini;
    this.paket = ayar.paket ?? 'com.teks.erp.mobil.test';
    this.log = ayar.log ?? ((s) => process.stdout.write(`${s}\n`));
    this.sonDugumler = [];
    mkdirSync(this.ekranDizini, { recursive: true });
  }

  /** Ağacı yeniden okur (dump ~0.5–1.5 sn). */
  agac() {
    this.sonDugumler = ayristir(this.cihaz.dump());
    return this.sonDugumler;
  }

  /** Seçiciyi bekler; bulunca düğümü döner, süre dolarsa hata. Yoklama aralığı dump süresine bağlı. */
  async bekle(sec, { ms = 8000, n = 0, ad } = {}) {
    const bas = Date.now();
    let son = null;
    while (Date.now() - bas < ms) {
      son = bul(this.agac(), sec, n);
      if (son) return son;
      await uyu(400);
    }
    throw new Error(`bekle zaman aşımı (${ms} ms): ${ad ?? JSON.stringify(secStr(sec))}`);
  }

  /** Seçici EKRANDA OLMAMALI (kapanan modal gibi). */
  async bekleYok(sec, { ms = 8000 } = {}) {
    const bas = Date.now();
    while (Date.now() - bas < ms) {
      if (!bul(this.agac(), sec)) return true;
      await uyu(400);
    }
    throw new Error(`hâlâ ekranda (${ms} ms): ${JSON.stringify(secStr(sec))}`);
  }

  /** Bul → dokunulabilir ata → tıkla. `n` = n. eşleşme. */
  async tik(sec, { ms = 8000, n = 0, bekleMs = 350 } = {}) {
    const d = await this.bekle(sec, { ms, n });
    const hedef = dokunulabilir(this.sonDugumler, d);
    this.cihaz.tik(hedef.merkez.x, hedef.merkez.y);
    await uyu(bekleMs);
    return hedef;
  }

  /** Koordinat tıkla (ölçülü durumlar). */
  async tikXY(x, y, bekleMs = 350) {
    this.cihaz.tik(x, y);
    await uyu(bekleMs);
  }

  /**
   * Metin kutusuna yaz: kutuyu bul + odakla, içeriği temizle (Ctrl+A yerine sona git + geri sil ×N), ASCII yaz.
   * `temizle` kutunun mevcut metnini okuyup o kadar BACKSPACE basar (uiautomator text = kutunun içeriği).
   */
  async yaz(sec, metin, { temizle = true, ms = 8000, n = 0 } = {}) {
    const d = await this.bekle(sec, { ms, n });
    this.cihaz.tik(d.merkez.x, d.merkez.y);
    await uyu(300);
    if (temizle) {
      const guncel = bul(this.agac(), sec, n);
      const uzunluk = (guncel?.text ?? '').length;
      if (uzunluk > 0) {
        this.cihaz.tus('KEYCODE_MOVE_END');
        for (let i = 0; i < uzunluk; i++) this.cihaz.tus('KEYCODE_DEL');
      }
    }
    if (metin) this.cihaz.yaz(metin);
    await uyu(250);
  }

  /**
   * Uygulamanın büyük NUMPAD'i ile sayı gir: alana dokun (numpad o alana bağlanır), rakamları
   * tuş METNİYLE tıkla ("1".."9","0","."). Tuşlar TouchableRipple → text düğümünün dokunulabilir atası.
   * Alan seçici `alan` (ör. { text: 'Sarılan metre' } etiketi ya da placeholder) — etiketin ALTINDAKİ kutuya
   * gitmek için `kutuSec` verilir; verilmezse etiket düğümünün bir alt satırındaki EditText aranır.
   */
  async numpadYaz(kutuSec, sayi, { ms = 8000, temizle = true } = {}) {
    const kutu = await this.bekle(kutuSec, { ms });
    this.cihaz.tik(kutu.merkez.x, kutu.merkez.y);
    await uyu(400);
    const agac = this.agac();
    if (temizle) {
      const geri = bul(agac, { re: /backspace|geri sil/i }) ?? null;
      const mevcut = (bul(agac, kutuSec)?.text ?? '').replace(/[^\d.,]/g, '');
      // Numpad'de BACKSPACE tuşu ikon (text yok) → desc ile; yoksa uzun basış temizler varsayılamaz, tek tek sil.
      for (let i = 0; i < mevcut.length; i++) {
        if (geri) this.cihaz.tik(geri.merkez.x, geri.merkez.y);
        else this.cihaz.tus('KEYCODE_DEL');
        await uyu(80);
      }
    }
    for (const ch of String(sayi).replace(',', '.')) {
      const tus = bul(agac, { text: ch, clickable: false }) ?? bul(agac, { desc: ch });
      if (!tus) throw new Error(`numpad tuşu yok: "${ch}" (ekranda numpad açık mı?)`);
      const hedef = dokunulabilir(agac, tus);
      this.cihaz.tik(hedef.merkez.x, hedef.merkez.y);
      await uyu(120);
    }
    await uyu(200);
  }

  /** Görüntü al; dönen yol. */
  ekran(ad) {
    return this.cihaz.ekran(this.ekranDizini, ad);
  }

  /** Ekranda listeyi kaydır (varsayılan: ortadan yukarı). */
  async kaydir(yon = 'yukari', { oran = 0.5 } = {}) {
    const b = this.cihaz.ekranBoyutu() ?? { w: 1920, h: 1200 };
    const x = Math.round(b.w / 2);
    const y1 = Math.round(b.h * (yon === 'yukari' ? 0.7 : 0.3));
    const y2 = Math.round(b.h * (yon === 'yukari' ? 0.7 - oran * 0.6 : 0.3 + oran * 0.6));
    this.cihaz.kaydir(x, y1, x, y2, 350);
    await uyu(400);
  }

  varMi(sec) {
    return bul(this.agac(), sec) != null;
  }

  hepsi(sec) {
    return hepsiniBul(this.agac(), sec);
  }

  agacOzeti() {
    return ozet(this.sonDugumler.length ? this.sonDugumler : this.agac(), { enCok: 120 });
  }

  /**
   * BEŞ FİİL — panel sürücüsüyle (d9 `Electron/e2e/guzergah`) ORTAK sözlük, cihaz karşılıkları.
   * Adım dosyası (`adimlar.mjs`) bunları kullanır; `id` + `dogrula` iki sürücüde AYNI, gövde farklı.
   */
  fiiller() {
    return {
      /** Bölüm Seçimi karosuna dokun (testID `modul-karo-<key>`; menü açıksa kapat). */
      git: async (key, { ms = 8000 } = {}) => {
        if (this.varMi({ desc: 'Menüyü kapat' })) await this.tik({ desc: 'Menüyü kapat' });
        await this.tik({ id: `modul-karo-${key}` }, { ms });
      },
      /** Düğme/satır dokun — önce accessibilityLabel (desc), olmazsa görünen metin. */
      tikla: async (ad, { ms = 8000 } = {}) => {
        if (this.varMi({ desc: ad })) return this.tik({ desc: ad }, { ms });
        return this.tik({ icerir: ad }, { ms });
      },
      /** Alana yaz (ASCII; numpad'li sayılar için `numpadYaz`). */
      yaz: (sec, deger) => this.yaz(sec, String(deger)),
      numpad: (sec, deger) => this.numpadYaz(sec, deger),
      /** PickerModal: alanı aç, satır seç (satır desc'i tam etiket). */
      sec: async (alanSec, satirDesc) => {
        await this.tik(alanSec);
        await this.tik({ desc: satirDesc });
      },
      /** "Bekle:" satırının makine karşılığı — görünür olmasını bekle. */
      gor: (sec, { ms = 15000 } = {}) => this.bekle(typeof sec === 'string' ? { icerir: sec } : sec, { ms }),
      bekle: (ms) => uyu(ms),
      ekran: (ad) => this.ekran(ad),
      surucu: this,
    };
  }
}

function secStr(sec) {
  return Object.fromEntries(Object.entries(sec).map(([k, v]) => [k, v instanceof RegExp ? String(v) : v]));
}

// ── Adım koşucusu — d9 panel sürücüsüyle ORTAK sözleşme (sonuc.json birebir) ──
/**
 * Adım: `{ id, rol, yol, gerektirir?, yap(ctx), bekle?(ctx), dogrula?:[{ad, uc|sql, params?, oku?, beklenen}] }`.
 * Üç değerli: yesil · kirmizi · atlandi (ön koşulu düşen adım "kırmızı" değil "atlandı"). `dogrula` satırı
 * `{ad, ok, beklenen, gorulen}` üretir; `beklenen` sabit ya da yüklem. Sonuç d9 biçimi:
 * `{ zaman, api, db, ozet:{yesil,kirmizi,atlandi}, adimlar:[…] }`.
 * @param {Surucu} s
 * @param {Array<object>} adimlar
 * @param {{ ciktiDizini: string, api: {get:(y:string)=>Promise<any>}, sql?: (q:string,p?:any[])=>Promise<any[]>, apiUrl?: string, dbName?: string, ctx?: object, adimZamanAsimiMs?: number }} ayar
 */
export async function kos(s, adimlar, { ciktiDizini, api, sql, apiUrl = null, dbName = null, ctx = {}, adimZamanAsimiMs = 90_000 } = {}) {
  mkdirSync(ciktiDizini, { recursive: true });
  const zaman = new Date().toISOString().replace(/[:.]/g, '-');
  const sonuclar = [];
  const atlandi = new Set();
  const f = s.fiiller();
  for (const adim of adimlar) {
    const t0 = Date.now();
    const kayit = { id: adim.id, rol: adim.rol ?? null, yol: adim.yol ?? '', durum: 'kirmizi', sure_ms: 0, dogrulama: [], hata: null, ekran: null };
    const onKosulEksik = (adim.gerektirir ?? []).filter((g) => atlandi.has(g) || sonuclar.find((x) => x.id === g)?.durum === 'kirmizi');
    if (onKosulEksik.length) {
      kayit.durum = 'atlandi';
      kayit.hata = `ön koşul düştü: ${onKosulEksik.join(', ')}`;
      atlandi.add(adim.id);
      sonuclar.push(kayit);
      s.log(`⏭  ${adim.id} atlandı — ${kayit.hata}`);
      continue;
    }
    const adimCtx = { ...f, api, sql, ...ctx };
    try {
      await Promise.race([
        (async () => {
          if (adim.yap) await adim.yap(adimCtx);
          if (adim.bekle) await adim.bekle(adimCtx);
        })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`adım ${adimZamanAsimiMs / 1000} sn'de bitmedi`)), adimZamanAsimiMs)),
      ]);
      for (const d of adim.dogrula ?? []) {
        const satir = { ad: d.ad, ok: false, beklenen: typeof d.beklenen === 'function' ? '<yüklem>' : String(d.beklenen), gorulen: null };
        try {
          const gorulen = d.sql ? await sql(d.sql, d.params ?? []) : await api.get(d.uc);
          const deger = d.oku ? d.oku(gorulen) : gorulen;
          satir.gorulen = typeof deger === 'object' ? JSON.stringify(deger).slice(0, 200) : String(deger);
          satir.ok = typeof d.beklenen === 'function' ? Boolean(d.beklenen(deger)) : deger === d.beklenen || String(deger) === String(d.beklenen);
        } catch (e) {
          satir.gorulen = `HATA: ${String(e).slice(0, 200)}`;
        }
        kayit.dogrulama.push(satir);
      }
      kayit.durum = kayit.dogrulama.every((d) => d.ok) ? 'yesil' : 'kirmizi';
      if (kayit.durum === 'kirmizi' && kayit.dogrulama.length) kayit.hata = 'backend doğrulaması tutmadı';
    } catch (e) {
      kayit.hata = String(e?.message ?? e).split('\n')[0].slice(0, 400);
      atlandi.add(adim.id);
    } finally {
      kayit.sure_ms = Date.now() - t0;
      try {
        kayit.ekran = `${adim.id}.png`;
        s.cihaz.ekran(ciktiDizini, adim.id);
        if (kayit.durum !== 'yesil') writeFileSync(join(ciktiDizini, `${adim.id}-agac.txt`), s.agacOzeti());
      } catch {
        kayit.ekran = null;
      }
      sonuclar.push(kayit);
      const isaret = kayit.durum === 'yesil' ? '✅' : kayit.durum === 'atlandi' ? '⏭ ' : '❌';
      s.log(`${isaret} ${adim.id} · ${adim.rol ?? '?'} · ${adim.yol ?? ''}  (${(kayit.sure_ms / 1000).toFixed(1)} sn)${kayit.hata ? ` — ${kayit.hata}` : ''}`);
      for (const d of kayit.dogrulama) s.log(`     ${d.ok ? '✓' : '✗'} ${d.ad}: beklenen ${d.beklenen} · görülen ${d.gorulen}`);
    }
  }
  const ozetSonuc = {
    yesil: sonuclar.filter((x) => x.durum === 'yesil').length,
    kirmizi: sonuclar.filter((x) => x.durum === 'kirmizi').length,
    atlandi: sonuclar.filter((x) => x.durum === 'atlandi').length,
  };
  const sonuc = { zaman, api: apiUrl, db: dbName, ozet: ozetSonuc, adimlar: sonuclar };
  writeFileSync(join(ciktiDizini, 'sonuc.json'), JSON.stringify(sonuc, null, 2));
  s.log(`\n=== Sonuç: ${ozetSonuc.yesil} yeşil · ${ozetSonuc.kirmizi} kırmızı · ${ozetSonuc.atlandi} atlandı → ${ciktiDizini}/sonuc.json ===`);
  return sonuc;
}
