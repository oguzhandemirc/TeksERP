# DÜZELTME TURU — çalışma kuralları (kullanıcı kararı, 2026-08-29 gece)

## Kapsam kararı
- **Kod + bekçi + şema taslakları.** Kod düzeltmeleri ve her düzeltmenin bekçi testi yazılır; yeni DB kısıt/index dosyaları (migration) YAZILIR ama **sahaya UYGULANMAZ** — yalnız yerelde denenir, `[PROD'DA ÇALIŞTIRMA]` etiketiyle sabaha bırakılır.
- **Dört aile de dahil:** ① sevkiyat–sipariş defteri ② yetki/güvenlik ③ yedek/kurulum ④ üretim/metraj.
- **Teslim:** yeni dal `denetim-duzeltme`, **her düzeltme ayrı commit** (mesajda hangi BULGU-id kapanıyor, neden, risk).
- **Veri onarımı:** buradaki DB saha DB'sinin gerisinde → yerelde onarım anlamsız. Onarım script'leri `Teks-Erp/scripts/fix_*.ts` olarak **dry-run varsayılan** yazılır, `--apply` sahada kullanıcı tarafından koşulur; etkilenecek her kayıt somut listelenir (CLAUDE.md kuralı).

## Sıra (pazarlık dışı)
Denetim BİTMEDEN düzeltmeye başlanmaz: Tur 3 → Tur 4 → sentez/rapor → düzeltme. Sebep: denetçi ajanlar kaynak kodu okuyor; eşzamanlı kod değişikliği satır numaralarını kaydırıp bulgu kanıtlarını geçersizleştirir.

## Kendime koyduğum kelepçeler
1. **Saha veritabanına hiçbir yazma yok** (erişim de yok). Yerel yazma denemeleri yalnız kopya DB'de (`tekserp_fixtest` gibi ayrı bir kopya), paylaşımlı `adnansahin_db` mümkün olduğunca bozulmadan bırakılır.
2. **Her düzeltme = kod + bekçi + negatif sonda.** Bekçi, düzeltme geri alındığında KIRMIZI verdiği kanıtlanmadan "bekçi" sayılmaz (repo kültürü).
3. **Tip kontrolü + ilgili bekçiler yeşil kalacak.** Düşen bir şey olursa düzeltme geri alınır, commit edilmez, sabaha not düşülür.
4. **İş kararı gerektiren hiçbir şeye dokunulmaz** (tolerans değerleri, hangi rakam doğru, hangi kayıt silinsin) — liste hâlinde sabaha bırakılır.
5. **Migration dosyaları prod'a uygulanmaz**, `prisma migrate deploy` yalnız yerel kopyada koşar; geri alma yolu her dosyanın başına yazılır.
6. Feature-flag / SystemSetting değerleri değiştirilmez.

## Sabah kullanıcıdan beklenen iki karar
1. Hangi şema taslakları (yeni kısıtlar) sahaya, hangi vardiya dışı pencerede uygulanacak.
2. Onarım script'lerinden hangileri sahada `--apply` ile koşacak (her biri için "doğru rakam ne" onayı).
