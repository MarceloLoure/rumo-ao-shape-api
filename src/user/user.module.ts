import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PaymentModule } from 'src/payment/payment.module';
import { CheckinModule } from 'src/checkin/checkin.module';

@Module({
  imports: [PaymentModule, CheckinModule],
  providers: [UserService],
  controllers: [UserController]
})
export class UserModule {}
