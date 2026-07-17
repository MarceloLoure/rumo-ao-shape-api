/// <reference types="multer" />
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckInDto } from './dto/create-checkin.dto';
import { FirebaseStorageService } from '../storage/firebase-storage.service';

@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: FirebaseStorageService,
  ) {}

  async create(dto: CreateCheckInDto, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('A foto de comprovação do treino é obrigatória.');
    }

    // 1. Valida se o monstro tá ativo no desafio
    const participant = await this.prisma.participant.findUnique({
      where: { challengeId_userId: { challengeId: dto.challengeId, userId: dto.userId } },
      include: {
        challenge: true,
      }
    });

    if (!participant || participant.status !== 'ACTIVE') {
      throw new BadRequestException('Usuário não está ativo ou inscrito neste desafio.');
    }

    const desafioStatus = participant.challenge.status;

    if (desafioStatus === 'PENDING') {
      throw new BadRequestException('Segura a ansiedade, monstro! Este desafio ainda não começou.');
    }

    if (desafioStatus === 'FINISHED') {
      throw new BadRequestException('O jogo acabou! Este desafio já foi finalizado e não aceita novos treinos.');
    }
    
    if (desafioStatus !== 'ACTIVE') {
       throw new BadRequestException('Não é permitido enviar check-ins para este desafio no momento.');
    }

    const hojeInicio = new Date();
    hojeInicio.setHours(0, 0, 0, 0);
    const hojeFim = new Date();
    hojeFim.setHours(23, 59, 59, 999);

    const jaTemValidHoje = await this.prisma.checkIn.findFirst({
      where: {
        userId: dto.userId,
        challengeId: dto.challengeId,
        status: 'VALID',
        createdAt: { gte: hojeInicio, lte: hojeFim },
      },
    });

    const agora = new Date();
    const diaDaSemana = agora.getDay(); // 0 = Domingo, 1 = Segunda, 2 = Terça...
    const distanciaParaSegunda = diaDaSemana === 0 ? -6 : 1 - diaDaSemana; // Ajuste para a semana começar na Segunda
    
    const inicioDaSemana = new Date(agora);
    inicioDaSemana.setDate(agora.getDate() + distanciaParaSegunda);
    inicioDaSemana.setHours(0, 0, 0, 0);

    const totalValidosNaSemana = await this.prisma.checkIn.count({
      where: {
        userId: dto.userId,
        challengeId: dto.challengeId,
        status: 'VALID',
        createdAt: { gte: inicioDaSemana },
      },
    });

    const limitePermitidoDoDesafio = participant.challenge.metaSemanal;

    // 🧠 REGRA DE NEGÓCIO: Se já tem um válido hoje, o novo entra como 'BONUS'. Se não, entra como 'VALID'.
    let statusFinal: 'VALID' | 'BONUS' = 'VALID';
    let message = 'Treino pago com sucesso! Computado na meta da semana! 🏁';

    if (jaTemValidHoje) {
      statusFinal = 'BONUS';
      message = 'Mais um pra conta, monstro! Postado como treino bônus no feed (Você já treinou hoje). 🏋️‍♂️';
    } else if (totalValidosNaSemana >= limitePermitidoDoDesafio) {
      statusFinal = 'BONUS';
      message = `Meta semanal batida (${totalValidosNaSemana}/${limitePermitidoDoDesafio})! Postado como treino bônus no feed. Segue o plano! 🔥`;
    }

    // 3. Executa o Upload para o Storage e captura a URL pública
    const imageUrl = await this.storageService.uploadPhoto(file, 'checkins', dto.userId);

    const storagePath = `checkins/${dto.userId}/${file.originalname}`;

    // 4. Grava no Postgres
    const checkin = await this.prisma.checkIn.create({
      data: {
        userId: dto.userId,
        challengeId: dto.challengeId,
        latitude: Number(dto.latitude),
        longitude: Number(dto.longitude),
        deviceUuid: dto.deviceUuid,
        source: 'APP',
        status: statusFinal === 'BONUS' ? undefined : (statusFinal as any),
        title: dto.title || null,
        description: dto.description || null,
        activity: dto.activity || null,
        duration: dto.duration ? Number(dto.duration) : null,
        distance: dto.distance ? Number(dto.distance) : null,
        calories: dto.calories ? Number(dto.calories) : null,
        steps: dto.steps ? Number(dto.steps) : null,
        image: {
          create: {
            url: imageUrl,
            storagePath: storagePath,
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeInBytes: file.size,
          },
        },
      },
      include: {
        image: true, // Já retorna os dados do arquivo no JSON para o Flutter
      },
    });

    return {
      message,
      checkin,
    };
  }

  // Listar treinos de um utilizador num desafio específico (Placar de Progresso)
  async getHistory(challengeId: string, userId: string) {
    return this.prisma.checkIn.findMany({
      where: { challengeId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}