-- CreateTable
CREATE TABLE "user_credit_cards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gatewayToken" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "lastFourDigits" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_credit_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_credit_cards_gatewayToken_key" ON "user_credit_cards"("gatewayToken");

-- CreateIndex
CREATE INDEX "user_credit_cards_userId_idx" ON "user_credit_cards"("userId");

-- AddForeignKey
ALTER TABLE "user_credit_cards" ADD CONSTRAINT "user_credit_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
