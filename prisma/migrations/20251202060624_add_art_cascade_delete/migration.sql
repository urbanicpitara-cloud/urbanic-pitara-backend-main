-- DropForeignKey
ALTER TABLE "public"."ArtAsset" DROP CONSTRAINT "ArtAsset_categoryId_fkey";

-- AddForeignKey
ALTER TABLE "ArtAsset" ADD CONSTRAINT "ArtAsset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ArtCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
