# Sürüm 2026-08-06 — Deploy Notu (yetkilendirme: rol şablonları koda taşındı)

> **Bu doküman KENDİ BAŞINA yeterli DEĞİLDİR.** Genel sıra ve yasaklar
> `DEPLOY-RUNBOOK.md`'de. Burada yalnız **bu işe özgü** olanlar var.

## Neden

Yetkilendirme baştan sona denetlendi (2026-08-06). **Mekanik taraf temizdi** —
izin kataloğu 67 ↔ DB 67, 496 API ucundan 473'ü izin guard'lı ve guard'sız 23'ün
hepsi meşru. Kırık olan **içerik** tarafıydı:

| Bulgu | Ölçüm (canlı fabrika) |
|---|---|
| "Admin (Tam Yetki)" şablonu **bayat** | 55 izin taşıyor, katalog 67 → o şablonla açılan yeni yönetici **12 yetkiyi almıyor** |
| **Masaüstü (büro) rolü yok** | 16 şablonun 15'i tek-ekran mobil, 1'i tam yetki |
| **Görev ayrılığı fiilen yok** | Eda · Enes · Samet **birebir aynı 40 izne** sahip |
| **7 izin hiç kimsede yok** | `document-template:read/write` · `settings:workstation` · `roll:history` · `shipping:undo-dispatch` · `mobile:kumas` · `mobile:siparis` → ekranlar var, **kimse açamıyor** (`admin` dahil) |

Kök neden ilk üçünde aynı: şablonlar yalnız `prisma/seed.ts`'te yaşıyordu, seed
ise **yalnız ilk kurulumda** koşar. Bu, izin kataloğunun 2026-08-01'de
kapattığı deliğin birebir ikizidir ve aynı üç parçalı kalıpla kapatıldı.

## Ne getiriyor

| Değişiklik | Nerede görünür |
|---|---|
| **8 masaüstü rolü** — Üretim Planlama · Depo & Sevkiyat · Muhasebe · Satış/Sipariş · Kalite · Belge & Etiket Tasarımı · Üretim Süpervizörü · Sistem Yöneticisi | Yetkiler → Şablonlar; kullanıcı Yetkiler sekmesindeki "Şablon Uygula" paneli |
| **2 yeni mobil rol** — Mobil Sipariş · Mobil Kumaş Ekle | aynı yerler |
| **"Admin (Tam Yetki)" artık katalogla otomatik eşitlenir** (55 → 67) | aynı yerler |
| **"N yetki hiçbir kullanıcıda yok" uyarı bandı** + satır başına kullanıcı/rol sayacı | Yetkiler → Yetki Kataloğu |
| **Sistem rolü rozeti + pasifleştirme/geri açma** | Yetkiler → Şablonlar |

## Migration — 1 adet, metadata-only

`20260806040111_permission_template_code` → `permission_templates.code`
(nullable VARCHAR(64) + unique index).

- **Nullable ve DEFAULT'suz** → PG11+'ta tablo yeniden yazılmaz; `permission_templates`
  zaten onlarca satır. Vardiya içinde uygulanabilir.
- Kolon, rolün **kalıcı kimliğidir**. Uzlaştırmanın şablonu ADIYLA bulması yeterli
  değildi: fabrika paneli şablonu yeniden adlandırabilir ve ada bakan bir
  uzlaştırma o rolü "yok" sayıp **ikizini doğururdu**.
- `code = NULL` → fabrikanın panelden yarattığı şablon; uzlaştırma **ona hiç
  dokunmaz**.

## Otomatik olan (elle bir şey yapma)

`pm2 restart` sonrası backend, açılışta iki fazlı uzlaştırmayı koşar:

```
[permission-catalog] ... izin kodu güncel / N EKSİK izin DB'ye yazıldı
[role-templates]     N eski şablon kodlandı: ...
[role-templates]     N YENİ rol oluşturuldu: WEB_PRODUCTION_PLANNING, ...
[role-templates]     'ADMIN_FULL' şablonuna N eksik izin eklendi: ...
[role-templates]     Fabrikanın kendi N şablonu korunuyor: ...
```

Sözleşme **yalnız EKLE**: var olan şablonun adı/açıklaması ezilmez, hiçbir izin
çıkarılmaz, fabrikanın kendi şablonlarına dokunulmaz.

## ⚠️ ELLE YAPILACAK — uzlaştırma izni GETİRİR, kimseye ATAMAZ

Bu kural bilinçlidir (*katalog koda, atama panele*) ve tam da bu yüzden sessizdir.
Restart'tan sonra **Yetkiler → Yetki Kataloğu** ekranını aç; üstteki amber bantta
kaç yetkinin kimsede olmadığı yazar. Beklenen liste (7 kalem) yukarıdaki tabloda.

Kapatma yolu — hepsi panelden:

1. **`admin` kullanıcısı:** Yetkiler sekmesi → "Şablon Uygula" → **Admin (Tam
   Yetki)** → *Ekle* → Kaydet. (Şablon artık 67 izin taşıyor.)
2. **Sevk geri alma (storno)** kimde olacak? → **Üretim Süpervizörü** rolü.
   `shipping:write` bunu KAPSAMAZ; sevk eden herkesin resmi çıkış belgesini
   iptal edebilmesi istenmiyor.
3. **Fatura izi** kimde olacak? → **Muhasebe** rolü (`shipping:invoice`).
   O rol bilinçli olarak `shipping:write` TAŞIMAZ.
4. **Belge/etiket tasarımı** → **Belge & Etiket Tasarımı** rolü.
5. **Yazıcı/kantar kuran depo personeli** → `settings:workstation` zaten
   **Depo & Sevkiyat** rolünde.

> Yetki değişikliği **anında geçerli olur**; hedef kullanıcının açık oturumu bir
> sonraki istekte 401 alıp sonlanır ve yeniden giriş ister (`tokenVersion++`).
> Vardiya ortasında toplu yetki değişikliği yapmayın.

## Mevcut kullanıcılara DOKUNULMADI

Eda · Enes · Samet · Berat · AhmetOnur'un yetkileri **aynen duruyor** (ürün
kararı): canlı fabrikada daraltma ayrı ve bilinçli bir adımdır — birinin işi
vardiya ortasında bir yetkiye takılmamalı. Roller hazır bekliyor; daraltmaya
karar verilirse önce rol atanır, sonra fazlalar kaldırılır.

## Ne GEREKMEZ

- **APK gerekmez** — mobil tarafta hiçbir sözleşme değişmedi.
- **Yeni izin kodu yok** — katalog 67'de kaldı; değişen, izinleri paketleyen
  rollerdir.

## Ne GEREKİR

**Backend + Electron aynı pencerede.** Panel yeni alanları (`code`, `userCount`,
`templateCount`) okuyor; eski panel yeni backend'le çalışır ama sistem rolü
rozetini ve "kimsede yok" bandını göstermez — yani deploy'un asıl amacı olan
görünürlük gelmez.

## Doğrulama (restart sonrası)

```bash
# 1. Uzlaştırma koştu mu + roller yerinde mi + idempotent mi (17 kontrol)
npx tsx scripts/test_role_template_catalog.ts

# 2. Şablon tablosunun canlı hâli
psql <db> -c "SELECT code, name, \"isActive\",
  (SELECT count(*) FROM permission_template_items ti WHERE ti.\"templateId\"=t.id) izin
  FROM permission_templates t ORDER BY code NULLS LAST;"
# Beklenen: 26 kodlu satır; ADMIN_FULL = 67 izin; kodsuz satırlar = fabrikanın kendi şablonları

# 3. Hâlâ kimsede olmayan izin kaldı mı
psql <db> -c "SELECT p.code FROM permissions p
  WHERE NOT EXISTS (SELECT 1 FROM user_permissions up WHERE up.\"permissionId\"=p.id)
  ORDER BY p.code;"
# Beklenen: BOŞ (panelden atamalar yapıldıktan sonra)
```

## Geri alma

Kod tarafı geri alınırsa (eski sürüme dönüş) **DB'de bir şey bozulmaz**: yeni
roller ve `code` kolonu kalır, eski sürüm onları görmezden gelir. `code` kolonunu
düşürmek gerekirse `DROP INDEX permission_templates_code_key; ALTER TABLE
permission_templates DROP COLUMN code;` — ama gereği yok, kolon kimseyi bağlamaz.
