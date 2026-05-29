import { Module } from '@nestjs/common';
import { AsaasService } from './asaas.service';
import { WebhookController } from './webhook.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WebhookController],
  providers: [AsaasService],
  exports: [AsaasService],
})
export class PaymentModule {}