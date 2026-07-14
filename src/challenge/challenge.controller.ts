import { Controller, Post, Patch, Delete, Get, Body, Param, UseInterceptors, UploadedFile, UseGuards, BadRequestException, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChallengeService } from './challenge.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { ApiTags, ApiConsumes, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { JoinByCodeDto } from './dto/join-by-code.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetPendingApprovalsQueryDto } from './dto/GetPendingApprovalsQueryDto.dto';

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

  @Delete(':id')
  @ApiOperation({ summary: 'Deleta um desafio permanentemente (Aplica travas para planos Premium)' })
  @ApiResponse({ status: 200, description: 'Desafio removido com sucesso' })
  async delete(@Param('id') id: string) {
    return this.challengeService.delete(id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos os desafios' })
  @ApiResponse({ status: 200, description: 'Lista de desafios retornada com sucesso' })
  async findAll() {
    return this.challengeService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca os detalhes completos e a timeline de check-ins de um desafio específico por UUID' })
  @ApiResponse({ status: 200, description: 'Dados estruturados do desafio retornados com sucesso' })
  async findById(@Param('id') id: string) {
    return this.challengeService.findById(id);
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

  @Post('join-by-code')
  @ApiOperation({ summary: 'Entrar em um desafio utilizando um código de convite rápido' })
  @ApiResponse({ status: 200, description: 'Inscrição processada via código de convite' })
  async joinByCode(
    @Body() dto: JoinByCodeDto,
    @CurrentUser() user: any
  ) {
    const userId = user?.sub || user?.id;
    return this.challengeService.joinByCode(dto.inviteCode, userId);
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

  @Get(':id/ranking')
  @ApiOperation({ summary: 'Busca o ranking de usuários com mais check-ins válidos no desafio' })
  @ApiResponse({ status: 200, description: 'Ranking retornado com sucesso.' })
  @ApiResponse({ status: 404, description: 'Desafio não encontrado.' })
  async getChallengeRanking(@Param('id') challengeId: string) {
    return this.challengeService.getRanking(challengeId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('challenges/:challengeId/moderate/:participantId')
  @ApiOperation({ summary: 'Admin aprova ou rejeita um participante de forma manual' })
  async moderate(
    @Param('challengeId') challengeId: string,
    @Param('participantId') participantId: string,
    @CurrentUser() admin: any,
    @Body('action') action: 'APPROVE' | 'REJECT',
  ) {
    if (action !== 'APPROVE' && action !== 'REJECT') {
      throw new BadRequestException('Ação inválida. Use APPROVE ou REJECT.');
    }
    return this.challengeService.moderateParticipant(challengeId, participantId, admin.id, action);
  }

  @UseGuards(JwtAuthGuard)
  @Get('challenges/:challengeId/approvals')
  @ApiOperation({ summary: 'Admin lista solicitações de entrada pendentes ou aprovadas do seu desafio' })
  async getApprovals(
    @Param('challengeId') challengeId: string,
    @CurrentUser() admin: any,
    @Query() query: GetPendingApprovalsQueryDto,
  ) {
    return this.challengeService.getChallengeApprovals(challengeId, admin.id, query);
  }
}