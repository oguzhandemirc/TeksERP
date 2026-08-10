# SaaS DÖNÜŞÜMÜ TASARIMI — Çok Firmalı Bulut Sürümü (DB-per-tenant)

> ## ⚠️ İLERİSİ İÇİN — ŞU AN UYGULANMIYOR
>
> Bu doküman bir **TASARIM TASLAĞIDIR**, yürürlükteki bir iş değildir. **Tek satır kod yazılmadı**, hiçbir fazı başlatılmadı, takvim verilmedi.
>
> - **Mevcut kurulum (Adnan Şahin) on-prem çalışmaya DEVAM EDİYOR** ve bu plandan hiçbir şekilde etkilenmez. Karar: SaaS ayrı bir hat olarak, yeni müşteriler için kurulacak (§A0).
> - Buradaki hiçbir madde bugünkü geliştirme kararlarını bağlamaz. Günlük işlerde ölçüt hâlâ kök `CLAUDE.md` ve alt proje CLAUDE.md'leridir.
> - **Ne zaman başlanacağı kararı verilmedi.** Başlanırsa giriş noktası Faz 0'dır (§H1) ve o fazın ilk maddesi SaaS'tan bağımsız olarak bugün de faydalıdır (mobil `serverReachability` düzeltmesi, §F2-2).
> - Dokümanın değeri **ölçüm**dedir: 4 kod taramasıyla çıkarılmış envanterler (86 dosyanın prisma bağımlılığı · 19 kalem bellek-içi global durum · istasyon davranışının ~46 hard guard'ı · donanım katmanının genişleme noktaları) SaaS yapılmasa bile mimari borç haritası olarak geçerlidir.

**Durum:** TASLAK **v2.1** (2026-08-10) — karar seti soru-cevap turuyla alındı; backend + istemciler + istasyon/donanım katmanı kod taramasıyla ölçüldü (4 tarama); v2.1 = boşluk analizi eklemeleri. Kod yazılmadı.
**Emsal dokümanlar:** `docs/design/CUVAL-HAVUZU-TASARIM.md`, `PARTI-MODELI-TASARIM.md` (format), `docs/ops/KURULUM.md` (bugünkü dağıtım).
**v2'de eklenenler:** tenant yaşam döngüsü · SLO/RPO-RTO · istasyon & donanım genişletme mimarisi (Bölüm D) · güvenlik/KVKK uyum listeleri · sürüm-uyumluluk politikası · onboarding metodolojisi · kapasite planı · kullanım ölçümü · risk kaydı.
**v2.1'de eklenenler (boşluk analizi):** sözleşme çerçevesi + SLA telafisi (§A4) · e-Belge kapsam beyanı (§A5) · duyuru kanalı (§B5) · on-prem→SaaS taşıma prosedürü (§C6.3) · fidye-dirençli yedek (§C7) · şifre politikası + sızma testi + DDoS (§E1) · olay yönetimi/post-mortem + iç p95 hedefi (§G1) · veri içe aktarım kiti (§G3) · risk 13-14 · açık soru 6-7.

---

# BÖLÜM A — ÜRÜN VE İŞ ÇERÇEVESİ

## A0. Karar Seti (2026-08-10)

| Konu | Karar |
|---|---|
| Model | **DB-per-tenant** (sektör terimiyle: veri katmanı **silo**, uygulama katmanı **pool** — AWS SaaS Lens sınıflaması). Firma başına ayrı Postgres database, tek Node API. Şemaya `tenantId` kolonu EKLENMEZ. |
| Mevcut fabrika | **On-prem KALIR.** Tek kod tabanı; `TENANT_MODE=single` on-prem'i bayt-bayt korur. |
| Barındırma | Tek güçlü Avrupa VPS (Hetzner tarzı). KVKK: sözleşmeye yurt dışı aktarım maddesi (§E2). |
| Erişim | Tek adres (`api.tekserp.com`) + login'de **firma kodu** → JWT `tenantId`. Subdomain yok (istemciler native). |
| Ölçek | Yıl 1: 5-20 firma → açılış tam otomatik. |
| Panel | Önce Electron (installer + auto-update + kod imzalama), web sonraki faz. |
| APK | Önce direkt link, sonra Play. |
| Müşteri profili | "Benzer ama varyasyonlu" → firma bazlı modül bayrakları + **jenerik istasyon çalışabilirliği** (Bölüm D — yeni istasyon/donanım genişlemesinin ön koşulu). |
| Paketleme | Ertelendi; `Tenant.planFlags` alanı rezerve. |
| Kurulum | White-glove, metodolojisi §G3. |
| Destek | Süreli, audit'li destek girişi (§B3). Seviye/yanıt hedefleri §A3. |
| Yedek | Gece firma başına `pg_dump` + şifreli site dışı, 30 gün (§C7). RPO/RTO §A3'te açıkça taahhüt edilir. |
| İnternet riski | Kabul + müşteriye 4G yedek modem şartı. Edge/senkron KAPSAM DIŞI. |
| Tempo | Acele yok; fazlar §H1, boyutlar T-shirt (S/M/L/XL). |

## A1. Hedef Mimari

```
                     api.tekserp.com          updates.tekserp.com  ·  indir.tekserp.com
                          │                              │ (statik: latest.yml, Setup.exe, APK)
                  Caddy (TLS, otomatik sertifika, reverse proxy, kaba rate-limit)
                          │
                  Node API — TEK süreç, pm2 (bugünkü src/server.ts)
                  ├── Tenant middleware: JWT.tenantId → AsyncLocalStorage bağlamı
                  ├── Tenant registry: master lookup + Prisma client cache (LRU)
                  ├── /api/control/*  ← süper-admin (ayrı JWT secret + TOTP, IP kısıtı)
                  └── Zamanlı işler: FİRMA DÖNGÜSÜ (arşiv, yedek, uzlaştırma, kullanım ölçümü)
                          │
                  PostgreSQL — tek instance (max_connections=200)
                  ├── tekserp_master      ← kontrol düzlemi
                  ├── tekserp_t_<kod>     ← firma başına DB (CONNECTION LIMIT 10)
                  └── ...
                          │
   ┌──────────────────────┴───────────────────────────────────────────┐
   │  MÜŞTERİ SAHASI (LAN) — donanım BULUTA DEĞİL, YEREL İSTEMCİYE bağlı │
   │  Electron PC'ler: etiket yazıcı (TCP:9100/COM/USB-winspool/CUPS),   │
   │  kantar (COM), barkod (COM/HID/wedge)                               │
   │  Tabletler: kamera barkod, BT-SPP kantar, BT-SPP yazıcı             │
   └─────────────────────────────────────────────────────────────────────┘
```

- **Tek süreç invariant'ı KORUNUR** (`server.ts`'teki mevcut blok): pm2 cluster'a GEÇİLMEZ. Presence, feature-flag cache, scheduler bayrakları buna dayanıyor; SaaS "process-global" olanları "tenant-keyed" yapar (§C3), invariant'ı değiştirmez.
- **Donanım ilkesi:** bulut API'si donanım-agnostiktir; tüm cihaz I/O'su sahadaki istemcide kalır (Bölüm D2). Buluta yalnız DEĞER + KAYNAK İZİ gider (`weighSack` emsali: `weightKg` + `weightSource: SCALE|MANUAL|SIMULATED`).

## A2. Tenant Yaşam Döngüsü (durum makinesi)

```
PROVISIONING ──ok──▶ ACTIVE ◀──askıdan al──┐
     │                 │                    │
     └─hata─▶ FAILED   ├──askıya al──▶ SUSPENDED ──sözleşme bitti──▶ OFFBOARDING ──▶ ARCHIVED
              (devam-et│ (ödeme / migration │                         (veri iade +      (DB düşürüldü,
               yeniden  │  hatası / istek)   │                          bekletme)         dump arşivde)
               dener)   ▼                    ▼
                     günlük işler         API 403 TENANT_SUSPENDED
```

| Durum | API davranışı | Yedek | Günlük işler |
|---|---|---|---|
| PROVISIONING / FAILED | 403 (login reddedilir) | — | — |
| ACTIVE | normal | ✅ | ✅ |
| SUSPENDED | 403 `TENANT_SUSPENDED` (alt sebep: `PAYMENT` / `MIGRATION_FAILED` / `REQUEST`) | ✅ sürer (veri korunur) | arşiv sürer, ölçüm sürer |
| OFFBOARDING | 403 | son tam dump alınır + müşteriye teslim | durur |
| ARCHIVED | 403 | dump saklama süresi boyunca arşivde | — |

- **Offboarding prosedürü (KVKK "veri iade + silme"):** ① son `pg_dump -Fc` + belge/etiket şablonları dahil tam kopya müşteriye şifreli teslim; ② 30 gün bekleme (itiraz penceresi); ③ `DROP DATABASE` — yalnız kontrol panelinden, **firma adını yazarak onaylı iki-adımlı** akışla (projenin "yıkıcı işlemde detaylı onay" konvansiyonu); ④ site dışı yedekler rotasyonla 30 gün içinde doğal düşer; ⑤ her adım `TenantOpLog`'a. Master'daki Tenant satırı ve op-log'lar SİLİNMEZ (ticari kayıt).

## A3. Hizmet Seviyeleri (müşteriye verilen söz — sözleşme eki)

| Metrik | Taahhüt (Faz 5 pilot itibarıyla) | Not |
|---|---|---|
| Erişilebilirlik (SLO) | **%99,5 / ay** (≈ 3,6 saat/ay) | Tek VPS için dürüst hedef; %99,9 çoklu-sunucu ister, vaat EDİLMEZ |
| Planlı bakım penceresi | Pazar 03:00-06:00 TSİ, 48 saat önceden duyuru | Migration + restart buraya |
| **RPO** (veri kaybı toleransı) | **24 saat** (gece yedeği) | Sözleşmede AÇIKÇA yazar; PITR'a geçiş (§C7) RPO'yu ~15 dk'ya indirir, fiyat farkıyla sunulabilir |
| **RTO** (geri dönüş süresi) | Tek firma geri yükleme: **4 saat** · VPS tam kaybı: **8 iş saati** | Tatbikatla ÖLÇÜLÜR (§G4); ölçülmemiş RTO taahhüt edilmez |
| Destek S1 (üretim durdu) | İlk yanıt 2 saat (07:00-22:00) — telefon/WhatsApp | 4G yedeği olmayan müşteride internet kesintisi S1 SAYILMAZ (sözleşmede) |
| Destek S2 (önemli işlev bozuk) | İlk yanıt 8 iş saati — e-posta/telefon | |
| Destek S3 (soru/küçük hata) | 2 iş günü — e-posta | |
| Durum sayfası | `durum.tekserp.com` (Uptime Kuma veya statik) | Kesintide tek doğru kaynak |
| **SLA telafisi (service credit)** | Aylık SLO altına düşülürse sonraki faturadan kademeli indirim (örn. <%99,5 → %10, <%98 → %25) | Telafisiz SLA pazarlama metnidir; kademeler sözleşme ekinde |

## A4. Sözleşme çerçevesi (hukuki asgari set)

Üç parçalı standart paket — **pilot ÖNCESİ avukat kontrolünden geçer** (Faz 5 çıkış koşulu):

1. **Abonelik Sözleşmesi:** hizmet tanımı ve kapsam sınırı (⚠️ "yazılım fatura/e-belge KESMEZ" açıkça — §A5) · ödeme/fesih koşulları · **"veri müşterinindir"** maddesi (istediği an tam dışa aktarım hakkı, §A2 prosedürü) · **sorumluluk sınırı** (sektör standardı: son 12 ay ücret tavanı; dolaylı zarar/kâr kaybı hariç) · firma-başına özel kod yazılmayacağı (H2 risk 10'un sözleşme karşılığı).
2. **SLA eki:** §A3 tablosu + telafi kademeleri + S1 tanımının 4G şartına bağlı istisnası.
3. **DPA (KVKK) eki:** §E2.

## A5. Kapsam beyanı: e-Belge (e-Fatura / e-İrsaliye)

⚠️ **Satışta ilk sorulacak sorulardan biri budur; cevabı baştan yazılı olmalı.** Bugünkü ürün ilkesi korunur: **ERP fatura KESMEZ** — resmi belge müşterinin muhasebe/e-belge yazılımında doğar; TeksERP sevk irsaliyesini operasyonel belge olarak basar ve dış belge numarasının yalnız İZİNİ tutar (`invoiceNo` deseni, 2026-08-02 kararı). GİB e-İrsaliye mükellefi müşteride akış: TeksERP çeki listesi/sevk verisini üretir → müşteri e-belgeyi kendi entegratöründe keser. **Entegratör entegrasyonu (Logo/Foriba/Uyumsoft vb.) Faz 6 adayıdır** — talep 2-3 müşteride somutlaşırsa tasarlanır, öncesinde VAAT EDİLMEZ. Keşif formuna (§G3) "e-İrsaliye mükellefi mi, hangi entegratör" sorusu eklidir.

---

# BÖLÜM B — KONTROL DÜZLEMİ (`tekserp_master`)

## B1. Şema (ayrı Prisma şeması: `prisma/master/schema.prisma`, ayrı client çıktısı)

```prisma
enum TenantStatus { PROVISIONING ACTIVE SUSPENDED FAILED OFFBOARDING ARCHIVED }

model Tenant {
  id            String       @id @default(uuid()) @db.Uuid
  code          String       @unique              // login'de girilen firma kodu, ^[a-z0-9-]{3,20}$
  name          String
  dbName        String       @unique              // tekserp_t_<code>
  status        TenantStatus @default(PROVISIONING)
  suspendReason String?                            // PAYMENT | MIGRATION_FAILED | REQUEST
  planFlags     Json         @default("{}")        // abonelik/modül bayrakları (§C9) — rezerve
  schemaState   String?                            // son başarılı migration adı
  contactName   String?      @db.VarChar(120)      // KVKK irtibat + S1 arayacağımız kişi
  contactPhone  String?      @db.VarChar(40)
  contactEmail  String?      @db.VarChar(120)
  notes         String?      @db.VarChar(1000)
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
}

model TenantOpLog {                                // append-only işletme izi
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String?  @db.Uuid                      // null = filo geneli işlem
  op        String                                  // PROVISION|MIGRATE|BACKUP|RESTORE_DRILL|SUPPORT_LOGIN|SUSPEND|RESUME|OFFBOARD|DROP
  status    String                                  // STARTED | OK | FAILED
  detail    Json?
  actor     String?                                 // ControlUser.username | "system"
  createdAt DateTime @default(now())
}

model TenantUsageDaily {                           // kullanım ölçümü (§B4) — billing hazırlığı
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @db.Uuid
  day          DateTime @db.Date
  activeUsers  Int                                  // o gün login olan tekil kullanıcı
  apiRequests  Int
  rollsCreated Int
  dbSizeMb     Int
  createdAt    DateTime @default(now())
  @@unique([tenantId, day])
}

model ControlUser {                                // süper-admin — tenant kullanıcılarından TAMAMEN ayrı
  id           String   @id @default(uuid()) @db.Uuid
  username     String   @unique
  passwordHash String
  totpSecret   String?                              // 2FA zorunlu (§E1) — null yalnız ilk kurulum
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

- **`code` değişmez kimliktir** (rol şablonu `code` dersi). DB adı koddan türetilir, `quoteIdent` (`pg-conn.helper.ts:98`) ile kullanılır.
- Master DB de gece yedeklenir (küçük ama kritik).

## B2. Süper-admin API + panel

`/api/control/*` — ControlUser JWT (**ayrı `CONTROL_JWT_SECRET`**) + TOTP + Caddy'de IP allowlist (ofis/VPN çıkışları). Control token `/api/*`'a, tenant token `/api/control/*`'a ASLA geçemez (ayrı middleware, bekçili — §G5).

| Uç | İş |
|---|---|
| `POST /control/tenants` | Firma aç → §C6 zinciri (async; TenantOpLog + durum akışı) |
| `GET /control/tenants` | Liste: durum, schemaState, DB boyutu, son yedek, son login, kullanım özeti |
| `PATCH /control/tenants/:id` | Askıya al / aktifleştir / iletişim-not |
| `POST /control/tenants/:id/support-session` | Destek girişi (§B3) |
| `POST /control/tenants/:id/offboard` · `POST /:id/drop` | §A2 prosedürü (iki-adımlı onay) |
| `POST /control/migrate` | Filo migrate orkestrasyonu (§C6.2) — deploy script de CLI'dan aynı ucu çağırır |
| `GET /control/health` | Host metrikleri (bugünkü `buildRichHealth` gövdesi) + firma başına kırılım |
| `GET /control/usage` | TenantUsageDaily raporu (dönem filtreli) |
| `GET/POST /control/announcements` | Duyuru yönetimi (§B5) |

Panel: Electron içinde ayrı route ağacı (`/control/*`); mevcut CRUD altyapısı (crudService, FilterBar) yeniden kullanılır.

## B3. Destek girişi

- Panelden "firmaya destek girişi" → hedef firmanın DB'sindeki seed'le gelen **`destek` kullanıcısı** için kısa ömürlü (60 dk) normal tenant JWT'si; `Session` kaydı `deviceType=SUPPORT`.
- `destek` kullanıcısı **şifresiz doğar** (`passwordHash=null` → normal login imkânsız); tek giriş yolu control ucu. İzin seti = salt-okunur genel + hedefli yazma İSTENMEZ (sorunu görmek için okuma yeter; yazma gerekiyorsa müşteri onayıyla geçici rol ataması, o da audit'te).
- İz iki yerde: master `TenantOpLog(SUPPORT_LOGIN, actor)` + tenant `SystemLog` (`AuditService`, category AUTH). Firma admin'i kendi audit ekranında görür — şeffaflık sözleşmede yazar.

## B4. Kullanım ölçümü (billing hazırlığı)

- Gece firma döngüsünün son adımı: `TenantUsageDaily` satırı (aktif kullanıcı `Session`'dan, istek sayısı latency-stats'ın tenant kırılımından, `rollsCreated` sayımdan, DB boyutu `pg_database_size`).
- Amaç: paketleme kararı geldiğinde **geriye dönük gerçek veriyle** fiyatlamak; ayrıca kontrol panelinde "büyüyen firma / ölü firma" görünürlüğü. Faturalama motoru YAZILMAZ (karar ertelendi).

## B5. Duyuru kanalı (bakım / olay / sürüm bildirimi)

§A3'teki "48 saat önceden duyuru" sözünün MEKANİZMASI — bugün hiçbir kanal yok: master'da `Announcement` (başlık, markdown gövde, tür: `MAINTENANCE|INCIDENT|RELEASE`, geçerlilik penceresi, hedef: filo|tek firma) + tenant bağlamında süzülen `GET /api/announcements` → Electron/mobil üstünde kapatılabilir bant. Bakım duyurusu, müşteriye dönük sürüm notu özeti ve olay bilgilendirmesi (§G1) AYNI kanaldan; e-posta/WhatsApp yalnız S1 tamamlayıcısı. Basit tutulur: okundu takibi YOK, zengin editör YOK. (Backend Faz 2, istemci bandı Faz 3.)

---

# BÖLÜM C — VERİ DÜZLEMİ (backend çekirdeği)

## C1. Bugünkü durum (ölçüldü, 2026-08-10)

- Tek singleton: `Teks-Erp/src/lib/prisma.ts` — pg Pool (`max:30`, `PG_SESSION_OPTIONS`=UTC) + PrismaPg adapter; `export default prisma; export { pool }`.
- **86 dosya** import ediyor (55 servis, 12 rapor, 9 helper, 4 job, 2 middleware, app/server, pool-health, 1 controller). `src/` içinde başka `new PrismaClient` YOK.
- Hazır temel: `pg-admin-client.ts` (`withAdminClient` — bakım DB'sine havuzsuz kısa ömürlü Client; CREATE/DROP DATABASE buradan koşuyor) + `pg-conn.helper.ts` (`parseDatabaseUrl`, `withDatabase`, `toClientConfig`, `quoteIdent`).
- Advisory lock envanteri tamamen 2-argümanlı `pg_advisory_xact_lock` (NS 8021-8025) → DB-per-tenant'ta kilitler doğal olarak firma-yerel; transaction-mode PgBouncer ile de uyumlu.

## C2. Tenant çözümleme: AsyncLocalStorage + Proxy — 86 dosyaya DOKUNMADAN

Yeni dosyalar: `src/lib/tenant-context.ts` (ALS + `runAsTenant`), `src/lib/tenant-registry.ts` (master lookup + client cache), `src/lib/master-prisma.ts` (master client, pool max 3).

```ts
// lib/prisma.ts default export'u Proxy olur:
// TENANT_MODE=single (varsayılan) → bugünkü singleton AYNEN (bayt-bayt korunum)
// TENANT_MODE=saas → aktif ALS bağlamının client'ına delege
const prismaProxy = new Proxy({} as PrismaClient, {
  get: (_t, prop) => Reflect.get(
    TENANT_MODE === "single" ? singleton : resolveTenantClient(), prop),
});
```

- `resolveTenantClient()` bağlam yoksa **THROW** (saas modunda bağlamsız DB erişimi = programlama hatası; "varsayılan firmaya düş" tam da önlenen sızıntıdır).
- Bağlamı kuranlar: ① istek yolu — auth.middleware JWT `tenantId` → `tenantContext.run`; ② job yolu — firma döngüsü `runAsTenant`; ③ login yolu — firma kodu gövdeden (§C5).
- `export { pool }` sözleşmesi kalkar (tek tüketici `pool-health.ts` — registry'den "tüm havuzlar" alır, §C3/10).
- ⚠️ Tenant başına Pool açan registry **`PG_SESSION_OPTIONS` geçirmek ZORUNDA** — `scripts/test_timestamptz_contract.ts` bekçisi `new Pool(` kuran her dosyayı tarıyor; bekçi bunu mekanik yakalar, gevşetme.

## C3. Bellek-içi durumun tenant'lanması (envanter — taramayla, 19 kalem)

Kural: *"Bu değer bir firmanın VERİSİNİ/KİMLİĞİNİ taşıyor mu?"* → tenant-keyed. *"Host kaynağını mı ölçüyor?"* → host-level kalır ama tenant admin'ine gösterilmez (yalnız `/control/health`).

**5A — tenant-keyed yapılacaklar (sızıntı üretir; Faz 1):**

| # | Yer | Sızıntı | Çözüm |
|---|---|---|---|
| 1 | `system-setting.service.ts` `featureFlagsCache` (30 sn, global) | A'nın companyName/documentsConfig/oturum ayarı B'ye servis edilir — **en kritik** | `Map<tenantId, {value,expiresAt,gen}>` |
| 2 | `system-log.service.ts` `DropdownCache` (kullanıcı listesi, 5 dk) | Kullanıcı adı/tam ad **PII** başka firmaya | tenant-keyed |
| 3 | `lib/presence.ts` `users`/`devices` | Online sayımı karışır | tenant-keyed |
| 4 | `device.service.ts` `lastSeenWrites` (deviceId→ts) | deviceId istemci-tanımlı → firmalar arası çakışma, yazım yutulur | anahtar `tenantId|deviceId` |
| 5 | `login-lockout.ts` `failCounts` (`req.ip`) | Aynı NAT'taki iki firma birbirini kilitler | anahtar `tenantCode|ip` |
| 6 | `system-setting` `documentsLogoWriteQueue` | A'nın logosu B'yi bekletir | tenant-keyed chain |
| 7 | `latency-persist.service.ts` `pending`+flush | Kayıt yanlış DB'ye gider | tenant bağlamında biriktir, kendi DB'sine flush |
| 8 | `audit.service.ts` `auditFailureState` (ham hata metni health'te) | Başka firmanın veri/şema ipucu | tenant-keyed sayaç; ham metin yalnız control |
| +9 | (yeni) per-tenant rate limiter (§E1) | — | tasarımı baştan tenant-keyed |

**5B — host-level kalır, görünürlüğü kısılır:** `latency-stats` (anlık perf; `/api/admin/perf` saas'ta control-only) · `pool-health` (registry toplamı + firma kırılımı; tenant admin health'inde havuz YOK) · `app.ts` backupCache / disk / CPU örnekleri (control-only) · `backup/db-copy/backup-impact` global tek-iş bayrakları → merkezi orkestratör kuyruğuna dönüşür (§C7), tenant admin'i yalnız KENDİ yedek durumunu görür.

**5C — dokunulmaz (şema/statik):** BaseService DMMF cache'leri, label-fields, raster font, printed-document registry, json-replacer bayrağı.

⚠️ Envanter bekçiye bağlanır: `test_tenant_isolation.ts` `src/` içinde module-level `let/Map/cache` taraması yapar, bilinen-liste dışı yeni global durum → KIRMIZI. Yarın eklenen bir cache'in sessizce sızmasını önlemenin tek mekanik yolu.

## C4. Bağlantı bütçesi + Postgres yapılandırması

| Ayar | Değer | Gerekçe |
|---|---|---|
| Firma havuzu | `max: 4` (env ile ayarlanır) | 20 firma × 4 = 80 + master 3 + bakım geçici ≈ 90 |
| `max_connections` | **200** | 32 GB RAM'de güvenli; yarısı boş pay |
| Firma DB'si | `ALTER DATABASE ... CONNECTION LIMIT 10` | Havuz kaçağına DB-seviyesi tavan (derinlik savunması) |
| LRU tahliyesi | 30 dk dokunulmayan firma → `pool.end()` | idle bağlantılar zaten 10 dk'da düşüyor; tahliye Map'i sınırlar |
| `statement_timeout` | app rolünde **30 sn** | Kaçak sorgu tavanı (Prisma tx timeout 20 sn zaten var; bu ham sorguları da kapsar) |
| PgBouncer eşiği | ~30+ eşzamanlı aktif firma VEYA `waitingCount` > 0 kalıcılaşırsa | Transaction mode; advisory lock'lar xact-scoped → uyumlu. Eşik görülmeden KURULMAZ |

**PG rolleri (en az yetki):**
- `tekserp_app` — uygulama rolü, superuser DEĞİL; her tenant DB'sinin sahibi; `REVOKE CONNECT ON DATABASE ... FROM PUBLIC`.
- `tekserp_admin` — `CREATEDB` yetkili provisioning rolü; yalnız `withAdminClient` yolunda.
- Süperuser yalnız elle bakım oturumlarında.

**CREATE DATABASE sözleşmesi:** `TEMPLATE template0 ENCODING 'UTF8'` + **canlı DB'nin `datcollate/datctype` değerinin AYNISI** (Faz 0'da `SELECT datcollate, datctype FROM pg_database` ile kaydedilir). Firma DB'leri arasında collation farkı = aynı sorgunun farklı sıralaması → yasak. Türkçe büyük/küçük zaten uygulama katmanında (`toLocaleUpperCase("tr")` kuralı) — DB collation'a taşınmaz.

## C5. Kimlik doğrulama

- Üç login gövdesi (`login`, `login-card`, `login-quick-pin`) `companyCode` kazanır. Saas'ta zorunlu; single'da yok sayılır. Akış: master lookup (ACTIVE değilse tek tip 403 — kod tahmini kolaylaştırılmaz) → `runAsTenant` içinde mevcut `AuthService.login` AYNEN (lockout, session-registry, izinler tenant DB'sinde).
- `JwtPayload` + `tenantId`/`tenantCode`; single modda yazılmaz (eski token'lar geçerli). `auth.middleware`: verify → registry cache'inden ACTIVE mi (DB'siz) → değilse 401 `TENANT_SUSPENDED` → ALS. Askı etkisi ANINDA (cache invalidation `PATCH /control/tenants`).
- `GET /api/auth/login-methods` yanıtına `tenantMode` eklenir; saas'ta `companyCode` query ister (kodsuz → yalnız `{tenantMode}`). ⚠️ `GET /api/auth/mobile-users` (public kullanıcı listesi) saas'ta koda bağlanır — tek firmada zararsızdı, çok firmada PII yüzeyi.
- **Secret yönetimi:** `JWT_SECRET` firma-bağımsız tek (token zaten `tenantId` taşıyor ve doğrulama tenant DB'sindeki session kaydına bakıyor — ikinci faktör); yıllık rotasyon prosedürü: çift-secret doğrulama penceresi (yeni imza + eski kabul, 1 oturum ömrü) → eski düşer. `CONTROL_JWT_SECRET` ayrı. Tüm secret'lar `/etc/tekserp/env` (root:600), repo'ya asla.

## C6. Firma açılışı + migration orkestrasyonu

### C6.1 Açılış zinciri (`POST /control/tenants`) — idempotent, her adım TenantOpLog'lu

```
1. master'a Tenant (PROVISIONING)              — code/dbName çakışması 409
2. withAdminClient: CREATE DATABASE …          — quoteIdent + §C4 sözleşmesi; DB var ve BOŞSA devam (yarım açılış kurtarma)
   + ALTER DATABASE … CONNECTION LIMIT 10; GRANT/OWNER tekserp_app
3. çocuk süreç: prisma migrate deploy          — env override (pg-tool.helper spawn emsali)
4. çocuk süreç: seed.ts --tenant-name "<Ad>"   — standart katalog
5. runAsTenant: izin kataloğu + rol şablonu uzlaştırması (mevcut job gövdeleri)
6. `destek` kullanıcısı (şifresiz, §B3)
7. master: ACTIVE + schemaState
```
Düşen adım → FAILED + log; panelden "devam et" aynı ucu çağırır. `DROP DATABASE` otomatiği YOK (yarım açılış temizliği bilinçli elle — canlı-veri refleksi).

### C6.2 Migration orkestrasyonu + sürüm politikası

- Deploy reçetesi: `git pull` → master migrate (nadiren) → **firma döngüsüyle sıralı `migrate deploy`** (çocuk süreç) → pm2 restart. Sonuçlar master'a (`schemaState`, OpLog).
- **Kısmi başarısızlık siyaseti:** düşen firma `SUSPENDED(MIGRATION_FAILED)` → o firmaya 503 "bakımda"; DİĞERLERİ yeni sürümle devam. Hepsi-ya-hiç YAPILMAZ (kurşun toplu-atama gerekçesi). İnceleme: son yedek kopya DB'ye açılır (mevcut db-copy altyapısı), migration orada denenir.
- Restart'tan önce tüm aktif firmalar migrate edilmiş olur → "eski şemalı firma + yeni kod" penceresi kapalı.
- **Sürüm politikası:** filo TEK sürümde koşar (firma başına sürüm pinleme YOK — bakım maliyeti + destek matrisi patlar; sektörde pooled-compute standartı). SemVer; migration içeren her sürüm MINOR+. Rollback = migration geri alınmaz (proje kuralı) → geri dönüş yedekten restore'dur ve bakım penceresine bu yüzden yedek-önce kuralı yazılır: **restart öncesi filo yedeği** (hızlı `pg_dump` turu ya da o gecenin yedeği taze ise atlanır).
- **Staging + kanarya:** VPS'te `tekserp_t_demo` (bizim demo firmamız) + dev makinede staging. Her sürüm önce demo firmada koşar (kanarya), sorun yoksa filoya. Demo firma aynı zamanda satış demosu.

### C6.3 Mevcut kurulumdan SaaS'a taşıma (on-prem → tenant)

Karar "on-prem kalır" ama prosedür yazılı dursun (ileride Adnan Şahin ya da hâlihazırda on-prem koşan bir aday için): ① firma açılışı **seed'siz varyantla** (§C6.1 adım 4 atlanır); ② sahada son `pg_dump -Fc` → tenant DB'ye `pg_restore`; ③ `migrate deploy` (saha eski sürümdeyse fark migration'ları burada koşar); ④ uzlaştırmalar + `destek` kullanıcısı; ⑤ istemcilerde adres + firma kodu değişimi; ⑥ eski sunucu 30 gün salt-okunur bekletilir. Kesinti = dump+restore süresi (bugünkü DB boyutunda dakikalar). Çift-yazım/senkron dönemi YOK — tek kesin geçiş (bakım penceresinde).

## C7. Yedekleme — 3-2-1, şifreli, tatbikatlı

| Katman | Ne | Nerede |
|---|---|---|
| 1. kopya | canlı DB | VPS disk (RAID yok — VPS) |
| 2. kopya | gece `pg_dump -Fc` firma başına | `BACKUP_DIR/<code>/`, 30 gün rotasyon |
| 3. kopya (site dışı) | rclone ile **şifreli** (`rclone crypt` remote) | Backblaze B2 / Hetzner Storage Box, 30 gün |

- Mevcut `backup.service` + `offsite-backup.helper` gövdesi yeniden kullanılır; global `running` bayrağı **merkezi sıralı kuyruk** olur (aynı anda tek pg_dump — IO fırtınası önlenir), firma başına durum master'a yazılır.
- Master DB + `/etc/tekserp/env` + Caddy config de yedeğe girer (VPS yeniden kurulum seti).
- **Fidye yazılımı direnci:** site dışı hedefte sürümleme/object-lock AÇIK ve sunucudaki rclone anahtarı **silme yetkisiz** (append-only application key) — ele geçirilen sunucu kendi yedeklerini imha EDEMEZ. Bu iki ayar olmadan "site dışı yedek" fidye senaryosunda değersizdir.
- **Tatbikat takvimi:** ayda 1 firma restore tatbikatı (mevcut db-copy/verify servisleri tenant-parametreli; sonuç `TenantOpLog(RESTORE_DRILL)`) + 6 ayda 1 **tam VPS yeniden kurulum tatbikatı** (boş sunucuya runbook'tan; RTO ölçümü buradan gelir).
- PITR (WAL arşivi) Faz 6 adayı: `wal-g`/`pgbackrest` + B2; RPO 24 saat → ~15 dk. Müşteri talebi/fiyat farkı netleşince.

## C8. Boot + zamanlanmış işler

Bugün: listen sonrası fire-and-forget → archive (60 sn), backup (60 sn), offsite (90 sn), permission-catalog (3 sn; rol şablonlarını zincirler). Saas'ta her iş **sıralı firma döngüsüne** sarılır:

```ts
for (const t of await activeTenants()) await runAsTenant(t, () => job.runIfDue());
```
- `permission-catalog.job.ts:47` `let started` bayrağı süreç-başına kalır ama gövde döngüye alınır — bugünkü haliyle ikinci firma için uzlaştırma ASLA koşmazdı.
- Damgalar zaten tenant DB'sinde (`audit.lastArchiveAt`, `backup.lastNightlyAt`) → "vadesi geldi mi" firma başına bedava doğru. Watchdog döngü seviyesine.
- Her gece döngüsünün sonu: kullanım ölçümü (§B4) + **dead-man switch ping'i** (healthchecks.io — gece işi hiç koşmadıysa sabah alarm, §G1).

## C9. Modül/paket bayrakları

- **Operasyonel bayraklar** (bugünkü `SystemSetting`): tenant DB'sinde, firma admin'i yönetir — DB-per-tenant sayesinde bedava firma-bazlı. "Kurşun bypass açık mı" burası.
- **Abonelik bayrakları** (`Tenant.planFlags`, master): "fason modülü satın alındı mı". `GET /api/feature-flags` yanıtına salt-okunur `plan` bloğu olarak iner; **enforcement paketleme kararına kadar yazılmaz** (alan rezerve, kapı yok). "Benzer ama varyasyonlu" ilk fazda operasyonel bayraklar + Bölüm D ile karşılanır.

---

# BÖLÜM D — GENİŞLEME MİMARİSİ: İSTASYONLAR VE DONANIMLAR

> Bu bölüm "yarın yeni istasyon tipleri ve donanımlar eklenecek" şartının karşılığıdır. İlke: **SaaS'ta firma-başına özel kod YOKTUR** (sektör standardı; fork cehennemi). Genişleme iki meşru kanaldan olur: ① firma kendi VERİSİNİ tanımlar (istasyon satırı, rota, cihaz satırı — deploy gerektirmez), ② ürün YENİ DAVRANIŞ kazanır (tek kod tabanına eklenir, TÜM filoya sürümle dağıtılır, firma bazında bayrakla açılır).

## D1. İstasyon genişletme — bugünkü sınır (ölçüldü) ve hedef

### D1.1 Ölçüm: kimlik veri, davranış kod

| Katman | Veri-sürümlü mü? | Kanıt |
|---|---|---|
| İstasyon satırı (code/name/type/department/kategori/`allowAsWorkOrderStep`) | ✅ tamamen | jenerik BaseService CRUD (`station.routes.ts:14-27`), `POST /api/stations` örneği bizzat `kind:OTHER` "Şardon Makinesi" |
| İstasyon yeteneği (`StationProperty` + `mode: AUTO/OPTIONAL/REQUIRED`) | ✅ tamamen | SAP *control key* karşılığı; planlama filtresi + otomatik uygulama |
| Rota / RouteStep / adım hedefleri | ✅ tamamen | `@@unique([routeId,sequence])`; tek kod bağı WO-create özellik kapsaması (o da veri-sürümlü) |
| Makine (1 istasyon → N makine) | ✅ tamamen | `Machine.stationId`; kurşun bypass makineye atanır |
| **İstasyon DAVRANIŞI (`StationKind`)** | ❌ hiç | 6 değerli kapalı enum; **~46 hard guard**: kursun-qc 13, kursun-bypass 12, tambur 10, inventory 5, subcontractor 5 + helper'lar; `dashboard.service.ts:135` ham SQL'de `'RAW_QC'` literal |

**`OTHER` tuzağı:** INTERNAL + OTHER istasyon tanımlanabilir, rotaya girer, top ORAYA GİRER ama **ÇIKAMAZ** — `SESSIONABLE_STATION_KINDS`'ta yok (oturum açılamaz), mobil `SCREEN_BY_STATION_KIND`'da yok (tablet ekranı yok), `RollMovement` kapatan tüm yollar kind-gated. Tek kurtuluş süpervizör `manual-move`. **Tek çalışan genişleme bugün EXTERNAL** (fason): akış `type===EXTERNAL`'e bakar, yeni bir "dış zımpara/ram" istasyonu kod değişmeden tam çalışır (sevk + kabul + özellik kopyalama).

**Panel tutarsızlıkları (Faz 4'te düzelir):** Electron `enums.ts` StationKind'ta SHIPPING yok (backend 6, panel 5 değer); `ProductionStationsPage` OTHER istasyonları hiç listelemiyor.

### D1.2 Hedef: JENERİK İÇ İSTASYON çalışabilirliği (yeni ürün özelliği — Faz 4)

"Benzer ama varyasyonlu" müşterinin ram/sanfor/şardon/yıkama gibi **kendi iç istasyonlarını** tanımlayıp ÇALIŞTIRABİLMESİ gerekir. Mimari çözüm repoda emsalli: `PeripheralDevice.readMode/pollCommand` deseni (*"yeni davranışlı cihaz = yeni satır; uygulama kodu değişmez"* — schema yorumu) istasyona uyarlanır:

- **Yeni `StationKind.GENERIC_PROCESS`** ("Genel İşlem İstasyonu"). `OTHER`'a davranış YÜKLENMEZ — OTHER bugüne kadar "tanım var, akış yok" sözleşmesiyle yaşadı; mevcut OTHER satırlarına sürpriz davranış vermek yerine yeni kind'a **opt-in** edilir (isteyen satırın kind'ı panelden değiştirilir).
- **Runtime asgari sözleşmesi:** kart okut → adım çözülür (`assertWoAtStepKind` genelleşir) → top okut = giriş (movement açılır) → "bitir" = çıkış (movement `qtyOut=qtyIn` kapanır) → `StationProperty.mode=AUTO` özellikleri `copyStationCapabilitiesToRoll` ile topa işlenir (helper MEVCUT) → `recomputeStepStatus` zaten jenerik → **son adımsa `finalizeRollsAtLastStep` zaten jenerik** ("her rotanın SON adımı finalize eder" kuralı 2026-07-13'ten beri kurulu — işin en büyük parçası çoktan yapılmış).
- Dokunulacak 5 kayıt yeri (taramayla): `schema.prisma` enum · servis guard'ları (yeni kind'ı jenerik yoldan kabul) · `work-session.service.ts` `SESSIONABLE_STATION_KINDS` + izin haritası (yeni izin `mobile:istasyon`) · mobil `stationScreens.ts` (tek JENERİK ekran: giriş listesi + top okut + bitir) · Electron `enums.ts`/`schema.ts`.
- **Kapsam dışı tutulacaklar (bilinçli):** jenerik istasyonda kalite kararı YOK (kalite yalnız kalite istasyonlarında — mevcut kural), kesim YOK (Tambur tekeli), hata kaydı v1'de YOK (ihtiyaç pilotta ölçülür).
- SaaS bağı: özellik TÜM filoya iner; kullanmayan firmada görünmez (istasyon tanımlamayan firma için sıfır değişiklik). Bu, "firma başına istasyon çeşitliliği"nin kod çatallaşmadan taşınabildiği tek modeldir.

### D1.3 Yeni istasyon eklemenin karar ağacı (onboarding'de kullanılır)

```
Yeni istasyon ihtiyacı
├─ Dış firmada mı yapılıyor?            → Station(type=EXTERNAL, kind=SUBCONTRACTOR) — BUGÜN çalışır, veri işi
├─ İçeride, "giriş→işlem→çıkış" mı?     → GENERIC_PROCESS (Faz 4 sonrası) — veri işi
├─ İçeride, ÖZEL veri/karar istiyor mu?  → ürün geliştirmesi: yeni StationKind + akış (tek kod tabanı,
│   (kalite kararı, kesim, ölçüm formu)    tüm filoya sürüm; firma bayrağıyla açılır) — D1.1'deki 5 kayıt yeri
└─ Sadece rapor/izleme noktası mı?       → TravelerCardScan zaten kind'sız iz tutuyor; istasyon satırı yeter
```

## D2. Donanım genişletme — mevcut desen ve genişleme noktaları

### D2.1 İlkeler (bugünkü mimariden, korunacak)

1. **Bulut API'si donanım-agnostik.** Cihaz I/O'su sahadadır: Electron main-process IPC modülleri (COM/HID/TCP/winspool/CUPS) + mobil HAL (BT-SPP). Buluta yalnız DEĞER + KAYNAK gider — emsal: `weighSack(weightKg, source)` + `Sack.weightSource: SCALE|MANUAL|SIMULATED`, sunucu `simulate` bayrağını cihaz kaydından kendisi çözer ve beyanı EZER. Yeni her ölçüm türü aynı deseni izler (değer + kaynak + sunucu-tarafı doğrulama).
2. **Protokol VERİDE.** `PeripheralDevice`: kind, connectionType (`NETWORK_TCP/BLUETOOTH_SPP/BLE/USB/SERIAL_COM`), address/port, `readMode: POLL/STREAM`, `pollCommand` (escape'li), `terminator`, `identifyPattern`, `decimals/scale/unit/timeoutMs`, yazıcı için dil/medya/dpi. **Yeni marka kantar/metre = yeni satır, sıfır kod** — şema yorumu bunu açıkça sözleşme yapmış.
3. **Cihaz yer-kapsamlı çözülür:** `GET /peripherals/for-session` (oturumun makinesi/istasyonu) — operatör cihaz SEÇMEZ, yer söyler. Fail-closed: oturum yoksa cihaz yok.
4. **Simülasyon per-cihaz DB bayrağı + sunucu enforce** (yerel simülasyon kaçışı 2026-07-30'da bilinçli silindi). SaaS demo firmasında simülasyonlu cihaz seti bulunur (satış demosu donanımsız döner).
5. **Taşıma katmanı bayt taşır, marka bilmez** (winspool başlık yorumu) — yazıcı diline karışmaz.

### D2.2 Genişleme noktaları (taramayla; "yeni donanım nereye dokunur" haritası)

| Genişleme | Dokunulan yer | Boyut |
|---|---|---|
| Yeni kantar/metre MARKASI (BT-SPP/COM) | — (yalnız `PeripheralDevice` satırı) | **S — veri işi** |
| Yeni yazıcı DİLİ (örn. TSPL) | `PrinterLanguage` enum + 1 emitter + `label-renderer.registry.ts`'e 1 satır; ⚠️ istemcilerdeki `NATIVE_LANGS` allowlist'i İKİ kopya (`useLabelPrinter.ts:34`, mobil `LabelPrinter.tsx:161`) — Faz 4'te tek kaynağa alınır (backend'in bildirdiği listeye) | S-M |
| Ağ kantarı (TCP) — mobil | `usePeripheralIO.ts` transport switch'ine TCP modülü (enum'da `NETWORK_TCP` ZATEN var) | M |
| BLE kantar — mobil | HAL BLE transport (`react-native-ble-plx` bağımlılıkta hazır, kurulmamış) | M |
| Electron'da TCP kantar | `scale.ipc.ts`'e tcp dalı (bugün yalnız COM) | S |
| El terminali (Zebra/Honeywell gömülü okuyucu) | Keyboard-wedge: Electron'da VAR (`wedge-detector.ts`), mobilde YOK → Electron çekirdeği mobile taşınır (saf fonksiyon, timer'sız) | S-M |
| RFID okuyucu | Wedge modunda çalışan modeller BEDAVA (okuyucu = klavye); SDK'lı modeller: yeni transport + codec | M-L |
| Makine sayacı / PLC (OPC-UA, Modbus) | **Ayrı proje.** Doğru yer yeni `PeripheralKind.SIGNAL_SOURCE` genişlemesi + sahada ajan; ajan rolünü zaten Electron oynar (main process'e Modbus/OPC istemcisi). Bulut API'ye yalnız olay/değer gider — mimari değişmez | **L/XL — ihtiyaç doğunca ayrı tasarım** |
| Yeni cihaz SINIFI (genel reçete) | ① `PeripheralKind` enum + panel etiketi · ② istemci codec/transport (HAL `DeviceTransport × DeviceCodec` dik eksenleri) · ③ Electron'da 4-adım IPC deseni (contract→main→preload→renderer) · ④ değerin girdiği uca `source` alanı | M |

### D2.3 SaaS'a özgü donanım notları

- Cihaz eşleştirme (Device allowlist), PeripheralDevice kayıtları, şablon yönlendirmeleri **zaten tenant DB'sinde** → firma başına donanım envanteri bedava ayrık. `x-device-id` üretimi cihaz-yerel UUID; firmalar arası çakışma riski yalnız bellek-içi `lastSeenWrites`'taydı (§C3/4 çözer).
- Onboarding'de donanım envanteri Keşif aşamasının zorunlu maddesidir (§G3): marka/model/bağlantı tipi öğrenilir, `PeripheralDevice` satırları kurulumda girilir, `:id/test` ucu + zararsız bağlantı testleriyle doğrulanır.
- Yazıcı ekosistemi kurulum kiti: NSIS installer + "Generic/Text Only" kuyruk talimatı (winspool USB yolu vendor sürücüsüz çalışır — kurulum dokümanına girer).

---

# BÖLÜM E — GÜVENLİK VE UYUM

## E1. Güvenlik sertleştirme listesi (Faz 1-3'e dağıtılır)

| Alan | İş | Faz |
|---|---|---|
| TLS | Caddy'de biter (TLS 1.2+, otomatik Let's Encrypt); HSTS Caddy başlığı. Node HTTP kalır | 3 |
| CORS | `origin:"*"` → allowlist (native istemci Origin göndermez, açık yüzey bırakılmaz); `/health` 6-alan dondurulmuş sözleşmesi korunur (Electron bağlantı testi) | 3 |
| Control düzlemi | Ayrı JWT secret + **TOTP zorunlu** + Caddy IP allowlist; control↔tenant token geçişmezliği bekçili | 2 |
| Rate limit | Caddy'de kaba IP limiti (login uçları) + uygulamada tenant-keyed token bucket (rapor/export uçları — noisy neighbor) | 3 |
| Secrets | `/etc/tekserp/env` root:600; JWT çift-secret rotasyon prosedürü; DB şifreleri rol-bazlı | 1-3 |
| PG en az yetki | `tekserp_app` süperuser değil; `REVOKE CONNECT FROM PUBLIC`; `statement_timeout` | 1 |
| Diskte şifreleme | Site dışı yedek **zorunlu şifreli** (`rclone crypt`). VPS diski: sağlayıcı at-rest şifrelemesi varsa açılır; yoksa kabul edilen risk olarak risk kaydına (§H2) | 2 |
| Mobil cleartext | SaaS APK'sında `usesCleartextTraffic` kapalı + https varsayılan; on-prem APK profili cleartext'e devam (build-apk.mjs iki profil) | 3 |
| Oturum güvenliği | Mevcut: jti + Session registry + tokenVersion + tek-oturum kick — DEĞİŞMEZ (zaten iyi durumda) | — |
| Denetim | Mevcut AuditService her tenant DB'sinde sürer; control işlemleri TenantOpLog'da; destek girişi çift kayıt | 2 |
| Şifre politikası | Tenant başına asgari kural (min 8; "123123" sınıfı yaygın şifre engeli) — mevcut ilk-giriş-değiştirme zorunluluğunun üstüne. Saha operatörü PIN/kart ile giriyor, politika büro kullanıcılarını hedefler | 3 |
| Sızma testi | Go-live ÖNCESİ: OWASP ASVS L1 öz-değerlendirme + harici otomatik tarama (OWASP ZAP vb.); kritik/yüksek bulgular kapanmadan pilot müşteri alınmaz. Yıllık tekrar | 5 |
| DDoS / IP gizleme | Opsiyon: Cloudflare proxy (ücretsiz katman) DNS önünde — değerlendirme Faz 3'te (Caddy-arkası TLS düzeni değişir; native istemciler etkilenmez) | 3 |
| Bağımlılık hijyeni | Aylık `npm audit` + Dependabot benzeri takip; kritik CVE'de plansız yama penceresi hakkı (SLA'da yazar) | sürekli |

## E2. KVKK uyum çerçevesi

| Konu | Uygulama |
|---|---|
| Roller | Müşteri firma = **veri sorumlusu**; biz = **veri işleyen**. Sözleşme eki: Veri İşleme Sözleşmesi (DPA) — işleme amaçları, süreler, alt işleyenler |
| Alt işleyenler listesi | Hetzner (barındırma, AB), Backblaze/Storage Box (şifreli yedek), Play (ileride dağıtım) — DPA ekinde adlı liste, değişiklikte bildirim |
| Yurt dışı aktarım | Veriler AB'de; sözleşmede açık madde + müşterinin kendi aydınlatma metnine dayanak. Müşteri "verim Türkiye'de kalsın" derse: TR sağlayıcı fiyat farkıyla opsiyon (satış kararı, mimari aynı) |
| İşlenen kişisel veri | Çalışan ad/kullanıcı adı, vardiya/işlem izleri (SystemLog), müşteri cari bilgileri. **Özel nitelikli veri YOK** — böyle kalmalı; yeni alan eklerken kontrol sorusu |
| Saklama/imha | Offboarding prosedürü §A2 (iade + 30 gün + silme + log). Audit arşivi tenant DB'sinde firma politikasına tabi |
| İhlal bildirimi | Tespitte 72 saat içinde veri sorumlusuna (müşteriye) bildirim taahhüdü — runbook'u §G1 alarmlarına bağlı |
| VERBİS | Bizim kaydımız (veri işleyen kapsamı) + müşteriye kendi yükümlülüğü hatırlatması onboarding'de |
| Destek erişimi | Sözleşmede açık (kim, ne zaman, iz nerede) — §B3 |

---

# BÖLÜM F — İSTEMCİLER

## F1. Electron

1. **Login:** `login-methods.tenantMode`'a göre firma kodu alanı; son kod electron-store'da. Sunucu adresi altyapısı (`api-config.ts` + `ApiEndpointDialog`) HAZIR; SaaS build'i `VITE_API_BASE_URL=https://api.tekserp.com` ile derlenir.
2. **Auto-update (bugün YOK):** `electron-updater` bağımlılıkta ama import edilmiyor, `build.publish` yok → ① `publish: generic` (`updates.tekserp.com/electron/`, Caddy statik), ② main'de autoUpdater akışı (denetle→indir→"yeniden başlat" bildirimi; vardiya ortasında zorla restart YOK), ③ **kod imzalama**: imzasız NSIS + auto-update = SmartScreen engeli → OV sertifika veya Azure Trusted Signing (yıllık maliyet kalemi, §H2 risk 8). Windows build makinesi zorunluluğu sürer (serialport/node-hid native).
3. **Kontrol paneli** route ağacı (§B2).
4. Donanım katmanına dokunulmaz (Bölüm D2 zaten istemci-yerel).

## F2. Mobil

1. **Login:** firma kodu (aynı `tenantMode` algısı); `login-methods`/`mobile-users` çağrıları `companyCode` parametreli.
2. ⚠️ **Bugün geçerli bug — Faz 0'da düzelt:** `offline/serverReachability.ts` sağlık yoklaması build-time `API_URL` sabitini kullanıyor (`healthUrl()`), Ayarlar'dan girilen adresi değil → adres değişen cihaz offline'da takılı kalabiliyor. `getCurrentBaseUrl()`'e geçir. SaaS'tan bağımsız saha düzeltmesi.
3. **Offline kuyruk namespace:** persist anahtarları (`TEKSERP_RQ_CACHE_V1`, `TEKSERP_FAILED_OPS_V1`) sunucu/firma bilmiyor → adres/firma değişince kuyruk YANLIŞ hedefe boşalır. Anahtara `hash(baseUrl|companyCode)`; firma değişiminde eski kuyruk "bekleyen N kayıt eski hedefe ait" uyarısıyla görünür yönetilir (sessiz silme YOK — eksik stok kopyadan kötü).
4. **Minimum sürüm kapısı:** `GET /api/version` → `{minVersionCode, latestVersionCode, apkUrl}`; açılışta karşılaştır, altındaysa güncelleme ekranı. "Backend+APK aynı pencerede" varsayımının filo karşılığı budur.
5. **Dağıtım:** `indir.tekserp.com` (statik sayfa + sürüm JSON'u) → sonra Play (kapalı test parkuru).

## F3. Sürüm-uyumluluk politikası (filo kuralı)

- Sunucu filo genelinde TEK sürüm. İstemciler firma bazında gecikebilir → **destek penceresi: sunucu, son 4 hafta içindeki istemci sürümlerini tolere eder**; daha eskisi min-sürüm kapısına takılır.
- Kırıcı API değişikliği YALNIZ minör+kapı yükseltmesiyle: önce toleranslı sunucu (alan-bazlı, bugünkü `undefined → eski davranış` disiplini), sonra kapı yükselir, sonra tolerans kodu temizlenir. Sürüm notları her yayında `docs/ops/` reçetesine.

---

# BÖLÜM G — OPERASYON

## G1. Gözlemlenebilirlik ve uyarılar

| Sinyal | Araç | Alarm |
|---|---|---|
| Dışarıdan erişilebilirlik | UptimeRobot/Kuma → `GET /health` (60 sn) | 2 ardışık hata → SMS/push |
| Gece işleri koştu mu | healthchecks.io **dead-man switch** (yedek turu + firma döngüsü sonunda ping) | Ping gelmezse sabah alarm |
| Host kaynakları | mevcut `buildRichHealth` (CPU/RAM/event-loop/disk/pg_stat) → `/control/health` + günlük göz | Disk >%80, event-loop lag, pool bekleme eşikleri |
| Firma kırılımı | `/control/health`: firma başına DB boyutu, havuz, hata sayacı, audit yazım hatası | — |
| Loglar | pm2 + logrotate (30 gün); yapılandırılmış hata satırları | S1 runbook'ları log konumunu bilir |
| Hata izleme | (opsiyonel, Faz 6) self-host Sentry/GlitchTip | — |

**Olay yönetimi (incident management):** her S1/S2 için kayıt — `docs/ops/olaylar/YYYY-AA-GG-<slug>.md`: zaman çizelgesi · etki (hangi firmalar, ne kadar) · kök neden · düzeltme · tekrar önleme maddesi. **S1'de etkilenen müşteri ilk 30 dk içinde duyuru kanalından (§B5) bilgilendirilir — çözüm beklenmeden**; kesintide sessizlik güveni kesintinin kendisinden çok bozar. Post-mortem şablonu Faz 2'de hazırlanır; tekrar-önleme maddeleri kapanana kadar açık iş sayılır.

**İç performans hedefi (müşteriye taahhüt DEĞİL):** sıcak uçlarda p95 < 500 ms — mevcut latency-stats zaten ölçüyor; sürüm karşılaştırmasında regresyon kapısı olarak kullanılır.

## G2. Kapasite planı

- **Başlangıç VPS:** 8 vCPU / 32 GB RAM / 240+ GB NVMe (~€40-60/ay). Postgres: `shared_buffers 8GB`, `effective_cache_size 24GB`, `max_connections 200`. Bir fabrika DB'si bugün küçük (dev kopya ölçülür — Faz 0 maddesi); firma başına yıllık büyüme tahmini ilk 3 müşteriden sonra gerçek veriyle güncellenir.
- **Büyütme tetikleri:** CPU 15 dk ortalaması >%70 · RAM'de PG cache hit düşüşü · disk >%70 · havuz `waitingMax` kalıcı >0. Aksiyon sırası: ① sorgu/endeks işi (bugünkü perf disiplini), ② VPS büyüt (dakikalar), ③ PgBouncer (§C4), ④ ancak ondan sonra süreç/sunucu ayrıştırma tartışılır.
- 5-20 firma bandının tamamı tek VPS'te rahat; bu doküman 50+ firmayı TASARLAMAZ (o gün ayrı revizyon).

## G3. Onboarding metodolojisi (white-glove — her müşteride aynı 5 aşama)

**1. Keşif (0,5-1 gün, sahada/uzaktan):** süreç haritası (hangi istasyonlar, hangi sırayla — D1.3 karar ağacı burada koşar) · donanım envanteri (yazıcı/kantar/okuyucu marka-model-bağlantı) · kullanıcı listesi + rol eşlemesi (26 hazır şablon) · belge ihtiyaçları (irsaliye/çeki düzeni, logo/antet) · etiket formatları · sipariş/müşteri kataloğu kaynağı (hangi formatta — Excel/eski program?) · **e-İrsaliye mükellefiyeti + entegratör (§A5)**. Çıktı: kurulum formu.
**2. Hazırlık (bizde):** tenant provision (§C6.1) → katalog kurulumu (istasyon/rota/kalite/renk/kumaş) → belge+etiket şablonları → `PeripheralDevice` satırları → kullanıcılar+roller → firma admin şifresi ilk girişte değiştirme zorunlu.
**3. Doğrulama (müşteriyle, uzaktan):** **kabul testi senaryosu** — uçtan uca bir top: KK1 giriş → rota adımları → kurşun/KK2 → tambur karar → depo → çuval → sevkiyat + irsaliye baskısı + iade denemesi; her cihazda gerçek baskı/tartı testi (`:id/test` + zararsız yazıcı testi). Çıktı: imzalı kabul listesi.
**4. Canlıya geçiş:** açılış stok sayımı girişi (KK1 toplu giriş) · rol bazlı eğitim (operatör 2 saat tablet başında, büro 2-4 saat) · go/no-go.
**5. Hypercare (2 hafta):** günlük check-in, sorun listesi, ayar ince-ayarı; sonunda normal destek rejimine (§A3) devir.

**Veri içe aktarım kiti (Faz 5'e kadar hazır olmalı):** kumaş/renk/müşteri/şube ve açılış stoku için CSV şablonları + **dry-run varsayılanlı** içe aktarım script'leri (`--apply` öncesi satır satır önizleme — projedeki backfill konvansiyonu aynen). Elle yüzlerce satır katalog girişi onboarding'in en pahalı ve en hatalı adımıdır; kit white-glove ARACIDIR, müşteri arayüzü değildir (self-servis import Faz 6+).

Her kurulum, sık tekrarlanan adımları ölçer — self-servis sihirbaz ancak bu ölçümden sonra tasarlanır (Faz 6+).

## G4. Test stratejisi

| Katman | Ne |
|---|---|
| Davranış korunumu | `TENANT_MODE=single`'da TÜM mevcut bekçiler değişiksiz yeşil — her sürümde |
| İzolasyon | `test_tenant_isolation.ts`: A token'ı yalnız A DB'sine dokunur · A'nın flag `set`'i B'nin yanıtını değiştirmez · bağlamsız erişim throw · global-durum taraması (§C3) · negatif sondalar: ALS throw kaldır → kırmızı, cache tenant anahtarı düşür → kırmızı, lockout anahtarından tenant çıkar → kırmızı |
| Provisioning | `test_tenant_provisioning.ts`: temiz açılış → ACTIVE; 3. adımda yapay hata → FAILED + devam-et idempotency; aynı kod → 409 |
| Control ayrımı | `test_control_auth.ts`: token geçişmezliği iki yönde + destek token süresi + çift audit izi |
| Orkestrasyon | `test_migrate_orchestration.ts`: kısmi başarısızlıkta düşen SUSPENDED + diğerleri ACTIVE + 503 sözleşmesi |
| Yük | k6: 20 sentetik firma, sıcak uçlar (login, top listesi, okutma, rapor) — Faz 2 sonunda taban çizgisi, sürümlerde regresyon karşılaştırması |
| Operasyon | Aylık restore tatbikatı + 6 aylık VPS yeniden kurulum tatbikatı (RTO ölçümü) — sonuçlar TenantOpLog'da |

---

# BÖLÜM H — YÜRÜTME

## H1. Fazlar (boyut: S/M/L/XL — "acele yok" temposuna göre sıralı, üst üste bindirilebilir)

**Faz 0 — Hazırlık (S):** mobil `serverReachability` düzeltmesi (bugünkü bug) · canlı DB `datcollate/datctype` + boyut ölçümü · VPS + domain + Caddy iskeleti · bu dokümanın onayı.

**Faz 1 — Çekirdek çok-kiracılık (XL):** tenant-context + registry + prisma Proxy (§C2) · master şema + provisioning CLI (§C6.1'in panel'siz hali) · login `companyCode` + JWT `tenantId` (§C5) · §C3/5A'nın 8+1 kaleminin tenant'lanması · PG rolleri + `statement_timeout` (§C4) · `test_tenant_isolation` + `test_tenant_provisioning`.
**Çıkış:** dev'de iki test firması yan yana; izolasyon bekçisi yeşil; single modda tüm bekçiler yeşil.

**Faz 2 — Operasyon düzlemi (L):** firma döngülü job'lar (§C8) · migrate orkestrasyonu + SUSPENDED yolu (§C6.2) · firma başına şifreli yedek + offsite + restore tatbikatı (§C7) · control API + TOTP + Electron kontrol sayfaları (§B2) · destek girişi (§B3) · kullanım ölçümü (§B4) · izleme/alarm kurulumu (§G1) · duyuru kanalı backend'i (§B5) · olay/post-mortem şablonu (§G1) · k6 taban çizgisi.
**Çıkış:** panelden firma aç/askıya al; migrate raporu; bir firma yedeği kopya DB'ye geri yüklenip doğrulanıyor; dead-man alarmı çalışıyor.

**Faz 3 — İstemciler + sertleştirme (L):** Electron firma kodu + auto-update + kod imzalama (§F1) · mobil firma kodu + kuyruk namespace + min-sürüm kapısı + https profili (§F2) · CORS allowlist + rate limit + secrets düzeni + şifre politikası (§E1) · duyuru bandı (Electron + mobil, §B5).
**Çıkış:** temiz Windows makinesi Setup.exe kurup firma koduyla giriyor ve sonraki sürüme kendini güncelliyor; APK https ile aynısını yapıyor; SmartScreen uyarısı yok.

**Faz 4 — Ürün genişletme: jenerik istasyon + donanım tekilleştirme (L):** `GENERIC_PROCESS` runtime (§D1.2 — 5 kayıt yeri + jenerik tablet ekranı) · Electron istasyon paneli düzeltmeleri (SHIPPING/OTHER görünürlüğü) · `NATIVE_LANGS` allowlist'inin tek kaynağa alınması · (pilot ihtiyacına göre) mobil TCP kantar transport'u.
**Çıkış:** panelden tanımlanan bir "Ram" istasyonu rotaya girip tablet üzerinden uçtan uca çalışıyor; `test_generic_station.ts` bekçisi negatif sondalarla kırmızı verebiliyor.

**Faz 5 — Pilot + hypercare (M):** demo firma (kanarya + satış demosu) · **sözleşme paketi (§A4) avukat kontrolünden geçmiş** · **sızma testi/ASVS turu (§E1) tamamlanmış** · **içe aktarım kiti (§G3) hazır** · ilk gerçek müşteri §G3 metodolojisiyle.
**Çıkış:** ilk müşteri 2 haftalık hypercare'i tamamlamış, S1 hiç yaşanmamış ya da SLA içinde çözülmüş.

**Faz 6 — Sonrası (ayrı kararlar):** web paneli · Play Store · paketleme enforcement'ı (§C9) · PITR · PgBouncer (eşikle) · self-servis sihirbaz · PLC/sayaç ajanı (§D2.2) · hata izleme · **e-belge entegratör entegrasyonu (§A5)** · self-servis veri dışa/içe aktarım.

## H2. Risk kaydı

| # | Risk | Olasılık/Etki | Önlem |
|---|---|---|---|
| 1 | Gözden kaçan global durum → firmalar arası veri sızıntısı | O: Orta · E: **Kritik** | §C3 envanteri + bekçide mekanik global-durum taraması + izolasyon testi her CI'da |
| 2 | VPS tam kaybı | O: Düşük · E: Yüksek | 3-2-1 şifreli yedek + kurulum runbook'u + 6 aylık yeniden-kurulum tatbikatı (RTO ölçülü) |
| 3 | Migration bir firmada düşer | O: Orta · E: Orta | SUSPENDED siyaseti (§C6.2) + restart öncesi filo yedeği + kopya DB'de inceleme |
| 4 | Gürültücü komşu (ağır rapor/export) | O: Orta · E: Orta | Havuz tavanı + `statement_timeout` + tenant-keyed rate limit + firma kırılımlı izleme |
| 5 | Bağlantı tükenmesi | O: Düşük · E: Orta | Havuz bütçesi (§C4) + CONNECTION LIMIT + PgBouncer eşiği tanımlı |
| 6 | KVKK ihlali / yurt dışı itirazı | O: Düşük · E: Yüksek | DPA + şifreli yedek + destek erişim şeffaflığı + TR-sağlayıcı opsiyonu satışta |
| 7 | Tek kişilik operasyon (bus factor) | O: — · E: Yüksek | Her şey runbook'ta (`docs/ops/`); alarmlar telefona; kritik prosedürler tatbikatla prova edilmiş |
| 8 | İmzasız Electron güncellemesi SmartScreen'e takılır | O: Yüksek · E: Orta | Faz 3'te OV sertifika/Azure Trusted Signing bütçelenir; imzasız auto-update yayınlanMAZ |
| 9 | Müşteri sahasında internet kesintisi → "sistem çalışmıyor" algısı | O: Orta · E: Orta | Sözleşmede 4G şartı + S1 tanımı netliği + mobil offline kuyruğun kapsam sınırı onboarding eğitiminde anlatılır |
| 10 | Firma-başına özel istek baskısı → kod çatallaşması | O: Yüksek · E: Yüksek | İlke: özel KOD yok; özelleştirme yalnız veri/bayrak/şablon katmanında (Bölüm D). Satışta açıkça söylenir |
| 11 | Eski istemci sürümleri filoda birikir | O: Orta · E: Orta | Min-sürüm kapıları + 4 haftalık tolerans penceresi (§F3) |
| 12 | Yarım provisioning artıkları | O: Düşük · E: Düşük | İdempotent devam-et + FAILED görünürlüğü; otomatik DROP bilinçli yok |
| 13 | e-Belge beklentisi ("e-irsaliyemi de kessin") karşılanamaz → satış kaybı ya da yanlış vaat | O: Yüksek · E: Orta | Kapsam beyanı §A5 sözleşmede + keşif sorusu; talep 2-3 müşteride somutlaşırsa Faz 6 tasarımı |
| 14 | Elle katalog girişi onboarding'i pahalı ve hatalı yapar | O: Yüksek · E: Orta | §G3 içe aktarım kiti (dry-run'lı script'ler) pilot ÖNCESİ hazır |

## H3. Kapsam dışı ve açık sorular

- **Kapsam dışı:** edge/yerel senkron kutusu · self-servis kayıt · online ödeme · pm2 cluster/yatay ölçek · firma başına özel kod · 50+ firma ölçeği · PLC ajanı (ihtiyaç doğunca ayrı tasarım).
- **Açık 1 — Electron tek installer mı?** On-prem ile SaaS aynı installer'dan çıkabilir (adres değiştirilebilir); ayrı marka istenirse iki profil. Faz 3'te karar.
- **Açık 2 — kod imzalama yolu:** OV sertifika mı Azure Trusted Signing mi (maliyet/kolaylık karşılaştırması Faz 3 başında).
- **Açık 3 — firma kodu politikası:** white-glove'da fiilen biz veririz; regex `^[a-z0-9-]{3,20}$`.
- **Açık 4 — `EndpointLatencyDaily` firma DB'sinde mi control'da mı:** §C3/7 firma DB'sini seçti (veri sahibine); maliyet görünürse control-only'ye düşürülür.
- **Açık 5 — GENERIC_PROCESS'te hata kaydı/duraklama gibi zenginleştirmeler:** pilotta ölçülür, v1'e alınmaz.
- **Açık 6 — müşteri sandbox/eğitim firması:** canlı tenant'ın yanına isteğe bağlı `<kod>-test` firması (DB-per-tenant'ta maliyeti ~sıfır; eğitim + "önce burada dene" güveni). Pilot geri bildirimine göre standart teklife girer mi?
- **Açık 7 — staging'in fiziksel ayrımı:** kanarya=prod'daki demo firma yaklaşımı başlangıç için yeterli; sürüm temposu/filo büyüyünce küçük ayrı staging VPS'i değerlendirilir.
