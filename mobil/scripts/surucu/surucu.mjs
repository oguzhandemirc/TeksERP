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
}

function secStr(sec) {
  return Object.fromEntries(Object.entries(sec).map(([k, v]) => [k, v instanceof RegExp ? String(v) : v]));
}

// ── Adım koşucusu ────────────────────────────────────────────────────────────
/**
 * @param {Surucu} s
 * @param {Array<{id:string, ad?:string, yap?:(s:Surucu, ctx:any)=>Promise<void>, bekle?:object[], dogrula?:(api:any, s:Surucu, ctx:any)=>Promise<any>}>} adimlar
 * @param {{ api?: any, ctx?: any, durdurKirmizida?: boolean }} ayar
 */
export async function kos(s, adimlar, { api, ctx = {}, durdurKirmizida = false } = {}) {
  const sonuc = { baslangic: new Date().toISOString(), cihaz: s.cihaz.seri ?? null, adimlar: [] };
  for (const adim of adimlar) {
    const bas = Date.now();
    const kayit = { id: adim.id, ad: adim.ad ?? '', durum: 'yesil', sureMs: 0, hata: null, dogrulama: null, ekran: {} };
    s.log(`▶ ${adim.id} ${adim.ad ?? ''}`);
    try {
      kayit.ekran.once = s.ekran(`${adim.id}-once`);
      if (adim.yap) await adim.yap(s, ctx);
      for (const sec of adim.bekle ?? []) await s.bekle(sec, { ms: sec.ms ?? 8000 });
      kayit.ekran.sonra = s.ekran(`${adim.id}-sonra`);
      if (adim.dogrula) kayit.dogrulama = await adim.dogrula(api, s, ctx);
      s.log(`  ✅ ${adim.id} (${Date.now() - bas} ms)`);
    } catch (e) {
      kayit.durum = 'kirmizi';
      kayit.hata = e instanceof Error ? e.message : String(e);
      try {
        kayit.ekran.hata = s.ekran(`${adim.id}-hata`);
        writeFileSync(join(s.ekranDizini, `${adim.id}-agac.txt`), s.agacOzeti());
      } catch {
        /* görüntü alınamadıysa hata metni yeter */
      }
      s.log(`  ❌ ${adim.id}: ${kayit.hata}`);
      if (durdurKirmizida) {
        kayit.sureMs = Date.now() - bas;
        sonuc.adimlar.push(kayit);
        break;
      }
    }
    kayit.sureMs = Date.now() - bas;
    sonuc.adimlar.push(kayit);
  }
  sonuc.bitis = new Date().toISOString();
  sonuc.ozet = {
    yesil: sonuc.adimlar.filter((a) => a.durum === 'yesil').length,
    kirmizi: sonuc.adimlar.filter((a) => a.durum === 'kirmizi').length,
  };
  writeFileSync(join(s.ekranDizini, 'sonuc.json'), JSON.stringify(sonuc, null, 2));
  return sonuc;
}
