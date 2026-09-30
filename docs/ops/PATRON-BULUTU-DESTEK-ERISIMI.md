# Patron bulutu — destek erişimi (doğrudan veritabanı sorgusu) runbook'u

> Hukuk kaynağı: Teknik ve İdari Tedbirler (Ek-6/B) §3 — `docs/hukuk/PATRON-BULUTU-TEDBIRLER.md`. Teknik zorlama: göç `patron/sunucu/prisma/migrations/20260930220000_destek_rolu` (rol, `support_access` kaydı, `destek_ac`/`destek_kapat`/`destek_tesisi`, `destek_kapisi` politikaları) · yetkiler `patron/sunucu/src/lib/db-grants.ts` `SUPPORT_GRANTS` → `scripts/db-rolleri.ts`. Bekçi `patron/sunucu/scripts/test_destek_rolu.ts`. Kural: `docs/kurallar/patron-bulutu.md` § Bulut sunucusu.

## 1. Ne zorlanır (teknik)

- Rol `patron_destek` (genel ad `<veritabanı>_destek`): NOSUPERUSER · NOBYPASSRLS · **NOLOGIN doğar**; yalnız `SELECT`, yalnız `SUPPORT_GRANTS`teki tablolarda ve **sır kolonları hariç** (parola özeti, TOTP sırrı, davet/oturum belirteç özeti, push belirteci). Yazma, silme, boşaltma yetkisi YOK.
- Destek rolünün okuyabildiği her İLİŞKİ ve çalıştırabildiği her FONKSİYON beyanlıdır: ilişki yalnız `SUPPORT_GRANTS` tabloları (görünüm YOK — görünüm sahibinin yetkisiyle koşar ve RLS'i atlayabilir), fonksiyon yalnız `SUPPORT_FUNCTIONS` (üç kapı fonksiyonu; PUBLIC'ten gelen EXECUTE de sayılır); SECURITY DEFINER fonksiyonun `search_path`i sabittir ve `pg_temp` sondadır. Yeni görünüm/fonksiyon destek rolüne ancak beyana girerek açılır — beyansız olan bekçide (`test_destek_rolu` §1g–§1i) kırmızıdır.
- Her okunabilir tabloda RESTRICTIVE `destek_kapisi` politikası: satır ancak bu **oturumun** (pid + oturum başlangıç anı) açık ve süresi dolmamış destek iznindeki tesise aitse görünür. `app.tesis_id` ayarını elle yazmak işe yaramaz (0 satır); izin başka tesise çevrilemez, başka oturum devralamaz.
- İzin YALNIZ `destek_ac(tesis, talep no, gerekçe, veri kümesi, dakika)` ile açılır ve açılış **silinemeyen kayda** (`support_access`) yazılır: kim (DB oturum kullanıcısı), ne zaman, hangi tesis, hangi veri kümesi, gerekçe + talep no, bitiş (en çok 8 saat). Kayıt silinemez, değiştirilemez (yalnız kapanış damgası yazılır), tesis imhasında da kalır. Destek rolü kendi erişim kaydını okuyamaz.
- Lisans Alan kendi tesisinin erişim kaydını **kendisi** görür: patron uygulaması (web) → Hesaplar → Dışa aktar → "Destek erişim kaydı" (Ek-6/B §3.3).

## 2. Ön koşul (idari)

İçerik erişimi yalnız Ek-6/B §3.1 hâllerinde: Lisans Alan'ın yazılı destek talebi (talep no) · güvenlik ihlali incelemesi · yetkili makamın bağlayıcı talebi. Talepte tesis kimliği (`tesis_id`), bakılacak veri kümesi ve gerekçe yazılı olmalı. Destek sırasında veri dışarı çıkarılmaz (Ek-6/B §3.4).

## 3. Erişimi AÇ (operatör, VDS)

```bash
# 1) Göç rolüyle (yalnız aç/kapa için; İÇERİK OKUMAK İÇİN KULLANILMAZ):
sudo docker exec -it tekserp-patron-uretim-db psql -U patron_goc -d patron
```
```sql
\password patron_destek                                   -- tek kullanımlık güçlü parola (istemde yazılır; geçmişe/deftere düşmez)
ALTER ROLE patron_destek LOGIN VALID UNTIL '<şimdi + 4 saat, ör. 2026-10-01 18:00+03>';
\q
```

## 4. Destek sorgusu (destek rolü)

```bash
sudo docker exec -it tekserp-patron-uretim-db psql -h 127.0.0.1 -U patron_destek -d patron   # parola istenir (TCP = parola doğrulaması)
```
```sql
SELECT destek_ac('<tesis uuid>', '<talep no>', '<gerekçe, en az 10 karakter>', '<veri kümesi: ör. projection_rows/siparis · sync_state>', 60);
-- Yalnız SELECT. Sır kolonları kapalıdır: accounts'ta kolonları adıyla seçin (SELECT * izin hatası verir).
SELECT projection, count(*) FROM projection_rows GROUP BY 1;
SELECT last_package_at, horizon, contract_warning FROM sync_state;
SELECT destek_kapat();   -- izni kapatır; sonraki sorgu HATA verir
\q
```

- Başka tesise geçmek için önce `destek_kapat()`, sonra o tesisin talebiyle yeni `destek_ac(...)` (her açılış ayrı kayıt).
- Süre dolunca (`dakika`) sorgular 0 satır döner; gerekirse yeni `destek_ac`.

## 5. Erişimi KAPAT (operatör — iş bitince, aynı gün)

```bash
sudo docker exec -it tekserp-patron-uretim-db psql -U patron_goc -d patron
```
```sql
ALTER ROLE patron_destek NOLOGIN PASSWORD NULL;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'patron_destek';
UPDATE support_access SET closed_at = now(), close_reason = 'ROL_KAPATILDI' WHERE closed_at IS NULL;
SELECT rolcanlogin FROM pg_roles WHERE rolname = 'patron_destek';   -- f olmalı
```

`scripts/db-rolleri.ts` (her göçten sonra) rolün özelliklerini ve yetkilerini hizalar ama LOGIN'e dokunmaz: açık unutulan giriş bu adımla kapanır.

## 6. Erişim kaydının dökümü (Ek-6/B §3.3 — 10 iş günü)

Lisans Alan'ın tesis yöneticisi dökümü kendisi alır (§1). Satıcıdan istenirse (göç rolüyle, yalnız kayıt tablosu):

```sql
SELECT created_at, db_user, ticket, reason, scope, expires_at, closed_at, close_reason
  FROM support_access WHERE tesis_id = '<tesis uuid>' ORDER BY created_at;
```

## 7. Sınır (dürüst beyan)

VDS'te docker yetkisi olan kişi göç (süper kullanıcı) rolüne de ulaşabilir; süper kullanıcı RLS'e ve bu kayda tabi değildir. Teknik zorlama destek rolünün kendisindedir; göç rolüyle içerik okumak bu runbook'un dışıdır ve yasaktır (idari tedbir, Ek-6/B §2: erişebilen çalışanlar adıyla belirli, gizlilik taahhüdü altında). Güçlendirme adayı (açık borç): DB konteynerinde yerel soket girişini parolaya bağlamak (`pg_hba` `local … scram-sha-256`) — dağıtım değişikliği, ayrı dilim.
