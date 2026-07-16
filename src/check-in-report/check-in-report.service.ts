import { Injectable, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckInReportDto } from './dto/create-report.dto';
import { ReportStatus } from '@prisma/client';

@Injectable()
export class CheckInReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1. CRIA UMA DENÚNCIA DE CHECK-IN
   */
  async createReport(checkInId: string, reporterId: string, dto: CreateCheckInReportDto) {
    // Busca o check-in para descobrir a qual desafio ele pertence
    const checkIn = await this.prisma.checkIn.findUnique({
      where: { id: checkInId },
      include: { challenge: true },
    });

    if (!checkIn) {
      throw new NotFoundException('Check-in não encontrado para denúncia.');
    }

    // Não faz sentido denunciar o próprio treino
    if (checkIn.userId === reporterId) {
      throw new BadRequestException('Você não pode denunciar o seu próprio check-in, monstro!');
    }

    // Segurança: Valida se o denunciante está matriculado e ATIVO no mesmo desafio
    const isParticipant = await this.prisma.participant.findFirst({
      where: {
        challengeId: checkIn.challengeId,
        userId: reporterId,
        status: 'ACTIVE',
      },
    });

    if (!isParticipant) {
      throw new UnauthorizedException('Apenas participantes ativos do mesmo desafio podem denunciar este check-in.');
    }

    // Evita duplicidade de denúncia do mesmo usuário no mesmo check-in
    const reportExists = await this.prisma.checkInReport.findUnique({
      where: {
        checkInId_reporterId: { checkInId, reporterId },
      },
    });

    if (reportExists) {
      throw new BadRequestException('Você já denunciou este check-in. Aguarde a análise do administrador.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Cria o registro da denúncia
      const report = await tx.checkInReport.create({
        data: {
          checkInId,
          reporterId,
          reason: dto.reason,
          description: dto.description,
          status: 'PENDING',
        },
      });

      // Salva no log de auditoria
      await tx.auditLog.create({
        data: {
          userId: reporterId,
          action: 'CHECKIN_REPORTED',
          description: `Usuário denunciou o check-in ${checkInId} no desafio "${checkIn.challenge.title}". Motivo: ${dto.reason}.`,
        },
      });

      return report;
    });
  }

  /**
   * 2. LISTA AS DENÚNCIAS PENDENTES DO DESAFIO (Para o Criador)
   */
  async getPendingReportsForAdmin(challengeId: string, adminId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) throw new NotFoundException('Desafio não encontrado.');
    if (challenge.creatorId !== adminId) {
      throw new UnauthorizedException('Apenas o criador do desafio pode visualizar as denúncias.');
    }

    return this.prisma.checkInReport.findMany({
      where: {
        checkIn: { challengeId },
        status: 'PENDING',
      },
      include: {
        reporter: { select: { id: true, name: true, avatarUrl: true } },
        checkIn: {
          include: {
            user: { select: { id: true, name: true, avatarUrl: true } },
            image: true, // Foto do treino denunciado
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 3. JULGAMENTO DA DENÚNCIA (Aprovar / Rejeitar)
   */
  async handleReportDecision(
    reportId: string,
    adminId: string,
    decision: 'APPROVE' | 'REJECT',
  ) {
    const report = await this.prisma.checkInReport.findUnique({
      where: { id: reportId },
      include: {
        checkIn: { include: { challenge: true, user: true } },
      },
    });

    if (!report) throw new NotFoundException('Denúncia não encontrada.');

    // Apenas o dono do desafio (admin) pode julgar a denúncia
    if (report.checkIn.challenge.creatorId !== adminId) {
      throw new UnauthorizedException('Apenas o criador do desafio pode julgar essa denúncia.');
    }

    if (report.status !== 'PENDING') {
      throw new BadRequestException('Esta denúncia já foi julgada e encerrada.');
    }

    return this.prisma.$transaction(async (tx) => {
      if (decision === 'APPROVE') {
        // 🚨 DENÚNCIA PROCEDENTE: O check-in denunciado é INVALIDADO!
        await tx.checkIn.update({
          where: { id: report.checkInId },
          data: { status: 'INVALID' as any }, // Altera o status para inválido no banco
        });

        // Atualiza a denúncia
        await tx.checkInReport.update({
          where: { id: reportId },
          data: {
            status: ReportStatus.APPROVED,
            resolvedById: adminId,
            resolvedAt: new Date(),
          },
        });

        // Registra o log para blindagem jurídica do tombo do trapaceiro
        await tx.auditLog.create({
          data: {
            userId: report.checkIn.userId, // Trapaceiro
            action: 'CHECKIN_INVALIDATED_BY_REPORT',
            description: `Check-in ${report.checkInId} foi invalidado pelo admin ${adminId} após denúncia aceita de fraude.`,
          },
        });

        return { message: 'Denúncia aceita! O check-in do participante foi invalidado com sucesso. 🎯' };
      } else {
        // ❌ DENÚNCIA IMPROCEDENTE: Mantém o check-in ativo e rejeita a contestação
        await tx.checkInReport.update({
          where: { id: reportId },
          data: {
            status: ReportStatus.REJECTED,
            resolvedById: adminId,
            resolvedAt: new Date(),
          },
        });

        return { message: 'Denúncia rejeitada. O check-in continua considerado como válido. 💪' };
      }
    });
  }
}