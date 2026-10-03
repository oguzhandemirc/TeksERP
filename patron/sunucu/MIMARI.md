# patron/sunucu — mimari ve ayrıntı

> `patron/sunucu/CLAUDE.md`'den 2026-10-03'te taşınan açıklayıcı metin: runbook atfı, komutlar, ortam değişkenleri. Oturum açılışında yüklenmez. Kurallar `patron/sunucu/CLAUDE.md`'de ve `docs/kurallar/patron-bulutu.md` § Bulut sunucusu (`patron/sunucu`), § Bildirimler (B5) ile § Patron sunucusu — alt-alan kuralları'nda kalır (Kurulum kaydı · Hizmet aşaması · Hesaplar · Bildirimler bölümlerinin eski metni uç, runbook ve bekçi atıflarıyla birlikte TAM hâliyle orada), burada tekrarlanmaz. Başlıklar eski CLAUDE.md bölüm başlıklarıyla aynıdır.

## Katmanlar

- **Servis** (`src/services/` · `src/auth/`): İş kuralı + tx.

## Çok kiracılı tek DB — üç rol (+ destek rolü)

- **Destek rolü:** Aç/kapa runbook'u `docs/ops/PATRON-BULUTU-DESTEK-ERISIMI.md`; bekçi `test_destek_rolu`.

## Komutlar

```bash
cd patron/sunucu
npx prisma migrate deploy && npx prisma generate && npx tsx scripts/db-rolleri.ts   # migrate dev/reset YASAK
npx tsx scripts/tesis.ts tesis-ac --tesis=<uuid> --ad="Fabrika" [--saklama=13|3|25|tumu]
npx tsx scripts/tesis.ts kurulum-kaydet --tesis=<uuid> --kurulum=<uuid> --acik-anahtar=<x> --sinif=URETIM --moduller=patron-bulut,production.enabled --bitis=<ISO>
npx tsx scripts/tesis.ts yonetici-davet --tesis=<uuid> --eposta=<e-posta> --ad="Ad Soyad"   # davet belirteci BİR KEZ basılır
npx tsx scripts/tesis.ts yonetici-yeniden-davet --tesis=<uuid> --eposta=<e-posta> [--zorla --talep=<no> --gerekce="…"]   # aktif yönetici varken yalnız zorlamayla
npx tsx scripts/tesis.ts imha --tesis=<uuid> --isleyen="Ad Soyad" [--erken-talep=<no>] [--uygula]   # kuru koşum varsayılan
npm run typecheck:scripts && npm run lint        # commit kapısı altıncı proje olarak aynısını ölçer (tip + eslint + lint-baseline.json tavanı)
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` (repoya girmez, 0600): `GOC_DATABASE_URL` · `DATABASE_URL` (uygulama rolü) · `ESITLEME_DATABASE_URL` (eşitleme rolü) — üçü AYNI `_test` DB'yi, ÜÇ AYRI rolle gösterir (`tekserp_fabrika_*` ASLA) · `ANAHTAR_DIZINI` · `PORT` (varsayılan 4620); isteğe bağlılar `.env.example`te. Bekçiler `scripts/test_*.ts`; harita `Teks-Erp/docs/BEKCI-HARITASI.md` § patron-bulutu. CI'da ayrı "Patron sunucusu" job'ı (PG 16, `migrate deploy`, roller, lint + tavan + tip + kapı kapsamı + bekçi koşucusu).
