# Backend Architecture Risk Assessment & Code Review Raporu

Bu rapor, TeksERP backend sisteminin (özellikle `src/services` katmanı ve `prisma/schema.prisma` veritabanı şeması) detaylı mimari, performans, ölçeklenebilirlik ve güvenlik incelemesi sonucunda tespit edilen riskleri içermektedir.

---

## 1. Database Şeması ve Sorgu Optimizasyonu

### Risk 1: Veritabanı Bağlantı Havuzunun Tükenmesi (N+1 Problemi ve Paralel Insert)
- **Risk Nedir?** İşlem gören çok sayıda kaydın (örneğin toplu barkod okutma işlemlerinde) her biri için ayrı ayrı veritabanı bağlantısı açarak kayıt atılması, "Connection Pool Exhaustion" (bağlantı havuzu tükenmesi) riskine yol açar. Yüksek eşzamanlılık durumunda sistem kilitlenebilir.
- **Kodun Hangi Kısmında?** `src/services/workorder.service.ts` (1932. satır - `attachRolls` fonksiyonu)
- **Çözüm Önerisi & Refactor Edilmiş Örnek Kod:**
  Toplu `AuditService.log` çağrıları `Promise.all` ile yapılıyor. Bu, her rulo için paralel bir DB connection açar. Bunun yerine `createMany` kullanılarak loglar tek bir sorguda (batch) atılmalıdır.

```typescript
// MEVCUT KÖTÜ KULLANIM (workorder.service.ts):
await Promise.all(
  attached.map((r) =>
    AuditService.log({
      userId, action: "UPDATE", tableName: "ROLL", ...
    })
  )
);

// ÖNERİLEN REFACTOR (audit.service.ts içerisine logMany metodu eklenmeli):
await AuditService.logMany(
  attached.map((r) => ({
    userId,
    action: "UPDATE",
    tableName: "ROLL",
    recordId: r.id,
    oldData: { status: r.prevStatus },
    newData: {
      status: "IN_PRODUCTION",
      workOrderId,
      firstStepId,
      barcode: r.barcode,
      qtyIn: r.qtyIn,
    }
  }))
);
```

### Risk 2: Kısmi (Partial) İndekslerin Manuel Yönetim Riski
- **Risk Nedir?** `prisma/schema.prisma` dosyasında `parentReceiptId`, `shipmentId`, `batchSplitId` gibi alanlar için Prisma'nın native olarak desteklemediği "Partial Index" (sadece NULL olmayanları indeksle) yapıları yorum satırıyla belirtilmiş. Ancak Prisma migrations run edildiğinde standart index oluşur. Gerçek partial index manuel SQL ile yapılmamışsa, index boyutu gereksiz şişerek DML (Insert/Update) performansını düşürür.
- **Kodun Hangi Kısmında?** `prisma/schema.prisma` (Roll Modeli indeksleri)
- **Çözüm Önerisi:** Prisma `@@index` tanımından bu alanları çıkarıp, deployment/migration sürecinde `CREATE INDEX CONCURRENTLY ... WHERE "shipmentId" IS NOT NULL` çalıştıracak özelleştirilmiş raw SQL migration'ların kullanıldığından kesin olarak emin olunmalıdır.

---

## 2. Mimari ve Business Logic (İş Mantığı) Hataları

### Risk 1: Manuel Optimistic Concurrency Control (Race Condition İhtimali)
- **Risk Nedir?** Yarış durumlarını (Race Conditions) engellemek için `TamburService` ve `WorkOrderService` içinde manuel olarak `updateMany` üzerinden dönen `count === 0` kontrolü yapılıyor. Ancak bu mimari standartlaştırılmamış. Yeni yazılacak bir modülde bir geliştirici bu yapıyı unutursa (çünkü standart bir `@Version` veya Row-Level Lock mekanizması yok), aynı top üzerinde mükerrer işlemler yapılabilir (Çift Tambur kesimi, çift fason çıkışı vs).
- **Kodun Hangi Kısmında?** `tambur.service.ts` (626. satır - `claim` yapısı)
- **Çözüm Önerisi:** Row-level lock (`SELECT ... FOR UPDATE`) kullanımı veya Prisma tarafında modele `version Int @default(0)` eklenerek tüm kritik update işlemlerinde `where: { id, version }` kontrolünün merkezi bir repoya (Repository Pattern) taşınması gerekir.

### Risk 2: Monolitik Servisler ve "Fat Service" Anti-Pattern
- **Risk Nedir?** İş mantığı katmanı çok şişmiş durumda. Sadece `workorder.service.ts` 123 KB, `tambur.service.ts` 95 KB boyutunda. Bu durum "God Object/Service" anti-pattern'idir. Servislerin test edilebilirliği zayıflar, modülerlik bozulur ve kod okunmaz hale gelir.
- **Kodun Hangi Kısmında?** Tüm ana servisler (`workorder.service.ts`, `tambur.service.ts`, `subcontractor.service.ts`)
- **Çözüm Önerisi:** İş mantığı domain bazlı parçalara ayrılmalı. Örneğin `WorkOrderService` içindeki yetki kontrolleri, rotalama/şablon ayrıştırmaları ve fiziksel kilit işlemleri (`computeWorkOrderLocks`) ayrı alt-servislere veya Strategy/State pattern'lerine taşınmalıdır.

---

## 3. Performans ve Ölçeklenebilirlik Riskleri

### Risk 1: Veritabanı Transaction'ı İçinde Bloklayıcı "for...of" Döngüleri
- **Risk Nedir?** `pg` (PostgreSQL) adapter ile transaction içinde `Promise.all` kullanılamadığı için geliştiriciler sıralı `for (const x of arr)` döngülerini kullanmış. Bu durum, döngü her döndüğünde veritabanına gidip gelmesine (network latency) ve transaction süresinin aşırı uzamasına sebep olur. Uzun süren transaction'lar diğer sorguları kilitler (Lock Contention) ve "Deadlock" ihtimalini inanılmaz artırır.
- **Kodun Hangi Kısmında?** `src/services/tambur.service.ts` (731. ve 769. satırlar - `segments` loop içi insert işlemleri)
- **Çözüm Önerisi & Refactor Edilmiş Örnek Kod:**
  Transaction içinde sıralı sorgu beklemek yerine, memory'de bulk-insert datası hazırlanmalı ve `createMany` ile tek bir sorguda DB'ye gönderilmelidir.

```typescript
// MEVCUT KÖTÜ KULLANIM (tambur.service.ts):
for (const seg of segments) {
  const splitRoll = await tx.roll.create({ ... }); // <-- Döngü içi tekil insert
  await tx.rollProperty.createMany({ ... });
  await tx.rollOperation.createMany({ ... });
}

// ÖNERİLEN REFACTOR:
// (Prisma createMany geri ID dönmezse, UUID'ler önceden kodda oluşturularak DB'ye toplu atılabilir)
const rollInserts = segments.map(seg => ({
  id: uuidv4(),
  barcode: generateTamburChildBarcode(),
  // ... diğer mappingler
}));

await tx.roll.createMany({ data: rollInserts });

// Daha sonra id'leri üzerinden Property ve Operation'lar da createMany ile tek hamlede atılır.
```

### Risk 2: Eksik Önbellekleme (Caching) ve Tekrarlı Okumalar
- **Risk Nedir?** Özellikle "Permission" listeleri, "Kullanıcı Tercihleri (UserPreferences)" ve "Route/Station" statik şablonları gibi uygulamanın yaşam döngüsü boyunca nadir değişen veriler için in-memory veya Redis tabanlı bir Cache kullanılmıyor. Her istekte bu master dataların DB'den çekilmesi büyük veri setlerinde ciddi CPU ve IO darboğazı yaratır.
- **Çözüm Önerisi:** Nadir değişen Master Data tabloları (Station, RouteTemplate, Permission) için `Redis` veya bellek içi (LRU Cache) bir önbellekleme katmanı (Interceptor veya Decorator bazlı) entegre edilmelidir.

---

## 4. Güvenlik ve Hata Yönetimi

### Risk 1: Yutulan Kritik Hatalar (Swallowed Exceptions)
- **Risk Nedir?** Audit servislerinde oluşan hatalar sadece konsola basılıp geçiliyor. "Loglama yüzünden ana akış bozulmasın" mantığı bir yere kadar doğru olsa da, uyumluluk (compliance) veya yasal sorumluluk gerektiren kayıtlarda veritabanı çöker ve log atılamazsa, kimin hangi işlemi yaptığı sonsuza dek silinmiş olur ve sistemin bundan haberi olmaz.
- **Kodun Hangi Kısmında?** `src/services/audit.service.ts` (40. satır - `catch (error) { console.error(...) }`)
- **Çözüm Önerisi:** Audit log başarısız olduğunda sistem bu işlemi bir `Dead Letter Queue (DLQ)` veya geçici bir dosyaya (Fallback Storage) yazabilmeli. Sistem sağlığı (Health Check) paneline "Audit yazmada X hata alındı" metriği düşürülmeli, tamamen yutulmamalıdır.

### Risk 2: JsonValue Üzerinde Eksik Type-Safety (Schema Validation)
- **Risk Nedir?** JSON formatında tutulan esnek alanlar (Örn: `stepData`, `lastLabelSnapshot`, `UserPreference.preferences`), kod içinde `as Prisma.InputJsonValue` ile cast ediliyor. Eğer Frontend'den manipüle edilmiş, formata uymayan zararlı veya bozuk bir JSON bloğu gelirse, backend bunu olduğu gibi DB'ye yazar. Çekerken runtime'da `undefined` veya tip uyuşmazlığı (TypeError) yüzünden uygulama çökebilir.
- **Kodun Hangi Kısmında?** `workorder.service.ts` (827. satır - `stepData` json operasyonları)
- **Çözüm Önerisi:** Bu alanlar veritabanına yazılmadan hemen önce `Zod` veya `Joi` gibi şema doğrulama (validation) kütüphaneleriyle kesin tiplere göre sanitize (parse) edilmeli, doğrudan casting yapılmamalıdır.
