import { Controller, Post, Patch, Param, Body, ParseFloatPipe, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
    @Param('id') userId: string,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() file?: Express.Multer.File, // 🌟 Injeta o arquivo físico recebido aqui
  ) {
    return this.userService.updateProfile(userId, dto, file);
  }

  @Post(':id/deposit')
  @ApiTags('Users')
  @ApiOperation({ summary: 'Realizar um depósito de teste via PIX' })
  @ApiResponse({ status: 200, description: 'Depósito de teste realizado com sucesso' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.' })
  async deposit(
    @Param('id') userId: string,
    @Body('amount', ParseFloatPipe) amount: number,
  ) {
    return this.userService.deposit(userId, amount);
  }

  @Patch('fcm-token')
  @ApiTags('Users')
  @ApiOperation({ summary: 'Atualizar o token FCM de um usuário' })
  @ApiResponse({ status: 200, description: 'Token FCM atualizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Usuário não encontrado.' })
  updateFcmToken(@Body() dto: UpdateFcmTokenDto) {
    return this.userService.updateFcmToken(dto);
  }


}