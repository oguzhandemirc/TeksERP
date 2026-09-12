// =============================================================================
// HTTP AYAKLI BEKÇİ KAPISI — "sessiz atlama" sınıfını kapatan TEK kaynak
// =============================================================================
// ÖLÇÜLDÜ (2026-09-12, paket taban koşumu): beş bekçi 19 kontrolü "atlandı" diye
// bildirdi ve gerekçe SUNUCU YOKLUĞU sanıldı. Değildi — dört portta da `/health`
// 200 dönüyordu. İki ayrı delik vardı:
//   1. `test_settings_password` ve `test_module_profile` var olduğunu VARSAYDIĞI
//      bir kullanıcıyla (`p2test`) giriş deniyordu. O kullanıcıyı repoda yaratan
//      TEK satır yok; taze her fixture DB'sinde 401 gelir ve 16 kontrol sessizce
//      düşer. `Teks-Erp/CLAUDE.md` zaten "HTTP bekçisi kendi kullanıcısını
//      fixture ile yaratır" diyordu; kural fiilen çiğnenmişti.
//   2. Sabit port BAŞKA bir oturumun sunucusunda olabilir ve o sunucu BAŞKA bir
//      veritabanına bakıyor olabilir. O hâlde bekçi ya yanlış DB'yi ölçer ya da
//      401 alıp "sunucu yok" diye atlar — ikisi de "ölçtüm" yalanıdır.
//
// AYRIM (bilinçli): YOKLUK ≠ YABANCI.
//   • Sunucu YOK              → ATLAMA, ama beyan edilir ve GERÇEK kontrol sayısı
//     sayaca eklenir. Beş sunucuyu her koşumda ayağa kaldırmak beklenmiyor;
//     yokluk beyan edilebilir bir eksikliktir ve paketin yeşil olma yolunu
//     kapatmamalı (yoksa "paket yeşil mi" sorusunun cevabı kalmaz).
//   • Sunucu VAR ama YABANCI  → KIRMIZI. Ölçüm yapıldığı sanılırken başka bir
//     veritabanı ölçülüyor olurdu; bu bir sözleşme ihlalidir.
//
// AYNI DB Mİ — KANIT: bekçi kullanıcısını PRİSMA ile kendi yaratır, hemen
// ardından HTTP'den giriş dener. Giriş 200 ise sunucu zorunlu olarak AYNI
// `users` tablosunu okumuştur ⇒ aynı veritabanı. Kimliksiz `/health` ucuna
// kurulum damgası eklemedik: o uç LAN'dan görünür ve ürün koduna ortam
// dallanması sokardı. Var olan bir kullanıcıyla giriş denemek ise bu tuzağın
// ta kendisiydi (401 belirsizdi); kullanıcıyı AYNI koşumda biz yarattığımız
// için 401 artık belirsiz değil, kanıttır.
//
// ⚠️ PAROLA KOŞUMA ÖZGÜ OLMAK ZORUNDA (ölçüldü 2026-09-12, iki-DB sondası):
// fixture SABİT parolayla yaratılınca `TEST-ADMIN` her fixture DB'sinde AYNI
// kimliğe sahip olur; yabancı sunucu da giriş 200 verir ve kapı onu "aynı DB"
// sayardı (sonda: DB_a'ya yazıp DB_b sunucusuna giriş → 200). Rastgele parola
// YALNIZ bizim yazdığımız satırda geçerlidir; yabancı DB 401 verir. Kanıtın
// dayanağı "kullanıcı var mı" değil, "az önce YAZDIĞIMIZ parola geçiyor mu".
// =============================================================================
import { ensureTestAdmin, kosumaOzguParola, TEST_ADMIN_USERNAME } from "../fixture-test-user";

export interface HttpKapiSonucu {
  /** Doluysa HTTP ayağı koşabilir (sunucu ayakta VE aynı veritabanına bakıyor). */
  token: string | null;
  /** Doluysa çağıran `check(label, false, kirmizi)` basar — sözleşme ihlali. */
  kirmizi: string | null;
  /** Doluysa çağıran `atla(label, atlaSebebi)` + gerçek kontrol sayısını ekler. */
  atlaSebebi: string | null;
}

/**
 * STRICT koşum — `TEKSERP_STRICT=1`. Paket kararında "yeşil = kapsandı" iddiası
 * ancak bu anahtarla kurulur: sunucu YOKLUĞU da kırmızıya döner. Anahtar tek
 * isimdir; ikinci bir strict bayrağı doğarsa iki koşum iki farklı şey iddia eder.
 */
export function strictMi(): boolean {
  return process.env.TEKSERP_STRICT === "1";
}

/** `http://localhost:4112` → `4112`; adres çözülemezse "?" (mesaj için). */
function portOf(base: string): string {
  try {
    return new URL(base).port || "(varsayılan)";
  } catch {
    return "?";
  }
}

/**
 * HTTP ayağının ön koşulunu ölçer ve token döndürür.
 *
 * Çağıran sözleşmesi (üçü de zorunlu):
 *   const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_KONTROL });
 *   if (kapi.kirmizi) { check("HTTP ayağı ölçülebildi", false, kapi.kirmizi); atlanan += HTTP_KONTROL; return; }
 *   if (!kapi.token)  { atla("HTTP turu", kapi.atlaSebebi!); atlanan += HTTP_KONTROL - 1; return; }
 *
 * `atlanan`a GERÇEK kontrol sayısı eklenir: `atla()` bir tane sayar, geri kalanı
 * çağıran ekler. Sayı yanlışsa kapsam kaybı olduğundan küçük görünür (ölçüldü:
 * `test_module_profile` dört kontrolü "1 atlandı" diye bildiriyordu).
 */
export async function httpBekciKapisi(opts: {
  base: string;
  kontrolSayisi: number;
}): Promise<HttpKapiSonucu> {
  const { base } = opts;
  const port = portOf(base);

  // ── 1) Sunucu ayakta mı? ──────────────────────────────────────────────────
  let saglik: { db?: string } | null = null;
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) {
      return {
        token: null,
        kirmizi: `${base} yanıt verdi ama /health ${r.status} döndü — porttaki süreç TeksERP sunucusu olmayabilir.`,
        atlaSebebi: null,
      };
    }
    saglik = (await r.json()) as { db?: string };
  } catch {
    const sebep =
      `${base} ayakta değil — ${opts.kontrolSayisi} kontrol ölçülmedi. ` +
      `Kendi sunucunu ver: PORT=${port} npx tsx src/server.ts (ya da TEST_API_URL=<adres>).`;
    // STRICT: paket kararı verilirken "yeşil = kapsandı" ancak burada iddia
    // edilebilir — yokluk da kırmızıya döner. Günlük koşumda beyan edilmiş
    // atlama yeterli (kadro her koşumda beş sunucu ayağa kaldırmıyor).
    return strictMi()
      ? { token: null, kirmizi: `${sebep} (TEKSERP_STRICT=1 — yokluk da kırmızıdır.)`, atlaSebebi: null }
      : { token: null, kirmizi: null, atlaSebebi: sebep };
  }

  if (saglik?.db !== "UP") {
    return {
      token: null,
      kirmizi: `${base} ayakta ama veritabanı DOWN (/health db=${String(saglik?.db)}) — ölçüm anlamsız olurdu.`,
      atlaSebebi: null,
    };
  }

  // ── 2) Kendi kullanıcımızı KOŞUMA ÖZGÜ PAROLAYLA yarat (varsayma) ─────────
  const { password } = await ensureTestAdmin({ password: kosumaOzguParola() });

  // ── 3) Giriş = "aynı veritabanı mı" kanıtı ────────────────────────────────
  let durum = 0;
  try {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: TEST_ADMIN_USERNAME,
        password,
        clientType: "electron",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    durum = r.status;
    if (r.ok) {
      const govde = (await r.json()) as { data?: { token?: string } };
      const token = govde.data?.token ?? null;
      if (token) return { token, kirmizi: null, atlaSebebi: null };
      return { token: null, kirmizi: `${base} girişi 200 döndü ama gövdede token yok.`, atlaSebebi: null };
    }
  } catch (e) {
    return {
      token: null,
      kirmizi: `${base} giriş isteği düştü (${(e as Error).message.slice(0, 80)}).`,
      atlaSebebi: null,
    };
  }

  // 429 ölçüm yapılamamasıdır (giriş kilidi IP başına ve bellek içi); sözleşme
  // ihlali değil — ardışık koşumda doğar ve ~60 sn sonra geçer.
  if (durum === 429) {
    return {
      token: null,
      kirmizi: null,
      atlaSebebi:
        `${base} giriş kilidi verdi (429) — ${opts.kontrolSayisi} kontrol ölçülmedi; ~60 sn sonra tekrar koş.`,
    };
  }

  return {
    token: null,
    kirmizi:
      `${base} AYAKTA ama az önce PRİSMA ile '${TEST_ADMIN_USERNAME}' satırına YAZDIĞIMIZ koşuma özgü parolayla giriş ${durum} verdi. ` +
      `Porttaki sunucu BAŞKA bir veritabanına bakıyor (ya da kimlik zinciri kırık): ${port} portunu başka bir oturum tutuyor olabilir. ` +
      "Kendi sunucunu kendi portunda başlat ve TEST_API_URL=<adres> ile koş.",
    atlaSebebi: null,
  };
}
