-- CreateEnum
CREATE TYPE "SourcingEventType" AS ENUM ('RFQ', 'RFP', 'RFI', 'TENDER', 'DIRECT_AWARD');

-- CreateEnum
CREATE TYPE "SourcingEventStatus" AS ENUM ('DRAFT', 'PLANNING', 'ACTIVE', 'EVALUATION', 'AWARDED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvaluatorRole" AS ENUM ('PROCUREMENT', 'TECHNICAL', 'FINANCE', 'DEPARTMENT', 'EXECUTIVE');

-- CreateEnum
CREATE TYPE "ClarificationVisibility" AS ENUM ('PRIVATE', 'ALL_SUPPLIERS');

-- CreateEnum
CREATE TYPE "ClarificationStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AwardRecommendationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AwardType" AS ENUM ('FULL', 'PARTIAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApprovalEntityType" ADD VALUE 'RFQ';
ALTER TYPE "ApprovalEntityType" ADD VALUE 'AWARD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvaluationCriterionType" ADD VALUE 'TECHNICAL';
ALTER TYPE "EvaluationCriterionType" ADD VALUE 'SERVICE_LEVEL';
ALTER TYPE "EvaluationCriterionType" ADD VALUE 'RISK';

-- AlterEnum
ALTER TYPE "QuotationStatus" ADD VALUE 'SUPERSEDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RFQInvitationStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "RFQInvitationStatus" ADD VALUE 'NO_RESPONSE';

-- AlterEnum
BEGIN;
CREATE TYPE "RFQStatus_new" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED', 'RESPONSE_PERIOD', 'CLOSED', 'UNDER_EVALUATION', 'AWARDED', 'NO_AWARD', 'EXPIRED', 'CANCELLED');
ALTER TABLE "public"."RFQ" ALTER COLUMN "status" DROP DEFAULT;
-- The lifecycle gained the stages the old enum collapsed. Existing rows are
-- mapped onto their equivalent rather than dropped:
--   WAITING    → PUBLISHED        (invitations out, nobody has engaged yet)
--   RECEIVED   → RESPONSE_PERIOD  (at least one supplier has responded)
--   EVALUATING → UNDER_EVALUATION
--   CLOSED     → AWARDED where a quotation was actually selected. A CLOSED RFQ
--                with no selection was closed without an award, which the new
--                enum can finally say out loud.
ALTER TABLE "RFQ" ALTER COLUMN "status" TYPE "RFQStatus_new" USING (
  CASE "status"::text
    WHEN 'WAITING'    THEN 'PUBLISHED'
    WHEN 'RECEIVED'   THEN 'RESPONSE_PERIOD'
    WHEN 'EVALUATING' THEN 'UNDER_EVALUATION'
    WHEN 'CLOSED'     THEN CASE WHEN "selectedQuotationId" IS NOT NULL THEN 'AWARDED' ELSE 'NO_AWARD' END
    ELSE "status"::text
  END
)::"RFQStatus_new";
ALTER TYPE "RFQStatus" RENAME TO "RFQStatus_old";
ALTER TYPE "RFQStatus_new" RENAME TO "RFQStatus";
DROP TYPE "public"."RFQStatus_old";
ALTER TABLE "RFQ" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupplierActivityType" ADD VALUE 'RFQ_VIEWED';
ALTER TYPE "SupplierActivityType" ADD VALUE 'RFQ_ACCEPTED';
ALTER TYPE "SupplierActivityType" ADD VALUE 'RFQ_DECLINED';
ALTER TYPE "SupplierActivityType" ADD VALUE 'QUOTE_DRAFTED';
ALTER TYPE "SupplierActivityType" ADD VALUE 'QUOTE_REVISED';
ALTER TYPE "SupplierActivityType" ADD VALUE 'QUOTE_WITHDRAWN';
ALTER TYPE "SupplierActivityType" ADD VALUE 'CLARIFICATION_ASKED';
ALTER TYPE "SupplierActivityType" ADD VALUE 'CLARIFICATION_ANSWERED';
ALTER TYPE "SupplierActivityType" ADD VALUE 'AWARD_RECEIVED';
ALTER TYPE "SupplierActivityType" ADD VALUE 'AWARD_LOST';

-- DropIndex
DROP INDEX "QuotationScore_quotationId_criterionId_key";

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "quotationNumber" TEXT,
ADD COLUMN     "shippingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "supersedesId" TEXT,
ADD COLUMN     "supplierReference" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "validityDays" INTEGER,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnReason" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "submittedAt" DROP NOT NULL,
ALTER COLUMN "submittedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "QuotationLineItem" ADD COLUMN     "deliveryCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryDays" INTEGER,
ADD COLUMN     "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
ADD COLUMN     "isAlternative" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isNoBid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "QuotationScore" ADD COLUMN     "evaluatorId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RFQ" ADD COLUMN     "allowSupplierRevision" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryTerms" TEXT,
ADD COLUMN     "estimatedValue" DECIMAL(18,4),
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "questionDeadline" TIMESTAMP(3),
ADD COLUMN     "referenceNumber" TEXT,
ADD COLUMN     "requiredDeliveryDate" TIMESTAMP(3),
ADD COLUMN     "showTargetPrice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourcingEventId" TEXT,
ADD COLUMN     "submittedForApprovalAt" TIMESTAMP(3),
ADD COLUMN     "termsAndConditions" TEXT;

-- AlterTable
ALTER TABLE "RFQAward" ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "recommendationId" TEXT,
ADD COLUMN     "type" "AwardType" NOT NULL DEFAULT 'FULL';

-- AlterTable
ALTER TABLE "RFQEvaluationCriterion" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RFQLineItem" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "requestLineItemId" TEXT,
ADD COLUMN     "requiredDeliveryDate" TIMESTAMP(3),
ADD COLUMN     "specification" TEXT,
ADD COLUMN     "targetPrice" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "RFQVendor" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "lastViewedAt" TIMESTAMP(3),
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "revisionAllowedAt" TIMESTAMP(3),
ADD COLUMN     "revisionAllowedById" TEXT,
ADD COLUMN     "revisionReason" TEXT,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SourcingEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requestId" TEXT,
    "categoryId" TEXT,
    "ownerId" TEXT,
    "type" "SourcingEventType" NOT NULL DEFAULT 'RFQ',
    "status" "SourcingEventStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "estimatedValue" DECIMAL(18,4),
    "responseDeadline" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "awardedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQEvaluator" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "EvaluatorRole" NOT NULL DEFAULT 'PROCUREMENT',
    "isChair" BOOLEAN NOT NULL DEFAULT false,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RFQEvaluator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationScoreHistory" (
    "id" TEXT NOT NULL,
    "scoreId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "scoredById" TEXT,
    "scoredAt" TIMESTAMP(3) NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationScoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQClarification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT,
    "askedBySupplierUserId" TEXT,
    "askedByUserId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "visibility" "ClarificationVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "ClarificationStatus" NOT NULL DEFAULT 'OPEN',
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RFQClarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AwardRecommendation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "AwardType" NOT NULL DEFAULT 'FULL',
    "status" "AwardRecommendationStatus" NOT NULL DEFAULT 'DRAFT',
    "recommendedAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "justification" TEXT NOT NULL,
    "evaluationSummary" JSONB,
    "recommendedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwardRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AwardRecommendationItem" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "rfqLineItemId" TEXT,
    "quotationLineItemId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "lineTotal" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "AwardRecommendationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcingEvent_organizationId_idx" ON "SourcingEvent"("organizationId");

-- CreateIndex
CREATE INDEX "SourcingEvent_organizationId_status_idx" ON "SourcingEvent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SourcingEvent_requestId_idx" ON "SourcingEvent"("requestId");

-- CreateIndex
CREATE INDEX "SourcingEvent_categoryId_idx" ON "SourcingEvent"("categoryId");

-- CreateIndex
CREATE INDEX "SourcingEvent_ownerId_idx" ON "SourcingEvent"("ownerId");

-- CreateIndex
CREATE INDEX "SourcingEvent_createdById_idx" ON "SourcingEvent"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingEvent_organizationId_eventNumber_key" ON "SourcingEvent"("organizationId", "eventNumber");

-- CreateIndex
CREATE INDEX "RFQEvaluator_rfqId_idx" ON "RFQEvaluator"("rfqId");

-- CreateIndex
CREATE INDEX "RFQEvaluator_userId_idx" ON "RFQEvaluator"("userId");

-- CreateIndex
CREATE INDEX "RFQEvaluator_assignedById_idx" ON "RFQEvaluator"("assignedById");

-- CreateIndex
CREATE UNIQUE INDEX "RFQEvaluator_rfqId_userId_key" ON "RFQEvaluator"("rfqId", "userId");

-- CreateIndex
CREATE INDEX "QuotationScoreHistory_scoreId_idx" ON "QuotationScoreHistory"("scoreId");

-- CreateIndex
CREATE INDEX "RFQClarification_organizationId_idx" ON "RFQClarification"("organizationId");

-- CreateIndex
CREATE INDEX "RFQClarification_rfqId_idx" ON "RFQClarification"("rfqId");

-- CreateIndex
CREATE INDEX "RFQClarification_rfqId_visibility_idx" ON "RFQClarification"("rfqId", "visibility");

-- CreateIndex
CREATE INDEX "RFQClarification_vendorId_idx" ON "RFQClarification"("vendorId");

-- CreateIndex
CREATE INDEX "RFQClarification_askedBySupplierUserId_idx" ON "RFQClarification"("askedBySupplierUserId");

-- CreateIndex
CREATE INDEX "RFQClarification_askedByUserId_idx" ON "RFQClarification"("askedByUserId");

-- CreateIndex
CREATE INDEX "RFQClarification_answeredById_idx" ON "RFQClarification"("answeredById");

-- CreateIndex
CREATE INDEX "AwardRecommendation_organizationId_idx" ON "AwardRecommendation"("organizationId");

-- CreateIndex
CREATE INDEX "AwardRecommendation_organizationId_status_idx" ON "AwardRecommendation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AwardRecommendation_rfqId_idx" ON "AwardRecommendation"("rfqId");

-- CreateIndex
CREATE INDEX "AwardRecommendation_quotationId_idx" ON "AwardRecommendation"("quotationId");

-- CreateIndex
CREATE INDEX "AwardRecommendation_vendorId_idx" ON "AwardRecommendation"("vendorId");

-- CreateIndex
CREATE INDEX "AwardRecommendation_recommendedById_idx" ON "AwardRecommendation"("recommendedById");

-- CreateIndex
CREATE INDEX "AwardRecommendation_decidedById_idx" ON "AwardRecommendation"("decidedById");

-- CreateIndex
CREATE INDEX "AwardRecommendationItem_recommendationId_idx" ON "AwardRecommendationItem"("recommendationId");

-- CreateIndex
CREATE INDEX "AwardRecommendationItem_rfqLineItemId_idx" ON "AwardRecommendationItem"("rfqLineItemId");

-- CreateIndex
CREATE INDEX "AwardRecommendationItem_quotationLineItemId_idx" ON "AwardRecommendationItem"("quotationLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_supersedesId_key" ON "Quotation"("supersedesId");

-- CreateIndex
CREATE INDEX "Quotation_rfqId_status_idx" ON "Quotation"("rfqId", "status");

-- CreateIndex
CREATE INDEX "Quotation_submittedBySupplierUserId_idx" ON "Quotation"("submittedBySupplierUserId");

-- CreateIndex
CREATE INDEX "QuotationLineItem_rfqLineItemId_idx" ON "QuotationLineItem"("rfqLineItemId");

-- CreateIndex
CREATE INDEX "QuotationScore_evaluatorId_idx" ON "QuotationScore"("evaluatorId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationScore_quotationId_criterionId_evaluatorId_key" ON "QuotationScore"("quotationId", "criterionId", "evaluatorId");

-- CreateIndex
CREATE INDEX "RFQ_sourcingEventId_idx" ON "RFQ"("sourcingEventId");

-- CreateIndex
CREATE INDEX "RFQ_approvedById_idx" ON "RFQ"("approvedById");

-- CreateIndex
CREATE INDEX "RFQ_publishedById_idx" ON "RFQ"("publishedById");

-- CreateIndex
CREATE INDEX "RFQ_closedById_idx" ON "RFQ"("closedById");

-- CreateIndex
CREATE INDEX "RFQAward_approvedById_idx" ON "RFQAward"("approvedById");

-- CreateIndex
CREATE INDEX "RFQAward_recommendationId_idx" ON "RFQAward"("recommendationId");

-- CreateIndex
CREATE INDEX "RFQLineItem_requestLineItemId_idx" ON "RFQLineItem"("requestLineItemId");

-- CreateIndex
CREATE INDEX "RFQVendor_rfqId_status_idx" ON "RFQVendor"("rfqId", "status");

-- CreateIndex
CREATE INDEX "RFQVendor_invitedById_idx" ON "RFQVendor"("invitedById");

-- CreateIndex
CREATE INDEX "RFQVendor_revisionAllowedById_idx" ON "RFQVendor"("revisionAllowedById");

-- AddForeignKey
ALTER TABLE "SourcingEvent" ADD CONSTRAINT "SourcingEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingEvent" ADD CONSTRAINT "SourcingEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingEvent" ADD CONSTRAINT "SourcingEvent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProcurementCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingEvent" ADD CONSTRAINT "SourcingEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingEvent" ADD CONSTRAINT "SourcingEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_sourcingEventId_fkey" FOREIGN KEY ("sourcingEventId") REFERENCES "SourcingEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQLineItem" ADD CONSTRAINT "RFQLineItem_requestLineItemId_fkey" FOREIGN KEY ("requestLineItemId") REFERENCES "RequestLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQVendor" ADD CONSTRAINT "RFQVendor_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQVendor" ADD CONSTRAINT "RFQVendor_revisionAllowedById_fkey" FOREIGN KEY ("revisionAllowedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_submittedBySupplierUserId_fkey" FOREIGN KEY ("submittedBySupplierUserId") REFERENCES "SupplierUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLineItem" ADD CONSTRAINT "QuotationLineItem_rfqLineItemId_fkey" FOREIGN KEY ("rfqLineItemId") REFERENCES "RFQLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQEvaluator" ADD CONSTRAINT "RFQEvaluator_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQEvaluator" ADD CONSTRAINT "RFQEvaluator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQEvaluator" ADD CONSTRAINT "RFQEvaluator_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationScore" ADD CONSTRAINT "QuotationScore_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "RFQEvaluator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationScoreHistory" ADD CONSTRAINT "QuotationScoreHistory_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "QuotationScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQClarification" ADD CONSTRAINT "RFQClarification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQClarification" ADD CONSTRAINT "RFQClarification_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQClarification" ADD CONSTRAINT "RFQClarification_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQClarification" ADD CONSTRAINT "RFQClarification_askedBySupplierUserId_fkey" FOREIGN KEY ("askedBySupplierUserId") REFERENCES "SupplierUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQClarification" ADD CONSTRAINT "RFQClarification_askedByUserId_fkey" FOREIGN KEY ("askedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQClarification" ADD CONSTRAINT "RFQClarification_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendation" ADD CONSTRAINT "AwardRecommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendation" ADD CONSTRAINT "AwardRecommendation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendation" ADD CONSTRAINT "AwardRecommendation_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendation" ADD CONSTRAINT "AwardRecommendation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendation" ADD CONSTRAINT "AwardRecommendation_recommendedById_fkey" FOREIGN KEY ("recommendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendation" ADD CONSTRAINT "AwardRecommendation_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendationItem" ADD CONSTRAINT "AwardRecommendationItem_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "AwardRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendationItem" ADD CONSTRAINT "AwardRecommendationItem_rfqLineItemId_fkey" FOREIGN KEY ("rfqLineItemId") REFERENCES "RFQLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecommendationItem" ADD CONSTRAINT "AwardRecommendationItem_quotationLineItemId_fkey" FOREIGN KEY ("quotationLineItemId") REFERENCES "QuotationLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQAward" ADD CONSTRAINT "RFQAward_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "AwardRecommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQAward" ADD CONSTRAINT "RFQAward_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity the Prisma schema cannot express
-- ---------------------------------------------------------------------------

-- A score is unique per (bid, criterion, evaluator). Postgres treats two NULLs as
-- distinct, so the composite unique alone would let unlimited duplicate rows in
-- for the pre-panel scores whose evaluatorId is NULL. This partial index closes
-- that hole without forcing a backfill of historical rows.
CREATE UNIQUE INDEX IF NOT EXISTS "QuotationScore_legacy_unscoped_key"
  ON "QuotationScore" ("quotationId", "criterionId")
  WHERE "evaluatorId" IS NULL;

-- Weights are percentages of the whole, and a score is bounded by its own maximum.
ALTER TABLE "RFQEvaluationCriterion"
  DROP CONSTRAINT IF EXISTS "rfq_criterion_weight_range",
  ADD CONSTRAINT "rfq_criterion_weight_range" CHECK ("weight" >= 0 AND "weight" <= 100);

ALTER TABLE "RFQEvaluationCriterion"
  DROP CONSTRAINT IF EXISTS "rfq_criterion_max_score_positive",
  ADD CONSTRAINT "rfq_criterion_max_score_positive" CHECK ("maxScore" > 0);

ALTER TABLE "QuotationScore"
  DROP CONSTRAINT IF EXISTS "quotation_score_non_negative",
  ADD CONSTRAINT "quotation_score_non_negative" CHECK ("score" >= 0);

-- Money never goes negative, and a quantity of nothing is not a line item.
ALTER TABLE "QuotationLineItem"
  DROP CONSTRAINT IF EXISTS "quotation_line_amounts_non_negative",
  ADD CONSTRAINT "quotation_line_amounts_non_negative"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0 AND "deliveryCost" >= 0);

ALTER TABLE "RFQLineItem"
  DROP CONSTRAINT IF EXISTS "rfq_line_quantity_positive",
  ADD CONSTRAINT "rfq_line_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "AwardRecommendation"
  DROP CONSTRAINT IF EXISTS "award_recommendation_amount_non_negative",
  ADD CONSTRAINT "award_recommendation_amount_non_negative" CHECK ("recommendedAmount" >= 0);

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Line totals were previously derived on read. They are stored now, so the
-- comparison matrix can be assembled without recomputing every bid.
UPDATE "QuotationLineItem"
SET "lineTotal"  = ROUND("quantity" * "unitPrice", 4),
    "taxAmount"  = ROUND("quantity" * "unitPrice" * "taxRate" / 100, 4)
WHERE "lineTotal" = 0;

-- Quotation money breakdown, reconstructed from the lines that produced the total.
UPDATE "Quotation" q
SET "subtotal"  = COALESCE(l."sub", 0),
    "taxAmount" = COALESCE(l."tax", 0)
FROM (
  SELECT "quotationId",
         SUM("quantity" * "unitPrice")                       AS "sub",
         SUM("quantity" * "unitPrice" * "taxRate" / 100)     AS "tax"
  FROM "QuotationLineItem"
  GROUP BY "quotationId"
) l
WHERE l."quotationId" = q."id" AND q."subtotal" = 0;

-- Every RFQ that ever left draft was, in the old model, published at creation.
UPDATE "RFQ"
SET "publishedAt" = "createdAt"
WHERE "publishedAt" IS NULL AND "status" NOT IN ('DRAFT', 'CANCELLED');

-- Traceability (§36) is retroactive: give every existing RFQ the sourcing event
-- it would have been created under, carrying the same link back to the request.
INSERT INTO "SourcingEvent" (
  "id", "organizationId", "eventNumber", "title", "description", "requestId",
  "categoryId", "ownerId", "type", "status", "currency", "responseDeadline",
  "publishedAt", "awardedAt", "createdById", "createdAt", "updatedAt"
)
SELECT
  'se_' || r."id",
  r."organizationId",
  'SE-' || TO_CHAR(r."createdAt", 'YYYY') || '-' ||
    LPAD(ROW_NUMBER() OVER (PARTITION BY r."organizationId", TO_CHAR(r."createdAt", 'YYYY') ORDER BY r."createdAt", r."id")::text, 4, '0'),
  r."title",
  r."description",
  r."requestId",
  r."categoryId",
  r."createdById",
  'RFQ',
  CASE r."status"::text
    WHEN 'DRAFT'     THEN 'DRAFT'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    WHEN 'AWARDED'   THEN 'AWARDED'
    WHEN 'NO_AWARD'  THEN 'CLOSED'
    WHEN 'UNDER_EVALUATION' THEN 'EVALUATION'
    ELSE 'ACTIVE'
  END::"SourcingEventStatus",
  r."currency",
  r."deadline",
  r."publishedAt",
  r."awardedAt",
  r."createdById",
  r."createdAt",
  r."updatedAt"
FROM "RFQ" r
WHERE r."sourcingEventId" IS NULL;

UPDATE "RFQ" SET "sourcingEventId" = 'se_' || "id" WHERE "sourcingEventId" IS NULL;

-- Keep the event counter ahead of the numbers just inserted, so the first event
-- created through the application does not collide with a backfilled one.
INSERT INTO "DocumentSequence" ("id", "organizationId", "prefix", "period", "lastValue", "updatedAt")
SELECT
  'seq_se_' || e."organizationId" || '_' || SPLIT_PART(e."eventNumber", '-', 2),
  e."organizationId",
  'SE',
  SPLIT_PART(e."eventNumber", '-', 2),
  MAX(SPLIT_PART(e."eventNumber", '-', 3)::int),
  NOW()
FROM "SourcingEvent" e
GROUP BY e."organizationId", SPLIT_PART(e."eventNumber", '-', 2)
ON CONFLICT ("organizationId", "prefix", "period") DO UPDATE
  SET "lastValue" = GREATEST("DocumentSequence"."lastValue", EXCLUDED."lastValue");
