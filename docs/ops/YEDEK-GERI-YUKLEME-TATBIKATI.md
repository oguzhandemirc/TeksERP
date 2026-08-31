# Yedekten Geri Yükleme Tatbikatı

> **Bu belge PROSEDÜR DEĞİL, PROVADIR.** Nasıl geri yükleneceği
> [`DEPLOY-RUNBOOK.md §5`](DEPLOY-RUNBOOK.md) içinde zaten yazılı. Buradaki soru
> başka: **o yol gerçekten çalışıyor mu, ve ne kadar sürüyor?**
>
> Denetim bulgusu (2026-08-29, T1-023): yedek her gece alınıyor ama **bir kez
> bile geri yüklenmedi.** "Yedek alınıyor" ile "yedekten dönülebiliyor" ayrı iki
> iddiadır; ikincisi denenmeden bilinmez. Gerçek bir felakette geri yükleme
> yolunun çalışıp çalışmadığını ilk kez o an öğrenmek, kabul edilebilir bir risk
> değil.

## Neden bu prova güvenli

Panel yedeği **canlı veritabanının üzerine yazmaz**. `<canlı>_restore_<damga>`
adında **yeni bir veritabanı** yaratır, doldurur ve doğrular. Backend o
veritabanına hiç bağlanmaz.

**Yani Faz A boyunca fabrika çalışmaya devam eder ve canlı veriye tek bayt
dokunulmaz.** Beğenmezseniz kopyayı silersiniz, hiçbir şey kaybolmaz.

Bu yüzden tatbikat **vardiya içinde de yapılabilir**. Yalnız Faz B (takas)
kesinti gerektirir ve bu provada **yapılmaz**.

---

## Hazırlık (5 dakika)

| Kontrol | Nerede | Beklenen |
|---|---|---|
| Yedek dosyası var mı | Panel → **Sistem → Yedekler** | En az bir `tekserp_*.dump`, tarihi dünden eski değil |
| Disk boş alanı | Sunucu | Veritabanı boyutunun **1,2 katından fazla** — azsa panel zaten bloklar |
| Yetki | Giriş yaptığınız hesap | `admin:settings` **ve** `admin:users` — ikisi birden gerekiyor |

⚠️ Yedek listesi boşsa tatbikattan önce cevaplanacak soru şu: `BACKUP_DIR`
tanımlı mı? Tanımsızsa **hiç yedek alınmıyordur** ve tatbikat değil, o
düzeltilir.

---

## Prova (Faz A — kesinti YOK)

Panel → **Sistem → Veritabanı Geri Yükleme**

1. **Yedeği seçin** ve "Kopyaya geri yükle" deyin.
2. Adımların ilerlemesini izleyin (kopya yaratılıyor → `pg_restore` → ayarlar
   replay ediliyor → doğrulama).
3. **Doğrulama raporunu okuyun.** Yedi başlık var; hepsinin yeşil olması gerekir:

   | Başlık | Ne söylüyor |
   |---|---|
   | Kopyaya bağlantı | Kopya gerçekten açılabiliyor |
   | Karakter kümesi ve sıralama (collation) | Türkçe harfler ve sıralama canlıyla **birebir** |
   | Veritabanı sahibi | Sahiplik doğru — yanlışsa backend bağlanamaz |
   | Veritabanı ayarları (`statement_timeout` vb.) | Canlının ayarları replay edilmiş (⚠️ aşağı bakın) |
   | Şema sürümü (migration) | Migration defteri canlıyla aynı hizada |
   | Veritabanı boyutu | Kopya canlıya yakın boyutta — çok küçükse yedek eksik |
   | `pg_restore` uyarıları | Geri yükleme sessiz mi, yoksa atlanan nesne var mı |

### Kaydedilecek üç sayı

Tatbikatın çıktısı "çalıştı" değil, **bu üç sayıdır** — felaket anında ne kadar
bekleyeceğinizi ancak bunlar söyler:

| Ölçüm | Nereden | Not |
|---|---|---|
| **Yedek boyutu** | Yedekler ekranı | Büyüdükçe süre artar |
| **Faz A süresi** | Başlangıç–bitiş saati | Kesintisiz kısım |
| **Faz B tahmini** | Takas komut bloğu | `pm2 stop` → rename → `migrate deploy` → `pm2 start`; saniyeler mertebesinde |

**Kabul ölçütü:** yedi başlık da yeşil **ve** Faz A süresi vardiya planına
sığıyor.

---

## Prova biterken

4. **Takas komutunu ÜRETİN ama ÇALIŞTIRMAYIN.** "Geçiş komutunu göster" deyin;
   blok ekrana gelsin, okuyun, kapatın. Amaç komutun gerçekten üretilebildiğini
   görmek — çalıştırmak provanın konusu değil.
   *(Bu tıklama audit'e `DB_SWAP_COMMAND_ISSUED` olarak düşer; tatbikatın izi de
   böylece kayda geçer.)*
5. **Kopyayı SİLİN.** Panelde silme düğmesi var. Silmezseniz kopya diskte durur;
   `/api/admin/health` içindeki `restoreCopyCount` unutulanları gösterir.

---

## Ne çıkarsa ne demek

| Gördüğünüz | Anlamı | Ne yapılır |
|---|---|---|
| Yedi başlık yeşil | Geri yükleme yolu **çalışıyor** | Süreleri kaydedin, kopyayı silin, tatbikat başarılı |
| "CREATEDB yetkisi yok" | Özellik hiç açılamıyor | Panel `ALTER ROLE … CREATEDB;` talimatını gösterir |
| "Disk yetersiz" | Boş alan < 1,2× | Provayı yapmadan disk açın — bu bir bulgudur |
| **Ayarlar başlığı kırmızı** | `statement_timeout` replay edilmemiş | ⚠️ Ciddi: takas sonrası uzun sorgu koruması **sessizce** kaybolurdu. Geçiş YAPMAYIN, bildirin |
| **Şema sürümü uyuşmuyor** | Yedek eski bir şemadan | Takas komutu zaten `migrate deploy` içerir; provada sorun değil, **not edin** |
| **Veritabanı boyutu** canlıdan belirgin küçük | Yedek eksik alınmış olabilir | Yedek alma zincirini inceleyin — bu, tatbikatın bulabileceği en değerli şeydir |
| **`pg_restore` uyarıları** dolu | Bazı nesneler atlanmış | Uyarı metnini okuyun; çoğu zararsız (sahiplik/uzantı) ama okunmadan geçilmez |

---

## Ne sıklıkla

**Yılda iki kez** ve ayrıca şu ikisinden sonra: PostgreSQL sürümü değiştiğinde,
sunucu donanımı/diski değiştiğinde. İkisi de geri yükleme yolunu sessizce
bozabilecek değişikliklerdir.

Sonuçları bu belgenin altına tarih + üç sayı olarak ekleyin; ikinci tatbikat
birincisiyle karşılaştırılabilir olsun.

## Tatbikat kaydı

| Tarih | Yedek boyutu | Faz A süresi | Doğrulama | Not |
|---|---|---|---|---|
| _(ilk tatbikat buraya)_ | | | | |

---

## Ne kadar veri kaybedebiliriz, ne kadar sürede döneriz (RPO / RTO)

> **BULGU-T1-022:** bu iki sayı sistemin hiçbir yerinde YAZILI DEĞİLDİ. Yedek
> alınıyor, geri yükleme yolu var, ama "en kötü ihtimalle ne kaybederiz" sorusuna
> kimse bakmadan cevap veremiyordu. Aşağısı yeni bir karar değil, **bugünkü
> kurulumun ölçülmüş sonucudur.**

| Soru | Bugünkü cevap | Neden |
|---|---|---|
| **RPO** — en fazla ne kadarlık veri kaybı | **≤ 24 saat** | Yedek günde BİR kez alınıyor (Windows Görev Zamanlayıcı `TeksERP-DB-Backup`, 02:00). Gün içinde çökerse o güne ait tüm giriş/sevk/kabul kaybolur. |
| **RTO** — ne kadar sürede ayağa kalkarız | **Faz A + dakikalar** | Faz A (kopyaya geri yükleme) tatbikatta ölçülür ve yukarıdaki tabloya yazılır; Faz B (takas) `pm2 stop` → rename → `migrate deploy` → `pm2 start`, saniyeler mertebesinde. |
| **PITR** (an bazlı geri dönüş) | **YOK** | WAL arşivleme kurulu değil. Yalnız gece yedeğine dönülebilir. |
| **Makine dışı kopya** | **Mekanizma VAR, yapılandırılmamış** | `rclone` süpürücüsü kodda hazır (`offsite-backup.helper`); `BACKUP_RCLONE_REMOTE` boş olduğu için çalışmıyor → yedekler DB ile **aynı diskte**. |

### Bu üç sayı neyi söylüyor

- **Disk ölürse fabrika bir günü kaybeder** ve yedekler de aynı diskte olduğu için
  **hiçbir şeyi geri getiremez.** Bu, bilinen ve kabul edilmiş bir risktir
  (kullanıcı kararı 2026-08-30) — ama artık YAZILI.
- Riski düşürmenin en ucuz iki adımı, sırayla:
  1. `BACKUP_RCLONE_REMOTE` doldurulur → gece yedeği makine dışına da kopyalanır
     (kod hazır, tek satırlık ayar; panelde "Bağlantıyı test et" düğmesi var).
  2. Gün içi ikinci bir yedek saati → RPO 24 saatten 12 saate iner.
- **PITR gerçekten isteniyorsa** ayrı bir iştir (WAL arşivleme + saklama alanı) ve
  bu kurulumun kapsamında değildir.

⚠️ Bu tablo tatbikattan SONRA güncellenir: Faz A süresi ölçülünce RTO satırına
gerçek rakam yazılır ("dakikalar" değil, "N dakika").

---

## Bu provanın KAPSAMADIĞI şey

⚠️ Faz B (gerçek takas) denenmiyor. Yani "kopya doğru üretiliyor" kanıtlanıyor,
"takas sorunsuz geçiyor" kanıtlanmıyor. Takasın kendi koruması var (ön kontrol +
otomatik geri alma + son sayım) ama o da bu provada çalıştırılmıyor.

Takası da denemek isterseniz doğru zaman **planlı bir bakım penceresidir** ve
geri dönüş yolu hazırdır: eski canlı `<canlı>_old_<damga>` olarak durur, geri
alma ters rename'dir.

⚠️ Ayrıca: makine dışı kopya **yok** (kullanıcı kararı 2026-08-30, kabul edilen
risk). Bu tatbikat "yedek okunabiliyor mu"yu ölçer; "sunucu kaybedilirse ne
olur"u ölçmez. Yedekler sunucuyla aynı makinede.
