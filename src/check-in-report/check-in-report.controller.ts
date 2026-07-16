import { 
  Controller, 
  Post, 
  Get, 
  Patch, 
  Body, 
  Param, 
  UseGuards, 
  Request, 
  Query 
} from '@nestjs/common';
import { CheckInReportService } from './check-in-report.service';
import { CreateCheckInReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Ajuste o caminho do seu guard
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse, 
  ApiBearerAuth, 
  ApiParam, 
  ApiQuery 
} from '@nestjs/swagger';

@ApiTags('Check-In Reports (Denúncias)') // Agrupa essa rota no Swagger UI
@ApiBearerAuth() // 🔒 Exige o Token JWT para os testes pelo Swagger
@Controller('check-in-reports')
@UseGuards(JwtAuthGuard) // Garante que apenas usuários logados acessem estas rotas
export class CheckInReportController {
  constructor(private readonly checkInReportService: CheckInReportService) {}

  /**
   * Rota: POST /check-in-reports/:checkInId/report
   * Descrição: Um participante denuncia o check-in de outro usuário.
   */
  @Post(':checkInId/report')
  @ApiOperation({ summary: 'Criar uma denúncia/pedido de reanálise de um check-in' })
  @ApiParam({ 
    name: 'checkInId', 
    type: 'string', 
    format: 'uuid', 
    description: 'ID do check-in (treino) que será denunciado' 
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Denúncia registrada com sucesso! Aguardando moderação.' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Não é possível denunciar seu próprio treino, ou denúncia duplicada.' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Token inválido ou ausente.' 
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Apenas participantes ativos do mesmo desafio podem denunciar este check-in.' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Check-in não encontrado.' 
  })
  async createReport(
    @Param('checkInId') checkInId: string,
    @Request() req: any,
    @Body() dto: CreateCheckInReportDto,
  ) {
    const reporterId = req.user.id; // ID do usuário logado vindo do JWT
    return this.checkInReportService.createReport(checkInId, reporterId, dto);
  }

  /**
   * Rota: GET /check-in-reports/challenge/:challengeId/pending
   * Descrição: O criador do desafio busca as denúncias que estão aguardando julgamento.
   */
  @Get('challenge/:challengeId/pending')
  @ApiOperation({ summary: 'Listar todas as denúncias pendentes de um desafio (Apenas para o criador)' })
  @ApiParam({ 
    name: 'challengeId', 
    type: 'string', 
    format: 'uuid', 
    description: 'ID do desafio do qual deseja buscar as denúncias' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lista de denúncias pendentes retornada com sucesso.' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Token inválido ou ausente.' 
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Apenas o criador do desafio pode visualizar as denúncias.' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Desafio não encontrado.' 
  })
  async getPendingReports(
    @Param('challengeId') challengeId: string,
    @Request() req: any,
  ) {
    const adminId = req.user.id;
    return this.checkInReportService.getPendingReportsForAdmin(challengeId, adminId);
  }

  /**
   * Rota: PATCH /check-in-reports/:reportId/decision
   * Descrição: O criador do desafio aceita (APPROVE) ou recusa (REJECT) a denúncia.
   */
  @Patch(':reportId/decision')
  @ApiOperation({ summary: 'Julgar uma denúncia de check-in (Aprovar/Invalidar ou Rejeitar)' })
  @ApiParam({ 
    name: 'reportId', 
    type: 'string', 
    format: 'uuid', 
    description: 'ID da denúncia que será julgada' 
  })
  @ApiQuery({ 
    name: 'action', 
    enum: ['APPROVE', 'REJECT'], 
    description: 'Ação do julgamento. APPROVE: Aceita denúncia (invalida o treino). REJECT: Ignora a denúncia (mantém o treino válido).' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Julgamento realizado com sucesso.' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Ação inválida ou denúncia já julgada/encerrada.' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Token inválido ou ausente.' 
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Apenas o criador do desafio correspondente pode julgar essa denúncia.' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Denúncia não encontrada.' 
  })
  async handleDecision(
    @Param('reportId') reportId: string,
    @Request() req: any,
    @Query('action') action: 'APPROVE' | 'REJECT',
  ) {
    const adminId = req.user.id;
    return this.checkInReportService.handleReportDecision(reportId, adminId, action);
  }
}