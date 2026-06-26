import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChallengeStatus } from '@prisma/client';
import { AsaasService } from 'src/payment/asaas.service';
import { ParticipantStatus, InvoiceType, CheckInStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class ChallengeCronService {
  private readonly logger = new Logger(ChallengeCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasService: AsaasService, // Injetado para gerar o Pix da multa
  ) {}

  // 🕒 Esse Cron roda TODOS OS DIAS à meia-noite (00:00)
  // Durante os testes locais, você pode usar CronExpression.EVERY_10_SECONDS para ver acontecer
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleChallengeTimeline() {
    this.logger.log('🔄 [Cron Linha do Tempo] Iniciando verificação de datas dos desafios...');

    const agora = new Date();

    try {
      // 🚨 TRANSICÃO 1: PENDING -> ACTIVE (Desafios que devem começar hoje)
      // Se a data de início é menor ou igual a "agora" e o status ainda está pendente
      const desafiosParaAtivar = await this.prisma.challenge.updateMany({
        where: {
          status: ChallengeStatus.PENDING,
          startDate: { lte: agora },
        },
        data: {
          status: ChallengeStatus.ACTIVE,
        },
      });

      if (desafiosParaAtivar.count > 0) {
        this.logger.log(`🔥 [Cron] ${desafiosParaAtivar.count} desafios foram ATIVADOS com sucesso!`);
      }

      // 🚨 TRANSICÃO 2: ACTIVE -> FINISHED (Desafios que chegaram ao fim)
      // Se a data de término é menor ou igual a "agora" e o desafio ainda está ativo
      const desafiosParaFinalizar = await this.prisma.challenge.updateMany({
        where: {
          status: ChallengeStatus.ACTIVE,
          endDate: { lte: agora },
        },
        data: {
          status: ChallengeStatus.FINISHED,
        },
      });

      if (desafiosParaFinalizar.count > 0) {
        this.logger.log(`🏆 [Cron] ${desafiosParaFinalizar.count} desafios foram CONCLUÍDOS com sucesso!`);
      }

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Erro ao rodar o Cron de linha do tempo dos desafios:', message);
    }
  }

  // 🕒 Roda todo domingo às 23:59.
  // Para testar local, você pode mudar temporariamente para CronExpression.EVERY_10_SECONDS
  @Cron('59 23 * * 0')
  async handleWeeklyCheckInValidation() {
    this.logger.log('🏋️‍♂️ [Cron Verificação Semanal] Iniciando conferência de metas de treinos...');

    // Calcula o intervalo da semana atual (segunda-feira 00:00 até agora domingo 23:59)
    const agora = new Date();
    const segundaFeira = new Date();
    segundaFeira.setDate(agora.getDate() - ((agora.getDay() + 6) % 7));
    segundaFeira.setHours(0, 0, 0, 0);

    try {
      // 1. Busca todos os desafios que estão rolando (ACTIVE)
      const desafiosAtivos = await this.prisma.challenge.findMany({
        where: { status: ChallengeStatus.ACTIVE },
        include: {
          participants: {
            where: { status: ParticipantStatus.ACTIVE },
            include: { user: true }
          },
        },
      });

      this.logger.log(`🔍 [Cron] Analisando metas para ${desafiosAtivos.length} desafios ativos...`);

      for (const challenge of desafiosAtivos) {
        const metaExigida = challenge.metaSemanal;
        const valorMulta = Number(challenge.valorCaucao);

        for (const participant of challenge.participants) {
          // 2. Conta quantos check-ins VÁLIDOS o monstro fez nesta semana específica
          const totalCheckInsNaSemana = await this.prisma.checkIn.count({
            where: {
              challengeId: challenge.id,
              userId: participant.userId,
              status: CheckInStatus.VALID,
              createdAt: {
                gte: segundaFeira,
                lte: agora,
              },
            },
          });

          // 3. SE NÃO BATEU A META: Hora da punição!
          if (totalCheckInsNaSemana < metaExigida) {
            this.logger.warn(
              `❌ Usuário ${participant.user.name} falhou! Fez ${totalCheckInsNaSemana}/${metaExigida} treinos no desafio "${challenge.title}".`
            );

            // Desafios gratuitos não geram cobrança financeira, apenas alteram status
            if (valorMulta === 0 || challenge.isFree) {
              await this.prisma.participant.update({
                where: { id: participant.id },
                data: { status: ParticipantStatus.PENALIZED },
              });
              continue;
            }

            // Executa a punição financeira em transação isolada para cada usuário falho
            await this.prisma.$transaction(async (tx) => {
              // A) Atualiza a ficha do participante no Postgres
              await tx.participant.update({
                where: { id: participant.id },
                data: {
                  finesPending: { increment: valorMulta },
                  status: ParticipantStatus.PENALIZED, // Joga na geladeira até pagar
                },
              });

              // B) Prepara a Invoice local e chama o Asaas para gerar o Pix
              const localInvoiceId = crypto.randomUUID();
              const descricaoMulta = `Multa Semanal - Desafio: ${challenge.title} (${totalCheckInsNaSemana}/${metaExigida} treinos)`;

              // Garante que o usuário tem cadastro no gateway antes de multar
              let customerId = participant.user.gatewayCustomerId;
              if (!customerId && participant.user.cpf) {
                customerId = await this.asaasService.createCustomer(
                  participant.user.name,
                  participant.user.email,
                  participant.user.cpf
                );
                await tx.user.update({
                  where: { id: participant.userId },
                  data: { gatewayCustomerId: customerId },
                });
              }

              if (customerId) {
                // Dispara a criação da cobrança de multa no Asaas
                const asaasPayment = await this.asaasService.generatePixPayment(
                  customerId,
                  valorMulta,
                  descricaoMulta,
                  localInvoiceId
                );

                // C) Registra a Invoice do tipo WEEKLY_FINE no banco local
                await tx.invoice.create({
                data: {
                  id: localInvoiceId,
                  userId: participant.userId,
                  challengeId: challenge.id,
                  gatewayInvoiceId: asaasPayment.asaasPaymentId,
                  pixCopyPaste: asaasPayment.payload, 
                  pixQrCodeUrl: asaasPayment.encodedImage, 
                  type: InvoiceType.WEEKLY_FINE,
                  status: 'PENDING',
                  value: valorMulta,
                  dueDate: new Date(asaasPayment.expirationDate || Date.now() + 48 * 60 * 60 * 1000), 
                },
              });
              }

              // D) Log de segurança para auditoria
              await tx.auditLog.create({
                data: {
                  userId: participant.userId,
                  action: 'MEMBER_PENALIZED_WEEKLY',
                  description: `Usuário ${participant.user.name} multado em R$ ${valorMulta.toFixed(2)} por fazer apenas ${totalCheckInsNaSemana} de ${metaExigida} treinos exigidos.`,
                },
              });
            });
          }
        }
      }

      this.logger.log('✅ [Cron Verificação Semanal] Processamento de penalidades concluído com sucesso!');
    } catch (error: unknown) {
      this.logger.error('❌ Erro crítico ao rodar validação de check-ins semanais:', (error as Error).message);
    }
  }

}