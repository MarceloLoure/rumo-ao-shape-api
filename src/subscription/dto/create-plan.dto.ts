export class CreatePlanDto {
  name: string;
  description?: string;
  price: number;
  durationDays: number;
  isActive?: boolean;
  isPromotion?: boolean;
  badgeText?: string;
}