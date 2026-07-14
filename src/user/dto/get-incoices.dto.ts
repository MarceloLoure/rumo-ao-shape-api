import { IsOptional, IsEnum, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { InvoiceStatus } from '@prisma/client';

export class GetInvoicesQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;

  @IsOptional()
  @IsEnum(InvoiceStatus, { message: 'Status de fatura inválido.' })
  status?: InvoiceStatus;

  @IsOptional()
  @IsDateString({}, { message: 'Data inicial deve ser no formato ISO (YYYY-MM-DD).' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data final deve ser no formato ISO (YYYY-MM-DD).' })
  endDate?: string;
}