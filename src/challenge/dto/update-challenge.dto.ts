import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateChallengeDto {
  @ApiPropertyOptional({ example: 'Novo Nome do Desafio Verão', description: 'Título atualizado' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Nova descrição atualizada das regras', description: 'Descrição atualizada' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '2026-06-05T00:00:00.000Z', description: 'Nova data de início' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-07-05T23:59:59.000Z', description: 'Nova data de término' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ type: 'string', format: 'binary', description: 'Nova imagem de capa para substituição' })
  image?: any;
}