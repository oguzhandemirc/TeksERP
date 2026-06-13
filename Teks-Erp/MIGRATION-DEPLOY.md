# Production Migration Deploy Notu

Geliştirme (dev) DB'sine uygulanan migration'lar production'a (Windows installer
DB'si `TeksErpDb`, ya da hangi ortamsa) **`prisma migrate deploy` ile** taşınır.
`migrate dev` PRODUCTION'da ASLA çalıştırılmaz (reset riski).

## Standart deploy sırası (her sürüm güncellemesinde)

```bash
# Production sunucuda, uygulama dizininde:
git pull                       # yeni migration dosyaları gelir
npm install                    # package.json değiştiyse
npm run prisma:generate        # = prisma generate (client yenilensin)
npm run prisma:migrate         # = prisma migrate deploy (pending migration'ları uygular)
# servisi yeniden başlat (Windows servisi / nssm restart)
```

`migrate deploy` yalnız `_prisma_migrations` tablosunda OLMAYAN migration'ları,
dosya sırasıyla uygular. Idempotent — tekrar çalıştırmak güvenli.

> **Sıra teyidi (2026-06-13):** Yukarıdaki dört adım (`git pull → npm install →
> prisma:generate → prisma:migrate`) güncel package.json script'leriyle birebir
> uyumludur: `prisma:generate` = `npx prisma generate`, `prisma:migrate` =
> `npx prisma migrate deploy`. **Windows installer yolunda fark var:** Prisma
> client kurulum anında DEĞİL, `build.ps1` derleme aşamasında üretilip
> `node_modules`'a gömülür; bu yüzden `manage.ps1 -Action install` sadece
> `migrate deploy` (+ ilk kurulumda seed) çalıştırır, ayrıca `generate`
> ÇAĞIRMAZ. Manuel/Linux yolunda ise `generate` her güncellemede gereklidir.

> **glibc collation NOTU (sıralı numara üreticileri — düzeltildi):** Günlük/
> ardışık numara üreten servisler (sevkiyat `shipmentNo`, çuval `sackNo`/
> `AMB%05d`, sipariş `orderNumber`, iş emri `batchNumber`/`manifestNo`) eskiden
> üst sınırı `lt: prefix + "￿"` (U+FFFF) ile arıyordu. Bu, U+FFFF'i "en yüksek
> karakter" sayar — macOS libc'de doğru, ama **Linux glibc** (ve glibc tabanlı
> üretim sunucuları) altında U+FFFF *ignorable* olduğundan o günün son
> numaraları aralık dışında kalır, "bugün kaç numara verildi" sorgusu eksik
> sayar ve **sevk/sipariş/çuval numaraları sessizce çakışırdı**. NİHAİ fix
> `gte: prefix` (her collation'da güvenli alt sınır + index seek) **+**
> `startsWith: prefix` (collation'dan bağımsız LIKE 'prefix%' tam-prefix
> filtresi) kombinasyonudur — `src/services/shipping.service.ts` ve
> `order.service.ts` içinde. Sonuç: production artık **Linux glibc'de güvenli**;
> CI'da bu bug 6 sevkiyat testini patlatmıştı, fix sonrası yeşil.
> **Eski sürüm Linux'a deploy edilmemelidir** (numara çakışması riski).

## ⚠️ Index-ağırlıklı migration'lar — VARDİYA DIŞINDA

`CREATE INDEX` büyük tabloda yazma kilidi alır (milyon satırda dakikalarca) ve
app DB'sinde `statement_timeout=50s` aktif olduğundan **uzun DDL 50s'de İPTAL olur**.
Yüz binlerce+ satıra index ekleyen migration'ın EN BAŞINA `SET statement_timeout = 0;`
konmalı (drift-free migration'lara elle eklenebilir) ve **gece/hafta sonu** deploy
edilmeli. Boş/yeni kurulumda risk yok.

İlgili index migration'ları (mevcut): `20260612100000_repartialize...`,
`20260612102000_dashboard_report_date_indexes`, `20260612120000_missing_fk_indexes...`,
`20260613101000_sack_manual_code_index`. Bunlar küçük/orta tabloda hızlıdır ama
hacim büyüdükçe yukarıdaki kural geçerlidir.

## Bu oturumda dev'e uygulanan, production'a gidecek migration'lar (2026-06-13)

| Migration | İçerik | Tablo boyutu/risk |
|---|---|---|
| `20260613100000_route_step_subcontractor_planning` | RouteStep'e fason alanları + 2 FK index | küçük (route_steps) — hızlı |
| `20260613101000_sack_manual_code_index` | sacks.manualCode index | orta — hacimde vardiya dışı |
| `20260613110000_shipment_destination` | ShipmentDestination enum + shipments.destination (default DOMESTIC) | ALTER + default — hızlı |
| `20260613111000_shipment_procedure_code` | shipments.procedureCode kolonu | hızlı |
| `20260613112000_machine_hardware` | machine_hardware tablosu + FK + unique index | yeni tablo — anında |

Hepsi geri-uyumlu (yeni kolon/tablo nullable veya default'lu); mevcut veriyi bozmaz.

## Temiz-DB deploy provası — DOĞRULANDI (2026-06-13)

Boş bir `teks_deploy_probe` DB'sinde tam deploy provası koşuldu:

```bash
createdb teks_deploy_probe
DATABASE_URL="postgresql://.../teks_deploy_probe?schema=public" \
  JWT_SECRET="ci-test-secret-not-for-production" \
  npx prisma migrate deploy            # All migrations have been successfully applied.
DATABASE_URL="..." JWT_SECRET="..." npx prisma generate   # Prisma Client v7.7.0
dropdb teks_deploy_probe
```

Sonuç: **51/51 migration hatasız uygulandı** (`_prisma_migrations` → 51 finished,
0 rolled-back/yarım), Prisma Client v7.7.0 temiz üretildi. İlk kurulum
`migrate deploy` yolu sıfırdan boş DB'de sorunsuz çalışıyor.

## Seed (örnek veri)

`npm run seed` dev verisini SIFIRLAYIP yeniden kurar (production'da çalıştırılmaz).
Makine donanımı örnek satırları (yazıcı/RS232 config) seed'e eklendi — yalnız dev/test
ortamında görünür. Production'da operatör/admin kendi makine donanımını
`Tanımlar → Makine Donanımı` ekranından girer.
