import { Module } from '@nestjs/common';
import { CheckInService } from './checkin.service';
import { CheckInController } from './checkin.controller';
import { FirebaseStorageService } from './firebase-storage.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CheckInController],
  providers: [
    CheckInService, 
    FirebaseStorageService 
  ],
  exports: [
    FirebaseStorageService 
  ]
})
export class CheckinModule {}
