# TeksERP — Üretim Deploy Öncesi Kontrol Listesi

Her üretim deploy'undan ÖNCE bu listeyi baştan sona işaretle. Adım atlamak =
sessiz bozulma riski. Akış ayrıntıları: `DEPLOY-RUNBOOK.md`. Migration notları:
`Teks-Erp/MIGRATION-DEPLOY.md`.

---

## A) Kod kalitesi (build makinesinde / CI)

- [ ] **Backend testleri yeşil** — `Teks-Erp/` içinde `npm test`
      (= `tsx scripts/run-all-tests.ts`, tüm `scripts/test_*.ts` dosyalarını
      toplar — kanonik sayı `scripts/test_*.ts`, 2026-07-14 itibarıyla ~159) exit 0.
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
      eder — kısa secret'ta sunucu açılmaz). Windows installer'da otomatik
      üretilir; manuel yolda elle güçlü bir değer konur.
- [ ] **`DATABASE_URL` doğru DB'yi gösteriyor** (production = `TeksErpDb`,
      dev/test DB'sine YANLIŞLIKLA bağlanmıyor).
- [ ] Windows: `C:\ProgramData\TeksERP\secret.json` yedeklendi (DB şifresi +
      JWT secret burada; kaybolursa DB'ye bağlanılamaz).

## C) Veritabanı hazırlığı

- [ ] **DB yedeği alındı** (`pg_dump -Fc` / Windows installer güncellemede
      `premigrate_*.dump`'ı otomatik alır — alındığı teyit edildi).
- [ ] **`migrate deploy` provası yapıldı** — temiz bir DB'de (`teks_deploy_probe`
      gibi) tüm migration'lar hatasız uygulanıyor (2026-06-13 provası **51/51
      hatasız**; migration sayısı sürekli artar — kanonik `prisma/migrations/`,
      2026-07-14 itibarıyla ~114 — prova her deploy öncesi tekrarlanır;
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
      (dev verisini sıfırlar). Windows: `.seeded` bayrağı bunu garanti eder.
- [ ] Manuel/Linux yolunda güncelleme sırası: `git pull → npm install →
      prisma:generate → npm run build → prisma:migrate → servis restart`
      (seed yok). Windows: yeni `setup.exe`'yi Yönetici olarak çalıştır.
- [ ] Servis yeniden başlatma sonrası teyit hazır.

## E) Deploy sonrası doğrulama

- [ ] **Sağlık kontrolü 200** — `curl http://localhost:4000/health` → HTTP 200
      ve `db: "UP"` (endpoint `/health`, `/api/health` DEĞİL).
- [ ] Giriş çalışıyor (`admin` / belirlenen şifre) ve temel ekranlar açılıyor.
- [ ] **Disk ve RAM yeterli** — DB + yedekler için yeterli boş alan; sunucu
      Node + PostgreSQL'i rahat taşıyor (yedek rotasyonu son 14 dump'ı tutar).
- [ ] Log konumları erişilebilir (Windows: `ProgramData\TeksERP\logs\`;
      Linux: systemd journal / PostgreSQL log) ve hata yığını yok.

## F) Geri dönüş hazırlığı

- [ ] **Geri-dönüş planı hazır** — `migrate deploy` geri alınmaz; rollback =
      migration öncesi yedekten restore + (şema değiştiyse) eski koda dönüş.
      Yedek dosyasının yeri ve eski sürüm `setup.exe`/commit'i el altında.
- [ ] **LAN-only duruşu teyit** — uygulama dışa kapalı (CORS/HTTPS/rate-limit
      bilinçli yok). Dışa AÇILIYORSA bunlar + `User.tokenVersion` token iptali
      eklenmeden deploy EDİLMEZ (bkz. `DEPLOY-RUNBOOK.md §9`).
