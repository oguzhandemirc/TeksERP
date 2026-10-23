// Sipariş kalemleri ve cari hareketleri: SUNUCU kimlik süzgeciyle (`siparisId` · `cariHesapId`) okunan listeler.
// Süzgeç yalnız sunucu beyan ettiyse çağrılır (`useListCapability`); istemci listeyi süzmez, değerler fabrikadan.
import { useEffect, useRef } from "react";
import type { ProjectionRecord } from "../../api/wire";
import { formatDate, formatMoney, formatNumber } from "../../lib/format";
import { cariKindLabel, cariTxnSourceLabel, unitLabel } from "../../lib/labels/siparis";
import { ListGroup, ListRow } from "../ListRow";
import { SectionHeader } from "../SectionHeader";
import { asObj, str } from "./OrderRow";
import { ListStates } from "./parts";
import { useRemoteList, type RemoteList } from "./useRemoteList";

/** Ekranın aşağı çekip tazelemesi (`tick` artar) listeyi de yeniden okur; ilk değer okumaz (ilk yükleme kendiliğinden). */
function useReloadOn(tick: number, list: RemoteList): void {
  const seen = useRef(tick);
  useEffect(() => {
    if (seen.current === tick) return;
    seen.current = tick;
    list.reload();
  }, [tick, list]);
}

const present = (v: unknown): boolean => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "");

/** Kalem satırı metinleri: ürün adı (yoksa "—") · renk · miktar + birim; iptal kalemde açık miktar yok. */
export function lineRowText(r: ProjectionRecord) {
  const k = asObj(r.kayit);
  const unit = unitLabel(k.birim);
  const cancelled = str(k.iptalTarihi) !== null;
  // `renkAdi` fabrika 2.15.13+; renksiz kalemde null, eski satırda hiç yok → renk kimliği varsa "—".
  const color = str(k.renkAdi) ?? (str(k.renkId) ? "—" : null);
  const open = !cancelled && present(k.acikMiktar) ? `Açık ${formatNumber(k.acikMiktar)} ${unit}` : null;
  const shipped = present(k.sevkMiktari) ? `Sevk ${formatNumber(k.sevkMiktari)} ${unit}` : null;
  return {
    title: str(k.urunAdi) ?? "—",
    subtitle: [cancelled ? "İptal edildi" : null, color ? `Renk ${color}` : null, shipped, open].filter(Boolean).join(" · ") || undefined,
    value: present(k.miktar) ? `${formatNumber(k.miktar)} ${unit}` : "—",
    cancelled,
  };
}

export function OrderLines({ siparisId, tick = 0 }: { siparisId: string; tick?: number }) {
  const list = useRemoteList("siparis-kalemi", { siparisId }, { tags: ["siparis-kalemi", "siparis"] });
  useReloadOn(tick, list);
  return (
    <>
      {list.items.length > 0 ? (
        <ListGroup testID="siparis-kalemleri">
          {list.items.map((r) => {
            const x = lineRowText(r);
            return (
              <ListRow key={r.id} title={x.title} subtitle={x.subtitle} value={x.value} domain="siparisler" icon="layers-outline" testID={`kalem-${r.id}`} />
            );
          })}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty="Bu siparişin kalemi yok" domain="siparisler" testID="siparis-kalem" />
    </>
  );
}

/** Hareket satırı: kaynak (sözlükten) · tarih · borç/alacak; tutar yalnız `.finans` alt satırı geldiyse. */
export function movementRowText(r: ProjectionRecord) {
  const k = asObj(r.kayit);
  const f = r.finans === undefined || r.finans === null ? null : asObj(r.finans);
  const doviz = str(k.doviz) ?? "TRY";
  // Fabrika satırı tek yönlüdür (borç ya da alacak, diğeri 0): sıfır olmayan taraf gösterilir.
  const side = f && present(f.borc) && Number(f.borc) !== 0 ? { label: "Borç", v: f.borc } : f && present(f.alacak) ? { label: "Alacak", v: f.alacak } : null;
  return {
    title: cariTxnSourceLabel(k.kaynak),
    subtitle: [formatDate(k.tarih), side?.label, str(k.aciklama)].filter(Boolean).join(" · "),
    value: side ? formatMoney(side.v, doviz) : undefined,
  };
}

function AccountMovements({ account, titled, tick }: { account: ProjectionRecord; titled: boolean; tick: number }) {
  const list = useRemoteList("cari-hareket", { cariHesapId: account.id }, { limit: 10, tags: ["cari-hareket", "cari-hesap"] });
  useReloadOn(tick, list);
  return (
    <>
      {titled ? <SectionHeader title={`Son hareketler · ${cariKindLabel(asObj(account.kayit).tur)}`} domain="finans" /> : null}
      {list.items.length > 0 ? (
        <ListGroup testID={`cari-hareketleri-${account.id}`}>
          {list.items.map((r) => {
            const x = movementRowText(r);
            return <ListRow key={r.id} title={x.title} subtitle={x.subtitle} value={x.value} domain="finans" icon="swap-horizontal-outline" testID={`hareket-${r.id}`} />;
          })}
        </ListGroup>
      ) : null}
      <ListStates list={list} empty="Bu hesapta hareket yok" domain="finans" testID={`cari-hareket-${account.id}`} />
    </>
  );
}

/** Carinin her muhasebe hesabı için son hareketler (`cari-hareket` `cariHesapId` taşır, `cariKartId` taşımaz). */
export function CustomerMovements({ accounts, tick = 0 }: { accounts: readonly ProjectionRecord[]; tick?: number }) {
  if (accounts.length === 0) return null;
  return (
    <>
      {accounts.length === 1 ? <SectionHeader title="Son hareketler" domain="finans" /> : null}
      {accounts.map((a) => <AccountMovements key={a.id} account={a} titled={accounts.length > 1} tick={tick} />)}
    </>
  );
}
