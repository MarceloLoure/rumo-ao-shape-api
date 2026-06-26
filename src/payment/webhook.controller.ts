import { Controller, Post, Body, Headers, UnauthorizedException, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType, ParticipantStatus, InvoiceType } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';

@Controller('webhooks/asaas')
export class WebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleAsaasWebhook(
    @Body() body: any,
    @Headers('asaas-access-token') webhookToken: string,
  ) {
    // 1. Trava de segurança: Valida se a requisição veio mesmo do Asaas
    if (webhookToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
      throw new UnauthorizedException('Token de webhook inválido.');
    }

    console.log(`🤖 [Webhook Asaas] Evento recebido: ${body.event} | Cobrança: ${body.payment?.id}`);

    // 2. Processa apenas se o status for de pagamento bem-sucedido
    if (body.event === 'PAYMENT_CONFIRMED' || body.event === 'PAYMENT_RECEIVED') {
      const localInvoiceId = body.payment?.externalReference;

      const netValueAsaas = Number(body.payment?.netValue); // Valor real que sobrou
      const feeAsaas = Number(body.payment?.fee) || 0;

      if (!localInvoiceId) {
        console.warn('⚠️ Cobrança recebida sem externalReference (ignorado).');
        return { received: true };
      }

      // 3. Executa a conciliação bancária dentro de uma transação isolada
      await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: localInvoiceId },
        });

        if (!invoice || invoice.status === 'CONFIRMED') {
          return;
        }

        // A) Atualiza o status da Fatura local para CONFIRMED de qualquer forma
        await tx.invoice.update({
          where: { id: localInvoiceId },
          data: { status: 'CONFIRMED' },
        });

        // B) MÁGICA DOS 3 FLUXOS: Divide o comportamento baseado no tipo da Invoice
        switch (invoice.type) {
          
          // ─── CENÁRIO 1: INSCRIÇÃO EM DESAFIO (Seu código original otimizado) ───
          case InvoiceType.CHALLENGE_ENTRY: {
            if (invoice.challengeId) {
              await tx.participant.update({
                where: {
                  challengeId_userId: {
                    challengeId: invoice.challengeId,
                    userId: invoice.userId,
                  },
                },
                data: { status: ParticipantStatus.ACTIVE }, // Usando o Enum real do Prisma
              });

              const challenge = await tx.challenge.findUnique({
                where: { id: invoice.challengeId },
              });

              if (challenge) {
                const taxaInscricaoOriginal = Number(challenge.taxaInscricao);
                const caucaoOriginal = Number(challenge.valorCaucao);
                
                // Se o desafio tem caução, descontamos a taxa do Asaas diretamente do cofre do grupo
                // para que o lucro do Criador do desafio fique protegido!
                let caucaoLiquida = caucaoOriginal - feeAsaas;
                let taxaCriadorLiquida = taxaInscricaoOriginal;

                // Margem de segurança: Se a taxa for maior que a caução por algum motivo, desconta do total
                if (caucaoLiquida < 0) {
                  caucaoLiquida = 0;
                  taxaCriadorLiquida = Math.max(0, netValueAsaas);
                }

                if (taxaCriadorLiquida > 0) {
                  await tx.user.update({
                    where: { id: challenge.creatorId },
                    data: { walletBalance: { increment: taxaCriadorLiquida } },
                  });
                }

                if (caucaoOriginal > 0) {
                  await tx.challengeTreasury.upsert({
                    where: { challengeId: challenge.id },
                    update: { totalEscrowed: { increment: caucaoLiquida } }, // 🚀 Saldo líquido descontado!
                    create: { challengeId: challenge.id, totalEscrowed: caucaoLiquida },
                  });
                }
              }
            }
            break;
          }

          // ─── CENÁRIO 2: PAGAMENTO DE MULTA (Quem faltou no treino e quer voltar) ───
          case InvoiceType.WEEKLY_FINE: {
            if (invoice.challengeId) {
              // 1. Reativa o status do cara para ACTIVE dentro do desafio
              await tx.participant.update({
                where: {
                  challengeId_userId: {
                    challengeId: invoice.challengeId,
                    userId: invoice.userId,
                  },
                },
                data: { status: ParticipantStatus.ACTIVE }, 
              });

              const multaLiquida = netValueAsaas;

              // 2. Joga o dinheiro da multa direto para o cofre de multas recolhidas (collectedFines)
              await tx.challengeTreasury.upsert({
                where: { challengeId: invoice.challengeId },
                update: { collectedFines: { increment: multaLiquida } },
                create: { challengeId: invoice.challengeId, totalEscrowed: 0, collectedFines: multaLiquida },
              });
            }
            break;
          }

          // ─── CENÁRIO 3: COMPRA DE PLANO (Upgrade para PREMIUM) ───
          case InvoiceType.PLAN_SUBSCRIPTION: {
            // Atualiza o plano do infeliz diretamente para PREMIUM no banco local
            await tx.user.update({
              where: { id: invoice.userId },
              data: { plan: PlanType.PREMIUM }, // Altera o enum de FREE para PREMIUM
            });
            break;
          }

          default:
            console.warn(`⚠️ Tipo de fatura desconhecido ou não tratado: ${invoice.type}`);
        }

        // C) Cria o Log de Auditoria definitivo unificado
        await tx.auditLog.create({
          data: {
            userId: invoice.userId,
            action: `PAYMENT_CONFIRMED_${invoice.type}`,
            description: `Pagamento de R$ ${Number(invoice.value).toFixed(2)} confirmado para o tipo [${invoice.type}]. Conciliação e regras executadas com sucesso.`,
          },
        });
      });
    }

    return { received: true };
  }
}