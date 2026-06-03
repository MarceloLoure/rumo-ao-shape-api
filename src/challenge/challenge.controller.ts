import { Controller, Post, Patch, Get, Body, Param, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChallengeService } from './challenge.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { ApiTags, ApiConsumes, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { UpdateChallengeDto } from './dto/update-challenge.dto';

@Controller('challenges')
@ApiBearerAuth()
@ApiTags('Challenges')
export class ChallengeController {
  constructor(private readonly challengeService: ChallengeService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cria um novo desafio (Com upload de capa)' })
  async create(
    @Body() dto: CreateChallengeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.challengeService.create(dto, file);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Edita dados de um desafio (Tranca textos/datas se já tiver começado)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateChallengeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.challengeService.update(id, dto, file);
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
    @CurrentUser() user: any
  ) {
    return this.challengeService.joinChallenge(challengeId, user.sub);
  }

  @Post(':id/leave')
  @ApiOperation({ summary: 'Sair de um desafio' })
  @ApiResponse({ status: 200, description: 'Usuário saiu do desafio com sucesso' })
  leave(
    @Param('id') challengeId: string,
    @CurrentUser() user: any
  ) {
    return this.challengeService.leaveChallenge(challengeId, user.sub);
  }
}