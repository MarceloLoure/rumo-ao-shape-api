import { Controller, Post, Param, Body, Ip, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasService } from './asaas.service';
import { PayCreditCardDto } from './dto/pay-credit-card.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasService: AsaasService,
  ) {}

  @Post('invoice/:id/pay-credit-card')
  @ApiTags('Payments')
  @ApiOperation({ summary: 'Pagar uma fatura com cartão de crédito' })
  @ApiResponse({ status: 200, description: 'Pagamento realizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos.' })
  async payInvoiceWithCard(
    @Param('id') invoiceId: string,
    @Body() dto: PayCreditCardDto,
    @Ip() ip: string,
  ) {
    // 1. Busca a fatura pendente no banco local
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) throw new BadRequestException('Fatura não encontrada.');
    if (invoice.status === 'CONFIRMED') throw new BadRequestException('Esta fatura já está paga.');

    // O Asaas precisa do IP real. Se rodar em localhost, mandamos um IP fictício padrão
    const clientIp = ip === '::1' || ip === '127.0.0.1' ? '186.200.10.20' : ip;

    // 2. Dispara a cobrança no cartão via Asaas
    const asaasResult = await this.asaasService.payWithCreditCard(invoice.gatewayInvoiceId, dto, clientIp);

    // 3. Se o status for aprovado na hora, já rodamos a conciliação atômica direto aqui!
    if (asaasResult.status === 'CONFIRMED' || asaasResult.status === 'RECEIVED') {
      await this.prisma.$transaction(async (tx) => {
        // Atualiza a Fatura
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: 'CONFIRMED' },
        });

        // 2. MÁGICA DA TOKENIZAÇÃO: Se o Asaas devolveu um token de cartão, salva para compras futuras!
        if (asaasResult.creditCardToken) {
            // Verifica se esse token já não foi salvo antes para evitar duplicidade
            const cardExists = await tx.userCreditCard.findUnique({
                where: { gatewayToken: asaasResult.creditCardToken }
            });

            if (!cardExists) {
                await tx.userCreditCard.create({
                data: {
                    userId: invoice.userId,
                    gatewayToken: asaasResult.creditCardToken,
                    brand: asaasResult.creditCardInfo?.creditCardBrand || 'UNKNOWN',
                    lastFourDigits: asaasResult.creditCardInfo?.creditCardNumber || '****',
                }
                });
            }
        }

        // Se for entrada de desafio, ativa o cara e distribui as taxas
        if (invoice.type === 'CHALLENGE_ENTRY' && invoice.challengeId) {
          await tx.participant.update({
            where: {
              challengeId_userId: { challengeId: invoice.challengeId, userId: invoice.userId },
            },
            data: { status: 'ACTIVE' },
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
          }
        }

        // Log de Auditoria do Cartão
        await tx.auditLog.create({
          data: {
            userId: invoice.userId,
            action: 'PAYMENT_CONFIRMED_CREDIT_CARD',
            description: `Pagamento de R$ ${Number(invoice.value).toFixed(2)} confirmado via Cartão de Crédito no Asaas. Inscrição liberada de imediato!`,
          },
        });
      });

      return {
        success: true,
        status: 'CONFIRMED',
        message: 'Pagamento aprovado com sucesso! Você já está no desafio. 💪🔥',
      };
    }

    // Caso caia em análise de risco do Asaas
    return {
      success: true,
      status: asaasResult.status,
      message: 'O pagamento está em análise pelo gateway. Aguarde a liberação.',
    };
  }

  @Post('invoice/:id/pay-saved-card')
  @ApiOperation({ summary: 'Pagar uma fatura com cartão salvo' })
  @ApiResponse({ status: 200, description: 'Pagamento realizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos.' })
    async payWithSavedCard(
    @Param('id') invoiceId: string,
    @Body('cardId') cardId: string,
    @Ip() ip: string,
    ) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new BadRequestException('Fatura não encontrada.');
    if (invoice.status === 'CONFIRMED') throw new BadRequestException('Esta fatura já está paga.');

    // Busca o token do cartão no nosso banco local
    const savedCard = await this.prisma.userCreditCard.findUnique({ where: { id: cardId } });
    if (!savedCard) throw new BadRequestException('Cartão de crédito não encontrado.');

    const clientIp = ip === '::1' || ip === '127.0.0.1' ? '186.200.10.20' : ip;

    try {
        // 🚨 CORRIGIDO: Agora chamamos o método certo, passando os argumentos na ordem exata!
        const asaasResult = await this.asaasService.payWithSavedCardToken(
        invoice.gatewayInvoiceId,
        savedCard.gatewayToken,
        clientIp
        );

        // Se o pagamento for capturado na hora com sucesso
        if (asaasResult.status === 'CONFIRMED' || asaasResult.status === 'RECEIVED') {
        await this.prisma.$transaction(async (tx) => {
            // A) Atualiza o status da Invoice local
            await tx.invoice.update({
            where: { id: invoiceId },
            data: { status: 'CONFIRMED' },
            });

            // B) Se for entrada de desafio, ativa o participante e move os saldos
            if (invoice.type === 'CHALLENGE_ENTRY' && invoice.challengeId) {
            await tx.participant.update({
                where: {
                challengeId_userId: { challengeId: invoice.challengeId, userId: invoice.userId },
                },
                data: { status: 'ACTIVE' },
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

            // C) Cria o Log de Auditoria
            await tx.auditLog.create({
            data: {
                userId: invoice.userId,
                action: 'PAYMENT_CONFIRMED_SAVED_CARD',
                description: `Pagamento de R$ ${Number(invoice.value).toFixed(2)} confirmado usando Cartão Salvo.`,
            },
            });
        });

        return { success: true, message: 'Pago com cartão salvo com sucesso! 💳🚀' };
        }
        
        return { success: true, status: asaasResult.status, message: 'Em análise pelo gateway.' };
    } catch (error: any) {
        // Evita duplicidade de tratamento se o AsaasService já lançou um BadRequestException
        if (error instanceof BadRequestException) throw error;
        
        const asaasError = error.response?.data?.errors?.[0]?.description || 'Erro ao processar cartão salvo.';
        throw new BadRequestException(asaasError);
    }
    }
}