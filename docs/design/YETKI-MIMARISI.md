# Yetki Mimarisi — endüstri ölçeğine hazırlık

> **Durum:** Katman 2 (Ekran Manifestosu) uygulanıyor. Diğer katmanlar yol
> haritasında; bu belge KARARI kaydeder, tamamlanmış işi değil.

## Neden

Tek fabrikada 68 izin / 26 rol yönetilebilir. Ürünü tekstil sektörüne
ölçeklerken üç şey kırılır:

1. **Yönetici ilk gün 68 kutuyla karşılaşıyor** — hangi kutunun hangi ekranı
   açtığı hiçbir yerde yazmıyor, yalnız route dosyaları taranarak öğrenilebiliyor.
2. **Roller kodda** — 50 fabrikanın 50 farklı iş unvanı olur.
3. **Modül/lisans ekseni yok** — kartela almayan müşteriye kartela yetkileri
   gösterilir.

## Karar: beş katman

```
0 · MODÜL       tenant bazlı açık/kapalı (Tenant.planFlags — SaaS planında rezerve)
1 · YETKİ       kodda · resource:action + riskli fiiller
2 · EKRAN       hangi ekran hangi yetkiyi ister (kodda, uçtan servis edilir)
3 · ROL         tenant VERİSİ · koddaki şablondan doğar, müşteri düzenler
4 · KULLANICI   rol(ler) + gerekçeli istisna
```

SAP karşılığı: nesne+ACTVT (1) · SU24 (2) · PFCG rol (3) · atama (4).
Dynamics 365: privilege → duty → role.

## Reddedilen alternatifler

| Alternatif | Neden reddedildi |
|---|---|
| **Mekanik CRUD** (her kaynağa create/read/update/delete) | Kod sayısı kaynak×4'e çıkar, çoğu hiç kullanılmaz. ERP'de `delete` zaten yok (soft delete + statü) → dördün biri baştan ölü. **Granülerlik arayüz değil İŞ RİSKİ kararıdır**: aynı riski taşıyıp hep birlikte verilen eylemler TEK yetki olmalı. |
| **Ekran başına ayrı yetki kodu** (`kk1:kumas-ekle` + `electron:kumas-ekle`) | Aynı iş yeteneği iki kodda yaşar ve ayrışır; "Ali kumaş ekleyebilir mi?" sorusunun tek cevabı kalmaz; yeni ekran = herkese yeniden dağıtım. Sektör ekran başına TANIMLAMAZ, ekranlar yetkiyi TALEP EDER. |
| **SAP org-seviyesi** (tesis/şirket kodu bazlı yetki) | Tekstil KOBİ'lerinin çoğu tek tesis. Ertelendi — ama dikiş bırakıldı: yetki kontrolü tek fonksiyondan geçer, kapsam filtresi ileride 200 çağrı noktasına dokunmadan eklenebilir. |
| **Rolleri bırakıp yalnız tekil atama** | "Çok kişi rol dışına çıkıyor" itirazı haklı ama rolü geçersiz kılmaz: SAP'ta da herkes sapar. Sorun sapma değil, **sessiz** sapma. Rol = taban çizgisi, sapma açık ve raporlanır. |

## Katman 2 — Ekran Manifestosu (bu iş)

**Tek kaynak:** `Teks-Erp/src/constants/screen-catalog.ts`, `GET /api/admin/screens`
ile İKİ istemciye servis edilir. Mobil/Electron aynası AÇILMAZ (mevcut
`permissions.ts` ayna derdinin tekrarı olurdu).

Her ekran iki liste taşır:
- `requires` — ekranı AÇMAK için (herhangi biri yeterli)
- `capabilities` — ekran İÇİNDE ek yetenek açan izinler

**Ölçüldü (2026-08-19):** 68 iznin 68'i istemcide referanslı — ölü yetki YOK.
Yani manifesto bir hatayı düzeltmiyor, **görünürlük** kazandırıyor.

### Manifestoyu ne besler

1. Atama ekranına **"Ekrana göre"** görünümü (yönetici modül listesine hiç girmez)
2. **"Neden giremiyor?"** aracı (SAP SU53 karşılığı)
3. **Bekçi** — beyan edilmemiş izni route'ta kullanan kod kırmızı verir

### Bilinen ve KABUL EDİLEN maliyet

Ortak bir yetki birden çok ekranda görünür (örn. `mobile:kumas` hem Kumaş Ekle
hem Hızlı İş Emri'nde). Birinde kaldırınca diğerinden de gider. **Arayüz bunu
SÖYLEMEK ZORUNDA** — yoksa "KK1'den kaldırdım, Hızlı İş Emri bozuldu" sürprizi
olur. Bu, yetkiyi çoğaltmamanın bedelidir ve doğru bedeldir.

## Yol haritası

| # | İş | Ön koşul |
|---|---|---|
| 1 | Ekran manifestosu + uç + bekçi | — |
| 2 | Atama ekranı: rol önce · ekran görünümü · sapma bandı | 1 |
| 3 | Modül/lisans ekseni | **2. müşteriden ÖNCE** |
| 4 | Roller tenant verisine (şablona soy bağıyla) | ilk "biz buna başka ad veriyoruz" talebi |
| 5 | "Neden giremiyor" · SoD uyarısı | 1 |
| — | Org kapsamı | çok tesisli müşteri gelene kadar ERTELENDİ |

## Başarı ölçütü

> Yeni bir fabrikayı kurarken yönetici **tek bir yetki kodu görmeden** sistemi
> çalışır hâle getirebilmeli: modülleri seç → roller hazır gelsin → kişileri ata.
> Kod listesi yalnız istisna için açılsın.
