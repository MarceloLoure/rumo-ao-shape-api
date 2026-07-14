import { Injectable, NotFoundException, BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AsaasService } from 'src/payment/asaas.service';
import { FirebaseStorageService } from 'src/storage/firebase-storage.service';
import { GetInvoicesQueryDto } from './dto/get-incoices.dto';
import { InvoiceType, ParticipantStatus, PlanType } from '@prisma/client';
import { GetChallengeInvoicesQueryDto } from './dto/GetChallengeInvoicesQueryDto.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseStorage: FirebaseStorageService,
    private readonly asaasService: AsaasService,
  ) {}

  async updateProfile(userId: string, dto: UpdateProfileDto, file?: Express.Multer.File) {
    // 1. Busca o usuário atual
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const updateData: any = {};

    if (dto.name) updateData.name = dto.name;

    if (file) {
      // Cria um caminho organizado no bucket para avatars
      const uniqueName = `${Date.now()}-${file.originalname}`;
      const storagePath = `avatars/${userId}/${uniqueName}`;

      // Envia para o Firebase Storage real (ou roda o mock se NODE_ENV=development)
      const imageUrl = await this.firebaseStorage.uploadPhoto(file, 'avatars', storagePath);

      // Salva os metadados da imagem de avatar na tabela File do Postgres igualzinho ao challenge
      const savedFile = await this.prisma.file.create({
        data: {
          url: imageUrl,
          storagePath: storagePath,
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeInBytes: file.size,
        },
      });

      // Se o seu model User salvar a string da URL:
      updateData.avatarUrl = savedFile.url;
      
      // NOTA: Se o seu model User usar relação física (ex: fileId), basta descomentar a linha abaixo:
      // updateData.fileId = savedFile.id;
    }

    if (dto.cpf) {
      const cleanCpf = dto.cpf.replace(/\D/g, '');

      if (cleanCpf.length !== 11) {
        throw new BadRequestException('CPF inválido. Deve conter 11 dígitos.');
      }

      if (cleanCpf !== user.cpf) {
        const cpfExists = await this.prisma.user.findUnique({ where: { cpf: cleanCpf } });
        if (cpfExists) {
          throw new ConflictException('Este CPF já está sendo utilizado por outra conta.');
        }
        updateData.cpf = cleanCpf;
      }
    }

    // Se não veio nenhum dado para atualizar, apenas retorna o usuário
    if (Object.keys(updateData).length === 0) {
      return user;
    }

    // 5. Atualiza no Banco de Dados Local
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    // 6. SINCRONIZAÇÃO COM O ASAAS: Se o usuário mudou o CPF ou Nome e já tem ID no Asaas, atualiza lá!
    if (user.gatewayCustomerId && (updateData.name || updateData.cpf)) {
      try {
        // Vamos usar o AxiosInstance que você já tem configurado no seu AsaasService criando um método lá, 
        // ou chamando diretamente uma rota de update de clientes se preferir.
        await this.asaasService.updateCustomer(user.gatewayCustomerId, {
          name: updatedUser.name,
          cpfCnpj: updatedUser.cpf || undefined,
        });
      } catch (error: any) {
        console.warn('⚠️ [Asaas Sincronização] Não foi possível atualizar os dados cadastrais no Asaas:', error.message);
      }
    }

    return {
      message: 'Perfil atualizado com sucesso!',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        cpf: updatedUser.cpf,
        avatarUrl: updatedUser.avatarUrl,
        walletBalance: updatedUser.walletBalance,
      },
    };
  }

  async deposit(userId: string, amount: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Soma o saldo atual com o valor do depósito
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        walletBalance: Number(user.walletBalance) + amount,
      },
    });

    // Registra a recarga na auditoria
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'DEPOSIT_MOCK_PIX',
        description: `Usuário ${user.name} realizou uma recarga de teste via PIX no valor de R$ ${amount.toFixed(2)}`,
      },
    });

    return {
      message: 'Depósito de testes realizado com sucesso!',
      newBalance: updatedUser.walletBalance,
    };
  }

  async updateFcmToken(dto: UpdateFcmTokenDto) {
    // 1. Verifica se o usuário existe antes de tentar atualizar
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    // 2. Atualiza o token no banco
    return this.prisma.user.update({
      where: { id: dto.userId },
      data: { fcmToken: dto.fcmToken },
      select: {
        id: true,
        name: true,
        fcmToken: true, // Retorna só o necessário para confirmar o update
      },
    });
  }

  async getPendingInvoices(userId: string) {
    // 1. Verifica se o monstro existe
    const userExists = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) throw new NotFoundException('Usuário não encontrado.');

    // 2. Puxa todas as faturas locais com status PENDING ordenadas pelas mais urgentes
    const pendingInvoices = await this.prisma.invoice.findMany({
      where: {
        userId,
        status: 'PENDING',
      },
      include: {
        challenge: {
          select: {
            title: true,
          },
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    return {
      userId,
      totalPending: pendingInvoices.length,
      invoices: pendingInvoices.map((inv) => ({
        id: inv.id,
        type: inv.type, // CHALLENGE_ENTRY, WEEKLY_FINE, PLAN_SUBSCRIPTION
        value: Number(inv.value),
        pixCopyPaste: inv.pixCopyPaste,
        pixQrCodeUrl: inv.pixQrCodeUrl, // Base64 da imagem real que salvamos do Asaas
        dueDate: inv.dueDate,
        challengeTitle: inv.challenge?.title || 'Upgrade de Plano Premium',
      })),
    };
  }

  async getUserInvoicesHistory(userId: string, query: GetInvoicesQueryDto) {
    const { page, limit, status, startDate, endDate } = query;

    const parsedLimit = Number(limit) || 10;
    const parsedPage = Number(page) || 1;
    const skip = (parsedPage - 1) * parsedLimit;

    // 1. Monta o filtro dinâmico
    const whereClause: any = { userId };

    if (status) {
      whereClause.status = status;
    }

    // Filtro por intervalo de datas (createdAt)
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        // Ajusta a data final para o final do dia (23:59:59) para não comer dados
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        whereClause.createdAt.lte = end;
      }
    }

    // 2. Executa a busca e a contagem total em paralelo (Performance de Sênior 🚀)
    const [totalItems, invoices] = await Promise.all([
      this.prisma.invoice.count({ where: whereClause }),
      this.prisma.invoice.findMany({
        where: whereClause,
        skip: skip,            // ✅ Garantido como número
        take: parsedLimit,
        include: {
          challenge: {
            select: { title: true },
          },
        },
        orderBy: {
          createdAt: 'desc', // Histórico mostra sempre o mais recente primeiro!
        },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      meta: {
        totalItems,
        itemCount: invoices.length,
        itemsPerPage: limit,
        totalPages,
        currentPage: page,
      },
      items: invoices.map((inv) => ({
        id: inv.id,
        gatewayInvoiceId: inv.gatewayInvoiceId,
        type: inv.type, // CHALLENGE_ENTRY, WEEKLY_FINE, PLAN_SUBSCRIPTION
        status: inv.status, // PENDING, CONFIRMED, OVERDUE, REFUNDED
        value: Number(inv.value),
        pixCopyPaste: inv.pixCopyPaste,
        pixQrCodeUrl: inv.pixQrCodeUrl,
        dueDate: inv.dueDate,
        createdAt: inv.createdAt,
        challengeTitle: inv.challenge?.title || 'Upgrade de Plano Premium',
      })),
    };
  }

  async confirmInvoiceManually(invoiceId: string, adminId: string) {
    // 1. Executa tudo dentro de uma transação isolada para blindar o banco
    return this.prisma.$transaction(async (tx) => {
      // Busca a fatura com os dados do desafio atrelado
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { challenge: true },
      });

      if (!invoice) {
        throw new NotFoundException('Fatura não encontrada.');
      }

      if (invoice.status === 'CONFIRMED') {
        throw new BadRequestException('Esta fatura já foi confirmada anteriormente.');
      }

      // 2. Trava de Segurança: Se for uma fatura de desafio, apenas o criador pode dar a baixa manual!
      if (invoice.challengeId && invoice.challenge?.creatorId !== adminId) {
        throw new UnauthorizedException('Apenas o administrador deste desafio pode confirmar este pagamento.');
      }

      // 3. Atualiza o status da fatura local para CONFIRMED
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'CONFIRMED' },
      });

      const valorBruto = Number(invoice.value);

      // 4. Divide o comportamento baseado no tipo da Invoice (Igual ao Webhook, mas com taxa ZERO)
      switch (invoice.type) {
        case InvoiceType.CHALLENGE_ENTRY: {
          if (invoice.challengeId) {
            // Ativa o participante no grupo
            await tx.participant.update({
              where: {
                challengeId_userId: {
                  challengeId: invoice.challengeId,
                  userId: invoice.userId,
                },
              },
              data: { status: ParticipantStatus.ACTIVE },
            });

            const taxaInscricao = Number(invoice?.challenge?.taxaInscricao);
            const caucao = Number(invoice?.challenge?.valorCaucao);

            // Como foi por fora, o criador recebe o valor integral da taxa de inscrição na carteira local dele
            if (taxaInscricao > 0) {
              await tx.user.update({
                where: { id: invoice?.challenge?.creatorId },
                data: { walletBalance: { increment: taxaInscricao } },
              });
            }

            // Alimenta o cofre do grupo com o valor bruto da caução (sem desconto de taxa de gateway!)
            if (caucao > 0) {
              await tx.challengeTreasury.upsert({
                where: { challengeId: invoice.challengeId },
                update: { totalEscrowed: { increment: caucao } },
                create: { challengeId: invoice.challengeId, totalEscrowed: caucao },
              });
            }
          }
          break;
        }

        case InvoiceType.WEEKLY_FINE: {
          if (invoice.challengeId) {
            // Reativa o participante que estava na geladeira por falta
            await tx.participant.update({
              where: {
                challengeId_userId: {
                  challengeId: invoice.challengeId,
                  userId: invoice.userId,
                },
              },
              data: { status: ParticipantStatus.ACTIVE },
            });

            // Injeta a multa bruta direto no bolo de multas do grupo
            await tx.challengeTreasury.upsert({
              where: { challengeId: invoice.challengeId },
              update: { collectedFines: { increment: valorBruto } },
              create: { challengeId: invoice.challengeId, totalEscrowed: 0, collectedFines: valorBruto },
            });
          }
          break;
        }

        case InvoiceType.PLAN_SUBSCRIPTION: {
          // Se por acaso você vender o plano Premium por fora via pix pessoal
          await tx.user.update({
            where: { id: invoice.userId },
            data: { plan: PlanType.PREMIUM },
          });
          break;
        }
      }

      // 5. Injeta o Log de Auditoria especificando que a baixa foi MANUAL
      await tx.auditLog.create({
        data: {
          userId: invoice.userId,
          action: `MANUAL_CONFIRMED_${invoice.type}`,
          description: `Administrador [${adminId}] confirmou manualmente o pagamento externo de R$ ${valorBruto.toFixed(2)} para a fatura [${invoiceId}] do tipo [${invoice.type}].`,
        },
      });

      return {
        success: true,
        message: 'Pagamento baixado manualmente com sucesso! Regras aplicadas.',
        invoiceStatus: updatedInvoice.status,
      };
    });
  }

  async getChallengePendingInvoices(
    challengeId: string,
    adminId: string,
    query: GetChallengeInvoicesQueryDto,
  ) {
    const { page, limit, type, search } = query;
    const parsedLimit = Number(limit) || 20;
    const parsedPage = Number(page) || 1;
    const skip = (parsedPage - 1) * parsedLimit;

    // 1. Validar se o desafio existe e se quem está chamando é o dono/criador
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Desafio não encontrado.');
    }

    if (challenge.creatorId !== adminId) {
      throw new UnauthorizedException('Apenas o administrador deste desafio pode visualizar essas faturas.');
    }

    // 2. Montar o filtro das faturas pendentes do desafio
    const whereClause: any = {
      challengeId,
      status: 'PENDING', // Apenas faturas pendentes de pagamento
    };

    if (type) {
      whereClause.type = type;
    }

    // Filtro opcional por nome ou e-mail do participante
    if (search) {
      whereClause.user = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    // 3. Executar busca paginada e contagem em paralelo
    const [totalItems, invoices] = await Promise.all([
      this.prisma.invoice.count({ where: whereClause }),
      this.prisma.invoice.findMany({
        where: whereClause,
        skip,
        take: parsedLimit,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc', // As mais recentes primeiro
        },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / parsedLimit);

    return {
      meta: {
        totalItems,
        itemCount: invoices.length,
        itemsPerPage: parsedLimit,
        totalPages,
        currentPage: parsedPage,
      },
      invoices: invoices.map((inv) => ({
        id: inv.id,
        gatewayInvoiceId: inv.gatewayInvoiceId,
        type: inv.type, // CHALLENGE_ENTRY ou WEEKLY_FINE
        value: Number(inv.value),
        pixCopyPaste: inv.pixCopyPaste,
        pixQrCodeUrl: inv.pixQrCodeUrl,
        dueDate: inv.dueDate,
        createdAt: inv.createdAt,
        participant: {
          id: inv.user.id,
          name: inv.user.name,
          email: inv.user.email,
          avatarUrl: inv.user.avatarUrl,
        },
      })),
    };
  }
}