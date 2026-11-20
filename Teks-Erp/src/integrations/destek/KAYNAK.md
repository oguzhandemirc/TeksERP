# Etkili Destek istemcisi — kopya kaydı

Bu klasördeki altı `.ts` dosyası Etkili Destek'in hazır entegrasyon istemcisinin `src/` klasörünün **olduğu gibi** kopyasıdır.

- Kaynak: `etkili-destek-main/packages/destek-client/src` (paket `@etkili/destek-client` 0.1.0). Kaynak bir git deposu olarak alınmadı; commit kimliği yok.
- Kopya tarihi: 2026-11-15.
- Uyarlama: TEK satır. `client.ts` multipart döngüsünde `new Blob([f.data as Uint8Array<ArrayBuffer>], …)` (+ bir yorum satırı): bu reponun TypeScript 6 lib tipi Blob'a `Uint8Array<ArrayBufferLike>` vermeyi reddediyor (kaynak TS 5.9). Davranış aynı. Diğer beş dosya bayt bayt kaynakla aynıdır. Kaynaktaki `client.ts` özeti: `e15867dc1a70fc3a7d3044eed71beaf8c4ab36dac602efc9abe5e3f38c9b38ce`. `webhook.ts` bu kurulumda kullanılmaz (fabrikaya gelen port açılmaz, webhook ucu yok) ama klasör bütün kalsın diye kopyalandı.
- Güncelleme: klasör yeniden kopyalanır, yukarıdaki tek satırlık uyarlama (gerekiyorsa) yeniden yapılır, bu dosyadaki tarih ve özetler yenilenir. Başka elle değişiklik yapılmaz; imza biçimi merkezle birlikte değişir.
- Kullanımı: `src/services/destek.service.ts` (istekler fabrikanın `lib/http-egress.ts` çıkışından geçer). Belge: `docs/ops/DESTEK-ENTEGRASYONU.md`.

| Dosya | sha256 |
|---|---|
| client.ts (uyarlanmış) | 1e4392103b5f29f375268dc8c61e04f439fca34964d2760573f6725462cdf0ec |
| errors.ts | 4b3966c28d662e788f451293831cc22cc4f3390a2d304e66ecb4097bd90b74f4 |
| index.ts | 35f42162414da3b6f88bec411b2f83787e79653afa7f8f8cd9159d5f5f8391df |
| signature.ts | 71d30c66815b44ea7145eb97008adee00d308dedf91c4bba817b9d1903452b78 |
| types.ts | 91a50647864d57ba1bb8234a2f9b287fa3139d396f867ee9db27bc93f160277d |
| webhook.ts | 06b0c8d5ea37cb9058038fa8082546334b7672de5b068161cd00eea821dd7761 |
