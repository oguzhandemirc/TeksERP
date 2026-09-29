# Hukuk taslakları — lisanslama

> **Durum: TASLAK — AVUKAT ONAYI BEKLİYOR.** Bu klasördeki metinlerin hiçbiri avukat onayı olmadan imzaya, panele ya da müşteriye çıkmaz. Kullanıcının 2026-09-29 lisanslama kararlarına ve onaylı lisanslama planına (Hukuk bölümü) göre Claude tarafından yazıldı. Her belgenin başında, avukatın özellikle bakması gereken FSEK, TBK, KVKK ve TCK 244 maddelerini listeleyen bir kutu var.

| Belge | Ne | Metin kimliği |
|---|---|---|
| `SON-KULLANICI-LISANS-SOZLESMESI.md` | Kalıcı lisans; kurulum ve tesis sınırı; yasaklar; son hak edilen sürüm; çevrimiçi denetim ve taşıma; lisans sınıfları; filigran ve kopya tespiti beyanı | `SKLS-2026.1` |
| `BAKIM-DESTEK-SOZLESMESI.md` | Yıllık bakım; güncelleme hakkı ve dağıtım yolu; yanıt süreleri; uzaktan erişim (Tailscale); yedek sorumluluğu | `BDS-2026.1` |
| `VERI-ISLEME-EKI.md` | Lisans yoklamasında giden alanlar tek tek; destek ve uzaktan erişimde veri işleyen; alt işleyenler; saklama süreleri; patron bulutu için ayrı ek iskeleti | `VIE-2026.1` |
| `YAPTIRIM-MADDELERI.md` | K0–K5 kademeleri; otomatik mekanizmalar; ödeme merdiveni, taksit, planlı eylem; "verilerimi al" kapısı; ihtar süreleri | `YM-2026.1` |
| `KABUL-METNI.md` | Panelde ilk kurulumda gösterilecek kısa metin; kabul kaydının içeriği ve yeri | `KM-2026.1` |

Mobil uygulamanın mağaza gizlilik politikası ayrı bir taslaktır: `docs/legal/GIZLILIK-POLITIKASI.md`. Lisans yoklaması devreye girince o metne de lisans bağlantısının bir satırı eklenmelidir. O metin bugün "geliştirici verilere erişmez" diyor.

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

## Açık kalanlar

- **Ticari:** lisans ve bakım bedelleri, modül fiyat listesi, taksit ve ödeme merdiveni süreleri, taşıma bedeli, yanıt süreleri, sorumluluk tavanı, ceza koşulu, yetkili mahkeme. Hepsi metinlerde `[DOLDURULACAK]` işaretli.
- **Bilgi eksik:** VDS sağlayıcısının ünvanı; uzak yedek hedefinin kimin hesabında olduğu; Lisans Veren'in ticari ünvanı ve KEP adresi.
- **Avukat kararı:** her belgenin başındaki kutu.
- **Patron bulutu eki:** ticari model belirlenince `VERI-ISLEME-EKI.md` Bölüm P ayrı bir belgeye çıkarılır ve tamamlanır.
