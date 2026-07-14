import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateChallengeDto {
  @ApiProperty({ example: 'Desafio Projeto Verão 2026', description: 'Título do desafio' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Foco total, 5 treinos por semana ou perde o Pix!', description: 'Descrição das regras' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '7d2698ef-a55a-479f-867f-7d2de1e79d17', description: 'ID do usuário criador' })
  @IsNotEmpty()
  @IsString()
  creatorId: string;

  @ApiProperty({ example: 5, description: 'Qtd de treinos obrigatórios por semana' })
  @IsNotEmpty()
  metaSemanal: number;

  @ApiProperty({ example: 0.00, description: 'Taxa que vai direto para o bolso do criador' })
  @IsNotEmpty()
  taxaInscricao: number;

  @ApiProperty({ example: 50.00, description: 'Valor retido semanalmente no cofre' })
  @IsNotEmpty()
  valorCaucao: number;

  @ApiProperty({ example: '2026-06-01T00:00:00.000Z', description: 'Data de início em formato ISO' })
  @IsNotEmpty()
  @IsString()
  startDate: string;

  @ApiProperty({ example: '2026-06-30T23:59:59.000Z', description: 'Data de término em formato ISO' })
  @IsNotEmpty()
  @IsString()
  endDate: string;

  @ApiPropertyOptional({ example: false, description: 'Define se o desafio é 100% gratuito' })
  @IsOptional()
  isFree?: boolean;

  @ApiProperty({ type: 'string', format: 'binary', description: 'Imagem de capa do desafio' })
  image?: any;

  @ApiPropertyOptional({ example: 'VERAO2026', description: 'Código de convite personalizado (Opcional)' })
  @IsOptional()
  @IsString()
  inviteCode?: string;

  @ApiPropertyOptional({ example: true, description: 'Define se o desafio exige aprovação do admin para novos participantes' })
  @IsOptional()
  requiresApproval?: boolean;
}