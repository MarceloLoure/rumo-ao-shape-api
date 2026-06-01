import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Monstro do Shape Atualizado' })
  name?: string;

  @ApiPropertyOptional({ example: '12345678901', description: 'Apenas números' })
  cpf?: string;
}