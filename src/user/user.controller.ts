import { Controller, Post, Get, Patch, Query, Param, Body, ParseFloatPipe, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GetInvoicesQueryDto } from './dto/get-incoices.dto';
import { GetChallengeInvoicesQueryDto } from './dto/GetChallengeInvoicesQueryDto.dto';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Patch(':id/profile')
  @UseInterceptors(FileInterceptor('image')) // 🌟 Captura o campo "image" do multipart
  @ApiConsumes('multipart/form-data') // 🌟 Avisa o Swagger que aceita arquivos
  @ApiOperation({ summary: 'Atualiza dados do perfil do usuário (Nome, CPF, Avatar)' })
  @ApiResponse({ status: 200, description: 'Perfil updated com sucesso.' })
  @ApiResponse({ status: 400, description: 'Dados inválidos ou CPF mal formatado.' })
  @ApiResponse({ status: 409, description: 'CPF já está em uso.' })
  async updateProfile(
   @CurrentUser() user: any,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() file?: Express.Multer.File, // 🌟 Injeta o arquivo físico recebido aqui
  ) {
    return this.userService.updateProfile(user.id, dto, file);
  }

  @Post(':id/deposit')
  @ApiTags('Users')
  @ApiOperation({ summary: 'Realizar um depósito de teste via PIX' })
  @ApiResponse({ status: 200, description: 'Depósito de teste realizado com sucesso' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.' })
  async deposit(
    @CurrentUser() user: any,
    @Body('amount', ParseFloatPipe) amount: number,
  ) {
    return this.userService.deposit(user.id, amount);
  }

  @Patch('fcm-token')
  @ApiTags('Users')
  @ApiOperation({ summary: 'Atualizar o token FCM de um usuário' })
  @ApiResponse({ status: 200, description: 'Token FCM atualizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Usuário não encontrado.' })
  updateFcmToken(@Body() dto: UpdateFcmTokenDto) {
    return this.userService.updateFcmToken(dto);
  }

  @Get(':id/pending-invoices')
  @ApiOperation({ summary: 'Busca faturas em aberto/pendentes de pagamento do usuário' })
  async getPending(
    @CurrentUser() user: any,
  ) {
    return this.userService.getPendingInvoices(user.id);
  }

  @Get(':id/invoices')
  @ApiOperation({ summary: 'Histórico de faturas completo, paginado e filtrável do usuário' })
  async getHistory(
      @CurrentUser() user: any,
      @Query() query: GetInvoicesQueryDto,
    ) {
      return this.userService.getUserInvoicesHistory(user.id, query);
  }

  @Patch('invoices/:id/manual-confirm')
  @ApiOperation({ summary: 'Administrador confirma o pagamento de uma fatura por fora (dinheiro/PIX direto)' })
  async manualConfirmInvoice(
    @Param('id') invoiceId: string,
    @CurrentUser() admin: any,
  ) {
    return this.userService.confirmInvoiceManually(invoiceId, admin.id);
  }

  @Get('challenges/:challengeId/pending-invoices')
  @ApiOperation({ summary: 'Admin busca todas as faturas pendentes dos participantes do seu desafio' })
  async getChallengePending(
    @Param('challengeId') challengeId: string,
    @CurrentUser() admin: any,
    @Query() query: GetChallengeInvoicesQueryDto,
  ) {
    return this.userService.getChallengePendingInvoices(challengeId, admin.id, query);
  }

}