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

    // 1. Busca todos os desafios ativos. Se ISSO falhar, aí sim não tem o que fazer
    // (não temos nem a lista de trabalho), então abortamos essa rodada específica.
    let desafiosAtivos: import('@prisma/client').Prisma.ChallengeGetPayload<{
      include: {
        participants: {
          include: { user: true }
        }
      }
    }>[] = [];

    try {
      desafiosAtivos = await this.prisma.challenge.findMany({
        where: { status: ChallengeStatus.ACTIVE },
        include: {
          participants: {
            where: { status: ParticipantStatus.ACTIVE },
            include: { user: true },
          },
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        '❌ Não foi possível buscar os desafios ativos. Cron abortado nesta rodada (vai rodar de novo no próximo domingo).',
        (error as Error).message,
      );
      return;
    }

    // 2. Monta uma lista "achatada" de tarefas (1 por participante) em vez de loop aninhado.
    // Isso facilita processar em lote e isolar falha por item.
    const tarefas = desafiosAtivos.flatMap((challenge) =>
      challenge?.participants?.map((participant) => ({ challenge, participant })),
    );

    this.logger.log(
      `🔍 [Cron] Analisando ${tarefas.length} participante(s) em ${desafiosAtivos.length} desafio(s) ativo(s)...`,
    );

    const CONCORRENCIA = 5; // quantos participantes processar em paralelo por lote
    const MAX_TENTATIVAS = 3; // 1 tentativa inicial + 2 retries
    const falhasDefinitivas: { participantId: string; userName: string; challengeTitle: string; erro: string }[] = [];

    // 3. Processa cada tarefa com retry embutido: se falhar, espera um pouco e tenta de novo,
    // sem nunca deixar uma falha derrubar as outras tarefas do lote.
    const processarComRetry = async (tarefa: (typeof tarefas)[number]) => {
      for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        try {
          await this.processarParticipante(tarefa.challenge, tarefa.participant, agora, segundaFeira);
          return; // sucesso — sai e não entra na lista de falhas
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          if (tentativa < MAX_TENTATIVAS) {
            this.logger.warn(
              `⚠️ Tentativa ${tentativa}/${MAX_TENTATIVAS} falhou para ${tarefa.participant.user.name} (desafio "${tarefa.challenge.title}"): ${msg}. Tentando de novo em breve...`,
            );
            await this.sleep(1000 * tentativa); // backoff simples: 1s, 2s...
          } else {
            this.logger.error(
              `❌ Esgotadas as ${MAX_TENTATIVAS} tentativas para ${tarefa.participant.user.name} (desafio "${tarefa.challenge.title}"): ${msg}`,
            );
            falhasDefinitivas.push({
              participantId: tarefa.participant.id,
              userName: tarefa.participant.user.name,
              challengeTitle: tarefa.challenge.title,
              erro: msg,
            });
          }
        }
      }
    };

    // 4. Roda em lotes de CONCORRENCIA tarefas por vez, ao invés de 1-a-1 (lento) ou tudo de uma vez
    // (sobrecarrega o Asaas e o pool de conexões do banco).
    for (let i = 0; i < tarefas.length; i += CONCORRENCIA) {
      const lote = tarefas.slice(i, i + CONCORRENCIA);
      await Promise.all(lote.map(processarComRetry));
    }

    // 5. Quem não deu certo mesmo depois dos retries fica registrado pra intervenção manual —
    // nunca fica "invisível". Esse insert é best-effort: se até isso falhar, só logamos.
    if (falhasDefinitivas.length > 0) {
      this.logger.error(
        `🚨 ${falhasDefinitivas.length} participante(s) não puderam ser processados nesta rodada mesmo após retries.`,
      );
      try {
        await this.prisma.auditLog.create({
          data: {
            userId: null,
            action: 'WEEKLY_FINE_CRON_FAILURES',
            description: `Falha ao processar ${falhasDefinitivas.length} participante(s) no cron semanal: ${JSON.stringify(
              falhasDefinitivas,
            )}`,
          },
        });
      } catch (error: unknown) {
        this.logger.error(
          '❌ Nem o log de auditoria das falhas foi possível salvar. Verificar manualmente.',
          (error as Error).message,
        );
      }
    }

    this.logger.log(
      `✅ [Cron Verificação Semanal] Concluído. ${tarefas.length - falhasDefinitivas.length}/${tarefas.length} participante(s) processados com sucesso.`,
    );
  }

  // Processa um único participante: conta check-ins da semana e aplica a punição (status e/ou multa) se necessário.
  // Lança exceção em caso de erro para que o chamador (com retry) possa decidir o que fazer — nunca engole o erro aqui.
  private async processarParticipante(
    challenge: { id: string; title: string; metaSemanal: number; valorCaucao: unknown; valorMulta: unknown; isFree: boolean },
    participant: { id: string; userId: string; user: { name: string; email: string; cpf: string | null; gatewayCustomerId: string | null } },
    agora: Date,
    segundaFeira: Date,
  ): Promise<void> {
    const metaExigida = challenge.metaSemanal;
    const valorMulta = Number(challenge.valorMulta);

    // 1. Conta quantos check-ins VÁLIDOS o participante fez nesta semana específica
    const totalCheckInsNaSemana = await this.prisma.checkIn.count({
      where: {
        challengeId: challenge.id,
        userId: participant.userId,
        status: CheckInStatus.VALID,
        createdAt: { gte: segundaFeira, lte: agora },
      },
    });

    if (totalCheckInsNaSemana >= metaExigida) {
      return; // bateu a meta, nada a fazer
    }

    this.logger.warn(
      `❌ Usuário ${participant.user.name} falhou! Fez ${totalCheckInsNaSemana}/${metaExigida} treinos no desafio "${challenge.title}".`,
    );

    // Desafios gratuitos não geram cobrança financeira, apenas alteram status
    if (challenge.isFree) {
      await this.prisma.participant.update({
        where: { id: participant.id },
        data: { status: ParticipantStatus.PENALIZED },
      });
      return;
    }

    // 2. Guarda de idempotência: se já existe uma multa (invoice WEEKLY_FINE) gerada pra esse
    // participante nesta mesma semana, não gera outra. Isso protege contra cobrança duplicada
    // no caso de um retry acontecer depois que o Asaas já tinha aceitado a cobrança anterior.
    const invoiceJaExiste = await this.prisma.invoice.findFirst({
      where: {
        userId: participant.userId,
        challengeId: challenge.id,
        type: InvoiceType.WEEKLY_FINE,
        createdAt: { gte: segundaFeira },
      },
    });

    if (invoiceJaExiste) {
      this.logger.log(
        `ℹ️ Já existe multa registrada para ${participant.user.name} nesta semana (invoice ${invoiceJaExiste.id}). Pulando geração duplicada.`,
      );
      return;
    }

    // Executa a punição financeira em transação isolada para este usuário
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
          participant.user.cpf,
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
          localInvoiceId,
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}


// import { Injectable, Logger } from '@nestjs/common';
// import { Cron, CronExpression } from '@nestjs/schedule';
// import { PrismaService } from '../prisma/prisma.service';
// import { ChallengeStatus } from '@prisma/client';
// import { AsaasService } from 'src/payment/asaas.service';
// import { ParticipantStatus, InvoiceType, CheckInStatus } from '@prisma/client';
// import * as crypto from 'crypto';

// @Injectable()
// export class ChallengeCronService {
//   private readonly logger = new Logger(ChallengeCronService.name);

//   constructor(
//     private readonly prisma: PrismaService,
//     private readonly asaasService: AsaasService, // Injetado para gerar o Pix da multa
//   ) {}

//   // 🕒 Esse Cron roda TODOS OS DIAS à meia-noite (00:00)
//   // Durante os testes locais, você pode usar CronExpression.EVERY_10_SECONDS para ver acontecer
//   @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
//   async handleChallengeTimeline() {
//     this.logger.log('🔄 [Cron Linha do Tempo] Iniciando verificação de datas dos desafios...');

//     const agora = new Date();

//     try {
//       // 🚨 TRANSICÃO 1: PENDING -> ACTIVE (Desafios que devem começar hoje)
//       // Se a data de início é menor ou igual a "agora" e o status ainda está pendente
//       const desafiosParaAtivar = await this.prisma.challenge.updateMany({
//         where: {
//           status: ChallengeStatus.PENDING,
//           startDate: { lte: agora },
//         },
//         data: {
//           status: ChallengeStatus.ACTIVE,
//         },
//       });

//       if (desafiosParaAtivar.count > 0) {
//         this.logger.log(`🔥 [Cron] ${desafiosParaAtivar.count} desafios foram ATIVADOS com sucesso!`);
//       }

//       // 🚨 TRANSICÃO 2: ACTIVE -> FINISHED (Desafios que chegaram ao fim)
//       // Se a data de término é menor ou igual a "agora" e o desafio ainda está ativo
//       const desafiosParaFinalizar = await this.prisma.challenge.updateMany({
//         where: {
//           status: ChallengeStatus.ACTIVE,
//           endDate: { lte: agora },
//         },
//         data: {
//           status: ChallengeStatus.FINISHED,
//         },
//       });

//       if (desafiosParaFinalizar.count > 0) {
//         this.logger.log(`🏆 [Cron] ${desafiosParaFinalizar.count} desafios foram CONCLUÍDOS com sucesso!`);
//       }

//     } catch (error: unknown) {
//       const message = error instanceof Error ? error.message : String(error);
//       this.logger.error('❌ Erro ao rodar o Cron de linha do tempo dos desafios:', message);
//     }
//   }

//   // 🕒 Roda todo domingo às 23:59.
//   // Para testar local, você pode mudar temporariamente para CronExpression.EVERY_10_SECONDS
//   @Cron('59 23 * * 0')
//   async handleWeeklyCheckInValidation() {
//     this.logger.log('🏋️‍♂️ [Cron Verificação Semanal] Iniciando conferência de metas de treinos...');

//     // Calcula o intervalo da semana atual (segunda-feira 00:00 até agora domingo 23:59)
//     const agora = new Date();
//     const segundaFeira = new Date();
//     segundaFeira.setDate(agora.getDate() - ((agora.getDay() + 6) % 7));
//     segundaFeira.setHours(0, 0, 0, 0);

//     try {
//       // 1. Busca todos os desafios que estão rolando (ACTIVE)
//       const desafiosAtivos = await this.prisma.challenge.findMany({
//         where: { status: ChallengeStatus.ACTIVE },
//         include: {
//           participants: {
//             where: { status: ParticipantStatus.ACTIVE },
//             include: { user: true }
//           },
//         },
//       });

//       this.logger.log(`🔍 [Cron] Analisando metas para ${desafiosAtivos.length} desafios ativos...`);

//       for (const challenge of desafiosAtivos) {
//         const metaExigida = challenge.metaSemanal;
//         const valorMulta = Number(challenge.valorCaucao);

//         for (const participant of challenge.participants) {
//           // 2. Conta quantos check-ins VÁLIDOS o monstro fez nesta semana específica
//           const totalCheckInsNaSemana = await this.prisma.checkIn.count({
//             where: {
//               challengeId: challenge.id,
//               userId: participant.userId,
//               status: CheckInStatus.VALID,
//               createdAt: {
//                 gte: segundaFeira,
//                 lte: agora,
//               },
//             },
//           });

//           // 3. SE NÃO BATEU A META: Hora da punição!
//           if (totalCheckInsNaSemana < metaExigida) {
//             this.logger.warn(
//               `❌ Usuário ${participant.user.name} falhou! Fez ${totalCheckInsNaSemana}/${metaExigida} treinos no desafio "${challenge.title}".`
//             );

//             // Desafios gratuitos não geram cobrança financeira, apenas alteram status
//             if (valorMulta === 0 || challenge.isFree) {
//               await this.prisma.participant.update({
//                 where: { id: participant.id },
//                 data: { status: ParticipantStatus.PENALIZED },
//               });
//               continue;
//             }

//             // Executa a punição financeira em transação isolada para cada usuário falho
//             await this.prisma.$transaction(async (tx) => {
//               // A) Atualiza a ficha do participante no Postgres
//               await tx.participant.update({
//                 where: { id: participant.id },
//                 data: {
//                   finesPending: { increment: valorMulta },
//                   status: ParticipantStatus.PENALIZED, // Joga na geladeira até pagar
//                 },
//               });

//               // B) Prepara a Invoice local e chama o Asaas para gerar o Pix
//               const localInvoiceId = crypto.randomUUID();
//               const descricaoMulta = `Multa Semanal - Desafio: ${challenge.title} (${totalCheckInsNaSemana}/${metaExigida} treinos)`;

//               // Garante que o usuário tem cadastro no gateway antes de multar
//               let customerId = participant.user.gatewayCustomerId;
//               if (!customerId && participant.user.cpf) {
//                 customerId = await this.asaasService.createCustomer(
//                   participant.user.name,
//                   participant.user.email,
//                   participant.user.cpf
//                 );
//                 await tx.user.update({
//                   where: { id: participant.userId },
//                   data: { gatewayCustomerId: customerId },
//                 });
//               }

//               if (customerId) {
//                 // Dispara a criação da cobrança de multa no Asaas
//                 const asaasPayment = await this.asaasService.generatePixPayment(
//                   customerId,
//                   valorMulta,
//                   descricaoMulta,
//                   localInvoiceId
//                 );

//                 // C) Registra a Invoice do tipo WEEKLY_FINE no banco local
//                 await tx.invoice.create({
//                 data: {
//                   id: localInvoiceId,
//                   userId: participant.userId,
//                   challengeId: challenge.id,
//                   gatewayInvoiceId: asaasPayment.asaasPaymentId,
//                   pixCopyPaste: asaasPayment.payload, 
//                   pixQrCodeUrl: asaasPayment.encodedImage, 
//                   type: InvoiceType.WEEKLY_FINE,
//                   status: 'PENDING',
//                   value: valorMulta,
//                   dueDate: new Date(asaasPayment.expirationDate || Date.now() + 48 * 60 * 60 * 1000), 
//                 },
//               });
//               }

//               // D) Log de segurança para auditoria
//               await tx.auditLog.create({
//                 data: {
//                   userId: participant.userId,
//                   action: 'MEMBER_PENALIZED_WEEKLY',
//                   description: `Usuário ${participant.user.name} multado em R$ ${valorMulta.toFixed(2)} por fazer apenas ${totalCheckInsNaSemana} de ${metaExigida} treinos exigidos.`,
//                 },
//               });
//             });
//           }
//         }
//       }

//       this.logger.log('✅ [Cron Verificação Semanal] Processamento de penalidades concluído com sucesso!');
//     } catch (error: unknown) {
//       this.logger.error('❌ Erro crítico ao rodar validação de check-ins semanais:', (error as Error).message);
//     }
//   }

// }