import { Controller, Post, Patch, Param, Body, ParseFloatPipe } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

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