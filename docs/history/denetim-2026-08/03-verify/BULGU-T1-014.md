# DOĞRULAMA — BULGU-T1-014

**Başlık:** 6 haneli PIN tek başına kimliktir; tek savunma IP-anahtarlı bellek kilidi → alt ağdan doygunluk, üstelik yönetici hesaplarının PIN'i var
**Geliş:** S1 / K2 · Modül KIM · `Teks-Erp/src/middlewares/login-lockout.ts`
**Sonuç:** **DOĞRULANDI (K2)** — ve ölçülen maruziyet, bulgunun kendi failure_mode'undan **daha ağır**: bir YÖNETİCİ hesabının PIN'i "aynı rakam ×6" sınıfında (aday kümesi **10**), yani aktif kilit altında bile **tek IP'den ~1 dakikada** ele geçirilebilir. Bu, S0 (yönetici devralma, önemsiz maliyetle sömürülebilir) için somut zemindir.

---

## 1. Kod zinciri (K1 teyidi — koruma yok/zayıf)

| Nokta | Kanıt |
|---|---|
| Uç kimliksiz | `routes/auth.routes.ts:15` `router.post("/login-quick-pin", AuthController.loginQuickPin)` — `verifyToken` YOK; bekçi muaf listesinde (`test_route_auth_coverage.ts`). |
| Kimlik = tek faktör | `services/auth.service.ts:130-136` `findFirst({ where:{ quickPin: normalized, isActive:true } })` — **kullanıcı adı YOK, bcrypt YOK**; indeksli seek (`schema.prisma:371 quickPin @unique`) → deneme ucuz. |
| Tek savunma | `middlewares/login-lockout.ts:24-41,82-89` modül-seviye `failCounts = new Map` (restart'ta sıfır), anahtar `req.ip`. `app.set("trust proxy")` **verilmemiş** (`auth.controller.ts:109` yorumu + grep 0) → anahtar = **soket IP**, yani IP başına. |
| Başka katman yok | `package.json`: `express-rate-limit`/`slow-down`/captcha **YOK** (yalnız `helmet`). CORS `*` (F-CORE-GUV-005) tarayıcı yüzeyini de açar. |
| Kilit yalnız yavaşlatır | `login-lockout.ts:82-89` eşik 5 → 60 sn blok; 3 tur (15 deneme) sonra 15 dk. Merdiven idle'da çürür (`:75-80`). **Onaylatma değil sadece gecikme**; 10 adaylık bir PIN 60 sn'de tükenir. |

## 2. K2 — prod kopyasında fiili maruziyet (`tekserp_saha_0825`, 2026-08-25)

Sorgu: `audit/data/BULGU-T1-014.sql` · Çıktı: `audit/data/BULGU-T1-014.txt`

**Ayar (system_settings):**
- `auth.loginMethods = {"enabled":["list","pin"], "primary":"pin"}` → PIN **birincil** giriş yöntemi.
- `auth.pinLockoutEnabled` **satırı YOK** → kod varsayılanı `true` (`system-setting.service.ts:399`). Attempts satırı yok → **5**; PenaltySec yok → **60**; Escalate=**3**; LongPenalty=**15 dk**. Kilit AÇIK ama zayıf.
- `device.pairingRequired` satırı yok → default `false` → `GET /auth/mobile-users` kimliksiz (yardımcı yüzey).

**Maruziyet:**
| Ölçüm | Değer |
|---|---|
| Aktif kullanıcı | 8 |
| quickPin taşıyan | **7 / 8** (farklı PIN: 7) |
| cardToken taşıyan | 0 (kart yolu boş; PIN tek yol) |
| PIN'i olan **yönetici** (admin:* yetkili) | **3** (id `ea0a5585…`, `b33559d0…`, `44acc97b…`; 54/55/58 yetki) |
| admin:* yetkili aktif kullanıcı (toplam) | 4 → 3'ünün PIN'i var |

**Entropi sınıfları (7 PIN; değerler basılmadı):**
| Sınıf | Adet |
|---|---|
| aynı rakam ×6 (`dddddd`) | **3** |
| bilinen zayıf sözlük (123456 vb.) | 2 |
| 0 ile başlayan | 2 |
| komşu PIN farkı ≤ 1000 (ardışık atama) | 0 (dağınık) |

**Aday kümesi (kaç denemeyle bulunur):**
| Aday kümesi | PIN adedi |
|---|---|
| 10 (all-same-digit) | 3 |
| 20 (kısa sözlük) | 1 |
| 1.000.000 (güçlü) | 3 |

**KRİTİK — yönetici hesapları (7b, değer basılmadı):**
| id | admin yetki | PIN aday kümesi |
|---|---|---|
| `b33559d0-4c30-43c1-9c96-e47d950acd22` | 3 | **10** (aynı rakam ×6) |
| `ea0a5585-443e-44e7-9614-719d8ec1f138` | 3 | 1.000.000 |
| `44acc97b-a1e3-4844-84a4-1bd1cf88827d` | 2 | 1.000.000 |

→ **3 admin yetkili bir hesabın PIN'i, 10 iyi bilinen değerin (000000,111111,…,999999) denenmesiyle bulunur.** Aktif kilit altında (5/60sn): ilk 5 serbest → 60 sn → kalan 5 → **tek IP'den ~60-70 sn**. Alt-ağ doygunluğuna (bulgunun ~1 günlük senaryosu) gerek YOK; bulgunun failure_mode'u bu hesap için maruziyeti **abartısız değil, eksik** tahmin ediyor.

**Fiili saldırı izi (arandı):**
- 90 günde `LOGIN_FAILED` 67 (16 farklı IP), `LOGIN_SUCCESS` 214 (32 IP). Tek IP/tek gün en çok 8 başarısız (`192.168.1.56`, 2026-08-01) — parmak-hatası profili, saldırı değil.
- `LOGIN_LOCKED`/429 audit izi 0 — ama 429 `next(AppError)` yolundan gider, ayrı audit yazılmaz; **yokluğu "kilit hiç kurulmadı" kanıtı DEĞİL**.
- LOGIN_FAILED yöntem dağılımı: 22 `admin` (klasik), 15 `quick-pin` → PIN yolu sahada fiilen kullanılıyor.

## 3. K3 / davranışsal kanıt

Sınıf **hesap/kimlik**, yarış değil → sözleşme gereği eşzamanlı repro (K3) N/A; yerine **tek-istek davranışsal kanıt** kod zincirinde kuruldu (§1): `loginQuickPin` bcrypt'siz/kullanıcı-adısız `findFirst`, kilit per-IP ve yalnız yavaşlatıcı. Çalışan sunucuya HTTP sondası KOŞULMADI çünkü (a) sömürü mekanizması tamamen kod+veri ile kanıtlandı, (b) gerçek PIN değerlerini deneyerek doğrulamak salt-okunur denetim sınırını ve KVKK'yı ihlal ederdi, (c) flag/ortam değiştirmek yasak. Bu bir sınırlama değil, sınıfın doğru kanıt biçimidir.

## 4. Yorum / şiddet

- Geliş: S1/K2. Doğrulama K2'yi **teyit** etti ve tek yeni ölçümle (yönetici hesabı aday kümesi 10) **sömürülebilirliği S1→S0 aralığına** taşıdı: etki=kritik (admin:* devralma → tüm ERP), olasılık=yüksek (10 deneme, aktif kilit yalnız ~1 dk geciktirir), düzeltici=zayıf ve sessiz. **S0 önerilir.**
- Bu, defterdeki `F-KIM-GUV-001` (2026-08-09, "düzeltildi — artık risk: çok-IP doygunluğu") notunun **açık bıraktığı ayağın veriyle doğrulanmış hâlidir**; reddedilmiş bulgu yeniden açılmıyor, kapatılan bulgunun kendi beyan ettiği "artık risk" saha verisiyle somutlaştı.
- Düzeltmenin şekli (2. tur, kod değişikliği DEĞİL bu turda): ① PIN'e minimum entropi zorlaması (all-same-digit / sözlük reddi) `setQuickPin`'de; ② global eş-zamanlı-bcrypt/deneme tavanı ya da gerçek rate-limit; ③ yöneticilerde salt-PIN girişini kapatıp parola+PIN iste; ④ mevcut zayıf yönetici PIN'lerini rotasyona sok. ①/④ acil.

## SINIR ÖTESİ NOTLAR
- `GET /auth/mobile-users` kimliksiz (pairingRequired default false) mobil kullanıcı adlarını döner → klasik `/login` password-spray'e yardımcı yüzey. Ayrı KIM bulgusu adayı (F-CORE-GUV-002/003 ailesi).
- CORS `*` (`app.ts:114`) — F-CORE-GUV-005 reddi duruyor; PIN yüzeyini tarayıcıdan da ulaşılır kılması bu bulguyla birleşince yeniden tartılabilir (yine de kimlik Authorization başlığında, cookie yok).

## KAPSANMAYAN / ERİŞİLEMEYEN
- Canlı prod DB'ye erişim yok; ölçüm 2026-08-25 kopyası. Sahadaki PIN'ler o günden sonra değişmiş olabilir (değişmediği varsayımı [VARSAYIM]).
- `auth.pinLockoutAttempts/PenaltySec` prod'da ezilmiş olabilir mi: saha kopyasında satır yok → varsayılan. Canlıda farklıysa kilit daha sıkı/gevşek olabilir (erişilemez).
