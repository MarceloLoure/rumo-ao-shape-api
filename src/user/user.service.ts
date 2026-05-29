import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

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
}