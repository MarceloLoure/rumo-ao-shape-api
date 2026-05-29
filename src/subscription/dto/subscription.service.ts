import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePlanDto } from './create-plan.dto';


@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  // Cria um novo plano (Usado por você/Admin no .http)
  async createPlan(dto: CreatePlanDto) {
    if (dto.price < 0 || dto.durationDays <= 0) {
      throw new BadRequestException('Preço ou duração do plano inválidos.');
    }

    return this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        description: dto.description,
        price: Number(dto.price),
        durationDays: Number(dto.durationDays),
        isActive: dto.isActive !== false, // Padrão true
        isPromotion: !!dto.isPromotion,
        badgeText: dto.badgeText,
      },
    });
  }

  // Lista os planos para o App (Retorna apenas os ativos)
  async getActivePlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' }, // Do mais barato ao mais caro
    });
  }
}