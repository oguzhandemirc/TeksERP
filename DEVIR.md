# O11b devir (dal gece/ortak-paket-o11b, taban o11a + o13b merge)
Yapıldı: deploy/backend-yayinla.mjs --grup; scripts/lib/grup-yayin.mjs (YENI_ADRES_KAPISI.acik=false, grupTerfiKapisi); backend-bildirim.ts dogrula|imzala --ortak (ortakPaketiAc ortak-dogrula ile tek gövde); bekçi test_backend_yayin §3G (104 geçti); hook adımı "backend grup yayını"; belgeler.
Açık: gerçek yükleme D5 + D8 ile (kapıyı açan dilim sabiti değiştirir, §3G8 kasten güncellenir); `imzala --ortak` gerçek anahtarla ölçülmedi (anahtar dosyası yok); panel/tablet grup yayını O10a/O10b; o10a dalı bu tabana merge EDİLMEDİ (TUKETICILER listesinde çakışma beklenir).
CI'ya test_backend_yayin eklenmedi (CI scripts işinde Teks-Erp node_modules yok).
