// Ürün penceresi atkı taslağı (B19): üç kip — "none" atkı yok · "new" bu kumaşa yeni atkı (kayıtta kart doğar) ·
// "card" var olan kart (`weftSpecId` form alanında). Kayıtlı kart YALNIZ bu kumaşa aitse yerinde düzenlenir; paylaşılan (ya da
// kullanımı bilinmeyen) kart burada düzenlenmez — "yalnız bu kumaş için kopya" ya da Atkı Kartları ekranı (kullanıcı 2026-11-25).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { countWeftSpecUsers, weftSpecApi } from "@/pages/WeaveDesigns/service";
import { suggestForkCode, suggestForkName } from "@/pages/WeaveDesigns/tabs/weft-fork-defaults";
import { EMPTY_WEFT, weftContentBlank, weftContentReady, type WeftContent } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { weftContentFromSpec } from "@/pages/WeaveDesigns/tabs/WeftSpecEditor";
import type { WeftSpecDetail } from "@/pages/WeaveDesigns/types";

export type WeftMode = "none" | "new" | "card";

export interface ItemWeftDraft {
  mode: WeftMode;
  /** Kip "card" iken seçili kart (form alanının aynası). */
  cardId: string | null;
  /** Düzenlemede kayıtlı kart — içeriği yalnız bunda düzenlenir. */
  savedCardId: string | null;
  content: WeftContent;
  touched: boolean;
  card: WeftSpecDetail | null;
  cardLoading: boolean;
  /** Seçili kartı kullanan ÖTEKİ kumaşlar (bu kumaş sayılmaz); null = henüz/hiç bilinmiyor → paylaşılan sayılır. */
  others: number | null;
  /** "Yalnız bu kumaş için kopya" seçildi: kayıtta kart bu kumaşa kopyalanır (fork), değişiklik kopyaya yazılır. */
  forking: boolean;
  setContent: (c: WeftContent) => void;
  startNew: (prefill?: WeftContent) => void;
  startFork: () => void;
  pickCard: (id: string | null) => void;
  clear: () => void;
}

export function useItemWeftDraft(open: boolean, savedCardId: string | null): ItemWeftDraft {
  const [mode, setMode] = useState<WeftMode>(savedCardId ? "card" : "none");
  const [cardId, setCardId] = useState<string | null>(savedCardId);
  const [content, setContentState] = useState<WeftContent>(EMPTY_WEFT);
  const [touched, setTouched] = useState(false);
  const [forking, setForking] = useState(false);
  useEffect(() => {
    if (!open) return;
    setMode(savedCardId ? "card" : "none");
    setCardId(savedCardId);
    setContentState(EMPTY_WEFT);
    setTouched(false);
    setForking(false);
  }, [open, savedCardId]);
  const cardQ = useQuery({
    queryKey: ["weft-specs", "detail", cardId],
    queryFn: () => weftSpecApi.get(cardId!),
    enabled: open && mode === "card" && !!cardId,
  });
  const usersQ = useQuery({
    queryKey: ["weft-specs", "users", cardId],
    queryFn: () => countWeftSpecUsers(cardId!),
    enabled: open && mode === "card" && !!cardId,
  });
  const others = mode === "card" && cardId
    ? (usersQ.isSuccess ? Math.max(0, usersQ.data - (cardId === savedCardId ? 1 : 0)) : null)
    : 0;
  // Kart içeriği gelince (kullanıcı henüz yazmadıysa) forma.
  useEffect(() => {
    if (mode === "card" && cardQ.data && cardQ.data.id === cardId && !touched) setContentState(weftContentFromSpec(cardQ.data));
  }, [mode, cardId, cardQ.data, touched]);
  const reset = (m: WeftMode, id: string | null) => {
    setMode(m);
    setCardId(id);
    setContentState(EMPTY_WEFT);
    setTouched(false);
    setForking(false);
  };
  return {
    mode,
    cardId,
    savedCardId,
    content,
    touched,
    card: mode === "card" && cardQ.data?.id === cardId ? cardQ.data : null,
    cardLoading: cardQ.isLoading,
    others,
    forking,
    setContent: (c) => {
      setContentState(c);
      setTouched(true);
    },
    startNew: (prefill) => {
      setMode("new");
      setCardId(null);
      setContentState(prefill ?? { ...EMPTY_WEFT, rows: [{ yarnItemId: "", picks: "" }] });
      setTouched(true);
      setForking(false);
    },
    startFork: () => setForking(true),
    pickCard: (id) => reset(id ? "card" : "none", id),
    clear: () => reset("none", null),
  };
}

/** Kayıtlı kart burada (ürün penceresinde) yerinde düzenlenebilir mi: yalnız bu kumaşa ait olduğu BİLİNİYORSA. */
export function cardEditableInPlace(d: Pick<ItemWeftDraft, "others">): boolean {
  return d.others === 0;
}

/** Kayıtta atkı ne yapacak — saf karar (test edilir). */
export type WeftSavePlan =
  | { kind: "none" }
  | { kind: "link"; weftSpecId: string | null }
  | { kind: "create-with-item"; body: Record<string, unknown> }
  | { kind: "attach"; body: Record<string, unknown> }
  /** Yalnız bu kumaşa ait kartın yerinde düzeltmesi (başka kullanan YOK, bilinerek). */
  | { kind: "patch-card"; weftSpecId: string; body: Record<string, unknown> }
  /** Paylaşılan/bilinmeyen kart değişikliği — ortak kart PATCH'lenmez; kayıttan önce kopyaya çevrilir ya da vazgeçilir. */
  | { kind: "shared-card"; weftSpecId: string; body: Record<string, unknown> }
  | { kind: "fork-patch"; sourceId: string; code: string; name: string; body: Record<string, unknown> }
  | { kind: "invalid"; message: string };

/**
 * "Yalnız bu kumaş için kopya": düzenleme kopyaya gider (`fork` tek ayırma yazıcısı, dokuma.md) — önerilen kod/ad
 * Desen > Atkı'daki "Örnek al (yalnız bu desen)" ile aynı; kod doğal idempotency anahtarı (tekrar Kaydet aynı kopyayı bulur).
 */
export function toForkPlan(plan: Extract<WeftSavePlan, { kind: "shared-card" }>, card: { code: string; name: string }, itemCode: string): WeftSavePlan {
  return { kind: "fork-patch", sourceId: plan.weftSpecId, code: suggestForkCode(card.code, itemCode), name: suggestForkName(card.name, itemCode), body: plan.body };
}

const INVALID_MSG = "Atkı: her satırda iplik seçin; sıra kodu yoksa rapordaki adeti girin.";

export function planWeftSave(
  d: Pick<ItemWeftDraft, "mode" | "cardId" | "savedCardId" | "content" | "touched" | "others" | "forking">,
  isEdit: boolean,
  build: (c: WeftContent) => Record<string, unknown>,
): WeftSavePlan {
  if (d.mode === "new") {
    if (weftContentBlank(d.content)) return { kind: "link", weftSpecId: null };
    if (!weftContentReady(d.content)) return { kind: "invalid", message: INVALID_MSG };
    return isEdit ? { kind: "attach", body: build(d.content) } : { kind: "create-with-item", body: build(d.content) };
  }
  if (d.mode === "card" && d.cardId) {
    if (isEdit && d.cardId === d.savedCardId && (d.touched || d.forking)) {
      if (!weftContentReady(d.content)) return { kind: "invalid", message: INVALID_MSG };
      const body = build(d.content);
      if (!d.forking && cardEditableInPlace(d)) return { kind: "patch-card", weftSpecId: d.cardId, body };
      return { kind: "shared-card", weftSpecId: d.cardId, body };
    }
    return { kind: "link", weftSpecId: d.cardId };
  }
  return { kind: "link", weftSpecId: null };
}
