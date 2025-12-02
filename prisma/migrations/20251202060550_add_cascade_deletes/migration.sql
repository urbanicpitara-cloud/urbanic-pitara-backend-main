-- DropForeignKey
ALTER TABLE "public"."PrintableVariant" DROP CONSTRAINT "PrintableVariant_printableProductId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PrintableView" DROP CONSTRAINT "PrintableView_printableVariantId_fkey";

-- AddForeignKey
ALTER TABLE "PrintableVariant" ADD CONSTRAINT "PrintableVariant_printableProductId_fkey" FOREIGN KEY ("printableProductId") REFERENCES "PrintableProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintableView" ADD CONSTRAINT "PrintableView_printableVariantId_fkey" FOREIGN KEY ("printableVariantId") REFERENCES "PrintableVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
