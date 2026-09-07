import { useMemo, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, PackageOpen, Search, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { staggerContainer, staggerItem, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { CUSTOMERLESS_FILTER_VALUE, type SackCustomerBucket } from "./types";

/**
 * Paketleme/Çuvallar GİRİŞ KAPISI (2026-09-04 saha isteği):
 * *"sevkiyat ekranına girerken önüme iki kutucuk gelsin — tüm çuvallar / tüm
 * cariler; cariyi seçince o carinin çuvalları listelensin."*
 *
 * ⚠️ KAPI TÜM CARİLERİ GÖSTERİR — 2026-09-04 (akşam) KULLANICI KARARI.
 * İlk yazımda yalnız kapsamda ÇUVALI OLAN cariler dönüyordu ve gerekçe şu
 * ölçümdü: 43 aktif cariden yalnız 4'ünün depoda çuvalı var, kalan 39 "sonuç
 * yok" verirdi. **Ölçüm doğruydu ama SORU yanlıştı**: kapının işi "bugün elimde
 * kimin malı var" değil, *"hangi cariye çuval açacağım"*. Yeni bir cariye ilk
 * çuvalı açacak personel onu listede bulamıyordu — oysa özelliğin var oluş
 * sebebi "seçtiğin caride sürekli ve kolay çuval açabilmek"ti.
 * Eski davranış kaybolmadı: üstteki **"Yalnız çuvalı olanlar"** anahtarı.
 * ⚠️ 39/43 tuzağı sıralamayla kapatıldı, kesmeyle değil: çuvalı olanlar ÜSTTE
 * (`sackCount desc`, sonra ad) — aradığı cari zaten ilk sıralarda.
 *
 * ⚠️ MÜŞTERİSİZ ÇUVALLAR KAYBOLMAZ: `Sack.customerId` opsiyoneldir ve aynı
 * ölçümde depodaki 9 çuvalın 4'ü müşterisizdi. Bu küme listenin BAŞINDA kendi
 * satırıyla durur ve seçilince `filter[customerId]=none` süzgecine düşer —
 * "cariye göre" akışında sessizce düşen satır BIRAKILMAZ.
 *
 * ⚠️ ADIM DIŞARIDAN SÜRÜLÜR (2026-09-04, saha turu): "cari listesi" adımından
 * çıkış yalnız PageHeader'ın geri okuyla olur — kapının kendi içinde İKİNCİ bir
 * "Geri" düğmesi VARDI ve ekranda iki geri tuşu görünüyordu. Adım burada state
 * olarak yaşasaydı sayfa üstündeki ok onu geri alamazdı.
 */
export type SackGateStep = "choice" | "customers";

export function SackEntryGate({
  step,
  onOpenCustomers,
  onPickAll,
  onPickCustomer,
}: {
  step: SackGateStep;
  onOpenCustomers: () => void;
  onPickAll: () => void;
  /** `customerId === null` → müşterisiz (genel stok) kovası. */
  onPickCustomer: (bucket: SackCustomerBucket) => void;
}) {
  if (step === "choice") {
    return (
      // SOLA DAYALI (ortalanmaz) — programın geri kalanındaki hub/karo
      // yerleşiminin aynısı; ekranda yönlendirme metni YOK (kartlar kendini
      // anlatır, HubCard'ın "açıklama basılmaz" kuralıyla aynı gerekçe).
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="grid w-full max-w-xl grid-cols-1 gap-3 p-6 sm:grid-cols-2"
      >
        <GateCard icon={PackageOpen} title="Tüm Çuvallar" tone="text-primary" onClick={onPickAll} />
        <GateCard icon={Users} title="Tüm Cariler" tone="text-info" onClick={onOpenCustomers} />
      </motion.div>
    );
  }

  return <CustomerStep onPick={onPickCustomer} />;
}

/**
 * Kapı karosu — `components/hub/HubCard.tsx` ile AYNI görsel dil (gradient kart,
 * tonlu ikon chip'i, dev filigran, hover'da sağa kayan ok, YALNIZ başlık).
 * HubCard doğrudan kullanılamaz: o bir ROTAYA gider (`to`), buradaki karolar
 * sayfa içi adım değiştirir. Görsel değişirse ikisi birlikte güncellenir.
 */
function GateCard({
  icon: Icon,
  title,
  tone,
  onClick,
}: {
  icon: typeof PackageOpen;
  title: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <motion.div variants={staggerItem} whileHover={{ y: -3 }} transition={springSnappy} className="relative h-full">
      <button type="button" onClick={onClick} className="group block h-full w-full text-left">
        <Card className="card-glow relative h-full overflow-hidden bg-gradient-to-br from-primary/5 to-transparent p-4">
          <Icon
            aria-hidden
            className={cn(
              "pointer-events-none absolute -bottom-4 -right-3 h-24 w-24 opacity-[0.06] transition-transform duration-300 group-hover:scale-110",
              tone,
            )}
          />
          <div className="relative flex items-start justify-between">
            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-current/10", tone)}>
              <Icon className="h-5 w-5" />
            </div>
            <ArrowRight
              className={cn(
                "h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100",
                tone,
              )}
            />
          </div>
          <div className="relative mt-4">
            <div className="font-medium">{title}</div>
          </div>
        </Card>
      </button>
    </motion.div>
  );
}

function CustomerStep({ onPick }: { onPick: (bucket: SackCustomerBucket) => void }) {
  const [search, setSearch] = useState("");
  // Varsayılan KAPALI = tüm cariler (2026-09-04 kullanıcı kararı).
  const [withSacksOnly, setWithSacksOnly] = useState(false);
  // Arama SUNUCUDA (liste ekranıyla aynı kural) — istemci süzmesi Türkçe
  // katlamada sessizce yanlış "sonuç yok" üretir.
  const debounced = useDebouncedValue(search, 300);
  const terim = debounced.trim();

  // ⚠️ `withSacksOnly` SORGU ANAHTARINDA: yoksa mod değiştiğinde React Query
  // eski cevabı gösterir ve düğme "çalışmıyor" sanılır.
  const q = useInfiniteQuery({
    queryKey: ["sack-search", "customers", terim, withSacksOnly],
    queryFn: ({ pageParam }) =>
      sackHubService.listSackCustomers({
        search: terim || undefined,
        withSacksOnly: withSacksOnly || undefined,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.data?.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const rows = useMemo(
    () => (q.data?.pages ?? []).flatMap((s) => s.data?.items ?? []),
    [q.data],
  );
  const warning = q.data?.pages?.[0]?.warnings?.[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      {/* Geri YOK — sayfa başlığındaki ok bir adım geri alır (tek geri yüzeyi). */}
      <div className="mb-3 flex items-center gap-3">
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
        {/* Eski davranış bir SÜZGEÇ olarak duruyor; varsayılan kapalı. */}
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={withSacksOnly}
            onCheckedChange={(v) => setWithSacksOnly(v === true)}
            aria-label="Yalnız çuvalı olan cariler"
          />
          Yalnız çuvalı olanlar
        </label>
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
            {terim
              ? withSacksOnly
                ? "Bu aramaya uyan, çuvalı olan cari yok. Süzgeci kapatıp tekrar deneyin."
                : "Bu aramaya uyan cari yok."
              : withSacksOnly
                ? "Depoda çuvalı olan cari yok. Süzgeci kapatıp tüm carileri görebilirsiniz."
                : "Kayıtlı cari yok."}
          </div>
        ) : (
          <>
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
                    {/* Çuvalsız cari SOLUK `0 çuval` — sayıyı gizlemek modu
                        değiştiren düğmeyi "bozuk" gösterirdi; kıyaslama sebebi. */}
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        r.sackCount > 0 ? "text-muted-foreground" : "text-muted-foreground/50",
                      )}
                    >
                      {r.sackCount} çuval
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {q.hasNextPage && (
              <div className="p-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={q.isFetchingNextPage}
                  onClick={() => void q.fetchNextPage()}
                >
                  {q.isFetchingNextPage ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Yükleniyor…
                    </>
                  ) : (
                    "Daha fazla göster"
                  )}
                </Button>
              </div>
            )}
          </>
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

  // ⚠️ KAPININ KENDİ YAZDIĞI FİLTRE KAPIYI KAPATMAZ (2026-09-07 saha hatası).
  //
  // Kullanıcı kapıdan bir cari seçiyor → adrese `filter[customerId]` yazılıyor →
  // sekme o adresi hatırlıyor → menüden tekrar girildiğinde kapı "hedefle
  // açıldı" sanıp kendini gizliyor ve SON SEÇİLEN carinin çuvallarını
  // getiriyordu. Operatör başka bir cariye geçmek istediğinde yolu yoktu.
  //
  // Ayrım şu: kapıyı SUSTURAN şey "ekran bir hedefle açıldı" olmalı — okutma
  // tohumu, kayıtlı görünüm, genel aramadan yönlendirme. Kapının KENDİ
  // yazdığı `customerId` bunlardan biri DEĞİL; onu hedef saymak kapıyı tek
  // kullanımlık yapıyordu.
  for (const k of searchParams.keys()) {
    if (!k.startsWith("filter[")) continue;
    if (k === KAPI_FILTRESI) continue;
    return false;
  }
  return true;
}

/** Kapının kendi yazdığı filtre — bunu "hedefle açıldı" saymayız (yukarı bak). */
const KAPI_FILTRESI = "filter[customerId]";
