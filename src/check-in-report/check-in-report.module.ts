import { Module } from '@nestjs/common';
import { CheckInReportService } from './check-in-report.service';
import { CheckInReportController } from './check-in-report.controller';
import { PrismaModule } from '../prisma/prisma.module'; // Ajuste o caminho do seu PrismaModule

@Module({
  imports: [PrismaModule],
  controllers: [CheckInReportController],
  providers: [CheckInReportService],
  exports: [CheckInReportService],
})
export class CheckInReportModule {}