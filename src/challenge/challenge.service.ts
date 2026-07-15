import { Injectable, BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { FirebaseStorageService } from 'src/storage/firebase-storage.service';
import { AsaasService } from 'src/payment/asaas.service';
import * as crypto from 'crypto';
import { ParticipantStatus } from '@prisma/client';
import { ApprovalFilterStatus, GetPendingApprovalsQueryDto } from './dto/GetPendingApprovalsQueryDto.dto';

@Injectable()
export class ChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseStorage: FirebaseStorageService,
    private readonly asaasService: AsaasService,
  ) {}

  async create(dto: CreateChallengeDto, creatorId: string, file?: Express.Multer.File) {
    try {

      const normalizedTitle = dto.title.trim();

      const existingChallenge = await this.prisma.challenge.findFirst({
        where: {
          title: {
            equals: normalizedTitle,
            mode: 'insensitive',
          },
          status: {
            in: ['PENDING', 'ACTIVE'],
          },
        },
      });

      if (existingChallenge) {        // Retorna HTTP 409 Conflict para o Flutter tratar de forma amigável na tela
        throw new ConflictException(`Já existe um desafio ativo com o nome "${normalizedTitle}". Escolha outro nome, monstro!`);
      }

      const taxaInscricao = Number(dto.taxaInscricao);
      const valorCaucao = Number(dto.valorCaucao);
      const metaSemanal = parseInt(dto.metaSemanal as any, 10);

      const isFree = String(dto.isFree) === 'true';

      const requiresApproval = String(dto.requiresApproval) === 'true';

      const user = await this.prisma.user.findUnique({
        where: { id: creatorId }
      });

      if (!user) {
        throw new BadRequestException('Usuário criador não encontrado.');
      }

      let codigoFinal = dto.inviteCode 
        ? dto.inviteCode.trim().toUpperCase() 
        : crypto.randomBytes(4).toString('hex').toUpperCase();

      if (dto.inviteCode) {
        const codigoExiste = await this.prisma.challenge.findUnique({ where: { inviteCode: codigoFinal } });
        if (codigoExiste) {
          throw new BadRequestException('🔥 Este código de convite já está sendo usado por outro desafio. Escolha outro!');
        }
      }

      if (user.plan === 'FREE') {
        // Se ele tentar criar um desafio com grana sendo FREE, já barra
        if (taxaInscricao > 0 || valorCaucao > 0 || !isFree) {
          throw new BadRequestException('🚨 Usuários FREE só podem criar desafios 100% gratuitos, sem taxas ou caução.');
        }

        // Conta quantos desafios ele já criou na vida
        const totalCriados = await this.prisma.challenge.count({
          where: { creatorId: creatorId,
            status: {
              in: ['PENDING', 'ACTIVE'] // Conta se tem algum desafio pendente ou já rolando
            }
          }
        });

        if (totalCriados >= 1) {
          throw new BadRequestException('🔥 Limite atingido! Usuários FREE só podem criar 1 desafio. Faça o upgrade para o Premium!');
        }
      }

      let fileId: string | undefined = undefined;

      // 3. Se enviou imagem, faz o upload físico e registra na tabela File
      if (file) {
        // Cria um caminho organizado no bucket: challenges/ID_DO_CRIADOR/uuid-nome.jpg
        const uniqueName = `${Date.now()}-${file.originalname}`;
        const storagePath = `challenges/${dto.creatorId}/${uniqueName}`;

        // Envia para o Firebase Storage real (ou roda o mock se NODE_ENV=development)
        const imageUrl = await this.firebaseStorage.uploadPhoto(file, 'challenges', storagePath);

        // Salva os metadados da imagem de capa na tabela File do Postgres
        const savedFile = await this.prisma.file.create({
          data: {
            url: imageUrl,
            storagePath: storagePath,
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeInBytes: file.size,
          },
        });

        fileId = savedFile.id;
      }

      const start = new Date(dto.startDate);
      const end = new Date(dto.endDate);

      if (start >= end) {
        throw new BadRequestException('A data de início deve ser anterior à data de término.');
      }

      // Usando Transação ACID para garantir consistência financeira do grupo
      return this.prisma.$transaction(async (tx) => {
        
        // 1. Cria o Desafio
        const challenge = await tx.challenge.create({
          data: {
            title: dto.title,
            description: dto.description,
            creatorId: creatorId,
            metaSemanal: metaSemanal,
            taxaInscricao: user.plan === 'FREE' ? 0.00 : taxaInscricao,
            valorCaucao: user.plan === 'FREE' ? 0.00 : valorCaucao,
            isFree: user.plan === 'FREE' ? true : isFree,
            startDate: start,
            endDate: end,
            fileId: fileId,
            inviteCode: codigoFinal,
            requiresApproval: requiresApproval,
          },
          include: {
            image: true,
          },
        });

        await tx.participant.create({
          data: {
            challengeId: challenge.id,
            userId: creatorId,
            status: 'ACTIVE', // O dono do jogo entra direto, sem passar por PENDING_PAYMENT
            escrowBalance: 0.00 // O criador não retém saldo de caução inicial com o gateway
          }
        });

        // 2. Inicializa o Caixa (Treasury) zerado para este desafio específico
        await tx.challengeTreasury.create({
          data: {
            challengeId: challenge.id,
            totalEscrowed: 0.00,
            collectedFines: 0.00,
          },
        });

        // 3. Registra nos Logs de Auditoria do Sistema (Sua Blindagem)
        await tx.auditLog.create({
          data: {
            userId: dto.creatorId,
            action: 'CREATE_CHALLENGE',
            description: `Desafio "${challenge.title}" criado com caução de R$ ${dto.valorCaucao} e meta de ${dto.metaSemanal}x na semana.`,
          },
        });

        return challenge;
      });
    } catch (error) {
      console.error('CREATE CHALLENGE ERROR');
      console.error(error);

      throw error;
    }
  }

  async update(id: string, dto: UpdateChallengeDto, file?: Express.Multer.File) {
    // 1. Busca o estado atual do desafio junto com os dados da foto atual
    const challenge = await this.prisma.challenge.findUnique({
      where: { id },
      include: { image: true },
    });

    if (!challenge) {
      throw new BadRequestException('Desafio não encontrado para atualização.');
    }

    const jaComecou = challenge.status !== 'PENDING';
    const updateData: any = {};

    // ─── FLUXO 1: SE JÁ COMEÇOU (Apenas atualiza a imagem se houver) ───
    if (jaComecou) {
      if (!file) {
        throw new BadRequestException('🚨 Este desafio já está ativo ou finalizado. Só é permitido alterar a imagem de capa.');
      }
      // Se enviou arquivo, o fluxo prossegue abaixo tratando apenas a imagem
    } else {
      // ─── FLUXO 2: SE NÃO COMEÇOU (Permite alterar textos e datas) ───
      if (dto.title) updateData.title = dto.title;
      if (dto.description !== undefined) updateData.description = dto.description;

      // Validação e conversão das novas datas caso tenham sido enviadas
      if (dto.startDate || dto.endDate) {
        const start = dto.startDate ? new Date(dto.startDate) : challenge.startDate;
        const end = dto.endDate ? new Date(dto.endDate) : challenge.endDate;

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          throw new BadRequestException('Formato de uma das datas fornecidas é inválido.');
        }

        if (start >= end) {
          throw new BadRequestException('A data de início deve ser anterior à data de término.');
        }

        if (dto.startDate) updateData.startDate = start;
        if (dto.endDate) updateData.endDate = end;
      }
    }

    // ─── TRATAMENTO DE SUBSTITUIÇÃO DE IMAGEM (Comum a ambos os fluxos) ───
    if (file) {
      // A) Se existia uma foto antiga cadastrada, remove o arquivo físico do Firebase Storage
      if (challenge.image && challenge.image.storagePath) {
        try {
          // Importamos o admin dinamicamente ou usamos o sdk instanciado
          const admin = require('firebase-admin');
          const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'rumo-ao-shape';
          await admin.storage().bucket(bucketName).file(challenge.image.storagePath).delete();
        } catch (storageError: any) {
          // Loga o erro mas não trava o fluxo caso o arquivo já tenha sido apagado manualmente no console
          console.warn('⚠️ Não foi possível deletar a imagem antiga do bucket:', storageError.message);
        }
      }

      // B) Faz o upload do novo arquivo físico
      const uniqueName = `${Date.now()}-${file.originalname}`;
      const storagePath = `challenges/${challenge.creatorId}/${uniqueName}`;
      const imageUrl = await this.firebaseStorage.uploadPhoto(file, 'challenges', storagePath);

      // C) Upsert dos metadados na tabela File (conecta na relação ou cria uma nova)
      if (challenge.fileId) {
        await this.prisma.file.update({
          where: { id: challenge.fileId },
          data: {
            url: imageUrl,
            storagePath: storagePath,
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeInBytes: file.size,
          },
        });
      } else {
        const savedFile = await this.prisma.file.create({
          data: {
            url: imageUrl,
            storagePath: storagePath,
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeInBytes: file.size,
          },
        });
        updateData.fileId = savedFile.id;
      }
    }

    // 3. Atualiza o registro final do desafio dentro de uma transação estável
    return this.prisma.$transaction(async (tx) => {
      const updatedChallenge = await tx.challenge.update({
        where: { id },
        data: updateData,
        include: { image: true },
      });

      await tx.auditLog.create({
        data: {
          userId: challenge.creatorId,
          action: 'UPDATE_CHALLENGE',
          description: jaComecou 
            ? `Imagem de capa do desafio em andamento "${challenge.title}" foi alterada.`
            : `Metadados do desafio pendente "${challenge.title}" foram editados.`,
        },
      });

      return updatedChallenge;
    });
  }

  async delete(id: string) {
    // 1. Busca o desafio trazendo as relações necessárias para validar as travas financeiras
    const challenge = await this.prisma.challenge.findUnique({
      where: { id },
      include: {
        image: true,
        creator: true,
        treasury: true, // 🧠 Fundamental para checar o saldo e movimentações físicas de dinheiro
      }
    });

    if (!challenge) {
      throw new BadRequestException('Desafio não encontrado para exclusão.');
    }

    // 2. Conta quantas faturas (Invoices) existem vinculadas a este desafio que NÃO estão falhadas/canceladas
    // Se houver qualquer ordem de pagamento gerada (PENDING ou PAID), o criador não pode simplesmente sumir com o desafio.
    const totalOrdensPagamentoAtivas = await this.prisma.invoice.count({
      where: {
        challengeId: id,
        status: {
          in: ['PENDING', 'CONFIRMED'], // Bloqueia se tiver boleto/pix emitido aguardando ou se já foi pago
        },
      },
    });

    // 3. 🚨 NOVA APLICAÇÃO DAS REGRAS DE NEGÓCIO FINANCEIRAS
    
    // Trava A: Se houver qualquer ordem de pagamento ativa ou concluída no sistema
    if (totalOrdensPagamentoAtivas > 0) {
      throw new BadRequestException(
        '🚨 Não é permitido deletar este desafio porque ele já possui ordens de pagamento ativas ou participantes que realizaram o pagamento.'
      );
    }

    // Trava B: Checagem profunda na tesouraria (Treasury)
    // Se o desafio movimentou R$ 1 que seja de caução (totalEscrowed) ou aplicou multas (collectedFines), bloqueia!
    if (challenge.treasury) {
      const dinheiroEmCustodia = Number(challenge.treasury.totalEscrowed) || 0;
      const multasColetadas = Number(challenge.treasury.collectedFines) || 0;

      if (dinheiroEmCustodia > 0 || multasColetadas > 0) {
        throw new BadRequestException(
          '🚨 Bloqueio Financeiro: Este desafio possui movimentações de caixa (valores em garantia ou multas aplicadas) e não pode ser excluído.'
        );
      }
    }

    // Trava C: Se for um desafio FREE, mas já tiver OUTROS usuários engajados participando
    // (Evita que o criador delete um desafio free que a galera já está participando e se esforçando)
    if (challenge.isFree) {
      const totalOutrosParticipantes = await this.prisma.participant.count({
        where: {
          challengeId: id,
          NOT: { userId: challenge.creatorId }
        }
      });

      if (totalOutrosParticipantes > 0) {
        throw new BadRequestException(
          '🚨 Não é permitido deletar um desafio gratuito que já possui outros participantes engajados.'
        );
      }
    }

    // 4. Executa a deleção em lote dentro de uma transação ACID estável
    await this.prisma.$transaction(async (tx) => {
      // A) Apaga o caixa (Treasury) vinculado
      await tx.challengeTreasury.deleteMany({ where: { challengeId: id } });

      // B) Apaga todas as matrículas de participantes deste desafio
      await tx.participant.deleteMany({ where: { challengeId: id } });

      // C) Apaga as faturas locais (Invoices) - se caiu aqui, só existem faturas com status 'CANCELED' ou 'FAILED'
      await tx.invoice.deleteMany({ where: { challengeId: id } });

      // D) Apaga as referências de check-ins se houverem (para não dar erro de chave estrangeira)
      await tx.checkIn.deleteMany({ where: { challengeId: id } });

      // E) Apaga o desafio físico da tabela
      await tx.challenge.delete({ where: { id } });

      // F) Se tinha imagem de capa, apaga os metadados do banco
      if (challenge.fileId) {
        await tx.file.delete({ where: { id: challenge.fileId } });
      }

      // G) Registra a auditoria do sistema
      await tx.auditLog.create({
        data: {
          userId: challenge.creatorId,
          action: 'DELETE_CHALLENGE',
          description: `Desafio "${challenge.title}" foi deletado permanentemente pelo criador.`,
        },
      });
    });

    // 5. 🧹 LIMPEZA DO BUCKET (Mantém o Firebase Storage limpo)
    if (challenge.image && challenge.image.storagePath) {
      try {
        const admin = require('firebase-admin');
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'rumo-ao-shape.firebasestorage.app';
        await admin.storage().bucket(bucketName).file(challenge.image.storagePath).delete();
      } catch (storageError: any) {
        console.warn('⚠️ Imagem de capa não encontrada no Firebase Storage para exclusão:', storageError.message);
      }
    }

    return {
      success: true,
      message: `O desafio "${challenge.title}" foi removido com sucesso de forma permanente.`,
    };
  }

  async findAll() {
    return this.prisma.challenge.findMany({
      include: {
        image: true,    // Traz os dados da foto de capa (tabela File)
        treasury: true, // Traw os dados do cofre do grupo
        creator: {      // Se quiser saber quem criou (traz só nome e email para não expor dados sensíveis)
          select: {
            id: true,
            name: true,
            email: true,
            plan: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc' // Mostra os mais recentes primeiro
      }
    });
  }

  async findById(id: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id },
      include: {
        image: true,       // Traz os dados da foto de capa (tabela File)
        treasury: true,    // Traz o cofre (collectedFines, totalEscrowed)
        creator: {         // Traz dados básicos do criador
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          }
        },
        participants: {    // Lista quem tá no jogo e o status de cada um
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
              }
            },
          },
          orderBy: {
            joinedAt: 'desc'
          }
        },
        checkins: {        // 🏋️‍♂️ Traz o histórico de treinos validados do grupo
          include: {
            user: {        // Identifica quem fez o check-in
              select: {
                id: true,
                name: true,
                avatarUrl: true,
              }
            },
            image: true,
          },
          orderBy: {
            createdAt: 'desc' // Mostra os treinos mais recentes no topo da timeline
          }
        }
      }
    });

    if (!challenge) {
      throw new BadRequestException('❌ Desafio não encontrado.');
    }

    return challenge;
  }

  async findCreatedBy(userId: string) {
    return this.prisma.challenge.findMany({
      where: {
        creatorId: userId,
      },
      include: {
        image: true,
        treasury: true,
        // Conta quantos participantes reais estão inscritos
        _count: {
          select: { participants: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 2. Busca os desafios onde o usuário está jogando ATIVAMENTE agora
   */
  async findActiveParticipations(userId: string) {
    // Fazemos a query partindo da tabela Challenge, mas filtrando pela existência da relação
    return this.prisma.challenge.findMany({
      where: {
        participants: {
          some: {
            userId: userId,
            status: 'ACTIVE', // Filtra apenas inscrições validadas pelo Asaas
          },
        },
      },
      include: {
        image: true,
        treasury: true,
      },
      orderBy: { startDate: 'asc' },
    });
  }

  /**
   * 3. Histórico completo de participações do usuário (Ativo, Concluído ou Desistiu)
   * Ideal para renderizar aquela aba "Passados" ou histórico no Perfil
   */
  async findHistory(userId: string) {
    return this.prisma.participant.findMany({
      where: {
        userId: userId,
      },
      include: {
        challenge: {
          include: {
            image: true,
            treasury: true,
          },
        },
      },
      orderBy: {
        id: 'desc', // Traz as inscrições mais recentes primeiro
      },
    });
  }

  async joinChallenge(challengeId: string, userId: string) {
    // 1. Busca o desafio e os dados do criador em uma única tacada externa
    // (Faremos apenas leituras rápidas fora, deixando a escrita pesada no bloco)
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId }
    });

    if (!challenge) {
      throw new BadRequestException('Desafio não encontrado.');
    }

    if (challenge.status !== 'PENDING') {
      throw new BadRequestException('Você só pode entrar em desafios que ainda não começaram e estão abertos.');
    }

    // 2. Usando a Transação ACID para travar e criar as ordens
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new BadRequestException('Usuário não encontrado.');
      }

      // 3. TRAVA DO PLANO FREE (Olha se já tem participação ativa ou pendente de pagamento)
      if (user.plan === 'FREE') {
        const participacoesAtivas = await tx.participant.count({
          where: {
            userId: userId,
            status: { in: ['ACTIVE', 'PENDING_PAYMENT'] },
          },
        });

        if (participacoesAtivas >= 1) {
          throw new BadRequestException(
            '🚀 Limite atingido! Usuários FREE só podem participar de 1 desafio por vez. Faça o upgrade para o Premium para entrar em quantos quiser!'
          );
        }
      }

      // 4. Evita duplicidade de inscrição ou reaproveita cobrança antiga aberta
      const existingParticipant = await tx.participant.findUnique({
        where: { challengeId_userId: { challengeId, userId } }
      });

      if (existingParticipant) {
        if (existingParticipant.status === 'PENDING_PAYMENT') {
          const existingInvoice = await tx.invoice.findFirst({
            where: { challengeId, userId, status: 'PENDING' }
          });
          if (existingInvoice) {
            return {
              message: 'Você já possui uma ordem de pagamento aberta para este desafio! Pague o Pix abaixo.',
              invoice: existingInvoice
            };
          }
        }
        throw new BadRequestException('Você já está participando de forma ativa deste desafio.');
      }

      // 5. SEGREDO DO INTEGRAL: Garante que o usuário possua ID no Asaas
      let customerId = user.gatewayCustomerId;
      if (!customerId) {
        if (!user.cpf) {
          throw new BadRequestException('Para participar de desafios pagos, você precisa cadastrar seu CPF no seu perfil.');
        }
        customerId = await this.asaasService.createCustomer(user.name, user.email, user.cpf);
        // Salva imediatamente na tabela de usuários para os próximos pagamentos
        await tx.user.update({
          where: { id: user.id },
          data: { gatewayCustomerId: customerId }
        });
      }

      const taxa = Number(challenge.taxaInscricao);
      const caucao = Number(challenge.valorCaucao);
      const custoTotal = taxa + caucao;
      const isChallengeFree = custoTotal === 0 || challenge.isFree;

      if (isChallengeFree) {
        // 🌟 NOVA REGRA: Se o desafio gratuito exigir aprovação, coloca na fila
        if ((challenge as any).requiresApproval) {
          const participant = await tx.participant.create({
            data: {
              challengeId,
              userId,       
              status: 'WAITING_APPROVAL' as any, // ⏳ Fica aguardando a moderação do admin
              escrowBalance: 0.00
            }
          });

          await tx.auditLog.create({
            data: {
              userId,
              action: 'CHALLENGE_REQUEST_JOIN',
              description: `Usuário ${user.name} solicitou entrada no desafio gratuito "${challenge.title}" que exige moderação.`
            }
          });

          return {
            message: 'Sua solicitação de entrada foi enviada! Aguarde a aprovação do administrador do grupo. ⏳👊',
            participantStatus: participant.status,
            participant
          };
        }

        // Se for gratuito e não exigir aprovação, ativa na hora
        const participant = await tx.participant.create({
          data: {
            challengeId,
            userId,
            status: 'ACTIVE',
            escrowBalance: 0.00
          }
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'JOIN_CHALLENGE_FREE',
            description: `Usuário ${user.name} entrou diretamente no desafio gratuito "${challenge.title}".`
          }
        });

        return {
          message: 'Inscrição realizada com sucesso! Desafio gratuito. 💪🔥',
          participantStatus: participant.status,
          participant
        };
      }

      // 7. Matrícula o participante em modo "Espera" até o webhook confirmar
      const participant = await tx.participant.create({
        data: {
          challengeId,
          userId,
          escrowBalance: challenge.valorCaucao,
          status: 'PENDING_PAYMENT' // Fica travado na geladeira
        }
      });

      // 8. Cria o ID único local da nossa Invoice para enviar como rastreio para o Asaas
      const localInvoiceId = crypto.randomUUID();
      const description = `Inscrição + Caução - Desafio: ${challenge.title}`;

      // Executa a chamada HTTP para o Sandbox do Asaas para gerar o Pix Real
      const asaasPayment = await this.asaasService.generatePixPayment(
        customerId,
        custoTotal,
        description,
        localInvoiceId // Referência Externa
      );

      // 9. Grava a ordem na tabela Invoice local para alimentar a aba de pagamentos do Flutter
      const invoice = await tx.invoice.create({
        data: {
          id: localInvoiceId,
          userId: user.id,
          challengeId: challenge.id,
          gatewayInvoiceId: asaasPayment.asaasPaymentId,
          pixCopyPaste: asaasPayment.payload, 
          pixQrCodeUrl: asaasPayment.encodedImage,
          type: 'CHALLENGE_ENTRY',
          status: 'PENDING',
          value: custoTotal,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Vence em 24 Horas
        }
      });

      // 10. Log de Auditoria Inicial (Abertura de Intenção)
      await tx.auditLog.create({
        data: {
          userId,
          action: 'JOIN_CHALLENGE_PENDING',
          description: `Usuário ${user.name} solicitou entrada no desafio ${challenge.title}. Ordem de pagamento gerada no valor de R$ ${custoTotal.toFixed(2)}.`
        }
      });

      return {
        message: 'Ordem de pagamento gerada! Pague o Pix para ativar sua inscrição. 💸🚀',
        participantStatus: participant.status,
        invoice: {
          id: invoice.id,
          value: invoice.value,
          pixCopyPaste: invoice.pixCopyPaste,
          pixQrCodeUrl: invoice.pixQrCodeUrl,
          dueDate: invoice.dueDate
        }
      };
    });
  }

  async joinByCode(inviteCode: string, userId: string) {
    const codigoHigienizado = inviteCode.trim().toUpperCase();

    // 1. Busca o desafio pelo código de convite
    const challenge = await this.prisma.challenge.findUnique({
      where: { inviteCode: codigoHigienizado }
    });

    if (!challenge) {
      throw new BadRequestException('❌ Código de convite inválido ou desafio não encontrado.');
    }

    // 2. Reutiliza 100% da inteligência e travas financeiras do método joinChallenge original!
    return this.joinChallenge(challenge.id, userId);
  }

  async leaveChallenge(challengeId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Busca a inscrição ativa do infeliz nesse desafio
      const participant = await tx.participant.findUnique({
        where: {
          challengeId_userId: { challengeId, userId }
        }
      });

      if (!participant) {
        throw new BadRequestException('Você não está inscrito neste desafio.');
      }

      if (participant.status !== 'ACTIVE') {
        throw new BadRequestException('Você não possui uma inscrição ativa para abandonar este desafio.');
      }

      // 2. Busca o desafio para validar o status dele
      const challenge = await tx.challenge.findUnique({
        where: { id: challengeId }
      });

      if (!challenge) {
        throw new BadRequestException('Desafio não encontrado.');
      }

      if (challenge.status === 'FINISHED') {
        throw new BadRequestException('Este desafio já foi encerrado. Não é possível sair.');
      }

      const valorCaucaoPerdida = Number(participant.escrowBalance || 0);

      // 3. Atualiza o status do participante para LEAVE (Desistiu)
      // Zeramos o escrowBalance dele porque ele PERDEU esse direito ao sair antes
      await tx.participant.update({
        where: {
          challengeId_userId: { challengeId, userId }
        },
        data: {
          status: 'LEAVE',
          escrowBalance: 0.00 // Perdeu a posse da caução
        }
      });

      // 4. Se ele tinha caução retida, transferimos definitivamente para o bolo de multas/bônus do grupo
      if (valorCaucaoPerdida > 0) {
        const treasury = await tx.challengeTreasury.findUnique({
          where: { challengeId }
        });

        if (treasury) {
          await tx.challengeTreasury.update({
            where: { challengeId },
            data: {
              // Deduz do dinheiro "garantido" (escrowed) e joga para a pilha de multas recolhidas (collectedFines)
              totalEscrowed: Number(treasury.totalEscrowed) - valorCaucaoPerdida,
              collectedFines: Number(treasury.collectedFines) + valorCaucaoPerdida
            }
          });
        }
      }

      // 5. Log de Auditoria para blindagem jurídica (Ele aceitou os termos ao sair)
      await tx.auditLog.create({
        data: {
          userId,
          action: 'LEAVE_CHALLENGE',
          description: `Usuário abandonou o desafio "${challenge.title}". Inscrição e multas não reembolsadas. Caução de R$ ${valorCaucaoPerdida.toFixed(2)} retida permanentemente no cofre do grupo.`
        }
      });

      return {
        message: 'Você saiu do desafio. Inscrição cancelada e caução retida. Sem moleza! ❌💪'
      };
    });
  }

  async getRanking(challengeId: string) {
    // 1. Agrupa os check-ins por usuário contando quantos 'VALID' cada um tem
    const rankingAgrupado = await this.prisma.checkIn.groupBy({
      by: ['userId'],
      where: {
        challengeId: challengeId,
        status: 'VALID', // 🚨 Ignora completamente os treinos extras ('BONUS')
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc', // Maior número de treinos no topo
        },
      },
    });

    // 2. Hidrata os IDs trazendo nome e foto de perfil de cada um na ordem do pódio
    const rankingComPerfil = await Promise.all(
      rankingAgrupado.map(async (item, index) => {
        const user = await this.prisma.user.findUnique({
          where: { id: item.userId },
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        });

        return {
          posicao: index + 1,
          userId: item.userId,
          name: user?.name || 'Monstro Anônimo',
          avatarUrl: user?.avatarUrl,
          totalCheckIns: item._count.id,
        };
      }),
    );

    return rankingComPerfil;
  }

  async moderateParticipant(
    challengeId: string,
    participantId: string, // ID do registro na tabela Participant
    adminId: string,
    action: 'APPROVE' | 'REJECT',
  ) {
    // 1. Valida se o desafio existe e se quem está aprovando é o criador
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) throw new NotFoundException('Desafio não encontrado.');
    if (challenge.creatorId !== adminId) {
      throw new UnauthorizedException('Apenas o criador do desafio pode moderar membros.');
    }

    // 2. Busca o participante pendente
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: { user: true },
    });

    if (!participant || participant.challengeId !== challengeId) {
      throw new NotFoundException('Inscrição do participante não encontrada neste desafio.');
    }

    if (participant.status !== ParticipantStatus.WAITING_APPROVAL) {
      throw new BadRequestException('Este participante não está aguardando aprovação.');
    }

    if (action === 'APPROVE') {
      // Ativa o monstro no desafio
      await this.prisma.participant.update({
        where: { id: participantId },
        data: { status: ParticipantStatus.ACTIVE },
      });

      await this.prisma.auditLog.create({
        data: {
          userId: participant.userId,
          action: 'CHALLENGE_JOIN_APPROVED',
          description: `Admin ${adminId} aprovou a entrada de ${participant.user.name} no desafio.`,
        },
      });

      return { message: 'Participante aprovado e ativado no desafio!' };
    } else {
      // Remove o registro se for rejeitado
      await this.prisma.participant.delete({
        where: { id: participantId },
      });

      await this.prisma.auditLog.create({
        data: {
          userId: participant.userId,
          action: 'CHALLENGE_JOIN_REJECTED',
          description: `Admin ${adminId} rejeitou a entrada de ${participant.user.name} no desafio.`,
        },
      });

      return { message: 'Solicitação rejeitada e removida com sucesso.' };
    }
  }
  
  async getChallengeApprovals(
    challengeId: string,
    adminId: string,
    query: GetPendingApprovalsQueryDto,
  ) {
    const { page, limit, status, search } = query;
    const parsedLimit = Number(limit) || 20;
    const parsedPage = Number(page) || 1;
    const skip = (parsedPage - 1) * parsedLimit;

    // 1. Segurança: Valida se o desafio existe e se quem está chamando é o criador
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Desafio não encontrado.');
    }

    if (challenge.creatorId !== adminId) {
      throw new UnauthorizedException('Apenas o criador do desafio pode gerenciar as aprovações.');
    }

    // 2. Mapeia o filtro do DTO para o status real do banco de dados
    const dbStatus = status === ApprovalFilterStatus.APPROVED ? 'ACTIVE' : 'WAITING_APPROVAL';

    const whereClause: any = {
      challengeId,
      status: dbStatus,
    };

    // Filtro de busca por nome ou e-mail do participante
    if (search) {
      whereClause.user = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    // 3. Busca paginada
    const [totalItems, participants] = await Promise.all([
      this.prisma.participant.count({ where: whereClause }),
      this.prisma.participant.findMany({
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
          joinedAt: 'desc', // Os pedidos mais novos no topo
        },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / parsedLimit);

    return {
      meta: {
        totalItems,
        itemCount: participants.length,
        itemsPerPage: parsedLimit,
        totalPages,
        currentPage: parsedPage,
      },
      requests: participants.map((p) => ({
        participantId: p.id, // ID da tabela Participant (usado para aprovar/rejeitar)
        userId: p.user.id,
        name: p.user.name,
        email: p.user.email,
        avatarUrl: p.user.avatarUrl,
        joinedAt: p.joinedAt,
        status: p.status, // ACTIVE ou WAITING_APPROVAL
      })),
    };
  }
}