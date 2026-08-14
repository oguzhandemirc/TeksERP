// =============================================================================
// ALIŞ SİPARİŞİ SEÇİCİSİ — mal kabul fişi için
// =============================================================================
// ⚠️ YALNIZ AÇIK SİPARİŞLER LİSTELENİR (`OPEN,PARTIAL`). Tamamlanmış siparişe
// mal kabul etmek meşrudur (fazla mal gelebilir) ama listede göstermek, yüzlerce
// kapanmış kaydı depocunun önüne yığıp doğru siparişi bulunamaz hâle getirirdi.
// İPTAL edilmiş sipariş ise backend tarafından zaten REDDEDİLİYOR — onu listeye
// koymak, kullanıcıyı kesin bir 409'a yürütmek olurdu.
//
// ⚠️ TEDARİKÇİ SEÇİLİYSE LİSTE ONA DARALIR. Sebep bir hata yolunu kapatmak:
// backend, fişin tedarikçisi ile siparişin tedarikçisi farklıysa 400 veriyor
// ("birini düzeltin") — çünkü hangisinin doğru olduğunu yalnız operatör bilir ve
// yanlış tarafa yazmak alış faturası mutabakatını yanlış cariye bağlardı.
// Daraltma o çelişkiyi seçim ANINDA imkânsız kılar.
//
// ⚠️ "HATA" ile "SİPARİŞ YOK" AYRI CÜMLELER. İstek düşerse (rejim kapalı, izin
// yok, sunucu erişilemez) elimizde boş bir dizi kalır; onu "açık sipariş yok"
// diye basmak, depocuyu siparişi bağlamadan fiş kapatmaya iter ve "ne ısmarladım
// ne geldi" raporu o malı hiç görmez.
//
// ⚠️⚠️ SEÇİLİ SİPARİŞ LİSTEDEN DÜŞEBİLİR ve kutu bunu SÖYLEMEK ZORUNDA. Liste
// tedarikçiye daralıyor: depocu önce siparişi seçip SONRA fişteki tedarikçiyi
// elle değiştirirse seçili id artık `rows` içinde değildir. Kontrollü bir
// `<select>` için bu, ekranda ilk seçeneğin ("Siparişsiz — serbest mal kabul")
// görünmesi ama state'in HÂLÂ o sipariş id'sini taşıması demektir; fiş de o
// siparişe bağlı kaydedilir. Yani ekran "siparişsiz" der, kayıt "siparişli"
// olur — sessiz ve tam ters bir yalan. Bu yüzden düşen seçim için AÇIK bir
// seçenek çizilir ve sebebi yazılır (backend zaten tedarikçi çelişkisini 400
// ile reddeder; kutu o reddi kullanıcının gözü önünde önceden söyler).
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { listPurchaseOrders } from "./service";
import { fmtDate } from "./dates";
import { LIVE_PO_STATUS } from "./PurchaseOrderFilterBar";

/** Seçicide gösterilen en fazla sipariş — açık sipariş sayısı tipik olarak azdır. */
const LIMIT = 200;

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Fişte seçili tedarikçi — verilirse liste ona daraltılır. */
  supplierId?: string | null;
  disabled?: boolean;
  className?: string;
}

export function PurchaseOrderPicker({ value, onChange, supplierId, disabled, className }: Props) {
  const q = useQuery({
    queryKey: ["purchase-orders", "picker", supplierId ?? null],
    queryFn: () =>
      listPurchaseOrders({
        page: 1,
        pageSize: LIMIT,
        status: LIVE_PO_STATUS,
        supplierId: supplierId ?? undefined,
      }),
    staleTime: 30_000,
  });

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination?.total ?? rows.length;
  // Seçim listede yok (tedarikçi daraltması değişti / sipariş kapandı / istek
  // düştü) — kutu boş görünüp id'yi taşımasın diye kendi seçeneğini alır.
  const orphanSelection = Boolean(value) && !q.isLoading && !rows.some((o) => o.id === value);

  return (
    <div className={className}>
      <select
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        value={value ?? ""}
        disabled={disabled || q.isLoading}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">
          {q.isLoading ? "Siparişler yükleniyor…" : "Siparişsiz (serbest mal kabul)"}
        </option>
        {orphanSelection && (
          <option value={value as string}>Seçili sipariş (bu listede görünmüyor)</option>
        )}
        {rows.map((o) => (
          <option key={o.id} value={o.id}>
            {o.orderNo} — {o.supplier?.name ?? "tedarikçisiz"}
            {o.expectedDate ? ` · beklenen ${fmtDate(o.expectedDate)}` : ""}
          </option>
        ))}
      </select>

      {orphanSelection && !q.isError && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">
          Seçili sipariş bu listede değil — büyük ihtimalle fişteki tedarikçi değiştirildi. Fiş bu
          siparişe BAĞLI kaydedilecek; tedarikçiler uyuşmuyorsa sunucu kaydı reddeder. Siparişi
          bırakmak için “Siparişsiz”i seçin.
        </p>
      )}

      {q.isError ? (
        <p className="mt-1 text-[11px] text-destructive">
          Sipariş listesi alınamadı — bu “açık sipariş yok” DEMEK DEĞİLDİR. Fişi siparişe bağlamadan
          kapatırsanız bu mal “ne ısmarladım, ne geldi” raporunda görünmez.
        </p>
      ) : !q.isLoading && rows.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {supplierId
            ? "Bu tedarikçinin açık siparişi yok. Sipariş başka bir tedarikçiye açılmış olabilir."
            : "Açık alış siparişi yok — fiş siparişsiz kaydedilebilir."}
        </p>
      ) : total > rows.length ? (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">
          {total} açık siparişin ilk {rows.length} tanesi listeleniyor. Aradığınızı bulamazsanız önce
          tedarikçiyi seçin.
        </p>
      ) : null}
    </div>
  );
}
