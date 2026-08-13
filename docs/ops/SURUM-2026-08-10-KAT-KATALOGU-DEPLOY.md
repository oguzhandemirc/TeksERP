# Sürüm 2026-08-10 — Üretim karakteristiği (kat kataloğu + istasyon yetenek modeli)

**Branch:** `feature/istasyon-yetenek-modeli` (GitHub'da; `main`'e merge EDİLMEDİ)
**Kapsam:** backend + Electron + **APK** · 3 migration · 1 veri göç script'i · yeni izin YOK

---

## 0) Neden bu sürüm

| Önce | Sonra |
|---|---|
| Kat değerleri 9 yerde kod sabitiydi; 6-KAT eklemek 3 projede sürüm isterdi | Panelden katalog satırı — sürüm gerekmez |
| İstasyona eklenen her özellik oradan geçen HER TOPA sessizce yazılırdı | Mod: Otomatik / Opsiyonel / Zorunlu |
| Kategorisi olmayan iç istasyon tanım gereği "renk veremez"di | Yetenek istasyonun kendi alanında → iç boyahane mümkün |
| 6-KAT'lı top **2-KAT metresiyle** ölçülürdü (sessiz yanlış metraj) | Rol birebir eşleşir, sapma yok |

---

## 1) Deploy sırası — PAZARLIK DIŞI

Üçü **aynı bakım penceresinde**. Sıra önemlidir.

```
1. Backend    (migration + kod)
2. Veri göçü  (script)
3. Electron   (panel)
4. APK        (tabletler)
```

**Neden bu sıra:**
- Backend önce: yeni panel/APK, eski backend'de olmayan alanları okur (`valueType`,
  `mode`, `values`, `appliesColor`) → boş liste, tuşsuz ekran.
- Veri göçü backend'den hemen sonra: aradaki pencerede kurşun özelliği toplara
  yazılmaz (bkz. §3 uyarı).
- APK en son: eski APK yeni backend'le **çalışır** (sabit iki tuş gösterir),
  tersi çalışmaz.

---

## 2) Backend

```bash
cd /path/to/Teks-Erp
git fetch origin
git checkout feature/istasyon-yetenek-modeli     # (merge sonrası: main)
npm ci
npm run prisma:generate
npm run prisma:migrate        # = prisma migrate deploy
pm2 restart tekserp-api
```

Uygulanacak üç migration (üçü de küçük; tablo yeniden yazımı yok):

| Migration | Ne yapar |
|---|---|
| `20260809232529_property_value_type_and_station_mode` | `FabricProperty.valueType` · yeni `fabric_property_values` tablosu · `StationProperty.mode` |
| `20260810010330_station_capability_flags` | `Station.appliesColor/appliesProperty` + **geri-doldurma UPDATE'i** (EXTERNAL bayrakları kategoriden) |
| `20260810233446_roll_property_value` | `RollProperty.valueId` (SEÇİM tipli özellikte operatörün seçtiği değer) |

> İkinci migration geri-doldurmayı **kendi içinde** yapar; ayrı bir komut yok.
> Vardiya dışı gerekmez (index yok, tablo yeniden yazımı yok).

---

## 3) Veri göçü — ATLANMASI YASAK

```bash
npx tsx scripts/seed_fold_catalog_and_modes.ts            # DRY-RUN, önce bunu oku
npx tsx scripts/seed_fold_catalog_and_modes.ts --apply
```

Script iki iş yapar ve **idempotenttir** (tekrar koşulabilir):

1. `KAT` karakteristiği + değerleri (`2-KAT`/`4-KAT`/`TUP`) + Tambur bağı (mod **OPSİYONEL**)
2. `KURSUN_KK2/KURSUN` satırını **AUTO**'ya çeker

> ⚠️ **2. adım atlanırsa iki şey SESSİZCE bozulur:** kurşun özelliği toplara
> yazılmayı bırakır **ve** kurşun bypass ataması *"istasyon kurşunu OTOMATİK
> uygulamıyor"* ile reddedilir. Şema varsayılanı bilinçli olarak OPSİYONEL —
> "eklenen her özellik her topa yazılır" tuzağını kapatmak için.
>
> ⚠️ 1. adım atlanırsa sistem **çalışmaya devam eder** (kat doğrulaması
> fail-open) ama Tambur ekranında hiç kat tuşu çıkmaz.

**Beklenen çıktı (saha DB'si):**
```
BOYA_FASON/OZL…            OPTIONAL (dokunulmuyor)     ×7
ZIMPARA_FASON/ZIMPARALI    OPTIONAL (dokunulmuyor)
KURSUN_KK2/KURSUN          OPTIONAL → AUTO
+ FabricProperty OLUŞTUR   code=KAT valueType=CHOICE
    + değer 2-KAT / 4-KAT / TUP
    + istasyon bağı TAMBUR_1 mod=OPTIONAL
```

---

## 4) Metre cihazları — ELLE KONTROL

Kat başına **bir METER cihazı** olmalı ve `role` alanı **kat koduyla birebir**
eşleşmeli (`2-KAT`, `4-KAT`, …).

```sql
SELECT code, name, role FROM peripheral_devices WHERE kind = 'METER';
```

> ⚠️ Eskiden bilinmeyen kat sessizce **2-KAT metresine** düşüyordu (yanlış
> metraj, hata yok, log yok). Artık düşmez: eşleşme yoksa tablet *"metrajı elle
> girin"* der. Yani **yeni bir kat eklemek = katalog satırı + cihaz satırı**.

---

## 5) Electron

```bash
cd /path/to/Electron
npm ci && npm run build:win     # ya da mevcut dağıtım yönteminiz
```

---

## 6) APK

```bash
cd /path/to/mobil
npm run build:apk:check                                   # adresi doğrula
EXPO_PUBLIC_API_URL=http://<sunucu>:4000/api npm run build:apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

> Sürüm numarasını `app.json` + `android/build.gradle`'da **elle eşitle**
> (bilinen tuzak). Eski APK yeni backend'le çalışır; yalnız yeni kat değerlerini
> ve KK2 özellik tuşlarını görmez.

---

## 7) Kurulumdan sonra — 6 dakikalık kabul turu

| # | Adım | Beklenen |
|---|---|---|
| 1 | Tanımlar → Kumaş Özellikleri → **KAT** satırı var mı, tipi "Seçim" mi? | 3 değer görünür |
| 2 | KAT'ı düzenle → **`6-KAT` / "6 Kat"** ekle → Kaydet | Hata yok |
| 3 | İş emri formu (rotada Tambur olan) | **Üçüncü tuş** çıkar |
| 4 | Tablet → Tambur | **Üçüncü tuş** çıkar |
| 5 | 6-KAT seçip finalize | **400 gelmez**; top `foldType=6-KAT` |
| 6 | 6-KAT rolünde metre yoksa | Ekran "elle girin" der, **2-KAT metresine sapmaz** |
| 7 | Envanter → Kat filtresi | 6-KAT seçeneği çıkar, süzer |
| 8 | Kurşun/QC2 ekranı | KURŞUN **"Otomatik"** görünür (tuş yok), top kapanınca yazılır |
| 9 | İstasyon Yetenekleri → yeni bir özelliği **Opsiyonel** ekle | Operatör işaretlemedikçe topa **yazılmaz** |
| 10 | Rota editörü → Tambur adımına renk atamayı dene | **Reddedilir** (bugünkü davranış korunur) |

**Test bittiğinde 6-KAT'ı silme** — pasifleştir (kayıtlar o kodu taşıyor olabilir).

### 7b) Değer taşıyan özellik (gramaj) — opsiyonel kabul turu

Bu sürüm SEÇİM tipli özelliği **her istasyonda** kullanılabilir kılıyor; kat
artık tek örnek değil.

| # | Adım | Beklenen |
|---|---|---|
| 1 | Kumaş Özellikleri → Yeni → tip **Seçim**, ad "Gramaj", istasyon **Kurşun+KK2**, değerler `25GR/25 gr`, `50GR/50 gr`, `75GR/75 gr` | Kaydolur |
| 2 | İstasyon Yetenekleri → Kurşun → Gramaj satırı → **Otomatik**'i dene | **Reddedilir** ("değeri operatör seçmelidir") |
| 3 | Aynı satırı **Zorunlu** yap | Kaydolur |
| 4 | Tablet → Kurşun/QC2 → bir top seç | "Gramaj *" başlığı + **üç değer çipi** çıkar |
| 5 | Değer seçmeden "KK2 Tamamla" | Engellenir, eksik özellik ADIYLA yazılır |
| 6 | 50 gr seç → KK2 Tamamla | Geçer |
| 7 | Panel → Envanter → o top → detay | Rozet **"Gramaj: 50 gr"** yazar (listede de) |
| 8 | Aynı topu tekrar işle, 25 gr seç | Değer **düzelir**, ikinci satır AÇILMAZ |

---

## 8) Geri alma

| Katman | Nasıl |
|---|---|
| APK | Önceki APK'yı `adb install -r` ile kur |
| Electron | Önceki kurulum paketi |
| Backend kodu | `git checkout <önceki-sürüm>` + `pm2 restart` |
| Migration | **Geri alınmaz** (proje kuralı). Kolonlar/tablo dursa da eski kod onları okumaz → zararsız. Gerçek geri dönüş yedekten restore'dur. |

> Kolonlar nullable/varsayılanlı ve yeni tablo boş kalabilir; eski backend
> bunları hiç sorgulamaz. Bu yüzden kod geri alımı tek başına yeterlidir.

---

## 9) Bu sürümde YENİ İZİN YOK

`GET /api/station-capabilities/for-session` mevcut `MOBILE_SESSION_PERMS`
kümesini kullanır. Kimseye yeni yetki atanması gerekmez.

---

## 10) Bilinçli kapsam dışı

**İç istasyonun OPERATÖR AKIŞI** — tablet ekranı, adım başlat/bitir, topun
ilerlemesi. Model kuruldu (iç istasyon rotada renk/özellik taşıyabilir), akış
YAZILMADI: bugün fabrikada içeride yapılan bir proses yok. İç bir makine
alındığında ayrı bir iş olarak planlanmalı — yoksa top o adımda kilitlenir
(ilerletecek yüzey yok) ve yalnız "Konumu Düzelt" ile kurtarılır.

---

## 11) 2026-08-11 denetim revizyonu (aynı branch, aynı pencere)

Sektör-standardı denetimi (5 mercek + çapraz doğrulama) 24 doğrulanmış bulgu
üretti; hepsi bu branch'te kapatıldı. **Yeni migration YOK** (Faz B'nin
`RollProperty.valueId` migration'ı zaten §2'de). Deploy'a etkisi olan kararlar:

- **Değer koruması (F1):** Düzelt / iş emri hedef güncellemesi artık yalnız
  BAYRAK satırlarını replace eder — GRAMAJ gibi SEÇİM tipli satırların değeri
  silinemez. Soyağacı kopyaları (kesim çocuğu, undo, kısmi sevk) `valueId`
  taşır.
- **CHOICE hedef listesine giremez (Q1/F2/F3):** 9 backend kapısı
  (`assertTargetablePropertyIds`) + istemci süzgüleri. SEÇİM tipli özellik
  hedef/rota/sipariş/ürün-izinli listelerinde 400 ile reddedilir.
- **Tip geçiş kilitleri (F5):** kullanılmış CHOICE→FLAG ve pivotlu/AUTO'lu
  FLAG→CHOICE 400; `KAT` tipi hiç değiştirilemez.
- **TAMBUR_1/KAT modu OPTIONAL (SEK-5):** REQUIRED *yalancı beyandı* — Tambur
  akışı capability kapısını çağırmıyor (kat kolon-projeksiyon istisnası; UI
  zorunlu sorar, backend eski-APK sözleşmesi gereği null fallback kabul eder).
  Seed'ler OPTIONAL yazar. **Script'i eski sürümüyle koşmuş bir kurulumda**
  (satır REQUIRED kalmışsa) tek seferlik düzeltme:
  ```sql
  UPDATE station_properties sp SET mode='OPTIONAL'
  FROM stations s, fabric_properties fp
  WHERE sp."stationId"=s.id AND sp."propertyId"=fp.id
    AND s.code='TAMBUR_1' AND fp.code='KAT' AND sp.mode='REQUIRED';
  ```
- **Yazılı ayrım (SEK-5):** *İSTASYON ekranı yeteneği adım payload'ından
  (Kurşun/QC2 → open-cards `stepSummary.properties`), PLANLAMA ekranı
  katalogdan (Tambur kat tuşları + Hızlı İş Emri → `code=KAT` araması) okur.*
  `GET /station-capabilities/for-session` ucunun bugün İSTEMCİSİ YOK — ileride
  istasyon-bağlı üçüncü ekran için hazır altyapı.
- **Görünürlük (VAL-02/03/04):** Düzelt diyaloğu + mobil Tambur/Depo çipleri
  artık SEÇİM değerini basar ("GRAMAJ: 50 gr").
