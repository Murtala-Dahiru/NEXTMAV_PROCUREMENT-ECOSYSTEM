// NextMav Procure — quotation arithmetic.
//
// §14 is blunt about this: "Do not rely on manually entered totals where the
// system can calculate them." So no caller — not the supplier portal, not the
// buyer capturing a bid that arrived by email — ever sends a line total or a
// quotation total. They send quantities, unit prices, discounts, tax rates and
// carriage, and this module derives the rest.
//
// It lives on its own rather than inside a service because two services need the
// identical answer. If the supplier portal and the buyer's capture path computed
// totals separately they would eventually disagree, and the bid a supplier
// believes they submitted would differ from the one being compared.
//
// Rounding happens once per line and once per total, at four decimal places to
// match the numeric(18,4) columns. Rounding per line rather than only at the end
// is deliberate: the line totals are shown to both parties and printed on the
// award, so they have to add up to the total exactly rather than approximately.

import { money } from "./db";

/** Four decimal places, matching the column scale. */
const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 10000) / 10000;

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxRate?: number;
  deliveryCost?: number;
  isNoBid?: boolean;
}

export interface LineTotals {
  /** quantity × unit price, before anything is taken off or added on. */
  gross: number;
  discountAmount: number;
  /** gross − discount. The figure tax is charged on. */
  net: number;
  taxAmount: number;
  deliveryCost: number;
  /** net + tax + delivery. What this line actually costs. */
  lineTotal: number;
}

/**
 * Costs one line.
 *
 * A no-bid line is priced at zero regardless of what was sent with it. A supplier
 * declining to quote an item must not be able to move the comparison by leaving a
 * stale price on a line they are not offering.
 */
export function costLine(line: LineInput): LineTotals {
  if (line.isNoBid) {
    return { gross: 0, discountAmount: 0, net: 0, taxAmount: 0, deliveryCost: 0, lineTotal: 0 };
  }

  const gross = round4(line.quantity * line.unitPrice);
  const discountAmount = round4(gross * ((line.discountPercent ?? 0) / 100));
  const net = round4(gross - discountAmount);
  const taxAmount = round4(net * ((line.taxRate ?? 0) / 100));
  const deliveryCost = round4(line.deliveryCost ?? 0);

  return {
    gross,
    discountAmount,
    net,
    taxAmount,
    deliveryCost,
    lineTotal: round4(net + taxAmount + deliveryCost),
  };
}

export interface QuotationTotals {
  subtotal: number;
  /** Line-level discounts plus the header discount. */
  discountAmount: number;
  taxAmount: number;
  /** Line-level carriage plus the header shipping charge. */
  shippingAmount: number;
  totalAmount: number;
  lines: LineTotals[];
}

/**
 * Costs a whole quotation.
 *
 * The header discount is applied after the lines, on the net subtotal, and is
 * NOT re-taxed — it is a concession on the price already computed, not a change
 * to the taxable base of each line. Doing it the other way would mean a buyer
 * negotiating a 5% settlement discount silently reduced the tax the supplier
 * declared, which is not the buyer's to reduce.
 */
export function costQuotation(
  lines: LineInput[],
  header: { discountAmount?: number; shippingAmount?: number } = {}
): QuotationTotals {
  const costed = lines.map(costLine);

  const netSubtotal = round4(costed.reduce((s, l) => s + l.net, 0));
  const lineDiscounts = round4(costed.reduce((s, l) => s + l.discountAmount, 0));
  const taxAmount = round4(costed.reduce((s, l) => s + l.taxAmount, 0));
  const lineDelivery = round4(costed.reduce((s, l) => s + l.deliveryCost, 0));

  const headerDiscount = round4(Math.max(0, header.discountAmount ?? 0));
  const headerShipping = round4(Math.max(0, header.shippingAmount ?? 0));

  const total = round4(netSubtotal + taxAmount + lineDelivery + headerShipping - headerDiscount);

  return {
    subtotal: netSubtotal,
    discountAmount: round4(lineDiscounts + headerDiscount),
    taxAmount,
    shippingAmount: round4(lineDelivery + headerShipping),
    // A discount larger than the bid would produce a negative total, which is not
    // a price. Clamped rather than rejected: the validation that refuses it lives
    // at the service boundary, and this function must stay total.
    totalAmount: money(Math.max(0, total)),
    lines: costed,
  };
}

/**
 * Normalises a bid's price for one RFQ line to a per-unit-of-requested-quantity
 * figure, so bids offering different pack sizes can be compared — §26.
 *
 * Returns null when the supplier did not price the line at all, which the
 * comparison renders as a gap rather than as a zero. A zero would make a
 * non-responsive bid look like the cheapest one.
 */
export function unitRateFor(
  quotedQuantity: number,
  lineTotal: number,
  requestedQuantity: number
): number | null {
  if (quotedQuantity <= 0 || requestedQuantity <= 0) return null;
  return round4(lineTotal / quotedQuantity);
}
