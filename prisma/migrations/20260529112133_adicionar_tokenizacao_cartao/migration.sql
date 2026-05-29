-- DropForeignKey
ALTER TABLE "user_credit_cards" DROP CONSTRAINT "user_credit_cards_userId_fkey";

-- AddForeignKey
ALTER TABLE "user_credit_cards" ADD CONSTRAINT "user_credit_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
