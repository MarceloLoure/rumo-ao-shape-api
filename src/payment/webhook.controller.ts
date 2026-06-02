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
                const taxa = Number(challenge.taxaInscricao);
                const caucao = Number(challenge.valorCaucao);

                if (taxa > 0) {
                  await tx.user.update({
                    where: { id: challenge.creatorId },
                    data: { walletBalance: { increment: taxa } },
                  });
                }

                if (caucao > 0) {
                  await tx.challengeTreasury.upsert({
                    where: { challengeId: challenge.id },
                    update: { totalEscrowed: { increment: caucao } },
                    create: { challengeId: challenge.id, totalEscrowed: caucao },
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

              // 2. Joga o dinheiro da multa direto para o cofre de multas recolhidas (collectedFines)
              await tx.challengeTreasury.upsert({
                where: { challengeId: invoice.challengeId },
                update: { collectedFines: { increment: Number(invoice.value) } },
                create: { challengeId: invoice.challengeId, totalEscrowed: 0, collectedFines: Number(invoice.value) },
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