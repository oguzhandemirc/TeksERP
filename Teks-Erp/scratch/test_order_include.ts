
import prisma from "../src/lib/prisma";
import { Order, OrderLine, Item, ItemVariant } from "@prisma/client";

async function testOrderInclude() {
  const order = await prisma.order.findFirst({
    include: {
      customer: true,
      lines: {
        include: { item: true, variant: true },
      },
    },
  }) as (Order & { lines: (OrderLine & { item: Item, variant: ItemVariant | null })[] }) | null;

  console.log("Order Found:", order ? order.orderNumber : "None");
  if (order && order.lines) {
    console.log("Lines Count:", order.lines.length);
    order.lines.forEach((l, i: number) => {
      console.log(`Line ${i} Variant:`, l.variant ? l.variant.code : "NULL");
    });
  }
}

testOrderInclude().catch(console.error);
