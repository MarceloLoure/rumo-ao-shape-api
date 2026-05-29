import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ChallengeModule } from './challenge/challenge.module';
import { UserModule } from './user/user.module';
import { CheckinModule } from './checkin/checkin.module';
import { SubscriptionModule } from './subscription/dto/subscription.module';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [AuthModule, PrismaModule, ChallengeModule, UserModule, CheckinModule, SubscriptionModule, PaymentModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
