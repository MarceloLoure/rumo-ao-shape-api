import { Controller, Post, Body, UseInterceptors, UploadedFile, Get, Query, Param } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CheckInService } from './checkin.service';
import { CreateCheckInDto } from './dto/create-checkin.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@Controller('checkins')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({ summary: 'Registrar um check-in' })
  @ApiResponse({ status: 201, description: 'Check-in registrado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos.' })
  async create(
    @Body() body: any, // Captura o objeto bruto do form-data
    @UploadedFile() file: Express.Multer.File,
  ) {
    // Monta o DTO garantindo que os dados textuais sejam repassados limpos
    const dto: CreateCheckInDto = {
      userId: body.userId,
      challengeId: body.challengeId,
      latitude: body.latitude,
      longitude: body.longitude,
      deviceUuid: body.deviceUuid,
    };

    return this.checkInService.create(dto, file);
  }

  @Get('history')
  @ApiOperation({ summary: 'Obter histórico de check-ins de um usuário em um desafio' })
  @ApiResponse({ status: 200, description: 'Histórico de check-ins retornado com sucesso' })
  @ApiResponse({ status: 400, description: 'Parâmetros inválidos.' })
  async getHistory(
    @Query('challengeId') challengeId: string,
    @CurrentUser() user: any,
  ) {
    return this.checkInService.getHistory(challengeId, user.sub);
  }
}