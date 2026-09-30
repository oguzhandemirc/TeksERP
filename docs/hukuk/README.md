# Hukuk taslakları — lisanslama

> **Durum: TASLAK — AVUKAT İNCELEMESİ BEKLİYOR.** Bu klasördeki metinlerin hiçbiri avukat onayı olmadan imzaya, panele ya da müşteriye çıkmaz. Kullanıcının 2026-09-29 lisanslama kararlarına ve onaylı lisanslama planına (Hukuk bölümü) göre Claude tarafından yazıldı. Her belgenin başında, avukatın özellikle bakması gereken FSEK, TBK, KVKK ve TCK 244 maddelerini listeleyen bir kutu var.
>
> **Kural (2026-09-30):** hukuk metni avukata giden metnin kendisidir. Hukuk metnine repo yolu, dosya adı, kod adı ya da geliştirici notu yazılmaz; belgeler birbirine belge adı ve Ek numarasıyla atıf yapar. Teknik ve geliştirici notları `UYGULAMA-NOTLARI.md`'ye yazılır; o dosya avukat paketine girmez.

| Belge | Ek | Ne | Metin kimliği |
|---|---|---|---|
| `SON-KULLANICI-LISANS-SOZLESMESI.md` | ana sözleşme | Kalıcı lisans; kurulum ve tesis sınırı; yasaklar; son hak edilen sürüm; çevrimiçi denetim ve taşıma; lisans sınıfları; filigran ve kopya tespiti beyanı; Ek listesi (§16) | `SKLS-2026.1` |
| `YAPTIRIM-MADDELERI.md` | Ek-2 | K0–K5 kademeleri; otomatik mekanizmalar; ödeme merdiveni, taksit, planlı eylem; "verilerimi al" kapısı; ihtar süreleri | `YM-2026.1` |
| `VERI-ISLEME-EKI.md` | Ek-3 | Lisans yoklamasında giden alanlar tek tek; destek ve uzaktan erişimde veri işleyen; alt işleyenler; saklama süreleri (patron bulutu KAPSAM DIŞI → Ek-6) | `VIE-2026.1` |
| `BAKIM-DESTEK-SOZLESMESI.md` | Ek-4 | Yıllık bakım; güncelleme hakkı ve dağıtım yolu; yanıt süreleri; uzaktan erişim (Tailscale); yedek sorumluluğu | `BDS-2026.1` |
| `PATRON-BULUTU-VERI-ISLEME-EKI.md` | Ek-6 | Patron bulutu (ayrı imzalanır): roller (fabrika sorumlu, Etkili Yazılım işleyen), veri kategorileri katalog sınıflarından, amaç ve hukuki sebep, VDS Türkiye, alt işleyenler ve KVKK md. 9 değerlendirmesi | `PBVIE-2026.1` |
| `PATRON-BULUTU-SAKLAMA-IMHA.md` | Ek-6/A | 3/13/25 ay/tümü geçmiş seçeneği, günlük budama, bulutta doğan verinin süreleri, abonelik bitişinde dışa aktarma + imha + yedekten düşme, imha kaydı | `PBSI-2026.1` |
| `PATRON-BULUTU-TEDBIRLER.md` | Ek-6/B | Teknik ve idari tedbirler: veri azaltma, RLS, izinler, parola + TOTP, imza ve şifreleme, barındırma, yedek, erişim kaydı | `PBTT-2026.1` |
| `PATRON-BULUTU-AYDINLATMA-METNI.md` | Ek-6/C | Uygulamada gösterilecek kısa + tam aydınlatma metni (fabrika adına), fabrikanın genel metnine eklenecek cümle | `PBAM-2026.1` |
| `KABUL-METNI.md` | Ek-7 | Panelde ilk kurulumda gösterilecek kısa metin; kabul kaydının içeriği ve yeri | `KM-2026.1` |
| `VERI-IHLALI-BILDIRIM-PROSEDURU.md` | Ek-8 | İhlal bildirimi: işleyenden sorumluya en geç 24 saat (öneri), sorumludan Kurul'a 72 saat; roller, içerik, kayıt (Ek-3 ve Ek-6 için ortak) | `VIBP-2026.1` |
| `docs/legal/GIZLILIK-POLITIKASI.md` | ayrı belge | Mobil uygulamanın mağaza (Google Play) gizlilik politikası; sözleşme eki değil | — |
| `UYGULAMA-NOTLARI.md` | — | Hukuk metinlerinden çıkarılan teknik ve geliştirici notları, hazırlanış kaynağı, metne olgu olarak yazılan yerlerin kod kaynağı. **Avukat paketine girmez.** | — |

Ek-1 (Lisans Belgesi) her kurulum için elektronik olarak üretilir; Ek-5 (fiyat ve ödeme planı) ticari karardır — ikisi de bu klasörde değildir. Ek numaralarının tek kaynağı Lisans Sözleşmesi §16'dır: bir belge eklenir ya da çıkarılırsa önce §16, sonra bu tablo ve belgelerin "Metin kimliği" satırı değişir.

Mobil uygulamanın gizlilik politikası (`docs/legal/GIZLILIK-POLITIKASI.md`) avukat paketine ayrı belge olarak girer. Lisans yoklaması devreye girince o metne de lisans bağlantısının bir satırı eklenmelidir. O metin bugün "geliştirici verilere erişmez" diyor.

## Metinlerin koda bağlı olduğu sayılar

Sözleşmeler aşağıdaki değerleri müşteriye TAAHHÜT eder. Koddaki değer değişirse metin de değişir, ya da tersi. Teknik kaynak: `docs/design/LISANS-PROTOKOLU.md`.

| Taahhüt | Metindeki değer | Protokoldeki karşılığı |
|---|---|---|
| Kullanım Onayı süresi | varsayılan 30 gün, en çok 45 gün | kira `bitis − verilis` ≤ 45 gün |
| Ek Süre | 30 gün | kira `ekSureGun` (protokol 0–60'a izin verir; **30'un altı sözleşmeye aykırıdır**) |
| Yoklama aralığı | saatte bir | `yoklamaAraligiDk` varsayılan 60 |
| İnternetsiz çalışma | yaklaşık 60 gün | kira + ek süre |
| Kısıtlı kipe zamanla geçiş | iki şart: ek süre bitti **ve** son 24 saatte yenileme gerçekten başarısız | durum kuralı 4 (iki anahtar) |
| Yaptırım ek sürede gevşemez | K1–K5, donmuş modül, DR devri son geçerli kiradan kalır | yönetici kararı 2026-09-29 (protokol §11'deki "K2 ek sürede açılır" notunun yerine geçer) |
| Makine parmak izi | beş değer; MAC ve işlemci kimliği YOK; ham değer gitmez | etken listesi (yönetici kararı 2026-09-29: dördüncü etken anakart/sistem seri numarası; protokol §6'daki MAC satırı bu kararla güncellenecek) |
| Yoklama alanları | Veri İşleme Eki Bölüm A'daki tablo | `PollRequestSchema`, `HealthSummarySchema`, `EnvironmentSchema`, `StateSummarySchema` (sıkı şema) |
| Tekrar oynatma kaydı | 10 dakika | nonce saklama `zaman` + 10 dk |
| Verilerime erişim | her kademede açık, "verilerimi al" kapısı dahil | lisans kapısının her kademede açık yol listesi |
| Patron bulutu önbelleği (Ek-6/B §1.5) | uygulamanın korumalı alanı, ayrıca şifrelenmez; oturum anahtarı güvenli depoda | `patron/uygulama/src/state/store.ts` · `cache.ts` · `session.tsx` (`UYGULAMA-NOTLARI.md`) |
| Bulutta sunulmayan rapor (Ek-6 §3.5) | operatör performans raporu | `REPORTS_NOT_IN_CLOUD` · `REMOTE_REPORTS` (`UYGULAMA-NOTLARI.md`) |
| Bulut girişi kilidi (Ek-6/B §1.4) | art arda 5 hatalı deneme → 15 dk kilit; IP başına dakikada 20 giriş isteği | `GIRIS_ESIGI` · `KILIT_DK` · `GIRIS_HIZ_DK` (`patron/sunucu/src/config.ts`) |
| Bulut yedeği (Ek-6/A §4.4, Ek-6/B §1.7) | günlük, 30 gün döngü | `YEDEK_ARALIK_SAAT` · `YEDEK_SAKLA_GUN` (`deploy/patron/yedek-dongusu.sh`) |
| Yoklama kayıtları ve sağlık özetleri (Ek-3 D) | 90 gün | `YOKLAMA_SAKLAMA_GUN` (`satici/sunucu/src/config.ts`) |
| Rapor istekleri ve sonuçları (Ek-6/A §2.4) | 30 gün | `RAPOR_SONUC_SAKLAMA_GUN` (`patron/sunucu/src/config.ts`) |
| Gelen Kutusu (Ek-6/A §2.4) | tesisin geçmiş seçeneği kadar | tesis `retentionMonths` (`patron/sunucu/src/services/maintenance.ts`) |
| Web bildirim hizmetleri (Ek-6 §6.1) | Google, Mozilla, Apple, Microsoft | `WEB_PUSH_HOSTS` (`patron/sunucu/src/push/targets.ts`) |
| Bildirim içeriği (Ek-6 §6.2, Ek-6/C §3) | cari ve kişi adı yok; toplam tutar olabilir | `patron/sunucu/src/services/notification-events.ts` |
| Hizmet bitişinden sonra erişim (Ek-6/A §4.2) | 90 gün salt okuma + JSON/CSV dışa aktarma | **kod borcu** — ayrı dilim (`UYGULAMA-NOTLARI.md`) |
| Kapatılan bulut hesabının kimlik verisi (Ek-6/A §2.5, Ek-6/C §3) | 30 gün içinde silinir | **kod borcu** — ayrı dilim |
| Erişim kayıtları (IP) (Ek-3 D, Ek-6/A §2.4) | 30 gün, zamana göre | **işletim borcu** — bugün boyuta göre dönüyor |
| Doğrudan veritabanı sorgusu (Ek-6/B §3.2) | ayrı salt okunur destek rolü + oturum kaydı | **işletim borcu** — hizmet açılmadan kurulur |
| Kabul kaydı olmadan etkinleştirme (Ek-7 §5) | satıcı reddeder; panel önce kabul adımını gösterir | **kod borcu** — satıcı + panel |

## Avukata ön not

Bu pakette lisans sözleşmesi, ekleri ve mobil uygulamanın gizlilik politikası taslak olarak yer alır. Hiçbiri avukat onayı olmadan imzaya, panele ya da müşteriye çıkmaz. Belgeler birbirine Ek numarasıyla atıf yapar; Ek numaraları Lisans Sözleşmesi §16'da tanımlıdır.

- **Avukat kararı:** Her belgenin başındaki kutu, o belgede özellikle bakılmasını istediğimiz FSEK, TBK, KVKK ve TCK maddelerini listeler. Metin içindeki "[avukat]" ve "[avukat: …]" işaretleri de avukat teyidi beklenen yerlerdir.
- **Şirket kuruluşu:** Lisans Veren Etkili Yazılım'ın resmî kuruluşu sürüyor. Ticaret unvanı, adresi, vergi dairesi ve numarası, MERSİS numarası, KEP adresi, telefonu ve yetkili mahkemenin ili "[Lisans Veren … — kuruluş tamamlanınca]" alanlarında duruyor; kuruluş tamamlanınca doldurulacak. Metinde kısa ad "Etkili Yazılım" kullanıldı; iletişim adresi info@etkiliyazilim.com.
- **Ticari kararlar:** bakım bedeli (lisans bedelinin %15'i), teklif bazında fiyatlandırma, bakımın kendiliğinden yenilenmesi, bütün ekler için tek sorumluluk tavanı, ceza koşulu, iade yapılmaması ve patron bulutunun ayrı yıllık abonelikle satılması metne işlendi. Bildirim, giderme, saklama ve yanıt süreleri taslağa önerilen değerleriyle işlendi; yazılımda ölçülebilen yerlerde yazılımın gerçek değeri yazıldı.
- **Şablon alanları:** Köşeli parantez içindeki "[Lisans Alan unvanı]" gibi Lisans Alan alanları ve "[Bakım başlangıç tarihi]" sözleşme imzalanırken, "[Yürürlük tarihi]" ve "[Yayın tarihi]" metin yayımlanırken doldurulur. Aydınlatma Metni'ndeki (Ek-6/C) {…} alanlarını uygulama, ilgili tesisin kaydından doldurur.
- **Eksik bilgi:** barındırma sağlayıcısının adı teyit edilince alt işleyen listelerine (Ek-3 C, Ek-6 §6.1) yazılacak; metinde bugün "Türkiye'de yerleşik barındırma sağlayıcısı" diye geçiyor.
- **Patron bulutu ekleri (Ek-6, Ek-6/A–C, Ek-8):** açık nokta yurt dışı alt işleyenlerle standart sözleşmenin imzalanabilirliğidir (Ek-6 §6.4); imzalanamazsa bildirimler içeriksiz "uyandırma" bildirimine iner. Tedbirler eki (Ek-6/B) bir taahhüt listesidir: hizmet satışa açılmadan her tedbirin uygulanmış ve doğrulanmış olması öngörülür.
- **Mobil Gizlilik Politikası (ayrı belge):** metin bugün "Uygulama geliştiricisi bu verilere erişmez" diyor (§1). Lisans yoklaması devreye girince bu metne lisans bağlantısına ilişkin bir satır eklenmesi gerekir.

## Açık kalanlar (iç)

- Yukarıdaki ön notun iç karşılığı: tedbirler ekinin her maddesi hizmet açılmadan uygulanmış ve Senaryo P ile ölçülmüş olmalıdır (`UYGULAMA-NOTLARI.md`).
- Patron bulutu ekleri 2026-09-29'da B7 diliminde taslak olarak yazıldı.
- 2026-09-30: hukuk metinlerinden çıkarılan iç notlar, iki olgu dolgusunun (Ek-6 §3.5, Ek-6/B §1.5) kod kaynağı ve Ek numaralandırmasının gerekçesi `UYGULAMA-NOTLARI.md`'dedir.
- 2026-09-30 ikinci tur: 112 "[DOLDURULACAK]" işaretinin 44'ü öneriyle, 17'si koddan ya da işletim belgelerinden olguyla dolduruldu, 6'sı şablon alanı oldu; kalan 45'i karar sorusu olarak kullanıcıya gitti.
- 2026-09-30 üçüncü tur: kullanıcının 15 cevabı işlendi; metinde "[DOLDURULACAK]" kalmadı. Kalanlar şablon alanıdır (Lisans Veren alanları şirket kuruluşuyla, Lisans Alan alanları imzada, tarihler yayında dolar). Cevap ↔ yer tablosu, kod ve işletim borçları `UYGULAMA-NOTLARI.md`'de.
