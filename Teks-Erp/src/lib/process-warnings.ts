import { uyari, stackTrace } from "./logger";

/**
 * NODE SÜREÇ UYARILARINI YIĞIN İZİYLE LOG'A YAZAR.
 *
 * ⚠️ NEDEN VAR (2026-09-07): sahada `backend-err.log`ta şu satır çıktı —
 *   "Calling client.query() when the client is already executing a query is
 *    deprecated and will be removed in pg@9.0"
 * ve Node'un kendi çıktısı NEREDEN geldiğini söylemiyordu:
 *   "(Use `node --trace-deprecation ...` to show where the warning was created)"
 * O bayrağı açmak yeniden başlatma, yani canlıda kesinti demekti. Oysa
 * ÖLÇÜLDÜ: `warning` olayının `w.stack` alanı ÇAĞRI YERİNİ BAYRAKSIZ DA
 * taşıyor — Node yalnız EKRANA basmıyor. Yani tanı için gereken tek şey bu
 * dinleyiciydi; kesinti değil.
 *
 * ⚠️ TEŞHİSİN KENDİSİ TAHMİNLE YAPILMASIN DİYE: aynı uyarı için üretilen üç
 * ayrı hipotez ölçümle ELENDİ (havuzdan serbest sorgular · tx içinde
 * `Promise.all` · tx zaman aşımı). Prisma havuz üzerinden çalıştığı için her
 * sorgu AYRI bir `Client` alır ve uyarının koşulu — aynı client'ta kuyrukta
 * bekleyen ÜÇÜNCÜ sorgu (`pg/lib/client.js`: `_queryQueue.length > 0`) — o
 * yoldan hiç oluşamıyor. Kalan yer PINLENMIŞ bir client'tır; onu da yığın izi
 * söyler. Bu dosya, "bir daha tahmin etmeyelim"in kodudur.
 *
 * ⚠️ TEK ATIMLIK UYARILAR VAR: `util.deprecate` SÜREÇ BAŞINA BİR KEZ basar.
 * Bu yüzden sahadaki iki satır "iki kez oldu" DEĞİL "iki ayrı süreçte en az
 * bir kez oldu" demektir; sıklık bu log'dan ölçülemez.
 *
 * Yığın izi `uyari()`nin ALTINA etiketsiz basılır (bir olay = tek greplenebilir
 * satır kuralı, bkz. `logger.ts`).
 */

/** Aynı uyarıyı tekrar tekrar basmamak için görülen imzalar. */
const seen = new Set<string>();
/** Sınırsız büyümeye karşı tavan — dolduktan sonra yeni imza basılmaz. */
const MAX_DISTINCT = 50;

function signature(w: Error): string {
  const ilkKare = (w.stack ?? "").split("\n")[1]?.trim() ?? "";
  return `${w.name}|${w.message}|${ilkKare}`;
}

let installed = false;

/** `server.ts` açılışında BİR KEZ çağrılır. İkinci çağrı no-op. */
export function logProcessWarnings(): void {
  if (installed) return;
  installed = true;
  process.on("warning", (w: Error) => {
    const k = signature(w);
    if (seen.has(k)) return;
    if (seen.size >= MAX_DISTINCT) return;
    seen.add(k);
    uyari("node", `${w.name}: ${w.message}`);
    // Çağrı yeri — asıl değerli kısım. Etiketsiz, `hata()`nın yığın basımıyla
    // aynı biçim: bir olay = bir etiketli satır + altında ham iz.
    if (w.stack) stackTrace(w.stack);
  });
}
