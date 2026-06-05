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
    });

    if (!participant || participant.status !== 'ACTIVE') {
      throw new BadRequestException('Usuário não está ativo ou inscrito neste desafio.');
    }

    // 2. Trava de segurança: Apenas 1 treino por dia
    const hojeInicio = new Date();
    hojeInicio.setHours(0, 0, 0, 0);
    const hojeFim = new Date();
    hojeFim.setHours(23, 59, 59, 999);

    const checkInDuplicado = await this.prisma.checkIn.findFirst({
      where: {
        userId: dto.userId,
        challengeId: dto.challengeId,
        createdAt: { gte: hojeInicio, lte: hojeFim },
      },
    });

    if (checkInDuplicado) {
      throw new BadRequestException('🔥 Calma monstro! Já registrou um treino hoje.');
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
        status: 'VALID',
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
      message: 'Treino pago com sucesso! Foto enviada para o painel. 🏁',
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