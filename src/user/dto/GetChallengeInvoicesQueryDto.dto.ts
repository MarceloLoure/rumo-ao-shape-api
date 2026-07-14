import { IsOptional, IsEnum, IsInt, Min, Max, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { InvoiceType } from '@prisma/client';

export class GetChallengeInvoicesQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsEnum(InvoiceType, { message: 'Tipo de fatura inválido.' })
  type?: InvoiceType;

  @IsOptional()
  @IsString()
  search?: string;
}