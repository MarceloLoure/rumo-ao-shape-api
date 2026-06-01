import { Injectable, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ParticipantStatus } from '@prisma/client';
import * as admin from 'firebase-admin';
import { LoginSocialDto } from './dto/login-social.dto';
import { RegisterManualDto } from './dto/register-manual.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private readonly userIncludeOptions = {
    participations: {
      where: { status: ParticipantStatus.ACTIVE },
      include: { challenge: true },
    },
  };

  async loginWithFirebase(firebaseToken: string) {
    try {
      let uid: string;
      let email: string;
      let name: string;
      let picture: string | null = null;

      // ─── BYPASS PARA TESTE LOCAL ───
      if (process.env.NODE_ENV === 'development' && firebaseToken === 'teste_local') {
        uid = 'mock_firebase_uid_12345';
        email = 'monstro_do_treino@teste.com';
        name = 'Cavaleiro do Shape';
        picture = 'https://via.placeholder.com/150';
      } else {
        const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
        uid = decodedToken.uid;
        email = decodedToken.email ?? '';
        name = decodedToken.name;
        picture = decodedToken.picture || null;
      }

      if (!email) {
        throw new UnauthorizedException('O e-mail é obrigatório no provedor social.');
      }

      // 2. Busca o usuário no Postgres incluindo as participações
      let user = await this.prisma.user.findUnique({
        where: { firebaseUid: uid },
        include: this.userIncludeOptions,
      });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            firebaseUid: uid,
            email: email,
            name: name,
            avatarUrl: picture,
          },
          include: this.userIncludeOptions,
        });
        console.log(`👤 Novo usuário criado no Postgres: ${user.name}`);
      }

      // 3. Prepara o Payload do NOSSO JWT de sessão
      const payload = { 
        sub: user.id, 
        email: user.email,
        name: user.name 
      };

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          cpf: user.cpf, // 🚨 ADICIONADO: Retorna o CPF no login social
          avatarUrl: user.avatarUrl, // 🚨 ADICIONADO: Garante o avatarUrl atualizado do banco
          walletBalance: user.walletBalance,
          // 🚨 ADICIONADO: Mapeia os desafios ativos direto aqui também
          activeChallenges: (user.participations || []).map((p: any) => ({
            id: p.challenge.id,
            name: p.challenge.name,
            taxaInscricao: p.challenge.taxaInscricao,
            valorCaucao: p.challenge.valorCaucao,
          })),
        },
        backend_token: this.jwtService.sign(payload),
      };

    } catch (error) {
      console.error('Erro na autenticação:', error);
      throw new UnauthorizedException('Autenticação inválida ou token expirado.');
    }
  }

  async registerManual(dto: RegisterManualDto) {
    const emailLower = dto.email.toLowerCase();

    const userExists = await this.prisma.user.findUnique({ where: { email: emailLower } });
    if (userExists) {
      throw new ConflictException('Este e-mail já está cadastrado no Rumo ao Shape.');
    }

    if (!dto.password) {
      throw new BadRequestException('A senha é obrigatória para cadastro manual.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: emailLower,
        name: dto.name,
        passwordHash,
      },
      include: this.userIncludeOptions,
    });

    return this.generateToken(user);
  }

  // 2. LOGIN MANUAL (Validação de E-mail e Senha)
  async loginManual(email: string, pass: string) {
    // 🚨 CORRIGIDO: Adicionado o include das participações na busca do login manual
    const user = await this.prisma.user.findUnique({ 
      where: { email: email.toLowerCase() },
      include: this.userIncludeOptions,
    });

    if (!user || !user.passwordHash) {
      throw new BadRequestException('E-mail ou senha inválidos.');
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('E-mail ou senha inválidos.');
    }

    return this.generateToken(user);
  }

  // 3. FLUXO UNIFICADO: LOGIN/CADASTRO SOCIAL (Google e Apple)
  async loginOrRegisterSocial(dto: LoginSocialDto) {
    const emailLower = dto.email.toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email: emailLower },
      include: this.userIncludeOptions, // 🚨 ADICIONADO: Include aqui para garantir consistência
    });

    if (existingUser) {
      if (!existingUser.firebaseUid) {
        const updatedUser = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { firebaseUid: dto.firebaseUid, avatarUrl: dto.avatarUrl || existingUser.avatarUrl },
          include: this.userIncludeOptions,
        });
        return this.generateToken(updatedUser);
      }
      return this.generateToken(existingUser);
    }

    const newUser = await this.prisma.user.create({
      data: {
        email: emailLower,
        name: dto.name,
        firebaseUid: dto.firebaseUid,
        avatarUrl: dto.avatarUrl,
      },
      include: this.userIncludeOptions,
    });

    return this.generateToken(newUser);
  }

  // Helper para gerar o JWT interno da nossa API
  private generateToken(user: any) {
    const payload = { sub: user.id, email: user.email, plan: user.plan };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        cpf: user.cpf, // 🚨 CORRIGIDO: Adicionado o campo CPF no payload centralizado
        plan: user.plan,
        avatarUrl: user.avatarUrl, // 🚨 CORRIGIDO: Força a entrega do link do avatar correto
        walletBalance: user.walletBalance,
        activeChallenges: (user.participations || []).map((p: any) => ({
          id: p.challenge.id,
          name: p.challenge.name,
          taxaInscricao: p.challenge.taxaInscricao,
          valorCaucao: p.challenge.valorCaucao,
        })),
      }
    };
  }
}