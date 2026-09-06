# TeksERP — Üretim Deploy Öncesi Kontrol Listesi

> ⚠️ **TARİHSEL — deploy yolu 2026-08-24'te değişti.** Aşağıdaki `git pull → build →
> migrate` akışı fabrikada **artık uygulanmıyor**: çalışan kurulum `C:\Etkili-Yazilim\app\`
> altındaki hazır pakettir ve `kur.ps1` ile kurulur (yedek + migrate + pm2 sırasını script
> yapar). Güncel akış **`docs/ops/DEPLOY-RUNBOOK.md §3`** + `deploy/README.md`. Bu dosyanın
> geri kalanı (gerekçeler, sıra teyidi, kontrol maddeleri) bilgi olarak duruyor.

Her üretim deploy'undan ÖNCE bu listeyi baştan sona işaretle. Adım atlamak =
sessiz bozulma riski. Akış ayrıntıları: `DEPLOY-RUNBOOK.md`. Migration notları:
`Teks-Erp/MIGRATION-DEPLOY.md`.

---

## A) Kod kalitesi (build makinesinde / CI)

- [ ] **Backend testleri yeşil** — `Teks-Erp/` içinde `npm test`
      (= `tsx scripts/run-all-tests.ts`, tüm `scripts/test_*.ts` dosyalarını
      toplar — kanonik sayı `scripts/test_*.ts`, 2026-09-05 itibarıyla 455) exit 0.
- [ ] **Electron testleri yeşil** — `Electron/` Vitest (`npm test`) hatasız.
- [ ] **Mobil testleri yeşil** — `mobil/` jest-expo (`npm test`) hatasız.
- [ ] (Hepsi tek seferde: kök `./run-tests.sh`.)
- [ ] **TypeScript temiz** — backend `npx tsc --noEmit` hatasız (ve gerekirse
      `npm run build` → `dist/` üretilir).
- [ ] **Lint temiz** — `npm run lint` (kritik kurallar: `tx` içinde
      `Promise.all([tx.*])` yok vb.).
- [ ] **Yeni migration varsa** geri-uyumlu mu doğrulandı (yeni kolon/tablo
      nullable veya default'lu; mevcut veriyi bozmuyor).

## B) Ortam ve gizli değerler

- [ ] **`.env` üç değişken set:** `PORT=4000`, `DATABASE_URL`, `JWT_SECRET`.
- [ ] **`JWT_SECRET` ≥ 32 karakter ve güçlü/rastgele** (backend açılışta enforce
      eder — kısa secret'ta sunucu açılmaz). Elle güçlü bir değer konur
      (installer'ın otomatik üretimi kaldırıldı).
- [ ] **`DATABASE_URL` doğru DB'yi gösteriyor** (production = `tekserp`,
      dev/test DB'sine YANLIŞLIKLA bağlanmıyor).
- [ ] **`Teks-Erp/.env` yedeklendi** (DB şifresi + JWT secret burada; kaybolursa
      DB'ye bağlanılamaz ve yedekten geri yükleme yapılamaz). Eski
      `C:\ProgramData\TeksERP\secret.json` **kaldırıldı** — tek sır kaynağı `.env`.

## C) Veritabanı hazırlığı

- [ ] **DB yedeği alındı** (`pg_dump -Fc` / Windows installer güncellemede
      `premigrate_*.dump`'ı otomatik alır — alındığı teyit edildi).
- [ ] **`migrate deploy` provası yapıldı** — temiz bir DB'de (`teks_deploy_probe`
      gibi) tüm migration'lar hatasız uygulanıyor (2026-06-13 provası 51/51'di; o günden bu yana 180+ migration eklendi — prova her deploy öncesi TEKRARLANIR, eski sonuç kanıt değildir) (**51/51
      hatasız**; migration sayısı sürekli artar — kanonik `prisma/migrations/`,
      2026-09-05 itibarıyla 232 — prova her deploy öncesi tekrarlanır;
      bkz. `Teks-Erp/MIGRATION-DEPLOY.md`).
- [ ] **Index-ağır migration vardiya dışına planlandı** — büyük tabloda
      `CREATE INDEX` içeren migration gece/hafta sonu deploy edilecek;
      gerekiyorsa migration başına `SET statement_timeout = 0;` eklendi
      (`statement_timeout=50s` aksi halde DDL'i iptal eder).
- [ ] **`statement_timeout=50s` üretim DB'sinde aktif** (`ALTER DATABASE ... SET
      statement_timeout = '50s'` uygulandı — installer otomatik yapar).

## D) Deploy adımları

- [ ] **İlk kurulum mu, güncelleme mi** netleştirildi.
- [ ] **`seed` SADECE ilk kurulumda çalıştırılacak** — güncellemede ASLA
      (verileri sıfırlar). **Otomatik koruma YOK** (eski installer'ın `.seeded`
      bayrağı kaldırıldı) → operatör disiplini.
- [ ] Güncelleme sırası: `git pull → npm install → prisma:generate →
      npm run build → prisma:migrate → pm2 restart tekserp-backend` (seed yok).
      **Bu sıra KANONİK** (`Teks-Erp/MIGRATION-DEPLOY.md`): geri alınamaz adım
      (`migrate deploy`) atomik cut-over'ın hemen öncesinde; `build` DB'ye dokunmaz,
      patlarsa temiz abort.
- [ ] **Geliştirme makinesinde `npm run check:migrations` TEMİZ** — commit
      edilmemiş/değiştirilmiş migration ya da `test_*.ts` yok. Untracked bir
      migration `migrate deploy` tarafından HİÇ görülmez: deploy "başarılı" der,
      sonra o kolonu okuyan her yol P2022/500 verir (2026-07-30'da üç migration
      tam bu şekilde production'a gitmemişti).
- [ ] **Bu sürümdeki her migration kod commit'inde görünüyor:**
      `git show --stat <sha> | grep prisma/migrations` boş DÖNMEMELİ.
- [ ] **Migration ÖNCESİ yedek elle alındı** — otomatik `premigrate_*` artık
      üretilmiyor (installer alıyordu); rollback buna dayanır.
- [ ] `pm2 restart` sonrası teyit hazır; deploy sonunda **`pm2 save`** koşulacak
      (yoksa reboot eski süreç listesini geri yükler).

## E) Deploy sonrası doğrulama

- [ ] **Sağlık kontrolü 200** — `curl http://localhost:4000/health` → HTTP 200
      ve `db: "UP"` (endpoint `/health`, `/api/health` DEĞİL).
- [ ] Giriş çalışıyor (`admin` / belirlenen şifre) ve temel ekranlar açılıyor.
- [ ] **Disk ve RAM yeterli** — DB + yedekler için yeterli boş alan; sunucu
      Node + PostgreSQL'i rahat taşıyor (yedek rotasyonu son 14 dump'ı tutar).
- [ ] Log konumları erişilebilir (`pm2 logs tekserp-backend`; dosya yolu
      `ecosystem.config.js` → `out_file`/`error_file`) ve hata yığını yok.
- [ ] **`pm2-logrotate` kurulu** — pm2 log rotasyonu yapmaz, kurulmazsa dosya
      sınırsız büyür (NSSM 10MB'da döndürüyordu).
- [ ] **Yedekleme canlı:** `GET /api/admin/health` (token + `admin:settings`) →
      `lastBackup` **null DEĞİL** — ⚠️ `/health`'te bu alan YOK (2026-08-09'da beş
      alana donduruldu; `lastBackup` yetkili uca taşındı, eski madde mekanik olarak hep
      kırmızıydı). Token'sız alternatif: `C:\Etkili-Yazilim\backups` içinde bugünün
      `tekserp_*.dump`'ı var mı (`kur.ps1` sonunda "Son gece yedegi:" satırı da bunu basar);
      backend log'unda `[backup] BACKUP_DIR tanımsız` satırı YOK; Panel → Sistem →
      Yedekler'de kırmızı "Yedekleme kapalı" kutusu YOK.

## F) Geri dönüş hazırlığı

- [ ] **Geri-dönüş planı hazır** — `migrate deploy` geri alınmaz; rollback =
      migration öncesi yedekten restore + (şema değiştiyse) eski koda dönüş.
      Yedek dosyasının yeri ve eski sürümün commit'i el altında.
- [ ] **LAN-only duruşu teyit** — uygulama dışa kapalı (CORS/HTTPS/rate-limit
      bilinçli yok). Dışa AÇILIYORSA bunlar + `User.tokenVersion` token iptali
      eklenmeden deploy EDİLMEZ (bkz. `DEPLOY-RUNBOOK.md §9`).
