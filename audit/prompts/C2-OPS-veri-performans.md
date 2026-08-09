# Oturum C2 — `OPS.veri-performans`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/services/backup.service.ts` · `backup-impact.service.ts` · `db-copy.service.ts` (931) ·
`db-copy-verify.service.ts` · `helpers/pg-tool.helper.ts` · `helpers/pg-admin-client.ts` ·
`jobs/backup-scheduler.ts` · `jobs/archive-scheduler.ts` · `ecosystem.config.js` · `.env` durumu

**Kapsam DIŞI:** `/health` içeriği ve hata yolu → A2. Deploy prosedürünün kendisi (repo dışı gerçekler).

**Okunacaklar:** `audit/surface/08-deploy-topolojisi.md` (tamamı) · `07-async-yuzey.md` §1, §6.1, §10

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
  jq -r 'select(.cell=="OPS.veri-performans") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = OPS.veri-performans

GÖREV: Veri kaybı yolları. Blast radius = VERİ (canlı fabrika verisi, geri dönüşü yok).

ANA OTURUMDA DOĞRULANMIŞ BULGU (genişlet, yeniden keşfetme):
Teks-Erp/.env GIT'TE İZLENİYOR. `git ls-files` doğruladı, 3 commit var
(en yenisi "chore(env): ... JWT secret rotasyonu"), repo GitHub'a push ediliyor
(git@github.com:oguzhandemirc/TeksERP.git). Dosya DATABASE_URL ve JWT_SECRET taşıyor.
.gitignore'da .env var ama dosya zaten index'te olduğu için kalıp ETKİSİZ.

1. Bu bulguyu FINDINGS'e yaz (severity: kritik, category: guvenlik, prod_risk: yuksek).
   fix_sketch'te ÜÇ ayrı karar olmalı: (a) git rm --cached + .gitignore doğrulama,
   (b) sahadaki JWT_SECRET repo'dakiyle AYNI MI (repodan cevaplanamaz - ŞÜPHELİ işaretle,
   doğrulama adımı yaz), (c) aynıysa secret rotasyonu + tüm oturumların geçersiz kılınması,
   (d) git geçmişinden temizleme kararı (repo public mi private mi - bu da repodan cevaplanamaz).
   Deponun görünürlüğünü VARSAYMA.

2. OFFSITE YEDEK YOK. ecosystem.config.js BACKUP_OFFSITE_DIR: "" (boş). Tüm yedekler
   BACKUP_DIR = C:/Etkili-Yazilim/backups, yani DB ile AYNI DİSKTE. Tek disk arızası =
   veri + yedek birlikte. Ayrıca gece yedeğinin sahibi bağımsız bir Windows Görev Zamanlayıcı
   görevi (BACKUP_SCHEDULE_ENABLED=false), yani backend bunu göremiyor ve /health'in
   lastBackup alanı o dosyaları görüyor mu - DOĞRULA.

3. runTool TIMEOUT'SUZ (pg-tool.helper.ts:8,44). pg_dump/pg_restore/psql spawn ediliyor,
   child asılırsa promise HİÇ SETTLE OLMUYOR. Telafi yalnız çağıran tarafta: verifyBackupFile
   Promise.race 30 sn, scheduler'da 3 saatlik watchdog - ama watchdog bayrağı bırakır,
   CHILD HÂLÂ KOŞUYOR. Ayrıca damga işin BAŞINDA yazılıyor -> başarısız yedek o gün
   TEKRAR DENENMİYOR. Somut failure_mode: asılı dump -> o gün yedek yok -> kimse fark etmiyor
   (arşiv işinin aksine yedeğin BACKUP_FAILED audit'i var - bu yolda tetikleniyor mu?).

4. db-copy.service (931 satır): CREATE DATABASE + pg_restore + iki ALTER DATABASE RENAME,
   withAdminClient(..., { statementTimeoutMs: 0 }) ile statement timeout KAPATILIYOR.
   Bu, canlı DB üzerinde en yıkıcı işlem. Guard'ları TEK TEK doğrula: hangi izin gerekiyor,
   onay akışı ne, yanlış hedefe restore edilmesi mümkün mü, "atomik claim" yorumu (satır ~403)
   tek-thread varsayımına dayanıyor - tek process olduğu için bugün doğru, ama bir script
   startCopyJob'u doğrudan çağırırsa?

5. ARŞİV İŞİ SESSİZ. archive-scheduler hatası yalnız console.error'a yazıyor, audit olayı YOK
   (yedeğin BACKUP_FAILED muadili yok). "Arşiv aylardır koşmuyor" nasıl fark edilir?
   SystemLog 6 ayda bir taşınıyor; taşınmazsa tablo ne kadar büyür (dev DB'de 51.281 satır ölçüldü)?

6. LOG ROTASYONU YOK. pm2 kendiliğinden rotate etmiyor; pm2-logrotate ayrıca kurulmalı.
   C:/Etkili-Yazilim/logs sınırsız büyüyor ve DB ile AYNI SUNUCUDA. Disk dolarsa hem backend
   hem PostgreSQL etkilenir. Bu repodan doğrulanamaz (ŞÜPHELİ) - doğrulama adımı yaz (`pm2 ls`).

7. backup-scheduler.ts:85 dueAt.setHours(hour,0,0,0) SÜREÇ SAAT DİLİMİNİ kullanıyor.
   Bu, tüm kod tabanındaki TEK setHours üretim kullanımı; diğer üç eşleşme "bu desen kaldırıldı"
   yorumu. FACTORY_TIMEZONE/factoryDayStart yardımcıları 35 yerde kullanılıyor ama burada değil.
   scripts/test_report_day_boundary.ts SQL'e bakıyor, JS setHours'u GÖRMÜYOR.
   Sahada scheduler kapalı olduğu için etki bugün sıfır - ama bayrak açılırsa sessizce
   yanlış saatte koşar. severity'yi buna göre ver.

8. TEST PAKETİ ORTAM GUARD'I OLMADAN GERÇEK DB'YE YAZIYOR. Ölçüldü (yüzey belgesi 09 §4):
   273 testin 235'i ../src/lib/prisma'yı import ediyor, testlerde 1.539 deleteMany çağrısı var
   (209 dosyada), ve NODE_ENV / "bu DB üretim mi" guard'ı taşıyan test sayısı SIFIR.
   Mock yok - test altyapısı bilinçli olarak "server'sız entegrasyon": DATABASE_URL ne
   gösteriyorsa oraya yazıyor. Kullanıcı belleğine göre dev DB gerçek fabrika verisine çekilmiş.
   SOMUT failure_mode: DATABASE_URL yanlışlıkla saha sunucusunu gösterirse `npm test`
   canlı fabrikaya 1.539 deleteMany gönderir. Tek koruma KONVANSİYON (silme kararları
   TEST-/TST- kod önekine bakıyor) - bu bir sed değil.
   fix_sketch: run-all-tests.ts başına fail-closed bir ortam guard'ı (DATABASE_URL host/db adı
   allowlist'i, ya da üretim işaretçisi varsa exit 1). Bu ürün kodu DEĞİL, test altyapısı -
   yani CANLI SİSTEM riski taşımadan düzeltilebilir. prod_risk: dusuk.
   AYRICA: clean_test_residue.ts'in kendi başlığı "koşucu 180sn'de SIGTERM gönderdiğinde
   finally bloğu HİÇ çalışmaz" diyor -> yarım koşum TEST-SINV-* toplarını envanterde
   hayalet stok olarak bırakıyor ve test_consistency §18'i kalıcı kırmızıya çeviriyor
   (gerçek bir mükerrer bulgusu bu gürültüde kaybolur). Bunu da yaz.

BİTİŞ KRİTERİ: 8 madde karara bağlanacak. Madde 1 mutlaka repo görünürlüğünü VARSAYMADAN yazılacak.
Madde 4 için guard listesi eksiksiz olacak. Madde 8 severity: kritik adayıdır.
