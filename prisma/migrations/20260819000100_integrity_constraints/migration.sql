-- NextMav Procure — database-level integrity.
--
-- Prisma expresses relationships and uniqueness but not value ranges. These are
-- the invariants that must hold no matter which process writes the row: a
-- negative received quantity or a payment for a negative amount is a corruption
-- of the ledger, not a validation message, so the database refuses it.

-- Organization / budget periods -------------------------------------------
ALTER TABLE "Organization" ADD CONSTRAINT "org_fiscal_month_range"
  CHECK ("fiscalYearStartMonth" BETWEEN 1 AND 12);

ALTER TABLE "Budget" ADD CONSTRAINT "budget_total_non_negative"
  CHECK ("totalAmount" >= 0);
ALTER TABLE "Budget" ADD CONSTRAINT "budget_quarter_range"
  CHECK ("fiscalQuarter" IS NULL OR "fiscalQuarter" BETWEEN 1 AND 4);
ALTER TABLE "Budget" ADD CONSTRAINT "budget_fiscal_year_range"
  CHECK ("fiscalYear" BETWEEN 1970 AND 2200);

-- Requests ------------------------------------------------------------------
ALTER TABLE "RequestLineItem" ADD CONSTRAINT "request_line_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "RequestLineItem" ADD CONSTRAINT "request_line_cost_non_negative"
  CHECK ("estimatedCost" >= 0);
ALTER TABLE "RequestLineItem" ADD CONSTRAINT "request_line_tax_rate_range"
  CHECK ("taxRate" BETWEEN 0 AND 100);
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "request_total_non_negative"
  CHECK ("totalEstimated" >= 0);

-- Sourcing ------------------------------------------------------------------
ALTER TABLE "RFQLineItem" ADD CONSTRAINT "rfq_line_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "Quotation" ADD CONSTRAINT "quotation_total_non_negative"
  CHECK ("totalAmount" >= 0);
ALTER TABLE "Quotation" ADD CONSTRAINT "quotation_delivery_days_non_negative"
  CHECK ("deliveryDays" >= 0);
ALTER TABLE "QuotationLineItem" ADD CONSTRAINT "quotation_line_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "QuotationLineItem" ADD CONSTRAINT "quotation_line_price_non_negative"
  CHECK ("unitPrice" >= 0);
ALTER TABLE "RFQAward" ADD CONSTRAINT "award_amount_non_negative"
  CHECK ("awardedAmount" >= 0);

-- Purchase orders -----------------------------------------------------------
ALTER TABLE "POLineItem" ADD CONSTRAINT "po_line_ordered_positive"
  CHECK ("orderedQty" > 0);
ALTER TABLE "POLineItem" ADD CONSTRAINT "po_line_quantities_non_negative"
  CHECK ("receivedQty" >= 0 AND "rejectedQty" >= 0 AND "invoicedQty" >= 0);
ALTER TABLE "POLineItem" ADD CONSTRAINT "po_line_price_non_negative"
  CHECK ("unitPrice" >= 0);
ALTER TABLE "POLineItem" ADD CONSTRAINT "po_line_tax_rate_range"
  CHECK ("taxRate" BETWEEN 0 AND 100);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "po_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "taxAmount" >= 0 AND "discountAmount" >= 0 AND "totalAmount" >= 0);

-- Receiving -----------------------------------------------------------------
-- receivedQty means *accepted*; damaged and rejected units are recorded here but
-- never posted to stock, so all four must be independently non-negative.
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "receipt_line_quantities_non_negative"
  CHECK ("orderedQty" >= 0 AND "receivedQty" >= 0 AND "rejectedQty" >= 0
         AND "damagedQty" >= 0 AND "deliveredQty" >= 0);

-- Invoicing -----------------------------------------------------------------
ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "taxAmount" >= 0 AND "totalAmount" >= 0 AND "paidAmount" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_not_overpaid"
  CHECK ("paidAmount" <= "totalAmount");
ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_due_after_issue"
  CHECK ("dueDate" >= "issueDate");
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "invoice_line_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "invoice_line_price_non_negative"
  CHECK ("unitPrice" >= 0);
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "invoice_line_tax_rate_range"
  CHECK ("taxRate" BETWEEN 0 AND 100);

-- Payments ------------------------------------------------------------------
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive"
  CHECK ("amount" > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "payment_allocation_amount_positive"
  CHECK ("amount" > 0);
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "payment_transaction_amount_positive"
  CHECK ("amount" > 0);

-- Inventory and assets ------------------------------------------------------
ALTER TABLE "InventoryItem" ADD CONSTRAINT "inventory_quantity_non_negative"
  CHECK ("quantity" >= 0 AND "reorderLevel" >= 0 AND "reorderQty" >= 0 AND "unitCost" >= 0);
ALTER TABLE "StockBalance" ADD CONSTRAINT "stock_balance_non_negative"
  CHECK ("quantity" >= 0 AND "reservedQty" >= 0);
ALTER TABLE "Asset" ADD CONSTRAINT "asset_values_non_negative"
  CHECK ("purchaseValue" >= 0 AND "currentValue" >= 0 AND "salvageValue" >= 0);

-- Contracts and vendors -----------------------------------------------------
ALTER TABLE "Contract" ADD CONSTRAINT "contract_period_ordered"
  CHECK ("endDate" > "startDate");
ALTER TABLE "Contract" ADD CONSTRAINT "contract_value_non_negative"
  CHECK ("value" >= 0);
ALTER TABLE "Vendor" ADD CONSTRAINT "vendor_rating_range"
  CHECK ("rating" BETWEEN 0 AND 5);

-- Approvals -----------------------------------------------------------------
ALTER TABLE "ApprovalWorkflowStage" ADD CONSTRAINT "stage_sla_positive"
  CHECK ("slaHours" > 0);
ALTER TABLE "ApprovalWorkflowStage" ADD CONSTRAINT "stage_sequence_non_negative"
  CHECK ("sequence" >= 0);
-- A step belongs to an approval instance or directly to a request; never neither.
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "approval_step_has_subject"
  CHECK ("instanceId" IS NOT NULL OR "requestId" IS NOT NULL);
