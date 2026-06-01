import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AsaasService } from 'src/payment/asaas.service';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasService: AsaasService,
  ) {}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // 1. Busca o usuário atual
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const updateData: any = {};

    if (dto.name) updateData.name = dto.name;

    if (dto.avatarUrl) updateData.avatarUrl = dto.avatarUrl;

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
}