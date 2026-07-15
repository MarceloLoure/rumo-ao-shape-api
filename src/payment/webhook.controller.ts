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
    if (webhookToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
      throw new UnauthorizedException('Token de webhook inválido.');
    }

    const localInvoiceId = body.payment?.externalReference;

    console.log(`🤖 [Webhook Asaas] Evento recebido: ${body.event} | Cobrança: ${body.payment?.id}`);

    if (body.event === 'PAYMENT_CONFIRMED' || body.event === 'PAYMENT_RECEIVED') {
     
      const netValueAsaas = Number(body.payment?.netValue);
      const feeAsaas = Number(body.payment?.fee) || 0;

      if (!localInvoiceId) {
        console.warn('⚠️ Cobrança recebida sem externalReference (ignorado).');
        return { received: true };
      }

      await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: localInvoiceId },
        });

        if (!invoice || invoice.status === 'CONFIRMED') {
          return;
        }

        await tx.invoice.update({
          where: { id: localInvoiceId },
          data: { status: 'CONFIRMED' },
        });

        switch (invoice.type) {
          
          case InvoiceType.CHALLENGE_ENTRY: {
            if (invoice.challengeId) {
              await tx.participant.update({
                where: {
                  challengeId_userId: {
                    challengeId: invoice.challengeId,
                    userId: invoice.userId,
                  },
                },
                data: { status: ParticipantStatus.ACTIVE },
              });

              const challenge = await tx.challenge.findUnique({
                where: { id: invoice.challengeId },
              });

              if (challenge) {
                const taxaInscricaoOriginal = Number(challenge.taxaInscricao);
                
                let taxaCriadorLiquida = taxaInscricaoOriginal;

                if (taxaCriadorLiquida > 0) {
                  await tx.user.update({
                    where: { id: challenge.creatorId },
                    data: { walletBalance: { increment: taxaCriadorLiquida } },
                  });
                }
              }
            }
            break;
          }

          case InvoiceType.WEEKLY_FINE: {
            if (invoice.challengeId) {
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

              await tx.challengeTreasury.upsert({
                where: { challengeId: invoice.challengeId },
                update: { collectedFines: { increment: multaLiquida } },
                create: { challengeId: invoice.challengeId, totalEscrowed: 0, collectedFines: multaLiquida },
              });
            }
            break;
          }

          case InvoiceType.PLAN_SUBSCRIPTION: {
            await tx.user.update({
              where: { id: invoice.userId },
              data: { plan: PlanType.PREMIUM },
            });
            break;
          }

          default:
            console.warn(`⚠️ Tipo de fatura desconhecido ou não tratado: ${invoice.type}`);
        }

        await tx.auditLog.create({
          data: {
            userId: invoice.userId,
            action: `PAYMENT_CONFIRMED_${invoice.type}`,
            description: `Pagamento de R$ ${Number(invoice.value).toFixed(2)} confirmado para o tipo [${invoice.type}]. Conciliação e regras executadas com sucesso.`,
          },
        });
      });
    }

    if (body.event === 'PAYMENT_OVERDUE' || body.event === 'PAYMENT_DELETED' || body.event === 'PAYMENT_CANCELED') {
      const novoStatusFatura = body.event === 'PAYMENT_OVERDUE' ? 'OVERDUE' : 'REFUNDED';

      await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({ where: { id: localInvoiceId } });
        if (!invoice || invoice.status === 'CONFIRMED' || invoice.status === novoStatusFatura) return;

        await tx.invoice.update({
          where: { id: localInvoiceId },
          data: { status: novoStatusFatura as any },
        });

        switch (invoice.type) {
          case InvoiceType.CHALLENGE_ENTRY: {
            if (invoice.challengeId) {
              await tx.participant.deleteMany({
                where: {
                  challengeId: invoice.challengeId,
                  userId: invoice.userId,
                  status: ParticipantStatus.PENDING_PAYMENT,
                },
              });
            }
            break;
          }

          case InvoiceType.WEEKLY_FINE: {
            if (invoice.challengeId) {
              await tx.participant.update({
                where: { challengeId_userId: { challengeId: invoice.challengeId, userId: invoice.userId } },
                data: { status: ParticipantStatus.PENALIZED }, 
              });
            }
            break;
          }

        }

        await tx.auditLog.create({
          data: {
            userId: invoice.userId,
            action: `PAYMENT_FAILED_${body.event}`,
            description: `Cobrança do tipo [${invoice.type}] falhou no gateway (Evento: ${body.event}). Fatura local marcada como ${novoStatusFatura}. Reversões aplicadas.`,
          },
        });
      });
    }

    return { received: true };
  }
}