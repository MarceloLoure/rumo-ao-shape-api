import { Controller, Post, Get, Body, Param, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChallengeService } from './challenge.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('challenges')
@ApiTags('Challenges')
export class ChallengeController {
  constructor(private readonly challengeService: ChallengeService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({ summary: 'Criar um novo desafio' })
  @ApiResponse({ status: 201, description: 'Desafio criado com sucesso' })
  async create(
    @Body() dto: CreateChallengeDto,
    @UploadedFile() image: Express.Multer.File
  ) {
    return this.challengeService.create(dto, image);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos os desafios' })
  @ApiResponse({ status: 200, description: 'Lista de desafios retornada com sucesso' })
  async findAll() {
    return this.challengeService.findAll();
  }

  @Get('creator/:userId')
  @ApiOperation({ summary: 'Busca os desafios criados e gerenciados por um usuário específico' })
  async getCreatedByUser(@Param('userId') userId: string) {
    return this.challengeService.findCreatedBy(userId);
  }

  @Get('active-participations/:userId')
  @ApiOperation({ summary: 'Busca os desafios onde o usuário está participando ativamente no momento' })
  async getActiveParticipations(@Param('userId') userId: string) {
    return this.challengeService.findActiveParticipations(userId);
  }

  @Get('history/:userId')
  @ApiOperation({ summary: 'Busca o histórico completo de todas as inscrições (ativas ou não) do usuário' })
  async getUserHistory(@Param('userId') userId: string) {
    return this.challengeService.findHistory(userId);
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Participar de um desafio' })
  @ApiResponse({ status: 200, description: 'Usuário entrou no desafio com sucesso' })
  join(
    @Param('id') challengeId: string,
    @Body('userId') userId: string
  ) {
    return this.challengeService.joinChallenge(challengeId, userId);
  }

  @Post(':id/leave')
  @ApiOperation({ summary: 'Sair de um desafio' })
  @ApiResponse({ status: 200, description: 'Usuário saiu do desafio com sucesso' })
  leave(
    @Param('id') challengeId: string,
    @Body('userId') userId: string // O Flutter envia o userId no corpo da requisição
  ) {
    return this.challengeService.leaveChallenge(challengeId, userId);
  }
}