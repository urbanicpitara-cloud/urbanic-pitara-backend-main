-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundAmount" DECIMAL(10,2),
ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);
