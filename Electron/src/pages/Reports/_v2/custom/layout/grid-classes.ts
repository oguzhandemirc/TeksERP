// Tailwind sınıfları derlemede taranır — dinamik `md:col-span-${w}` üretilemez, 1..12 burada sabit.
// Dar ekranda (md altı) her blok tam genişlik: sabit piksel yok, ızgara kırılır.
export const GRID_SPAN_CLASS: Record<number, string> = {
  1: "col-span-12 md:col-span-1",
  2: "col-span-12 md:col-span-2",
  3: "col-span-12 md:col-span-3",
  4: "col-span-12 md:col-span-4",
  5: "col-span-12 md:col-span-5",
  6: "col-span-12 md:col-span-6",
  7: "col-span-12 md:col-span-7",
  8: "col-span-12 md:col-span-8",
  9: "col-span-12 md:col-span-9",
  10: "col-span-12 md:col-span-10",
  11: "col-span-12 md:col-span-11",
  12: "col-span-12",
};
