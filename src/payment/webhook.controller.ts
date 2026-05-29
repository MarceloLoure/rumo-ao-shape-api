import { Controller, Post, Body, Headers, UnauthorizedException, HttpCode, HttpStatus } from '@nestjs/common';
import { ChallengeService } from '../challenge/challenge.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhooks/asaas')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK) // O Asaas exige retorno HTTP 200 para saber que recebemos com sucesso
  async handleAsaasWebhook(
    @Body() body: any,
    @Headers('asaas-access-token') webhookToken: string,
  ) {
    // 1. Trava de segurança: Valida se a requisição veio mesmo do Asaas
    if (webhookToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
      throw new UnauthorizedException('Token de webhook inválido.');
    }

    console.log(`🤖 [Webhook Asaas] Evento recebido: ${body.event} | Cobrança: ${body.payment?.id}`);

    // 2. Nós só queremos processar se o status for PAYMENT_CONFIRMED (Pago) ou PAYMENT_RECEIVED
    if (body.event === 'PAYMENT_CONFIRMED' || body.event === 'PAYMENT_RECEIVED') {
      const localInvoiceId = body.payment?.externalReference; // Lembra do UUID que passamos?

      if (!localInvoiceId) {
        console.warn('⚠️ Cobrança recebida sem externalReference (ignorado).');
        return { received: true };
      }

      // 3. Executa a conciliação bancária dentro de uma transação isolada
      await this.prisma.$transaction(async (tx) => {
        // Busca a fatura local correspondente
        const invoice = await tx.invoice.findUnique({
          where: { id: localInvoiceId },
        });

        // Se a fatura não existir ou já tiver sido confirmada, mata o processo
        if (!invoice || invoice.status === 'CONFIRMED') {
          return;
        }

        // A) Atualiza o status da Fatura para CONFIRMED
        await tx.invoice.update({
          where: { id: localInvoiceId },
          data: { status: 'CONFIRMED' },
        });

        // B) Se a fatura for de entrada em desafio (CHALLENGE_ENTRY)
        if (invoice.type === 'CHALLENGE_ENTRY' && invoice.challengeId) {
          
          // 1. Ativa o infeliz do participante no jogo!
          await tx.participant.update({
            where: {
              challengeId_userId: {
                challengeId: invoice.challengeId,
                userId: invoice.userId,
              },
            },
            data: { status: 'ACTIVE' },
          });

          // 2. Busca o desafio para saber as taxas e o criador
          const challenge = await tx.challenge.findUnique({
            where: { id: invoice.challengeId },
            include: { treasury: true }
          });

          if (challenge) {
            const taxa = Number(challenge.taxaInscricao);
            const caucao = Number(challenge.valorCaucao);

            // 3. Transfere a taxa de inscrição para a carteira interna do CRIADOR da sala
            if (taxa > 0) {
              await tx.user.update({
                where: { id: challenge.creatorId },
                data: { walletBalance: { increment: taxa } },
              });
            }

            // 4. Joga o valor da caução direto para o cofre do grupo (Treasury)
            if (caucao > 0) {
              await tx.challengeTreasury.upsert({
                where: { challengeId: challenge.id },
                update: { totalEscrowed: { increment: caucao } },
                create: { challengeId: challenge.id, totalEscrowed: caucao },
              });
            }
          }
        }

        // C) Cria o Log de Auditoria definitivo de pagamento compensado
        await tx.auditLog.create({
          data: {
            userId: invoice.userId,
            action: 'PAYMENT_CONFIRMED',
            description: `Pagamento de R$ ${Number(invoice.value).toFixed(2)} confirmado via Asaas. Inscrição ativada e saldos distribuídos com sucesso! 💸🏆`,
          },
        });
      });
    }

    return { received: true };
  }
}