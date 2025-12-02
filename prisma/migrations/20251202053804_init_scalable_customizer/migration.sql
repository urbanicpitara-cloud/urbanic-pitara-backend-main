-- CreateTable
CREATE TABLE "PrintableProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintableProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintableVariant" (
    "id" TEXT NOT NULL,
    "printableProductId" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintableVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintableView" (
    "id" TEXT NOT NULL,
    "printableVariantId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintableView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtAsset" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtCategory_name_key" ON "ArtCategory"("name");

-- AddForeignKey
ALTER TABLE "PrintableVariant" ADD CONSTRAINT "PrintableVariant_printableProductId_fkey" FOREIGN KEY ("printableProductId") REFERENCES "PrintableProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintableView" ADD CONSTRAINT "PrintableView_printableVariantId_fkey" FOREIGN KEY ("printableVariantId") REFERENCES "PrintableVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtAsset" ADD CONSTRAINT "ArtAsset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ArtCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
