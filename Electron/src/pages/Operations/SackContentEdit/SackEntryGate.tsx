import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, PackageOpen, Search, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { CUSTOMERLESS_FILTER_VALUE, type SackCustomerBucket } from "./types";

/**
 * Paketleme/Çuvallar GİRİŞ KAPISI (2026-09-04 saha isteği):
 * *"sevkiyat ekranına girerken önüme iki kutucuk gelsin — tüm çuvallar / tüm
 * cariler; cariyi seçince o carinin çuvalları listelensin."*
 *
 * ⚠️ KAPI CARİ KATALOĞU DEĞİL, "elimde kimin malı var" LİSTESİDİR — uç
 * `GET /sack-search/customers` yalnız kapsamda ÇUVALI OLAN carileri döner
 * (ölçüm 2026-09-04: 43 aktif cari ↔ 4'ünün depoda çuvalı var).
 *
 * ⚠️ MÜŞTERİSİZ ÇUVALLAR KAYBOLMAZ: `Sack.customerId` opsiyoneldir ve aynı
 * ölçümde depodaki 9 çuvalın 4'ü müşterisizdi. Bu küme listenin BAŞINDA kendi
 * satırıyla durur ve seçilince `filter[customerId]=none` süzgecine düşer —
 * "cariye göre" akışında sessizce düşen satır BIRAKILMAZ.
 */
export function SackEntryGate({
  onPickAll,
  onPickCustomer,
}: {
  onPickAll: () => void;
  /** `customerId === null` → müşterisiz (genel stok) kovası. */
  onPickCustomer: (bucket: SackCustomerBucket) => void;
}) {
  const [step, setStep] = useState<"choice" | "customers">("choice");

  if (step === "choice") {
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center p-8">
        <div className="w-full max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold">Nasıl devam edelim?</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Depodaki tüm çuvalları listeleyebilir ya da önce cari seçip yalnız o carinin
            çuvallarıyla çalışabilirsiniz.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <GateCard
              icon={PackageOpen}
              title="Tüm Çuvallar"
              description="Depodaki (sevk edilmemiş) bütün çuvallar — müşterisiz genel stok çuvalları dahil."
              onClick={onPickAll}
            />
            <GateCard
              icon={Users}
              title="Tüm Cariler"
              description="Çuvalı olan carileri listele, birini seç → yalnız o carinin çuvalları gelsin."
              onClick={() => setStep("customers")}
            />
          </div>
        </div>
      </div>
    );
  }

  return <CustomerStep onBack={() => setStep("choice")} onPick={onPickCustomer} />;
}

function GateCard({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof PackageOpen;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full flex-col items-start gap-2 rounded-lg border bg-card p-5 text-left transition",
        "hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="rounded-md bg-primary/10 p-2 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-base font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </button>
  );
}

function CustomerStep({
  onBack,
  onPick,
}: {
  onBack: () => void;
  onPick: (bucket: SackCustomerBucket) => void;
}) {
  const [search, setSearch] = useState("");
  // Arama SUNUCUDA (liste ekranıyla aynı kural) — istemci süzmesi Türkçe
  // katlamada sessizce yanlış "sonuç yok" üretir.
  const debounced = useDebouncedValue(search, 300);
  const q = useQuery({
    queryKey: ["sack-search", "customers", debounced.trim()],
    queryFn: () => sackHubService.listSackCustomers({ search: debounced.trim() || undefined }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const warning = q.data?.warnings?.[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <div className="mb-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Geri
        </Button>
        <div className="relative w-72">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari ara (ad ya da kod)…"
            className="h-9 pl-7"
            autoFocus
          />
        </div>
        {q.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {warning && (
        <div className="mb-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          {warning}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
        {q.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {search.trim()
              ? "Bu aramaya uyan, çuvalı olan cari yok."
              : "Depoda çuvalı olan cari yok. 'Tüm Çuvallar' ile devam edebilirsiniz."}
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.customerId ?? "__none__"}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <UserRound
                      className={cn("h-4 w-4 shrink-0", r.customerId ? "text-muted-foreground" : "text-amber-600")}
                    />
                    <span className="truncate font-medium">{r.name}</span>
                    {r.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.code}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.sackCount} çuval</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Kapı seçimini URL süzgecine çevirir — müşterisiz kovası sentinel değere düşer. */
export function customerFilterValue(bucket: SackCustomerBucket): string {
  return bucket.customerId ?? CUSTOMERLESS_FILTER_VALUE;
}

/** Kapıyı atlatan scan-anywhere anahtarları (SacksListView bunları tüketir). */
export const SCAN_SEED_KEYS = ["scanCode", "focusBarcode", "scanCodeDispatched"] as const;

/**
 * Giriş kapısı çizilsin mi? SAF YÜKLEM — bekçi bunu doğrudan ölçer.
 *
 * ⚠️ EKRAN BİR HEDEFLE AÇILDIYSA KAPI SORMAZ. Scan-anywhere
 * (`openTab(path,{state:{scanCode}})`), kayıtlı sekme/görünüm ve genel arama
 * yönlendirmeleri doğrudan LİSTEYE düşer: kapı öne konsaydı `useScanSeed`
 * SacksListView mount olana kadar koşmaz ve operatör okuttuğu barkodun
 * kaybolduğunu görürdü (bu depoda "sessizce düşen" sınıfının aynısı).
 */
export function shouldShowEntryGate(state: unknown, searchParams: URLSearchParams): boolean {
  const st = state as Record<string, unknown> | null;
  if (st && SCAN_SEED_KEYS.some((k) => typeof st[k] === "string")) return false;
  if (searchParams.get("search")) return false;
  for (const k of searchParams.keys()) if (k.startsWith("filter[")) return false;
  return true;
}
