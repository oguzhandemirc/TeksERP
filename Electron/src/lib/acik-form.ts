import { useCallback, useEffect, useRef, useState, type ForwardedRef } from "react";

/**
 * AÇIK / YAZILMIŞ FORM KAYDI — panel güncellemesinin kurulumu bekletip bekletmeyeceğinin TEK kaynağı.
 *
 * Ekran ekran tel çekilmez: iki ortak kaynaktan beslenir.
 *  ① Açık form penceresi: ortak diyalog/yan pencere ilkelleri (`ui/dialog.tsx`, `ui/sheet.tsx`) içeriklerini
 *     `useOpenPaneRef` ile kaydeder; açıkken içinde düzenlenebilir alan varsa sayılır — arka plan sekmesindeki de.
 *  ② Yazılmış form: pencere dışındaki bir `<form>`a yazıldıysa (belge düzeyi `input`/`change` olayı); form DOM'dan
 *     kalkınca ya da `reset` olayında düşer. Form dışındaki alan (liste arama kutusu, süzgeç) sayılmaz.
 * Tutucu yön bilinçli: yanlış "var" kurulumu yalnız erteler (kapanışta yine kurulur), yanlış "yok" girdiyi kaybettirir.
 */

/** Düzenlenebilir alan: gizli/düğme türü, devre dışı ve salt-okunur alanlar sayılmaz. */
export const EDITABLE_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([disabled]):not([readonly])',
  "textarea:not([disabled]):not([readonly])",
  "select:not([disabled])",
  '[contenteditable="true"]',
].join(",");

/** Ortak diyalog/yan pencere ilkellerinin kaydettiği, şu an çizili içerikler. */
const openPanes = new Set<Element>();
const dirtyForms = new Set<Element>();
const subscribers = new Set<() => void>();
let listeningDoc: Document | null = null;

function notify(): void {
  for (const d of subscribers) d();
}

function onFieldInput(e: Event): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  for (const p of openPanes) if (p.contains(target)) return; // ① zaten sayıyor
  const form = target.closest("form");
  if (!form || dirtyForms.has(form)) return;
  dirtyForms.add(form);
  notify();
}

function onFormReset(e: Event): void {
  if (e.target instanceof Element && dirtyForms.delete(e.target)) notify();
}

/** Pencere içeriğini kaydeder; dönen fonksiyon kaydı siler (içerik kapanınca). */
export function registerOpenPane(el: Element): () => void {
  openPanes.add(el);
  notify();
  return () => {
    if (openPanes.delete(el)) notify();
  };
}

/**
 * Ortak ilkelin içerik ref'i: Radix içeriği yalnız açıkken bağlar, kapanınca `null` verir — kayıt bu ömre bağlıdır.
 * Dışarıdan verilen ref de aynen beslenir.
 */
export function useOpenPaneRef<T extends Element>(outerRef: ForwardedRef<T>): (el: T | null) => void {
  const release = useRef<(() => void) | null>(null);
  return useCallback(
    (el: T | null) => {
      release.current?.();
      release.current = el ? registerOpenPane(el) : null;
      if (typeof outerRef === "function") outerRef(el);
      else if (outerRef) outerRef.current = el;
    },
    [outerRef],
  );
}

/** Belge düzeyi dinleyiciyi bir kez kurar (idempotent). */
export function installFormListener(doc: Document = document): void {
  if (listeningDoc === doc) return;
  listeningDoc = doc;
  doc.addEventListener("input", onFieldInput, true);
  doc.addEventListener("change", onFieldInput, true);
  doc.addEventListener("reset", onFormReset, true);
}

/** Kurulumu bekleten formlar (açık pencereler + yazılmış formlar). DOM'dan kalkmış yazılmış form budanır. */
export function formsBlockingInstall(): Element[] {
  for (const f of dirtyForms) if (!f.isConnected) dirtyForms.delete(f);
  for (const p of openPanes) if (!p.isConnected) openPanes.delete(p);
  // Kapanış animasyonundaki içerik (`data-state="closed"`) artık açık değildir.
  const panes = [...openPanes].filter(
    (p) => p.getAttribute("data-state") !== "closed" && p.querySelector(EDITABLE_FIELD_SELECTOR) != null,
  );
  return [...panes, ...dirtyForms];
}

export function hasOpenForm(): boolean {
  return formsBlockingInstall().length > 0;
}

/** Diyalog açılıp kapanması DOM'da olur; ucuz bir yoklama yeter (yalnız kurulum beklerken koşar). */
export const OPEN_FORM_POLL_MS = 1000;

/** `enabled` iken açık/yazılmış form var mı (yoklama + yazım olayı); pasifken `false`. */
export function useHasOpenForm(enabled: boolean): boolean {
  const [present, setPresent] = useState(() => enabled && typeof document !== "undefined" && hasOpenForm());
  // Dinleyici kapı her ekranda çizildiği için açılışta kurulur: paket inmeden ÖNCE yazılan form da sayılsın.
  useEffect(() => installFormListener(), []);
  useEffect(() => {
    if (!enabled) {
      setPresent(false);
      return;
    }
    const measure = () => setPresent(hasOpenForm());
    measure();
    subscribers.add(measure);
    const t = setInterval(measure, OPEN_FORM_POLL_MS);
    return () => {
      subscribers.delete(measure);
      clearInterval(t);
    };
  }, [enabled]);
  return present;
}

/** Yalnız test: kaydı sıfırlar. */
export function resetOpenFormRegistryForTest(): void {
  dirtyForms.clear();
  openPanes.clear();
}
