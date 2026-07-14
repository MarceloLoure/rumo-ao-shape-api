import { IsUUID, IsNotEmpty } from 'class-validator';

export class SubscribeToPlanDto {
  @IsUUID('4', { message: 'O ID do plano deve ser um UUID válido.' })
  @IsNotEmpty({ message: 'O ID do plano é obrigatório.' })
  planId: string;
}