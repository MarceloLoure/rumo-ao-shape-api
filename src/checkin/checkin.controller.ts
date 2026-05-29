import { Controller, Post, Body, UseInterceptors, UploadedFile, Get, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CheckInService } from './checkin.service';
import { CreateCheckInDto } from './dto/create-checkin.dto';

@Controller('checkins')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
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
  async getHistory(
    @Query('challengeId') challengeId: string,
    @Query('userId') userId: string,
  ) {
    return this.checkInService.getHistory(challengeId, userId);
  }
}