import { Module } from '@nestjs/common';
import { ChallengeService } from './challenge.service';
import { ChallengeController } from './challenge.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PaymentModule } from 'src/payment/payment.module';
import { ChallengeCronService } from './challenge-cron.service';

@Module({
  imports: [PrismaModule, PaymentModule],
  providers: [ChallengeService, ChallengeCronService],
  controllers: [ChallengeController]
})
export class ChallengeModule {}
