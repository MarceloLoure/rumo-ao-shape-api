import { Controller, Get, Post, Body } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';


@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post('plans')
    @ApiTags('Subscriptions')
    @ApiOperation({ summary: 'Criar um novo plano de assinatura' })
    @ApiResponse({ status: 201, description: 'Plano criado com sucesso' })
    @ApiResponse({ status: 400, description: 'Dados inválidos.' })
  create(@Body() dto: CreatePlanDto) {
    return this.subscriptionService.createPlan(dto);
  }

  @Get('plans')
    @ApiOperation({ summary: 'Listar planos de assinatura ativos' })
    @ApiResponse({ status: 200, description: 'Lista de planos retornada com sucesso' })
  findAll() {
    return this.subscriptionService.getActivePlans();
  }
}