-- NextMav Procure — vendor lifecycle, compliance and master record.
--
-- Phase 3. Three things happen here, in an order that matters:
--
--   1. PREFERRED stops being a vendor *status*. It was never a stage of a
--      relationship, and modelling it as one meant a preferred supplier did not
--      answer a query for active suppliers. The flag is preserved on the way past:
--      the two rows currently carrying it are parked in a temporary column,
--      re-typed to ACTIVE, and restored into the new `isPreferred` boolean.
--      Losing that distinction would be a silent data loss, so it is carried
--      across explicitly rather than left to a default.
--   2. The enum is rebuilt as a real lifecycle. Postgres cannot drop a member in
--      place, hence the type swap Prisma generated below.
--   3. Compliance becomes evidence rather than a score: VendorComplianceRequirement
--      records one obligation each, and VendorNote holds buyer-side commentary
--      that no supplier session can reach.

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('SUPPLIER', 'MANUFACTURER', 'DISTRIBUTOR', 'CONTRACTOR', 'SERVICE_PROVIDER', 'CONSULTANT', 'OTHER');

-- CreateEnum
CREATE TYPE "VendorBusinessSize" AS ENUM ('MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "VendorComplianceState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT', 'EXPIRED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "VendorRiskStatus" AS ENUM ('UNASSESSED', 'ASSESSED', 'REVIEW_DUE', 'ESCALATED');

-- CreateEnum
CREATE TYPE "VendorContactType" AS ENUM ('GENERAL', 'SALES', 'FINANCE', 'OPERATIONS', 'ACCOUNT_MANAGER', 'EXECUTIVE', 'TECHNICAL', 'SUPPORT');

-- CreateEnum
CREATE TYPE "VendorComplianceType" AS ENUM ('BUSINESS_REGISTRATION', 'TAX_CLEARANCE', 'INSURANCE', 'CERTIFICATION', 'INDUSTRY_LICENCE', 'BANK_VERIFICATION', 'DATA_PROTECTION', 'HEALTH_AND_SAFETY', 'ANTI_BRIBERY', 'OTHER');

-- CreateEnum
CREATE TYPE "VendorComplianceStatus" AS ENUM ('NOT_STARTED', 'PENDING_SUBMISSION', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED', 'WAIVED');

-- CreateEnum
CREATE TYPE "VendorNoteVisibility" AS ENUM ('INTERNAL', 'RESTRICTED');

-- Preserve the PREFERRED flag across the enum rebuild (step 1 above).
ALTER TABLE "Vendor" ADD COLUMN "isPreferred_migrating" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Vendor" SET "isPreferred_migrating" = true WHERE "status" = 'PREFERRED';
UPDATE "Vendor" SET "status" = 'ACTIVE' WHERE "status" = 'PREFERRED';

-- AlterEnum
BEGIN;
CREATE TYPE "VendorStatus_new" AS ENUM ('PROSPECTIVE', 'INVITED', 'ONBOARDING', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'INACTIVE', 'ARCHIVED', 'BLACKLISTED');
ALTER TABLE "public"."Vendor" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Vendor" ALTER COLUMN "status" TYPE "VendorStatus_new" USING ("status"::text::"VendorStatus_new");
ALTER TYPE "VendorStatus" RENAME TO "VendorStatus_old";
ALTER TYPE "VendorStatus_new" RENAME TO "VendorStatus";
DROP TYPE "public"."VendorStatus_old";
ALTER TABLE "Vendor" ALTER COLUMN "status" SET DEFAULT 'PROSPECTIVE';
COMMIT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "businessClassification" TEXT,
ADD COLUMN     "businessSize" "VendorBusinessSize",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "complianceState" "VendorComplianceState" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "country" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedReason" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "incorporatedOn" TIMESTAMP(3),
ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "isPreferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "minimumOrderValue" DECIMAL(18,4),
ADD COLUMN     "onboardingStartedAt" TIMESTAMP(3),
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "riskNextReviewAt" TIMESTAMP(3),
ADD COLUMN     "riskStatus" "VendorRiskStatus" NOT NULL DEFAULT 'UNASSESSED',
ADD COLUMN     "stateRegion" TEXT,
ADD COLUMN     "submittedForReviewAt" TIMESTAMP(3),
ADD COLUMN     "tradingName" TEXT,
ADD COLUMN     "vendorType" "VendorType" NOT NULL DEFAULT 'SUPPLIER';

-- Restore the preferred flag onto the new column, then drop the scaffold.
UPDATE "Vendor" SET "isPreferred" = "isPreferred_migrating";
ALTER TABLE "Vendor" DROP COLUMN "isPreferred_migrating";

-- Vendors already trading keep an honest activation date. Nothing back-fills
-- approvedAt: no approval ever took place for these rows, and inventing one would
-- put a fabricated decision into an audit surface.
UPDATE "Vendor" SET "activatedAt" = "onboardedAt"
WHERE "onboardedAt" IS NOT NULL AND "status" = 'ACTIVE';

-- AlterTable
ALTER TABLE "VendorContact" ADD COLUMN     "department" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "type" "VendorContactType" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "VendorDocument" ADD COLUMN     "documentNumber" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "supersedesId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "uploadedById" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "VendorComplianceRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "VendorComplianceType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "VendorComplianceStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "documentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNotes" TEXT,
    "waivedById" TEXT,
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorComplianceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "visibility" "VendorNoteVisibility" NOT NULL DEFAULT 'INTERNAL',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorComplianceRequirement_organizationId_status_idx" ON "VendorComplianceRequirement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "VendorComplianceRequirement_vendorId_idx" ON "VendorComplianceRequirement"("vendorId");

-- CreateIndex
CREATE INDEX "VendorComplianceRequirement_expiresAt_idx" ON "VendorComplianceRequirement"("expiresAt");

-- CreateIndex
CREATE INDEX "VendorComplianceRequirement_documentId_idx" ON "VendorComplianceRequirement"("documentId");

-- CreateIndex
CREATE INDEX "VendorComplianceRequirement_reviewedById_idx" ON "VendorComplianceRequirement"("reviewedById");

-- CreateIndex
CREATE INDEX "VendorComplianceRequirement_waivedById_idx" ON "VendorComplianceRequirement"("waivedById");

-- CreateIndex
CREATE UNIQUE INDEX "VendorComplianceRequirement_vendorId_type_name_key" ON "VendorComplianceRequirement"("vendorId", "type", "name");

-- CreateIndex
CREATE INDEX "VendorNote_organizationId_idx" ON "VendorNote"("organizationId");

-- CreateIndex
CREATE INDEX "VendorNote_vendorId_createdAt_idx" ON "VendorNote"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorNote_authorId_idx" ON "VendorNote"("authorId");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_complianceState_idx" ON "Vendor"("organizationId", "complianceState");

-- CreateIndex
CREATE INDEX "Vendor_createdById_idx" ON "Vendor"("createdById");

-- CreateIndex
CREATE INDEX "Vendor_approvedById_idx" ON "Vendor"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "VendorDocument_supersedesId_key" ON "VendorDocument"("supersedesId");

-- CreateIndex
CREATE INDEX "VendorDocument_uploadedById_idx" ON "VendorDocument"("uploadedById");

-- CreateIndex
CREATE INDEX "VendorDocument_verifiedById_idx" ON "VendorDocument"("verifiedById");

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorDocument" ADD CONSTRAINT "VendorDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorDocument" ADD CONSTRAINT "VendorDocument_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorDocument" ADD CONSTRAINT "VendorDocument_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "VendorDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorComplianceRequirement" ADD CONSTRAINT "VendorComplianceRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorComplianceRequirement" ADD CONSTRAINT "VendorComplianceRequirement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorComplianceRequirement" ADD CONSTRAINT "VendorComplianceRequirement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "VendorDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorComplianceRequirement" ADD CONSTRAINT "VendorComplianceRequirement_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorComplianceRequirement" ADD CONSTRAINT "VendorComplianceRequirement_waivedById_fkey" FOREIGN KEY ("waivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorNote" ADD CONSTRAINT "VendorNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorNote" ADD CONSTRAINT "VendorNote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorNote" ADD CONSTRAINT "VendorNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

