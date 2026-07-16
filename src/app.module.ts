import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ChallengeModule } from './challenge/challenge.module';
import { UserModule } from './user/user.module';
import { CheckinModule } from './checkin/checkin.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { PaymentModule } from './payment/payment.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { StorageModule } from './storage/storage.module';
import { CheckInReportModule } from './check-in-report/check-in-report.module';

@Module({
  imports: [ScheduleModule.forRoot(),AuthModule, PrismaModule, StorageModule, ChallengeModule, UserModule, CheckinModule, SubscriptionModule, PaymentModule, CheckInReportModule],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    AppService
  ],
})
export class AppModule {}
