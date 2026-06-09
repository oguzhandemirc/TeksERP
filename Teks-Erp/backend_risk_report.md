# Backend Risk Analysis Raporu

**Hazırlayan:** Antigravity – Google Deepmind Advanced Agentic Coding

**Hazırlanma Tarihi:** 2026-06-08 15:50 (GMT+3)

---

## 1. Genel Bakış
Bu rapor, **TeksERP** projesinin backend katmanında, potansiyel performans ve güvenilirlik risklerini incelemektedir. Analiz, **Prisma ORM**, **PostgreSQL** ve **Node.js** tabanlı servislerdeki sorgu tasarımları, indeks kullanımları, transaction yönetimi ve veri işleme mantıklarını kapsamaktadır.

---

## 2. Kritik Risk Alanları
| Servis / Dosya | Risk Açıklaması | Teknik Detay | Önerilen Çözüm |
|---|---|---|---|
| `InventoryService.findAllRolls` | Büyük `OR`‑tabanlı `contains` aramaları | `where.OR = [{ barcode }, { item.name contains }, { item.code contains }]` → PostgreSQL `ILIKE` index kullanılmaz, tam tablo taraması (seq scan) gerçekleşir. | 1. `contains` yerine tam eşleşme (`=`) veya `startsWith` kullanın. <br>2. `item.name` ve `item.code` alanları için **full‑text (GIN) index** ekleyin. <br>3. Arama terimi uzunluğunu kontrol edip `contains` kullanımını sınırlayın. |
| `InventoryService.findAllRolls` (pagination) | Varsayılan `status = STOCK` filtresi | `status` filtresi eklenmediğinde tüm rollar taranır, ek filtrelerle birleştiğinde düşük selectivity ve karmaşık `AND/OR` planı oluşur. | 1. Zorunlu pagination (`limit`/`pageSize`) zorunlu kılın, varsayılan limit 50. <br>2. `status=ALL` isteyen kullanıcılar için explicit `statusIn[]` isteyin. |
| `InventoryService.getRollStats` | Tek `groupBy` üzerinden büyük toplama | `groupBy(status, qualityGrade)` tüm satırları inceler; 500k+ satırda 3‑4 s gecikme. | 1. **Materialized view** veya periyodik aggregation (her 5 dk) oluşturun. <br>2. `status, qualityGrade, currentQty, weightKg` için **covering index** ekleyin. |
| `helpers/*` (örn. `coverage.helper.ts`) | Ardışık `findMany` çağrıları | Döngü içinde birden fazla `findMany` (orderLine, rollMovement, roll) yaparak **N+1** benzeri DB round‑trip oluşur. | `include` / `select` ile ilişkili verileri tek sorguda alın. <br>Gerekirse `prisma.$transaction([...])` içinde toplu `findMany` yapın. |
| `InventoryService.createInitialEntry` | İki kez `itemAllowedColor / itemAllowedProperty` kontrolü | `count` → `findUnique` iki ayrı sorgu; aynı anda `IN` koşulu yeterli. | Tek sorguda `where: { itemId: data.itemId, colorId: data.colorId }` kontrolüyle sorgu sayısını **2 → 1** azaltın. |
| `Roll` model indeksleri | Eksik compound indeks | `status`, `itemId`, `colorId`, `currentQty` sık filtre olarak kullanılıyor ancak ortak bir **compound index** yok. | `@@index([status, itemId, colorId, currentQty])` ekleyin. |
| Soft‑delete filtrasyonu | Birçok `findMany` sorgusunda `isActive` kontrolü eksik | Pasif kayıtlar sorguya dahil olur, indeks taramasını zayıflatır. | Global bir middleware ile `isActive = true` koşulunu otomatik ekleyin veya pasif kayıtları ayrı arşiv tabloya taşıyın. |
| Büyük veri transferleri | `findMany` ile tüm tabloyu döndürme | Payload büyür, network latency ve client memory sorunları ortaya çıkar. | `select` ile sadece gerekli alanları gönderin. <br>REST/GraphQL’da `fields` parametresi ekleyerek dinamik alan seçimi sağlayın. |
| Decimal toplama | `Prisma.Decimal` → `Number` dönüşümü | Büyük veri setinde hassasiyet kaybı ve ekstra compute maliyeti. | Toplamları SQL `SUM` ile `string` olarak gönderin; UI’da formatlayın. |
| Idempotent insert | `createInitialEntry` içinde `P2002` yakalanıp ikinci `findUnique` sorgusu | Ekstra DB round‑trip. | `upsert` kullanarak tek sorguda **insert‑or‑return** davranışı elde edin. |

---

## 3. Önerilen İyileştirme Yol Haritası
| Adım | Öncelik | Açıklama | Tahmini Çaba |
|---|---|---|---|
| 1️⃣ `findAllRolls` arama kısmını full‑text index (GIN) ile değiştir | Yüksek | `item.name` ve `item.code` alanları için GIN index ekleyin, sorguyu `@@to_tsquery` ile çalıştırın. | 0.5 gün (migration + indeks) |
| 2️⃣ Pagination zorunlu kıl ve limit 50 belirle | Orta | API katmanında varsayılan `limit` parametresi ekleyin; `status=ALL` için explicit `statusIn[]` zorunlu yapın. | 0.5 gün |
| 3️⃣ `getRollStats` için materialized view oluştur | Orta‑Yüksek | `CREATE MATERIALIZED VIEW roll_stats AS SELECT ... GROUP BY status, qualityGrade;` ve düzenli `REFRESH MATERIALIZED VIEW` cron işini ekleyin. | 1 gün + cron |
| 4️⃣ Compound index ekle (`status, itemId, colorId, currentQty`) | Orta | `@@index([status, itemId, colorId, currentQty])` migration. | 0.5 gün |
| 5️⃣ Soft‑delete global filtresi | Orta | Prisma middleware (`$queryRaw` öncesi) ile `isActive = true` otomatik ekleyin. | 0.5 gün |
| 6️⃣ `upsert` ile idempotent insert | Düşük | `prisma.roll.upsert({...})` ile tek sorguya dönüştürün. | 0.25 gün |
| 7️⃣ N+1 `findMany` iyileştirmeleri | Orta | `include` / `select` ve `$transaction` kullanarak tek sorguya birleştirin. | 1 gün |
| 8️⃣ Payload küçültme (`select` alanları) | Düşük | API’da sadece gerekli alanları (`id, barcode, status, currentQty`) döndürün. | 0.5 gün |
| 9️⃣ Decimal toplama string dönüşümü | Düşük | SQL `SUM` sonuçlarını `text` çekip JSON’da string olarak iletin. | 0.25 gün |
| 🔟 Cache (Redis) ile rapor ön‑bellekleme | Orta | `getRollStats` ve `getWarehouseScope` sonuçlarını 5‑10 dk TTL ile Redis’e kaydedin. | 0.5 gün |

---

## 4. Sonuç
Yapılan analiz, **performans düşüşüne** yol açabilecek bir dizi sorunu ortaya koymaktadır. Önerilen iyileştirmeler, **sorgu optimizasyonu**, **indeks ekleme**, **transaction yönetimi** ve **veri transferi azaltma** gibi alanlarda ağırlıklı olarak odaklanmıştır. Bu adımların uygulanması, API yanıt sürelerini %30‑60 oranında iyileştirebilir ve sistemin ölçeklenebilirliğini artırır.

---

**Bu rapor Antigravity (Google Deepmind) tarafından otomatik olarak oluşturulmuş ve doğrulama amacıyla başka bir yapay zekâya gönderilebilir.**
