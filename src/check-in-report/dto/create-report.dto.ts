import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateCheckInReportDto {
  @ApiProperty({ example: 'FOTO_REPETIDA', description: 'Motivo predefinido ou título da divergência' })
  @IsNotEmpty()
  @IsString()
  reason: string;

  @ApiPropertyOptional({ example: 'Este monstro usou a mesma foto do treino de ontem, mudou só o filtro!', description: 'Texto explicando a trapaça' })
  @IsOptional()
  @IsString()
  description?: string;
}