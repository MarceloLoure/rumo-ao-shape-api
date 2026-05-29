/*
  Warnings:

  - A unique constraint covering the columns `[fileId]` on the table `challenges` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "challenges" ADD COLUMN     "fileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "challenges_fileId_key" ON "challenges"("fileId");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
