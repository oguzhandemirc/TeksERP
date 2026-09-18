// =============================================================================
// GÜZERGÂH ADIMLARI (TABLET) — kullanıcı testi HTML'inin T (tablet) adımları
// =============================================================================
// d9'un `Electron/e2e/guzergah/adimlar.mjs`'iyle ORTAK: `id` harf+sayı İKİ SÜRÜCÜDE AYNI,
// `dogrula` (backend uç/SQL + beklenen) AYNI; `yap` gövdesi cihaza özgü (adb fiilleri).
// `rol` daima "T" (bu dosya yalnız tablet adımları). `gerektirir` panelin P adımlarına bakar
// (aynı DB'ye koşulunca zincir tutar): D1 ← B3 (çözgü kartı) · D0 (devere makinesi/istasyon).
//
// Fiiller (ctx): git(key) karo · tikla(ad) düğme/desc · yaz(sec,deger) · numpad(sec,deger) ·
// sec(alan,satırDesc) picker · gor(metin) görünür bekle · bekle(ms) · ekran(ad) · api · sql · ctx.
// =============================================================================

export const ADIMLAR = [
  {
    id: 'A3',
    rol: 'T',
    yol: 'TEST TeksERP → (giriş) → Bölüm Seçimi',
    // Uygulama zaten açık ve giriş yapılmış varsayılır (emülatör oturumu / operatör PIN'i).
    // Sürüm notu diyaloğu açıksa kapat, Bölüm Seçimi'nin çizildiğini doğrula.
    async yap(ctx) {
      if (ctx.surucu.varMi({ desc: 'Tamam' }) && ctx.surucu.varMi({ icerir: 'neler değişti' })) {
        await ctx.tikla('Tamam');
      }
    },
    async bekle(ctx) {
      await ctx.gor('Levent Sarım');
    },
    dogrula: [
      { ad: 'operatör oturumu backend’de tanınır (izin var)', uc: '/api/auth/me', oku: (g) => Boolean(g?.data?.id ?? g?.id), beklenen: true },
    ],
  },
  {
    id: 'D1',
    rol: 'T',
    yol: 'Bölüm Seçimi → Levent Sarım → Yeni levent',
    gerektirir: ['B3', 'D0'],
    async yap(ctx) {
      await ctx.git('devere');
      await ctx.gor('Levent Sarım');
      await ctx.tikla('Yeni levent');
      await ctx.gor('Yeni levent planla');
      // Çözgü kartı seç (TEST-CK1 satırı picker'da), planlanan metre, gövde no.
      await ctx.sec({ icerir: 'Çözgü kartı' }, ctx.cozguKartiDesc ?? 'TEST-CK1');
      await ctx.numpad({ icerir: 'Planlanan metre' }, '500');
      await ctx.yaz({ icerir: 'Metal levent no' }, 'TEST-M1');
      await ctx.tikla('Planla');
    },
    async bekle(ctx) {
      await ctx.gor('Planlı');
    },
    dogrula: [
      {
        ad: 'TEST-M1 gövdeli PLANNED levent doğdu',
        sql: "SELECT count(*)::int AS n FROM warp_beams WHERE public.tr_fold(\"physicalBeamNo\") = public.tr_fold($1) AND status = 'PLANNED'",
        params: ['TEST-M1'],
        oku: (rows) => rows[0].n,
        beklenen: (v) => v >= 1,
      },
    ],
  },
  {
    id: 'D2',
    rol: 'T',
    yol: 'Levent Sarım → Planlı → SAR (sayfalı: ölçü · makine·iplik · özet)',
    gerektirir: ['D1'],
    async yap(ctx) {
      await ctx.git('devere');
      await ctx.tikla('SAR');
      await ctx.gor('Ölçü');
      await ctx.numpad({ icerir: 'Sarılan metre' }, '500');
      await ctx.tikla('İleri');
      await ctx.gor('Makine · iplik');
      // Makine tek ise ön-seçili (db2cb15e); değilse seç. Lot + kg.
      if (ctx.surucu.varMi({ desc: 'Seçilmedi' })) await ctx.sec({ desc: 'Seçilmedi' }, ctx.makineDesc ?? 'DV1');
      await ctx.sec({ icerir: 'Lot yok' }, ctx.lotDesc ?? 'TEST-L1');
      await ctx.numpad({ text: 'kg' }, '30');
      await ctx.tikla('İleri');
      await ctx.gor('Özet');
      await ctx.tikla('Sarımı Kaydet');
    },
    async bekle(ctx) {
      await ctx.gor('Bugün sarılan');
    },
    dogrula: [
      {
        ad: 'levent READY (sarıldı)',
        sql: "SELECT count(*)::int AS n FROM warp_beams WHERE public.tr_fold(\"physicalBeamNo\") = public.tr_fold($1) AND status = 'READY'",
        params: ['TEST-M1'],
        oku: (rows) => rows[0].n,
        beklenen: (v) => v >= 1,
      },
    ],
  },
];
