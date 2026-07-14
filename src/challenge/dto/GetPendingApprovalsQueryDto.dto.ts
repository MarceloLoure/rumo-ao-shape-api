import { IsOptional, IsEnum, IsInt, Min, Max, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export enum ApprovalFilterStatus {
  PENDING = 'PENDING', // Mapeia para WAITING_APPROVAL
  APPROVED = 'APPROVED', // Mapeia para ACTIVE
}

export class GetPendingApprovalsQueryDto {
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
  @IsEnum(ApprovalFilterStatus, { message: 'Status de filtro inválido. Use PENDING ou APPROVED.' })
  status: ApprovalFilterStatus = ApprovalFilterStatus.PENDING;

  @IsOptional()
  @IsString()
  search?: string; // Para buscar participante por nome ou e-mail
}