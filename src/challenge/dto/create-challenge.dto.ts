export class CreateChallengeDto {
  title: string;
  description?: string;
  creatorId: string; // ID do usuário que está criando (Admin)
  metaSemanal: number; // Ex: 3 (três treinos por semana)
  taxaInscricao: number; // Ex: 20.00
  valorCaucao: number; // Ex: 15.00
  startDate: string; // ISO String enviada pelo Flutter
  endDate: string; // ISO String enviada pelo Flutter
  isFree?: boolean;
}