# TeksERP — Kullanıcı Kabul Test Senaryoları (UAT)

Bu doküman, otomatik testlerin (backend 38 dosya · Electron 41 · mobil 19) KAPSAMADIĞI
**kullanıcı/UI ve fiziksel akışlar** için adım-adım manuel test senaryolarıdır.
Otomatik testler iş mantığını doğrular; bu senaryolar gerçek ekran + gerçek cihazla
doğrulanır.

**Kullanım:** her senaryoyu sırayla uygula, **Beklenen** ile karşılaştır, Sonuç sütununa
✅/❌ yaz. Test kullanıcısı: `admin / 123123` (tam yetki). Saha senaryoları için ilgili
`mobile:*` izinli kullanıcı.

Öncelik: 🔴 kritik (para/stok/sevk) · 🟡 önemli · 🟢 ikincil.

---

## 1. Giriş & Yetki 🔴
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 1.1 | Admin girişi | admin/123123 ile gir | Tüm modüller görünür | |
| 1.2 | Yetkisiz kullanıcı | Yeni kullanıcı (izinsiz) ile gir | "Yetkiniz yok" / giriş engeli; hiçbir modül açılmaz | |
| 1.3 | Kısmi yetki | Yalnız `order:read` atanmış kullanıcı | Sipariş görür, "Yeni/Düzenle" butonları gizli/403 | |

## 2. Sipariş & İsim Standardı 🟡
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 2.1 | Sipariş no override (#16) | Yeni sipariş, "Sipariş No" boş bırak → kaydet | Otomatik `YYYYAAGG-N` üretilir | |
| 2.2 | Manuel sipariş no | "Sipariş No" elle gir → kaydet | Girilen no kullanılır; aynı no 2. kez → hata | |
| 2.3 | Ürün adı BÜYÜK (#13) | "test ürün" adıyla ürün ekle | Liste/detayda "TEST ÜRÜN" | |
| 2.4 | Renk normalize (#13) | "beyaz 055" adıyla renk ekle | "055-BEYAZ" olarak kaydedilir | |
| 2.5 | Türkçe arama | Ürün/renk aramada "siyah" yaz | BÜYÜK "SİYAH" kayıt bulunur (İ/ı katlanması) | |

## 3. Renk Ekleme (#12) 🟢
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 3.1 | Picker'dan hızlı renk | Sipariş/WO renk seçicide "Yeni Renk Ekle" → ad+hex | Renk anında oluşur + seçili gelir | |
| 3.2 | Toplu renk | Renkler sayfası → "Toplu Ekle" → çok satır (`ad #RRGGBB`) | Her satır ayrı renk; hatalı satır listede kalır | |

## 4. Yurtiçi / Yurtdışı Sevkiyat (#19, #22) 🔴
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 4.1 | Yurtiçi default | Mobil Paketleme'de yeni sevkiyat aç | Kapsam "Yurtiçi" seçili gelir | |
| 4.2 | Yurtiçi tartısız sevk | Yurtiçi sevk, çuvala kod ver ama TARTMA → Sevke Hazır | İzin verilir (tartı zorunlu değil) | |
| 4.3 | Yurtdışı tartı zorunlu | Yurtdışı seç, tartısız çuval → Sevke Hazır | "Tartısı girilmemiş (yurtdışı)" engeli | |
| 4.4 | Rozet & filtre | Çuval Depo (Electron) | Her kartta Yurtiçi/Yurtdışı rozeti + üst filtre çalışır | |
| 4.5 | Kapsam değiştir | Çuval Depo slide-over'da kapsam toggle | Anında değişir; EXPORT'ta tartı uyarısı | |

## 5. Prosedür/İhracat Kodu (#21) 🟡
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 5.1 | Kod gir | Çuval Depo slide-over → Prosedür No düzenle → kaydet | Kod kaydedilir, kartta görünür | |
| 5.2 | Varsayılan | Kod boşsa | Müşteri/şube `code`'u gösterilir | |

## 6. Çuval & Top Arama (#1, #23) 🟡
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 6.1 | Ürüne göre | Operasyon → Çuval & Top Arama → ürün filtre | O ürünü içeren çuvallar + eşleşen adet/metre | |
| 6.2 | Çuval içeriği | Sonuç satırını genişlet | Çuvaldaki toplar (barkod/ürün/renk/metre) lazy gelir | |
| 6.3 | Top nerede | Barkod okut/yaz → "Topu Bul" | Topun çuvalı + sevkiyatı + statüsü | |
| 6.4 | Sevk edilmiş | "Sevk edilmişleri de ara" işaretle | DISPATCHED çuvallar da listeye girer | |

## 7. Çuval Düzeltme — mobil (#3, #4) 🔴
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 7.1 | Çuvaldan çıkar | TartıPaket → Çuval Düzeltme → top okut → "Çuvaldan Çıkar" | Top serbest depoya döner; READY+ ise tartı sıfırlanır + uyarı | |
| 7.2 | Başka çuvala taşı | Top okut → "Başka Çuvala Taşı" → hedef seç | Top hedefe taşınır; iki çuvalın tartısı sıfırlanır | |
| 7.3 | İki topu takasla | Top okut → "İki Topu Takasla" → 2. topu okut | Çuvalları yer değiştirir (aynı sevkiyat); farklı sevkiyatta engel | |
| 7.4 | Çuvalı tart | İçerik değişiminden sonra "Çuvalı Tart" → kg | Tartı kaydedilir; READY akışı tekrar kapanır | |
| 7.5 | Etiket değiştir (#4) | Top okut → "Etiket Değiştir" → renk/en/kalite → kaydet | Etiket güncellenir + yeni etiket basılır (yazıcı); commit'li sevkiyatta engel | |

## 8. 300-Çuval UX — mobil (#8) 🟡
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 8.1 | Çok çuval | Paketleme'de 20+ çuval aç | Arama kutusu çıkar; yalnız aktif + son 20 render (akıcı) | |
| 8.2 | Çuval ara/atla | Arama kutusuna kod/sıra no | Eşleşen çuval(lar) listelenir | |
| 8.3 | Tümünü göster | "N çuval daha göster" | Kalan çuvallar açılır; "Listeyi daralt" geri toplar | |

## 9. Sevkiyat Yeniden Hedefleme (#7) 🔴
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 9.1 | PREPARING retarget | Sevkiyatlar → detay → "Siparişleri Değiştir" → farklı sipariş seç | Sipariş kümesi değişir | |
| 9.2 | READY retarget | Sevke hazır sevkiyatta retarget | Eski siparişin karşılanması düşer, yeniye yazılır | |
| 9.3 | DISPATCHED engel | Sevk edilmiş sevkiyatta "Siparişleri Değiştir" butonu | Görünmez (engelli) | |

## 10. Muhasebe / Sevk Edilenler (#2) 🔴
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 10.1 | Liste | Operasyon → Sevk Edilenler (Muhasebe) | Yalnız DISPATCHED sevkiyatlar; tarih/müşteri filtresi | |
| 10.2 | Fiş önizleme | Satırda "Fiş" | 3 bölüm: Ürün/Çuval/Çeki Listesi (ornek-fis düzeni) | |
| 10.3 | Fiş yazdır 🖨️ | "Yazdır" | Yazıcıdan 3 bölüm çıkar; çeki'de kg yalnız çuvalın ilk topunda | |
| 10.4 | Toplu etiket 🖨️ | "Toplu Etiket" | Sevkiyatın tüm toplarının etiketi tek belgede, her top ayrı sayfa | |

## 11. Ham Kumaş Satışı + Hızlı Sipariş (#10, #11) 🟡
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 11.1 | Hızlı sipariş | TartıPaket → Hızlı Sipariş → ham toplar okut → müşteri seç → oluştur | Toplar spec'e göre satırlara gruplanır; sipariş açılır; STOK toplar WAREHOUSE | |
| 11.2 | Önizleme | Toplar okutulurken | "Sipariş Satırları (önizleme)" doğru gruplar | |
| 11.3 | Ham sevk | Ham (renksiz) toplarla normal sevk | Kapsama renk-null eşleşir; sevk tamamlanır | |

## 12. Etiket & KK2 (#6, #18) 🟢
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 12.1 | Etiket kopya adedi (#6) 🖨️ | Genel Ayarlar → Etiket Baskısı = 2 → bir top etiketi bas | 2 kopya çıkar (üst+alt) | |
| 12.2 | Top adı şablonu (#20) | Etiket Baskısı → şablon değiştir → önizleme | Önizleme anında güncellenir; listelerde birleşik ad uyar | |
| 12.3 | KK2 genel hata (#18) | Mobil KK2 → hata ekle | "GENEL" butonu en başta; tip seçmeden hata girilebilir | |

## 13. Rota Fason Firma (#14) 🟡
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 13.1 | Rotaya fason firma | Rota Tasarımcısı → fason adıma firma/kategori ata → kaydet | Kaydedilir + geri okunur | |
| 13.2 | WO'ya akış | Bu rotadan iş emri oluştur | Fason firma/kategori WO adımına kopyalanır | |

## 14. Makine Donanımı (cihaz tablosu) 🟢
| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---|---|---|---|
| 14.1 | Kayıt ekle | Tanımlar → Makine Donanımı → Yeni → makine + yazıcı IP/MAC + RS232 MAC + regex desen | Kaydedilir; makine başına tek kayıt | |
| 14.2 | Düzenle | Mevcut kaydı düzenle → deseni değiştir | "Cihaz/kodlama değişti" senaryosu: yeni desen kaydedilir | |
| 14.3 | Seed örnekleri | `npm run seed` sonrası | KK1/KK2/Tambur için 3 örnek config görünür | |

## 15. Fiziksel / Donanım — ZORUNLU MANUEL 🔴
> Bunlar simülasyon/otomatik test KAPSAMI DIŞINDADIR (gerçek cihaz şart).
| # | Senaryo | Beklenen | Sonuç |
|---|---|---|---|
| 15.1 | Top etiketi baskısı (Tambur/KK1) | Etiket doğru hizalı, barkod/QR okunur, kopya adedi doğru | |
| 15.2 | Sevk irsaliyesi baskısı | İçerik + künye + çuval dökümü tam | |
| 15.3 | Fason sevk / kartela çeki baskısı | Donmuş belge düzeni doğru | |
| 15.4 | Muhasebe fişi (3 bölüm) baskısı | ornek-fis.pdf ile birebir | |
| 15.5 | Barkod okuyucu (HID/kamera) | Okutma istasyon akışını tetikler | |
| 15.6 | Tartı/RS232 köprü | (Faz-1 simüle — gerçek entegrasyon ileride) | |

---

## Otomatik test kapsamı (referans — bunlar zaten yeşil)
- **Backend** `cd Teks-Erp && npm test` → 38 dosya (sevk yaşam döngüsü, durum geçişleri,
  çuval işlemleri, kapsama, fason, tambur, izin/cihaz/dashboard, vb.).
- **Electron** `cd Electron && npm test` → 41 test (RBAC, util'ler, zod şema, fiş bileşeni).
- **mobil** `cd mobil && npm test` → 19 test (RBAC hook, barkod, query, zaman).
- Tümü: `bash run-tests.sh` (+ `--tsc`). CI: `.github/workflows/ci.yml` (her push/PR).
