import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class JoinByCodeDto {
  @ApiProperty({ example: 'VERAO2026', description: 'Código de convite do desafio' })
  @IsNotEmpty()
  @IsString()
  inviteCode: string;
}