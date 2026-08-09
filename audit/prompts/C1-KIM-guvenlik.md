# Oturum C1 — `KIM.guvenlik`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/services/auth.service.ts` · `permission-management.service.ts` (1.008) ·
`session-registry.service.ts` · `device.service.ts` · `controllers/auth.controller.ts` ·
`middlewares/login-lockout.ts` · `routes/auth.routes.ts` · `routes/device.routes.ts`

**Kapsam DIŞI:** guard kapsaması (A1'de yapıldı) · izin kataloğunun içeriği/rol şablonları → P1 (KIM.IZO).

**Okunacaklar:** `audit/raw/_GUARD-BASELINE.md` · `jq 'select(.cell=="CORE.guvenlik")' audit/FINDINGS.jsonl` ·
`audit/surface/07-async-yuzey.md` §5.1 (login-lockout satırı), §7

---

## YAPIŞTIRILACAK PROMPT

Bu bir DENETİM oturumudur. Kod DEĞİŞTİRME — salt okuma çalış.
Kod tabanı: /Users/oad/Documents/projeler/AdnanSahin/Teks-Erp (Express 5 + Prisma 7 + PostgreSQL, PRODUCTION CANLI).

ÇIKTI: bulgularını audit/FINDINGS.jsonl dosyasına APPEND et (satır başına bir JSON).
Şema ve yazım kuralları: audit/SCHEMA.md — ÖNCE ONU OKU.
Zorunlu alanlar: id, cell, severity, category, file, line, title, evidence, failure_mode,
fix_sketch, verification, status, confidence, session, found_at.

KALİTE KURALLARI:
- `failure_mode` üretemiyorsan (somut girdi -> somut yanlış sonuç) bu bir bulgu DEĞİLDİR.
  severity: bilgi ver ya da hiç yazma. "Bu kod karışık" bulgu değildir.
- Emin değilsen confidence: supheli ver ve verification alanına "nasıl kesinleşir" yaz.
- Aynı kök nedenin N tezahürü TEK bulgudur.
- CANLI SİSTEM: fix_sketch migration veya toplu veri dokunuşu öneriyorsa prod_risk: yuksek
  zorunlu ve geri alma yolu yazılmalı. `migrate reset` / reseed / toplu DELETE bu repoda YASAK.

YAZIM: Türkçe, teknik terimler İngilizce orijinaliyle. Emoji ve LaTeX kullanma.

OTURUM BAŞINDA ZORUNLU:
  jq -r 'select(.cell=="KIM.guvenlik") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = KIM.guvenlik

GÖREV: Kimlik doğrulamanın sertliği. Blast radius = ERİŞİM (tüm sistemin kapısı).

ANA OTURUMDA DOĞRULANMIŞ BULGU (senin işin bunu genişletmek, yeniden keşfetmek değil):
AuthController.login (auth.controller.ts:86-147) reserveLoginAttempt'i ÇAĞIRMIYOR.
Çağrılar yalnız satır 163 (loginCard, 148-226) ve 242 (loginQuickPin, 227-300).
Yani klasik kullanıcı adı/şifre girişinde brute-force kilidi YOK. Rate limit de yok.

1. Bu boşluğun somut sonucu: sınırsız şifre denemesi. bcryptjs kullanılıyor (maliyet faktörü kaç?
   auth.service.ts'e bak) - bcrypt yavaşlığı tek başına yeterli bir savunma mı? Tek process
   olduğu için CPU-bound bcrypt aynı zamanda bir DoS vektörü mü (event loop bloklama)?
   İKİ AYRI failure_mode yaz: (a) hesap ele geçirme, (b) hizmet kesintisi.

2. login-lockout process-local bir Map (MAX_ENTRIES 5000), restart'ta sıfırlanıyor,
   anahtar req.ip. app.set("trust proxy") YOK (doğrulandı) -> req.ip soket IP'si.
   Fabrika ağında NAT/proxy arkasından gelen tüm tabletler aynı IP mi görünüyor?
   Öyleyse bir tabletin hatalı denemeleri diğerlerini kilitler mi (yanlış pozitif DoS)?

3. GET /api/auth/mobile-users KİMLİK DOĞRULAMASIZ kullanıcı listesi döndürüyor.
   Ne dönüyor tam olarak (id, kullanıcı adı, ad soyad, rol?)? Bu bir enumeration yüzeyi.
   Giriş ekranının gerçekten buna ihtiyacı var mı, yoksa cihaz eşleşmesi arkasına alınabilir mi?
   GET /api/auth/login-methods da aynı sınıf.

4. CİHAZ EL SIKIŞMASI. POST /api/devices/announce kimlik doğrulamasız ve bilinmeyen cihaz için
   PENDING KAYIT YARATIYOR. Rate limit yok. Somut sonuç: kayıt şişirme. Tavan var mı,
   temizlik var mı? GET /api/devices/status ve /pairing-required ne kadar bilgi veriyor?

5. ADVISORY LOCK UZAYI PAYLAŞIMI. 1-argümanlı pg_advisory_xact_lock uzayını İKİ bağımsız
   alt sistem paylaşıyor: session-registry.service.ts:63 hashtext("<userId>|<deviceType>")
   ve permission-management.service.ts:584 hashtext('perm-admin-guard').
   2-argümanlı kullanıcılar (8021, 8022) namespace'i ÖZENLE ayırmışken bu ikisi ayırmamış.
   Etkisi yanlış sonuç değil GECİKME (serileşme) - ama asimetri belgesiz.
   Bu bilinçli bir kabul mü, gözden kaçmış mı? Çakışma olasılığını hesapla.

6. SON ADMİN KORUMASI. permission-management'ta 'perm-admin-guard' kilidi son admin'in
   yetkisinin düşürülmesini engelliyor. Bu guard TÜM yolları kapsıyor mu (kullanıcı silme,
   pasifleştirme, rol şablonu uygulama, izin kaldırma, şablon silme)? Bir yol atlanırsa
   sistem yönetici olmadan kalır -> kurtarma yolu var mı?

7. JWT. auth.service.ts:35-45 JWT_SECRET < 32 karakter ise boot'ta patlıyor (iyi).
   Token ömrü ne, refresh var mı, revocation nasıl (Session tablosu jti bazlı)?
   verifyToken her istekte session.findUnique yapıyor - yani revocation anlık.
   Çıkış (logout) gerçekten session'ı öldürüyor mu?
   NOT: .env'in git'te olduğu ve JWT_SECRET'ın orada bulunduğu ANA OTURUMDA DOĞRULANDI -
   o bulgu OPS.veri-performans hücresine ait, burada TEKRAR ETME, related ile bağla.

BİTİŞ KRİTERİ: 7 madde karara bağlanacak. Madde 1 iki ayrı failure_mode üretecek.
Madde 6 için "kurtarma yolu var mı" sorusu mutlaka cevaplanacak.
