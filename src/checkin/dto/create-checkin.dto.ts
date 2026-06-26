import { IsOptional, IsString, IsNumber, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';


export class CreateCheckInDto {

  @ApiPropertyOptional({ description: 'UUID do usuário que está fazendo o check-in' })
  @IsString()
  userId: string;

  @ApiPropertyOptional({ description: 'UUID do desafio no qual o check-in está sendo feito' })
  @IsString()
  challengeId: string;

  @ApiPropertyOptional({ description: 'Latitude do local do check-in' })
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  latitude: number;

  @ApiPropertyOptional({ description: 'Longitude do local do check-in' })
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  longitude: number;

  @ApiPropertyOptional({ description: 'UUID do dispositivo do usuário (para rastrear dispositivos diferentes)' })
  @IsOptional()
  @IsString()
  deviceUuid: string;

  @ApiPropertyOptional({ example: 'Cardio Concluído' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Corrida de 5km em ritmo moderado.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'RUNNING', description: 'Tipo de esporte praticado' })
  @IsOptional()
  @IsString()
  activity?: string;

  @ApiPropertyOptional({ example: 60, description: 'Duração em minutos' })
  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : null)
  @IsInt()
  @Min(1)
  duration?: number;

  @ApiPropertyOptional({ example: 5.25, description: 'Distância percorrida em km' })
  @IsOptional()
  @Transform(({ value }) => value ? parseFloat(value) : null)
  @IsNumber()
  @Min(0)
  distance?: number;

  @ApiPropertyOptional({ example: 450, description: 'Calorias queimadas' })
  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : null)
  @IsInt()
  @Min(0)
  calories?: number;

  @ApiPropertyOptional({ example: 6500, description: 'Total de passos' })
  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : null)
  @IsInt()
  @Min(0)
  steps?: number;
}