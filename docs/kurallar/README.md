# Alan kural dosyaları

> Kök `CLAUDE.md` her oturumda yüklenir ve yalnız ÇEKİRDEK'i taşır; bir alana dokunmadan önce buradaki dosya okunur. Dosyalar anlama turunda (2026-09-05) ayrıştırıldı; yeni karar notu **arşive** yazılır, buradaki ilgili dosyaya **tek kural satırı** eklenir.

| Alan | Dosya | Arşiv tarihleri |
|---|---|---|
| **Defter · Hareket tablosu · Ters kayıt · Hard delete** | `docs/kurallar/defter.md` | 2026-09-10 |
| Sevkiyat · Çuval · Brüt · Storno/İade | `docs/kurallar/sevkiyat.md` | 2026-08-02, 2026-08-03, 2026-08-05, 2026-08-21, 2026-08-22, 2026-08-25, 2026-09-13 |
| Fason · Kartela | `docs/kurallar/fason.md` | 2026-08-04, 2026-08-19 |
| Tambur · Finalize · Kesim · Geri alma | `docs/kurallar/tambur.md` | 2026-08-04, 2026-08-12, 2026-08-13, 2026-09-03 |
| Top düzeltme · İptal · Fire · Geri alma | `docs/kurallar/top-duzeltme.md` | 2026-07-13, 2026-08-05, 2026-08-06, 2026-08-12, 2026-08-19, 2026-08-21, 2026-08- |
| KK1 · İdempotency · Çevrimdışı kuyruk | `docs/kurallar/kk1.md` | 2026-08-05, 2026-08-12 |
| Kurşun planlama · Bypass | `docs/kurallar/kursun.md` | 2026-08-05, 2026-08-06 |
| İş emri · Sipariş bağı | `docs/kurallar/is-emri.md` | 2026-08-04, 2026-08-21, 2026-08-25, 2026-09-13 |
| Rota · Renk · Özellik · Kapsama | `docs/kurallar/rota-renk.md` | 2026-08-06, 2026-08-10, 2026-08-19, 2026-08-21, 2026-08-27 |
| Kalite · İstasyon yeteneği | `docs/kurallar/kalite.md` | 2026-08-02, 2026-08-06, 2026-09-03 |
| Parti (Batch) | `docs/kurallar/parti.md` |  |
| Yarı mamul | `docs/kurallar/yari-mamul.md` | 2026-08-26, 2026-08-27 |
| Dokuma · Dokuma işi · Doff · Tezgah karnesi | `docs/kurallar/dokuma.md` | 2026-09-13, 2026-09-14 |
| Refakat kartı | `docs/kurallar/refakat-karti.md` | 2026-08-05 |
| Belge · Etiket · Şablon | `docs/kurallar/belge-etiket.md` | 2026-07-30, 2026-08-05, 2026-08-13, 2026-09-04 |
| Mükerrer · nameFold seddi | `docs/kurallar/mukerrer.md` | 2026-08-21, 2026-08-22, 2026-08-25 |
| Sebep katalogları | `docs/kurallar/sebep-katalogu.md` | 2026-08-25, 2026-08-26 |
| Keşif · Cihaz · Ağ · Donanım | `docs/kurallar/kesif-cihaz.md` | 2026-09-04 |
| Sürüm · Yayın (panel/tablet) | `docs/kurallar/surum-yayin.md` | 2026-08-19, 2026-08-26, 2026-08-27, 2026-09-03 |
| Deploy · Kurulum · Migration | `docs/kurallar/deploy-kurulum.md` | 2026-08-26, 2026-09-04 |
| Modül anahtarları · Bayraklar · Profiller | `docs/kurallar/modul-bayrak.md` | 2026-09-02, 2026-09-03, 2026-09-04 |
| Süperadmin · Ayar şifresi | `docs/kurallar/superadmin.md` | 2026-09-03 |
| Yetki · İzin · Rol | `docs/kurallar/yetki-izin.md` | 2026-08-06, 2026-08-26, 2026-09-03 |
| Filtre · Liste · Arama · Sıralama | `docs/kurallar/filtre-liste.md` | 2026-08-06, 2026-08-12, 2026-08-27 |
| Raporlar · Karneler | `docs/kurallar/raporlar.md` | 2026-08-09 |
| Finans · Sağlamlık sınıfları | `docs/kurallar/finans.md` | 2026-08-02, 2026-09-13 |
| Genel · Uzak erişim · Konvansiyon | `docs/kurallar/genel.md` | 2026-09-01, 2026-09-13 |

> ⚠️ **"Arşiv tarihleri" kolonu ELLE tutulur ve KAPISI YOKTUR.** Ölçüldü 2026-09-14: 26 satırın 19'u dosyanın kendi en yeni arşiv atfının gerisinde (ör. `fason.md` kolonda 2026-08-19, dosyada 2026-09-14; `belge-etiket.md` 09-04 ↔ 09-14; `tambur.md` 09-03 ↔ 09-14) ve 9 dosyanın atıfları bu kolonun okuyamadığı biçimde (`R:…`, `CLAUDE.md:…`). ⇒ Bir alanın güncel arşiv tarihini bu kolondan OKUMA, dosyanın kendisinden ölç (`grep -oE 'arşiv:?[ ]?2026-[0-9-]+' docs/kurallar/<dosya>.md | sort | tail -1`). Kolon yalnız kaba bir işarettir; ölçülene dek bayat varsayılır.
