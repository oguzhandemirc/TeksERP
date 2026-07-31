# Sürüm 2026-07-30 — Deploy Reçetesi

Bu sürüme **ÖZGÜ**, kopyala-yapıştır reçete. Genel kurallar `MIGRATION-DEPLOY.md`
(kanonik sıra) ve `URETIM-KONTROL-LISTESI.md`'de; burada yalnız **bu sürümün**
migration'ları, doğrulama sorguları ve duman testleri var.

> **Neden ayrı dosya:** bu sürüm 5 migration taşıyor ve üçü aylardır bekliyordu
> (git'e hiç girmemişlerdi). Bilgi üç dokümana dağılmış durumdaydı; deploy anında
> tek yerden okunabilmeli.

---

## 0a) ⚠️ BACKEND'İ TEK BAŞINA DEPLOY ETME — Electron ile BİRLİKTE gider

Bu sürümde **iş emri kapatma sözleşmesi değişti**. Eski davranış: istasyonda top
varsa kapatma reddedilirdi (`canComplete=false`). Yeni davranış: kapatma **engellenmez**,
her top için karar (dispozisyon) istenir.

**Yalnız backend güncellenirse ne olur:** eski Electron kurulumu `complete-preview`den
gelen `canComplete=true`yi görüp **"İş emrini kapat" düğmesini AÇAR**, ama gövdesiz
istek atar ve yeni backend reddeder:

```
400 — "İşlemde N top var, 0 dispozisyon gönderildi — liste bu sırada değişti."
```

Operatör için görünen tablo: *düğme aktif ama her basışta anlamsız hata*. Sessiz veri
bozulması YOK (istek tamamen reddedilir), ama iş emri kapatma **kullanılamaz** hale gelir.

→ **Backend + Electron aynı pencerede deploy edilir.** Mobil bu akışa girmiyor
(iş emri kapatma yalnız Electron'da), mobil eski sürümde kalabilir.

**Geri alma:** backend rollback yeterli — kapatma sözleşmesi şema değil kod
seviyesindedir, `20260730170000` index'i kalsa da eski kod çalışır.

---

## 0b) Davranış değişiklikleri — operatöre ÖNCEDEN söyle

Bunlar hata değil, bilinçli değişiklik. Deploy sabahı destek çağrısı gelmesin diye
vardiya amirine önceden geçilmeli:

| Ne değişti | Eski | Yeni |
|---|---|---|
| **İş emri kapatma** | İstasyonda top varsa reddederdi | Her top için karar sorar (ham stok / bitmiş depo / 2. kalite / fire / hatalı kayıt / yeni iş emrine devret). Fasondaki top hâlâ engeller. Karar veriyorsa `roll:manual-adjust` gerekir. |
| **Konumu Düzelt** | İptal/devredilmiş iş emrinde de çalışırdı → top "canlı ama kimse okutamaz" çıkmazına düşerdi | İptal/devredilmiş iş emrinde **reddedilir** (409) |
| **Top ekranındaki 3 buton** | "Etiket Bas/Önizle" + "Yeniden Etiketle/Düzenle" + "Manuel Düzelt" | **2 buton**: "Etiket" (önizle/bas/farklı müşteriye bas) ve "Düzelt" (renk/metraj/kalite/en/özellik + gerekiyorsa sebep) |
| **Envanter tarih kolonu** | "Tarih" = oluşturma | Ham Stok'ta "Giriş", diğer sekmelerde **"Son İşlem"**; liste ona göre sıralı (bugün depoya giren top artık en üstte) |
| **Metraj kolonu** | `700 / 800` (iki sayı) | Yalnız **700** — giriş metrajı detay panelinde |
| **Üretimdeki topu düzeltme** | Depo operatörü "serbest stokta değil" hatası alırdı | Yine reddedilir ama **403** + "yalnız süpervizör düzeltebilir". Süpervizör artık üretimdeki topun **metrajını da** düzeltebiliyor (eski boşluk). |

**Yeni permission YOK** — `roll:manual-adjust` zaten seed'de mevcuttu; canlı DB'ye
INSERT gerekmez. Yalnız kimlerin bu izne sahip olduğunu bir kez gözden geçir:
üretimdeki topu düzeltebilmesi ve dispozisyonlu kapatma yapabilmesi gereken
süpervizörlerde olmalı.

---

## 0) VARDİYA DIŞI ZORUNLU

`20260730170000_roll_status_updatedat_index` **`rolls` tablosuna index ekliyor** →
yazma kilidi alır. `prisma migrate deploy` bekleyen migration'ları **TOPLU** uygular;
"ucuzları gündüz, index'i geceye" **mümkün değil** (dosyayı dizinden çıkarmak drift
yaratır). Dolayısıyla **tüm sürüm gece/hafta sonu**.

`CREATE INDEX CONCURRENTLY` bu mimaride kullanılamaz: `migrate deploy` her migration
dosyasını tek transaction'da koşar, `CONCURRENTLY` transaction içinde `25001` verir.
Migration dosyası zaten `SET statement_timeout = 0` ile başlıyor (app DB'sinde
`statement_timeout=50s` aktif ve uzun DDL'i keserdi).

---

## 1) Geliştirme makinesinde — deploy ÖNCESİ

```bash
cd /Users/oad/Documents/projeler/AdnanSahin

# Commit hijyeni (migration ya da test commit'lenmemişse deploy SESSİZCE eksik gider)
node scripts/check-migrations.mjs        # ✅ beklenir
cd Teks-Erp && npx tsx scripts/test_migration_hygiene.ts

# Temiz-DB provası — bu sürümün migration'ları sıfırdan kuruluyor mu?
createdb teks_deploy_probe
DATABASE_URL="postgresql://<kullanıcı>@localhost:5432/teks_deploy_probe?schema=public" \
  JWT_SECRET="ci-probe-not-a-real-secret" npx prisma migrate deploy
# → "All migrations have been successfully applied."
dropdb teks_deploy_probe
```

---

## 2) Hasar taraması — deploy'dan ÖNCE (salt okunur, güvenli)

Bu sürüm "hayalet çuval içeriği" hatasını kapatıyor (çuvaldaki top kartelaya/tambura/
fasona gidebiliyor, çuvalda kayıtlı kalıyor, sevkte `SHIPPED`'e eziliyordu → irsaliye
metrajı şişiyordu). **Geçmişte olmuş mu bilinmiyor** — bu tarama onu ölçer.

```bash
psql "$PROD_DATABASE_URL" -f Teks-Erp/scripts/consistency-check.sql
#    §7  = ŞU AN çuvalda sıkışmış hayaletler        → onarılabilir (adım 6)
#    §7b = GEÇMİŞ çift-sayım (sevk edildi VE kartelaya/fasona gitti) → GERİ ALINAMAZ
#    §7c = simetri kontrolü (normalde 0)
```

**Saf SQL — hiçbir yeni kolon/enum kullanmıyor**, dolayısıyla migration'dan ÖNCE,
eski şemada güvenle koşar. Dosya yeni olduğu için sunucuda `git pull` gerekir;
`git pull` TEK BAŞINA çalışan süreci ETKİLEMEZ (pm2 derlenmiş `dist/`'i koşar,
`npm run build` çalışmadan davranış değişmez).

Bu adımın amacı **büyüklüğü önceden bilmek**: §7 doluysa deploy penceresine onarım
süresi ekleyin; §7b doluysa bu bir muhasebe/hukuk konusu (aşağıya bakın).

---

## 3) Deploy (production sunucu, vardiya dışı)

```powershell
# 1) YEDEK — ELLE, ZORUNLU (otomatik premigrate_* artık üretilmiyor)
#    Panel → Sistem → Yedekler → "Şimdi yedek al" → rotasyondan çıkar:
Rename-Item ...\backups\tekserp_<zaman>.dump premigrate_2026-07-30_<zaman>.dump

# 2) KANONİK SIRA (build, migrate'ten ÖNCE — geri alınamaz adım en sona)
git pull
npm install
npm run prisma:generate
npm run build              # ← burada patlarsa DUR: DB'ye HİÇ dokunulmadı, temiz abort
npm run prisma:migrate     # ← GERİ ALINAMAZ eşik (5 migration birlikte)
pm2 restart tekserp-backend
pm2 save
```

### Bu sürümdeki migration'lar

| Migration | Ne yapar | Risk |
|---|---|---|
| `20260730120000_add_sack_notes` | `sacks.notes` (VarChar 500, nullable) | Yok — rewrite yok |
| `20260730120500_add_label_kind_sack` | `LabelKind` enum'a `SACK` | Yok — geri alınamaz ama zararsız |
| `20260730170000_roll_status_updatedat_index` | `rolls(status, updatedAt)` index | **Yazma kilidi** → vardiya dışı |
| `20260730190000_sack_weight_source` | `SackWeightSource` enum + `sacks.weightSource` | Yok — nullable, DEFAULT yok |
| `20260730200000_sack_label_dirty` | `sacks.labelDirty` (bool, DEFAULT false) | Yok — PG 11+ rewrite etmez |

---

## 4) Doğrulama SQL'i (salt-okunur)

```sql
-- a) sacks.notes
SELECT column_name, data_type, character_maximum_length, is_nullable
FROM information_schema.columns WHERE table_name='sacks' AND column_name='notes';
-- beklenen: notes | character varying | 500 | YES

-- b) LabelKind enum'da SACK
SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) FROM pg_enum e
JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='LabelKind';
-- beklenen: ROLL_RAW, ROLL_FINISHED, SWATCH, SACK

-- c) index VAR ve GEÇERLİ (yarıda kesilmemiş)
SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
WHERE c.relname='rolls_status_updatedAt_idx';
-- beklenen: t   ← indisvalid=f ise DROP INDEX + yeniden kur

-- d) weightSource + labelDirty
SELECT column_name, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name='sacks' AND column_name IN ('weightSource','labelDirty');
-- beklenen: weightSource | SackWeightSource | YES | (boş)
--           labelDirty   | bool             | NO  | false

-- e) BEŞ migration gerçekten KAYITLI ve BİTMİŞ
SELECT migration_name, applied_steps_count, finished_at, rolled_back_at
FROM "_prisma_migrations" WHERE migration_name LIKE '20260730%' ORDER BY migration_name;
-- beklenen: 5 satır · finished_at DOLU · rolled_back_at NULL · applied_steps_count >= 1
--   ⚠️ applied_steps_count = 0 görürsen SQL KOŞMAMIŞ olabilir (elle `migrate resolve`
--      izi) — o migration'ın etkisini (a)-(d) ile TEK TEK doğrula.
```

---

## 5) Duman testi (bu sürümün canlı tüketicileri)

- [ ] `GET /health` → 200, `db: "UP"`, `lastBackup` null DEĞİL
- [ ] **Mobil Paketleme ekranı açılıyor** (`listCustomerPoolSacks` — `notes` select'i; 500 gelirse migration uygulanmamış)
- [ ] Çuval **notu** yaz + oku (mobil sheet · Electron dialog)
- [ ] Çuval **etiketi** önizleme (`LabelKind.SACK`)
- [ ] **Sevk irsaliyesi baskısı** (`resolveLiveRowNotes` — her baskıda koşan yol)
- [ ] Çuval **arama** + **çeki listesi** + **top konumu**
- [ ] Envanter sekmelerinde "Son İşlem" sıralaması hızlı (yeni index)
- [ ] **Depoya alınan top listede ÜSTTE:** bir topu depoya al (kapatma dispozisyonu ya
      da "İstasyondan Kurtar") → Envanter → Bitmiş Depo'da **1. sırada**. Eski hatanın
      testi budur: statü doğruydu ama top 5000 satırın altında kalıyordu.
- [ ] **İş emri kapatma (dispozisyon):** istasyonda topu olan bir iş emrini kapat →
      her top için karar sorulmalı, sebep zorunlu, karar verilmeden düğme kilitli.
      "Yeni iş emrine devret" seçilirse ayrıca **açık onay kutusu** çıkmalı.
- [ ] **Kapatma yetki kapısı:** `roll:manual-adjust` OLMAYAN kullanıcıda aynı diyalog
      dispozisyon formu yerine yetki uyarısı göstermeli (403'e koşmadan).
- [ ] **Konumu Düzelt guard'ı:** iptal edilmiş bir iş emrinde konum düzeltmeyi dene →
      kırmızı blok + düğme kilitli (409).
- [ ] **Tek "Düzelt" diyaloğu:** barkodLU bir topta ve **barkodSUZ açık kumaşta** açılıyor
      (ikincisi `GET /api/rolls/:id/relabel-context` yolunu doğrular — eski "Manuel
      Düzelt"in tek üstünlüğü buydu, kaybolmamalı).
- [ ] **Etiket diyaloğunda "farklı müşteri için bas"** bölümü görünüyor (istasyondan taşındı).
- [ ] **Hayalet guard'ı:** çuvaldaki bir topu kartelaya göndermeyi dene → Türkçe 400 + çuval kodu
- [ ] **Tartı:** ⚖ ile tart → kaydediliyor; Cihaz Kaydı'ndan kantarın "simülasyon"unu AÇ → tartı **400** veriyor, ⋮ → "Elle kg gir" çalışıyor
- [ ] Çuval detayında tartı **kaynağı rozeti** görünüyor (elle girilende "elle girildi")

---

## 5b) Hayalet ONARIMI — deploy'dan SONRA, AYNI pencerede

⚠️ **Onarım scripti deploy'dan ÖNCE koşamaz:** `repair_sack_ghost_rolls.ts` çuvalın
tartısını sıfırlarken `weightSource` kolonuna da dokunuyor; o kolon migration'dan önce
DB'de de Prisma client'ında da YOK → P2022 verir. (Adım 2'deki SQL taraması saf SQL
olduğu için ondan önce koşar; ayrım budur.)

**İyi tarafı:** onarım deploy'dan sonra koştuğu için guard'lar ARTIK CANLI → onarım ile
deploy arasında yeni hayalet doğamaz.
**Dikkat:** deploy ile onarım arasındaki pencerede, legacy hayalet içeren bir çuvalla
sevkiyat kurulmak istenirse yeni hard-block 400 verir (somut Türkçe mesaj + çuval kodu).
Bu yüzden onarımı **aynı pencerede, hemen** koşun.

```bash
cd Teks-Erp
# a) RAPOR (yazmaz) — A/B/C/D/E sınıfları + §E'de tartısı sıfırlanacak çuvallar TEK TEK
npx tsx scripts/repair_sack_ghost_rolls.ts

# b) Sınıf A (depo çuvalı) onarımı
npx tsx scripts/repair_sack_ghost_rolls.ts --apply

# c) Sınıf B (PLANNED sevkiyattaki çuval) — AYRI ONAY:
#    çuvalı sevkiyattan çıkarır → hayaleti çıkarır → geri ekler (tahsisler yeniden
#    hesaplanır). Canlı sevkiyatı geçici bozar: seq yeniden atanır, brüt kg sıfırlanır.
npx tsx scripts/repair_sack_ghost_rolls.ts --apply --planned

# d) Doğrula — §7 boş kalmalı (kalırsa yalnız sınıf C satırları)
psql "$PROD_DATABASE_URL" -f scripts/consistency-check.sql
```

- **Sınıf C (DISPATCHED çuval):** rapor-only. Sevkiyat kapanmış, belge donmuş.
- **Sınıf D (§7b):** GERİ ALINAMAZ — aynı mal müşteriye faturalandı VE dışarıya çıktı.
  Script belgeye DOKUNMAZ; düzeltme yalnız `reissue` (gerekçeli revizyon) ile insan kararı.
- **§E listesi:** tartısı sıfırlanan çuvallar yeniden tartılmalı + etiketleri yeniden basılmalı.

---

## 6) Rollback

```powershell
pm2 stop tekserp-backend
git checkout <önceki-sha>
npm ci
npm run prisma:generate
npm run build
# yedekten geri yükle (ÖNCE eski koda dön, SONRA restore — DEPLOY-RUNBOOK.md §5)
pg_restore -c -d <db> premigrate_2026-07-30_<zaman>.dump
pm2 start ecosystem.config.js
pm2 save
```

Notlar:
- `LabelKind.SACK` enum değeri PostgreSQL'de **düşürülemez** — restore etmezsen kalır, zararsızdır.
- `sacks.notes` / `weightSource` / `labelDirty` kolonları eski kodda okunmaz; bırakılabilir.
- Index bırakılabilir (yalnız sorgu hızlandırır).

---

## 7) Deploy SONRASI — ayrı iş olarak izlenecek

- [ ] **Sevkiyat bilgisayarları:** kantar simülasyonu artık yalnız Cihaz Kaydı'nda.
      Bu sürümde bilgisayarın kendi "simülasyon" anahtarı KALDIRILDI; yalnız COM
      portu tanımlı PC'ler yerel kantarı kullanmaya devam eder. Sadece-simülasyon
      tanımlı bir PC varsa otomatik olarak Cihaz Kaydı'ndaki kantara düşer.
### DB emniyet kilidi — ÖN KOŞULLAR ÇÖZÜLDÜ, kilit HENÜZ EKLENMEDİ

`rolls_sackId_status_present` CHECK'i ("`sackId` doluysa statü fiziksel-olarak-çuvalda
olmalı") uygulama guard'larının altına bir kat daha koyar. **Bilerek ertelendi**; açmak
için gereken her şey hazır:

| Ön koşul | Durum |
|---|---|
| 23514 → Türkçe 409 eşlemesi (yoksa opak 500 + teşhis edilemez audit) | ✅ yapıldı, gerçek PG hatasıyla test edildi (`test_check_violation_mapping.ts`) |
| Hayalet üreten testlerin kilitle yaşayabilmesi | ✅ `scripts/fixture-sack-constraint.ts` — kilit varsa askıya alır, yoksa no-op. Üç test kilit KURULUYKEN de geçiyor (prova edildi) |
| Sınıf B (PLANNED sevkiyattaki çuval) onarılabilmesi | ✅ `repair_sack_ghost_rolls.ts --apply --planned` — servisleri sırayla çağırır, tahsisler yeniden hesaplanır |
| **Production §7 taraması = 0 satır** | ⛔ **YAPILMADI** — tek kalan ön koşul |

**Neden §7 sıfır olmalı:** `NOT VALID` mevcut satırları taramaz, yani migration
PATLAMAZ. Ama kilit konduktan sonra **ihlalli bir satıra dokunan her UPDATE 23514
verir** — örneğin kartela kabulü (`AT_KARTELA → KARTELA_CONSUMED`) ya da o çuvalın
sevkiyattan çıkarılması. Yani legacy kirli satır varsa saha ortasında iş durur.
Hata artık Türkçe ve anlaşılır, ama yine de durur.

**Açma adımları (§7 sıfır çıktıktan SONRA):**

```bash
# 1) Migration dosyasını oluştur
mkdir -p Teks-Erp/prisma/migrations/<zaman>_rolls_sack_status_present
cat > Teks-Erp/prisma/migrations/<zaman>_rolls_sack_status_present/migration.sql <<'SQL'
-- rolls_sackId_status_present — "sackId doluysa top FİZİKSEL olarak çuvalda olmalı".
-- Uygulama guard'larının (kartela/tambur×2/fason + createShipment/dispatch) ALTINDA
-- son emniyet katmanı. Statü kümesi: helpers/sack-invariants.helper.SACK_ABSENT_STATUSES.
--
-- NOT VALID: mevcut satırları TARAMAZ → migration patlamaz, kilit hızlı eklenir.
-- VALIDATE BİLEREK YOK: doğrulama ayrı ve ELLE (aşağıda 3. adım) — deploy'un
-- geri alınamaz adımına tam tablo taraması bindirmeyiz.
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sackId_status_present"
  CHECK ("sackId" IS NULL OR "status" NOT IN (
    'CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR',
    'SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED'
  )) NOT VALID;
SQL

# 2) SIRA: git add ÖNCE (Teks-Erp/CLAUDE.md kuralı), sonra dev'e uygula
git add Teks-Erp/prisma/migrations/<zaman>_rolls_sack_status_present
cd Teks-Erp
npx prisma db execute --file prisma/migrations/<zaman>_rolls_sack_status_present/migration.sql
npx prisma migrate resolve --applied <zaman>_rolls_sack_status_present

# 3) test_db_invariants.ts CHECK envanterine EKLE (yoksa "envanter dışı nesne" uyarısı)
#    { table: "rolls", name: "rolls_sackId_status_present" }
#    ⚠️ O dosya NOT VALID'i hata sayıyorsa döngüyü de güncelle.

# 4) Testler kilitle geçmeli (fixture yardımcısı devrede)
npx tsx scripts/run-all-tests.ts sack

# 5) Production'da deploy sonrası ELLE doğrula (isteğe bağlı, tam tarama):
#    ALTER TABLE "rolls" VALIDATE CONSTRAINT "rolls_sackId_status_present";
#    → SHARE UPDATE EXCLUSIVE (okuma+yazma devam eder) + tek tam tarama.
#      İhlal varsa HATA verir; o zaman §7'yi tekrar koş ve onar.
```
