/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `checkins` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "checkins" DROP COLUMN "imageUrl";

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeInBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkInId" TEXT,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_checkInId_key" ON "files"("checkInId");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "checkins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
