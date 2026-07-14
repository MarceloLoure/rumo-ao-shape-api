import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { AsaasService } from 'src/payment/asaas.service';
import * as crypto from 'crypto';
import { SubscribeToPlanDto } from './dto/SubscribeToPlanDto.dto';



@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasService: AsaasService,
  ) {}

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

  async subscribeToPlan(userId: string, dto: SubscribeToPlanDto) {
    // 1. Busca o plano desejado
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });

    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plano de assinatura não encontrado ou inativo.');
    }

    const price = Number(plan.price);

    // 2. Usando transação para garantir consistência
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      if (user.plan === 'PREMIUM' && price > 0) {
        throw new BadRequestException('Você já possui uma assinatura PREMIUM ativa.');
      }

      // 3. Se for um plano de teste/gratuito (R$ 0.00), ativa imediatamente
      if (price === 0) {
        await tx.user.update({
          where: { id: userId },
          data: { plan: 'PREMIUM' },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'FREE_PLAN_ACTIVATED',
            description: `Plano gratuito "${plan.name}" ativado diretamente para o usuário.`,
          },
        });

        return {
          message: `Plano ${plan.name} ativado com sucesso de forma gratuita! 🎉`,
          status: 'CONFIRMED',
        };
      }

      // 4. Garante que o usuário possua Customer ID no Asaas
      let customerId = user.gatewayCustomerId;
      if (!customerId) {
        if (!user.cpf) {
          throw new BadRequestException(
            'Para assinar um plano pago, você precisa cadastrar seu CPF no seu perfil.'
          );
        }
        customerId = await this.asaasService.createCustomer(user.name, user.email, user.cpf);
        await tx.user.update({
          where: { id: user.id },
          data: { gatewayCustomerId: customerId },
        });
      }

      // 5. Verifica se o usuário já tem alguma invoice de assinatura pendente para evitar cobranças duplicadas
      const existingPendingInvoice = await tx.invoice.findFirst({
        where: {
          userId,
          type: 'PLAN_SUBSCRIPTION',
          status: 'PENDING',
        },
      });

      if (existingPendingInvoice) {
        return {
          message: 'Você já tem uma ordem de pagamento aberta para assinatura! Pague o Pix abaixo.',
          invoice: {
            id: existingPendingInvoice.id,
            value: Number(existingPendingInvoice.value),
            pixCopyPaste: existingPendingInvoice.pixCopyPaste,
            pixQrCodeUrl: existingPendingInvoice.pixQrCodeUrl,
            dueDate: existingPendingInvoice.dueDate,
          },
        };
      }

      // 6. Gerando ID local e criando a cobrança PIX no Asaas
      const localInvoiceId = crypto.randomUUID();
      const description = `Assinatura Plano: ${plan.name} (${plan.durationDays} dias de Premium)`;

      const asaasPayment = await this.asaasService.generatePixPayment(
        customerId,
        price,
        description,
        localInvoiceId,
      );

      // 7. Grava a invoice localmente
      const invoice = await tx.invoice.create({
        data: {
          id: localInvoiceId,
          userId: user.id,
          challengeId: null, // Faturas de plano de assinatura não se vinculam a um desafio
          gatewayInvoiceId: asaasPayment.asaasPaymentId,
          pixCopyPaste: asaasPayment.payload,
          pixQrCodeUrl: asaasPayment.encodedImage,
          type: 'PLAN_SUBSCRIPTION',
          status: 'PENDING',
          value: price,
          dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000), // Assinatura vence rápido (ex: em 2 Horas) para não travar o fluxo do cara
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'SUBSCRIBE_PLAN_PENDING',
          description: `Usuário iniciou contratação do plano "${plan.name}". Cobrança de R$ ${price.toFixed(2)} gerada no Asaas.`,
        },
      });

      return {
        message: 'Fatura de assinatura gerada! Realize o pagamento do PIX para liberar o seu acesso Premium. ⚡🚀',
        invoice: {
          id: invoice.id,
          value: Number(invoice.value),
          pixCopyPaste: invoice.pixCopyPaste,
          pixQrCodeUrl: invoice.pixQrCodeUrl,
          dueDate: invoice.dueDate,
        },
      };
    });
  }
}