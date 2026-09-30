# Hukuk metinleri — uygulama notları

> **Bu dosya avukat paketine GİRMEZ.** Hukuk metinlerinden 2026-09-30'da çıkarılan teknik ve geliştirici notlarını, belgelerin hazırlanış kaynağını ve metne olgu olarak yazılan yerlerin kod kaynağını taşır. Kural `README.md`'dedir: hukuk metnine repo yolu, dosya adı, kod adı ya da geliştirici notu yazılmaz; buraya yazılır.

## Hazırlanış kaynağı

- Lisans metinleri (Lisans Sözleşmesi, Ek-2, Ek-3, Ek-4, Ek-7) kullanıcının 2026-09-29 lisanslama kararlarına ve onaylı lisanslama planına (Hukuk bölümü) göre Claude tarafından yazıldı. Kabul Metni'nin (Ek-7) dayandığı karar: "ilk kurulumda panelde kabul adımı; kabul kaydı kurulum geçmişine".
- Patron bulutu ekleri (Ek-6, Ek-6/A–C) ve ihlal prosedürü (Ek-8) kullanıcının 2026-09-29 patron bulutu kararlarına ve eşitleme sözleşmesi v1 tasarımına göre Claude tarafından yazıldı: `docs/design/PATRON-BULUTU.md`, `docs/design/PATRON-BULUTU-ESITLEME.md` §1, §9–§11; saklama ve imha için `docs/design/PATRON-BULUTU-ESITLEME.md` §9.5.

## Ek numaraları ve adlar

- Ek numaralarının tek kaynağı Lisans Sözleşmesi §16'dır; dosya ↔ Ek eşlemesi `README.md` tablosundadır. Belgeler birbirine "Belge adı (Ek-N)" biçiminde atıf yapar; 2026-09-30'a kadar dosya adıyla yapıyordu (81 atıf çevrildi).
- Ek-7 (Kabul Metni) ve Ek-8 (Kişisel Veri İhlali Bildirim Prosedürü) §16'ya 2026-09-30'da eklendi. Ek-8 hem Ek-3 (Bölüm B.4) hem Ek-6 için ortaktır; bu yüzden Ek-6'nın alt numarası değildir.
- Metinlerdeki "Patron Bulutu hakkı", Lisans Belgesi'ndeki `patron-bulut` hak anahtarıdır.

## Veri İşleme Eki (Ek-3)

- Bölüm A'daki alan listesi yazılımın lisans protokolünden birebir alınmıştır (`docs/design/LISANS-PROTOKOLU.md`); protokole alan eklenirse ek de yeni sürüm alır (`README.md` "Metinlerin koda bağlı olduğu sayılar").
- Bölüm P'de daha önce duran patron bulutu iskeleti Patron Bulutu Veri İşleme Eki'ne (Ek-6) taşındı ve tamamlandı.

## Yaptırım Maddeleri (Ek-2) §5.3

- Ticari kararın kaynağı: kullanıcı "ödemezse lisansını dondurabileyim" dedi. §5.3'teki sıralama cümlesi bu hakkı merdivene bağlar ve hukuki riski azaltmak için önerildi; avukat ve kullanıcı birlikte karar verir.

## Kabul Metni (Ek-7)

- Eski §4.3 (eski §4.4 şimdi §4.3): Kabulün sistem günlüğüne (audit) de bir ayak izi düşer, ama kabulün **kaynağı** §4.2'deki kayıttır; audit'ten kabul bilgisi türetilmez.
- Eski §7 "Uygulayıcılar için notlar":
  - Lisans protokolü v:1'de kabul kaydı için alan yoktur. Protokolün sürüm kuralı, v:1 içinde yalnız "yok sayılabilir" alan eklenmesine izin verir (`docs/design/LISANS-PROTOKOLU.md` §9). Kabul kaydı etkinleştirme isteğine isteğe bağlı bir alan olarak ya da ayrı bir istek amacıyla eklenir. Karar, lisans motorunun ve satıcı sunucusunun sahibine aittir.
  - Tam metinler ve özetleri tek kaynaktan gelir: Lisans Veren'in onaylı son metni. Panel metni kendi içinde kopyalamaz; aksi hâlde gösterilen metin ile kaydedilen özet ayrışır.

## Patron Bulutu Veri İşleme Eki (Ek-6)

- Bu ek, Veri İşleme Eki'nin (Ek-3) Bölüm P iskeletinin yerini aldı.
- §3.1'in teknik kaynağı: `docs/design/PATRON-BULUTU-ESITLEME.md` §3 ve §11 (projeksiyon kataloğu, veri sınıfları). Metindeki "yazılımın projeksiyon kataloğu" önceden "eşitleme sözleşmesinin projeksiyon kataloğu" idi; oradaki "sözleşme" teknik tel sözleşmesidir, hukuki sözleşme değil.
- §3.5'teki "buluta gitmeyenler" listesi teknik olarak kataloğun "dışarıda" listesiyle ölçülür.
- **§3.5 olgu dolgusu (2026-09-30; önceki işaret: "[DOLDURULACAK — v1 kararı: operatör performans raporu bulutta sunulmaz]").** Metin artık "kişi adı taşıyan performans raporları (operatör performans raporu bulutta sunulmaz)" der. Kaynak: fabrika tarafında buluttan istenebilir raporlar `Teks-Erp/src/cloud-sync/report-requests.ts` `REMOTE_REPORTS` (sekiz rapor, hepsi `personalData: "YOK"`; `production/operator-performance` listede yok); bulut tarafında `patron/sunucu/src/catalog/reports.ts` `REPORTS_NOT_IN_CLOUD` (`audit/*`, `production/operator-performance` → 404 `RAPOR_BULUTTA_YOK`); kural `docs/kurallar/patron-bulutu.md` ("kişi adı taşıyan rapor buluttan istenemez"); bekçi `patron/sunucu/scripts/test_rapor_istegi.ts`.

## Saklama ve İmha Prosedürü (Ek-6/A)

- §4.1'deki "Kullanım Onayı'nda yazılı patron bulutu bitiş tarihi" kira alanı `patronBulutBitis`tir (`Teks-Erp/src/lib/license/protocol/belgeler.ts` `LeaseSchema`; `docs/design/LISANS-PROTOKOLU.md` kira alanları tablosu).

## Teknik ve İdari Tedbirler (Ek-6/B)

- Yazım kuralı: bu ek bir taahhüt listesidir. Uygulanmamış bir tedbir metinden çıkarılır ya da [DOLDURULACAK] olarak işaretlenir; metin kodun önüne geçemez.
- §4'teki kabul senaryosu Senaryo P'dir (`docs/design/PATRON-BULUTU.md`).
- **§1.5 olgu dolgusu (2026-09-30; önceki işaret: "[DOLDURULACAK — B4 dilimi yöntemi]").** Metin artık önbelleğin uygulamanın korumalı alanında durduğunu, uygulamanın onu ayrıca şifrelemediğini, oturum anahtarının işletim sisteminin güvenli deposunda (web'de yalnız sekme açıkken) tutulduğunu ve önbelleğin ne zaman silindiğini yazar. Kaynak: `patron/uygulama/src/state/store.ts` — oturum belirteci `secretStore` (`expo-secure-store`: iOS Keychain / Android Keystore; web'de `sessionStorage`), son veri önbelleği `plainStore` (`@react-native-async-storage/async-storage` 2.2.0; web gerçekleştirimi tarayıcının `localStorage`'ı); `patron/uygulama/src/state/cache.ts` — `patron:onbellek:` önekli kayıtlar, yetki (403) ya da bulunamadı (404) yanıtında o kayıt silinir, `clearCache` hepsini siler; `patron/uygulama/src/state/session.tsx` — `reset` (çıkış ve 401) ve `login` (her yeni giriş) `clearCache` çağırır. Önbelleği şifreleyen bir katman kodda yok; şifreleme istenirse önce kod, sonra metin değişir.

## Aydınlatma Metni (Ek-6/C)

- Eski §4 "Uygulama için teknik notlar (metnin parçası değildir)" çıkarıldı; eski §5 artık §4:
  - Kısa ve tam metin **sunucudan** gelir (sürüm kimliği + SHA-256 özeti); uygulama metni gömülü taşımaz. Böylece metin değişince yeni sürüm gerekmez ve okundu kaydı hangi metnin gösterildiğini kanıtlar.
  - `{…}` yer tutucuları Tesis kaydından doldurulur; eksik alan varsa metin gösterilmez ve tesis yöneticisine "aydınlatma bilgileri eksik" uyarısı çıkar (eksik kimlikle metin yayınlanmaz).
  - Okundu teyidi hesap güvenlik kaydına yazılır; bu bir rıza değildir, kullanıcıya rıza gibi sunulmaz.

## Mobil Gizlilik Politikası (`docs/legal/GIZLILIK-POLITIKASI.md`, ayrı belge)

- Veri akışları `mobil/` kaynak kodundan çıkarılmıştır.
- Yayın: herkese açık, sabit bir URL'de barındırılmalı (GitHub Pages veya şirket sitesi). Play Console → Store listing → Privacy policy alanına bu URL girilir (akış: `docs/ops/PLAY-STORE-YAYIN.md`).
- Doldurulacak yer işareti 2026-09-30'da paketteki diğer belgelerle aynı biçime ("[DOLDURULACAK]") çevrildi.
