// =============================================================================
// FATURA KAPAMA — "hangi para hangi faturayı kapattı"
// =============================================================================
// Bu ekran İKİ AYRI SORUDAN ikincisini cevaplar:
//   • CARİ BAKİYE  → "bu müşteri bize toplam ne kadar borçlu" (Cari ekranı)
//   • KAPAMA       → "hangi FATURA hâlâ açık" (burası; yaşlandırmanın girdisi)
// Birincisi kapama olmadan da doğrudur; ikincisi ancak faturayla parayı
// eşleyerek cevaplanır.
//
// ⚠️ KAPAMA DEFTERE SATIR YAZMAZ. Cari bakiyesi faturanın ONAYINDA ve tahsilatın
// KAYDINDA zaten oynadı; burada değişen yalnız eşleşmedir. Bu yüzden ekrandaki
// hiçbir metin "bakiye düşecek" demez — öyle deseydi muhasebeci aynı parayı
// ikinci kez arardı.
//
// ⚠️ KURALLAR DAR ve uygunsuz kaynak listede HİÇ GÖSTERİLMEZ: aynı cari, aynı
// para birimi, yön eşleşmesi (Tahsilat ↔ SATIŞ, Ödeme ↔ ALIŞ). Farklı cari
// (mahsuplaşma) ve farklı para birimi (kur farkı) bu sürümde bilinçli olarak
// desteklenmiyor; ikisi de deftere EK SATIR ister. Gösterip 400 aldırmak,
// kullanıcıya var olmayan bir seçenek vaat etmektir.
//
// ⚠️ ÖN KONTROLLER KORUMA DEĞİL, KOLAYLIKTIR. Aşımı reddeden taraf backend'dir
// (ham atomik UPDATE + DB CHECK). Ekran "409 hiç olmaz" GARANTİSİ VERMEZ: aynı
// anda başka biri aynı faturayı kapatabilir ve o durumda uç haklı olarak
// reddeder — mesajı da apiClient interceptor'u OLDUĞU GİBİ basar.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody, PageFooter } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { money, type Currency } from "../service";
import { AllocationFilters } from "./AllocationFilters";
import { AllocationSummaryBar } from "./AllocationSummaryBar";
import { OpenInvoiceTable } from "./OpenInvoiceTable";
import { SourceAllocationsTable } from "./SourceAllocationsTable";
import { SourcePicker } from "./SourcePicker";
import { fromKurus, kurusToInput } from "./allocationMath";
import { useAllocationDraft } from "./useAllocationDraft";
import { useAllocationSources } from "./useAllocationSources";
import {
  allocate,
  allocateBulk,
  BULK_MAX_ITEMS,
  getCari,
  listOpenInvoices,
  type Direction,
  type OpenInvoiceRow,
  type SourceKind,
} from "./service";

/**
 * Sorgu çözülmeden dönen boş liste — SABİT referans.
 * `?? []` her render'da YENİ bir dizi üretir ve o dizi taslak kancasının efekt
 * bağımlılığında; kimliği her render değişince efekt boşuna koşar (bugün
 * zararsız, ama bir gün oraya bir `setState` eklenirse sonsuz döngü olur).
 */
const NO_ROWS: OpenInvoiceRow[] = [];

export function AllocationsPage() {
  const qc = useQueryClient();
  // ⚠️ OKUMA ile YAZMA AYRI İZİN: sayfa `finance:read` ile açılır, kapama yazmak
  // `finance:payment` ister (uçların kendi guard'ları böyle). Ayrım burada da
  // uygulanmazsa salt-okuyan muhasebeci on satır tutar doldurur, sonra kaydet
  // düğmesinin hiç olmadığını görür — yaptığı iş çöpe gider ve sebebini hiçbir
  // yerde okumaz.
  const canWrite = useRoleAccess().hasPermission("finance:payment");
  const [cariId, setCariId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [direction, setDirection] = useState<Direction>("IN");
  const [sourceKind, setSourceKind] = useState<SourceKind>("PAYMENT");
  const [sourceId, setSourceId] = useState<string | null>(null);

  const cariQ = useQuery({
    queryKey: ["finance", "cari", "detail", cariId],
    queryFn: () => getCari(cariId as string),
    enabled: Boolean(cariId),
  });

  // Para birimi carinin VARSAYILANINDAN tohumlanır — en sık doğru cevap odur ve
  // kullanıcı yine değiştirebilir. Yalnız cari DEĞİŞTİĞİNDE yazılır; her veri
  // tazelemesinde yazılsaydı elle seçilen birim sessizce geri alınırdı.
  const seededCariRef = useRef<string | null>(null);
  useEffect(() => {
    const c = cariQ.data;
    if (!c || seededCariRef.current === c.id) return;
    seededCariRef.current = c.id;
    setCurrency(c.defaultCurrency);
  }, [cariQ.data]);

  const {
    items: sources,
    isLoading: sourcesLoading,
    isError: sourcesError,
  } = useAllocationSources({
    cariId,
    currency,
    direction,
    kind: sourceKind,
  });
  const selected = sources.find((s) => s.id === sourceId) ?? null;

  // FIFO önerisi SUNUCUDAN gelir (`amount` verilince satırlara `suggested`
  // eklenir). İstemcide ikinci bir FIFO yazmak, aynı sorunun iki cevabı demekti
  // ve ikisi bir gün ayrışırdı.
  const openQ = useQuery({
    queryKey: [
      "finance",
      "allocations",
      "open-invoices",
      cariId,
      currency,
      direction,
      selected?.freeKurus ?? null,
    ],
    queryFn: () =>
      listOpenInvoices({
        cariId: cariId as string,
        currency,
        direction,
        amount: selected ? kurusToInput(selected.freeKurus) : undefined,
      }),
    enabled: Boolean(cariId),
  });

  const openRows = openQ.data?.data ?? NO_ROWS;
  const draft = useAllocationDraft({
    selected,
    openRows,
    openDataReady: Boolean(openQ.data),
  });

  const freeKurus = selected?.freeKurus ?? 0;
  // ⚠️ SIRA ANLAMLIDIR: yetki en başta sorulur. Yetkisi olmayan kullanıcıya önce
  // "soldan bir belge seçin" demek, sonunda hiçbir şey yapamayacağı bir yola
  // davet etmektir.
  const blockReason = !canWrite
    ? "Kapama yazma yetkiniz yok (finance:payment). Bu ekranı yalnız görüntüleyebilirsiniz."
    : !cariId
      ? "Önce cari hesap seçin."
      : !selected
        ? "Soldan bir belge seçin."
        : draft.items.length === 0
          ? "En az bir faturaya tutar yazın."
          : draft.overCount > 0
            ? `${draft.overCount} satırda yazılan tutar, faturanın açık tutarını aşıyor.`
            : draft.distributedKurus > freeKurus
              ? `Dağıtılan tutar belgenin kalanını ${money(fromKurus(draft.distributedKurus - freeKurus), currency)} aşıyor.`
              : draft.items.length > BULK_MAX_ITEMS
                ? `Tek seferde en fazla ${BULK_MAX_ITEMS} fatura kapatılabilir.`
                : null;

  /** Kapsam değişti: seçili belge ve yazılmış tutarlar artık geçersiz. */
  const resetSelection = () => {
    setSourceId(null);
    draft.clear();
  };

  const submitM = useMutation({
    mutationFn: async (): Promise<{ message?: string }> => {
      if (!selected) throw new Error("Kaynak seçilmedi.");
      const ref =
        selected.kind === "PAYMENT"
          ? { paymentId: selected.id, chequeId: null }
          : { paymentId: null, chequeId: selected.id };
      const only = draft.items[0];
      // Tek satırda TEKİL uç kullanılır: aynı tx gövdesini çağırır (davranış
      // birebir) ama mesajı somuttur — "FT… tamamen kapandı".
      if (draft.items.length === 1 && only) {
        return allocate({ invoiceId: only.invoiceId, ...ref, amount: kurusToInput(only.kurus) });
      }
      // Çoklu dağıtım HEPSİ-YA-HİÇ (uçta da öyle): "1000 TL'yi şu üç faturaya
      // böl" tek bir karardır; üçüncüsü sığmazsa ilk ikisini yazmak kullanıcının
      // hiç istemediği bir dağıtımı kalıcı yapardı.
      return allocateBulk({
        ...ref,
        items: draft.items.map((i) => ({ invoiceId: i.invoiceId, amount: kurusToInput(i.kurus) })),
      });
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Kapama kaydedildi.");
      draft.clear();
    },
    // Hata dalında da tazele: yarışta uç 409 verir ve ekrandaki rakamlar
    // bayattır. `onError` YAZILMAZ — mesajı apiClient interceptor'u basar,
    // ikinci bir toast aynı şeyi iki kez söylerdi.
    onSettled: () => void qc.invalidateQueries({ queryKey: ["finance"] }),
  });

  return (
    <PageShell>
      <PageHeader
        title="Fatura Kapama"
        description="Tahsilat/çek ile faturayı eşleştirir. Cari bakiyeyi DEĞİŞTİRMEZ — yalnız hangi faturanın açık kaldığını belirler."
      />

      <AllocationFilters
        cariId={cariId}
        currency={currency}
        direction={direction}
        cariLabel={
          cariQ.data ? `${cariQ.data.name} · varsayılan ${cariQ.data.defaultCurrency}` : null
        }
        onCariChange={(v) => {
          setCariId(v);
          resetSelection();
        }}
        onCurrencyChange={(v) => {
          setCurrency(v);
          resetSelection();
        }}
        onDirectionChange={(v) => {
          setDirection(v);
          resetSelection();
        }}
      />

      <PageBody className="space-y-6 p-6">
        {!cariId ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Cari hesap seçin. Kapama her zaman TEK bir cari ve TEK bir para birimi
            içinde yapılır; farklı carinin ödemesiyle fatura kapatmak ayrı bir işlemdir
            (mahsuplaşma) ve bu ekranda yapılmaz.
          </div>
        ) : (
          <>
            {/* ⚠️ SARMALAYICILAR `flex … flex-col` OLMAK ZORUNDA — süs değil.
                İki kart da içeride `flex-1 overflow-auto` ile kendi kaydırma
                bölgesini kuruyor, ama bu ancak kartın yüksekliği SINIRLI ise
                çalışır. Düz `max-h-[60vh]` bir blok kabında yükseklik zinciri
                kurmaz: kart doğal (içerik) boyunda kalır, iç kaydırma HİÇ
                devreye girmez ve 30 açık faturada tablo kabından taşıp alttaki
                "daha önce kapatılan faturalar" bölümünün üstüne biner. Flex
                kolonunda ise kart küçültülebilir bir öğedir (`min-h-0` kartın
                kendi sınıfında var) → 60vh'de durur ve içi kayar. */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <div className="flex max-h-[60vh] min-h-0 flex-col">
                <SourcePicker
                  items={sources}
                  isLoading={sourcesLoading}
                  isError={sourcesError}
                  kind={sourceKind}
                  direction={direction}
                  currency={currency}
                  selectedId={sourceId}
                  onKindChange={(k) => {
                    setSourceKind(k);
                    resetSelection();
                  }}
                  // Aynı satıra ikinci kez basmak seçimi BIRAKIR — yanlış belge
                  // seçen kullanıcının çıkışı olmalı.
                  onSelect={(item) => setSourceId(item.id === sourceId ? null : item.id)}
                />
              </div>
              <div className="flex max-h-[60vh] min-h-0 flex-col">
                <OpenInvoiceTable
                  rows={openRows}
                  isLoading={openQ.isLoading}
                  isError={openQ.isError}
                  currency={currency}
                  drafts={draft.drafts}
                  onDraftChange={draft.setDraft}
                  onFillMax={draft.fillMax}
                  disabled={!selected || !canWrite}
                />
              </div>
            </div>

            {selected && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">
                  {selected.docNo} — daha önce kapatılan faturalar
                </h2>
                <SourceAllocationsTable
                  sourceKind={selected.kind}
                  sourceId={selected.id}
                  sourceDocNo={selected.docNo}
                />
              </section>
            )}
          </>
        )}
      </PageBody>

      <PageFooter>
        <AllocationSummaryBar
          currency={currency}
          freeKurus={freeKurus}
          distributedKurus={draft.distributedKurus}
          invoiceCount={draft.items.length}
          blockReason={blockReason}
          isPending={submitM.isPending}
          onSubmit={() => submitM.mutate()}
          onClear={draft.clear}
        />
      </PageFooter>
    </PageShell>
  );
}
