import { Controller, Get, Post, Body } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreatePlanDto } from './create-plan.dto';


@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  // Rota para cadastrar novos planos (Admin)
  @Post('plans')
  create(@Body() dto: CreatePlanDto) {
    return this.subscriptionService.createPlan(dto);
  }

  // Rota que o Flutter vai chamar para listar na tela de vendas
  @Get('plans')
  findAll() {
    return this.subscriptionService.getActivePlans();
  }
}