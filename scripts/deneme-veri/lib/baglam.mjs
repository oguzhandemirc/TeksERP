// =============================================================================
// deneme-veri — doldurma bağlamı: idempotent yazım kalıpları (adımlar yalnız bunları kullanır).
//   tokenli(anahtar, yol, gövde)      → clientToken = UUIDv5(anahtar); ikinci koşum sunucunun replay boğazına düşer
//                                       (aynı gövde ⇒ aynı kayıt). Gövde ZAMANA BAĞLI OLMAMALI (çapa tarihten türetilir).
//   bulYaDaYarat(ad, bul, yarat)      → tokensız uçlar: önce canlı durumda ara, yoksa TEK denemeyle yarat; belirsiz
//                                       hatada yeniden ARAR (körlemesine ikinci POST yok ⇒ çift kayıt doğmaz).
//   kosulluYaz(ad, gerekliMi, yaz)    → durum geçişi: canlı durum geçişi gerektirmiyorsa yazma (ikinci koşum no-op).
// Sayaç: modül → { yeni, mevcut, belirsiz }. Çıktı yalnız kod/numara/sayı basar.
// =============================================================================
import { belirlenimliToken } from "./token.mjs";
import { liste } from "./istemci.mjs";

export function baglamKur({ api, cap }) {
  const sayac = new Map();
  const baslangic = Date.now();
  const say = (modul, tur) => {
    if (!sayac.has(modul)) sayac.set(modul, { yeni: 0, mevcut: 0, belirsiz: 0 });
    sayac.get(modul)[tur]++;
  };
  const capMs = Date.parse(cap + "T00:00:00+03:00");
  /** Çapa günden `gun` gün + `saat` saat sonra (fabrika dilimi +03:00, ISO). Gövdeler buradan türer — belirlenimli. */
  const an = (gun, saat = 9) => new Date(capMs + gun * 86_400_000 + saat * 3_600_000).toISOString();
  const gunStr = (gun) => an(gun, 12).slice(0, 10);

  /** Sayfalı liste: `page` (BaseController) ya da imleç (`pagination.nextCursor`) — ilk yanıttan anlaşılır. */
  async function hepsi(yol, { limit = 100 } = {}) {
    const ayirac = yol.includes("?") ? "&" : "?";
    const out = [];
    const ilk = await api("GET", `${yol}${ayirac}limit=${limit}`);
    out.push(...liste(ilk));
    let p = ilk.pagination;
    if (p && "nextCursor" in p) {
      for (let n = 0; p?.hasMore && p.nextCursor && n < 500; n++) {
        const j = await api("GET", `${yol}${ayirac}limit=${limit}&cursor=${encodeURIComponent(p.nextCursor)}`);
        out.push(...liste(j));
        p = j.pagination;
      }
      return out;
    }
    for (let sayfa = 2; p && sayfa <= (p.totalPages ?? 1) && sayfa < 500; sayfa++) {
      out.push(...liste(await api("GET", `${yol}${ayirac}page=${sayfa}&limit=${limit}`)));
    }
    return out;
  }

  async function tokenli(modul, anahtar, yol, govde) {
    const clientToken = belirlenimliToken(anahtar);
    try {
      const j = await api("POST", yol, { ...govde, clientToken });
      const d = j?.data ?? j;
      const olusma = d?.createdAt ?? d?.[Object.keys(d ?? {}).find((k) => d[k]?.createdAt)]?.createdAt;
      // Sayım içindir, karar değil; yanıt oluşma zamanı taşımıyorsa "belirsiz" (çoğaltma ölçümü DB sayımıyla yapılır).
      say(modul, !olusma ? "belirsiz" : Date.parse(olusma) < baslangic - 5_000 ? "mevcut" : "yeni");
      return j.data ?? j;
    } catch (e) {
      if (e.kod === "CLIENT_TOKEN_COLLISION") throw new Error(`${anahtar}: aynı token BAŞKA gövdeyle yazılmış — gövde zamana bağlı olmamalı (${e.message})`);
      throw e;
    }
  }

  async function bulYaDaYarat(modul, bul, yarat) {
    const var1 = await bul();
    if (var1) { say(modul, "mevcut"); return var1; }
    try {
      const y = await yarat();
      say(modul, "yeni");
      return y;
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 409) throw e;
      const var2 = await bul(); // belirsiz hata ya da yarış: yazılmış olabilir
      if (var2) { say(modul, "yeni"); return var2; }
      throw e;
    }
  }

  async function kosulluYaz(modul, gerekliMi, yaz) {
    if (!(await gerekliMi())) { say(modul, "mevcut"); return null; }
    const r = await yaz();
    say(modul, "yeni");
    return r;
  }

  return { api, sayac, say, an, gunStr, hepsi, tokenli, bulYaDaYarat, kosulluYaz, kayit: {} };
}

/** Türkçe katlama (karşılaştırma; yerel ayar API'si kullanılmaz). */
export const katlaAd = (s) => String(s ?? "").replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase().replace(/\s+/g, " ").trim();
