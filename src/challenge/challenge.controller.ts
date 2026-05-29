import { Controller, Post, Get, Body, Param, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChallengeService } from './challenge.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';

@Controller('challenges')
export class ChallengeController {
  constructor(private readonly challengeService: ChallengeService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @Body() dto: CreateChallengeDto,
    @UploadedFile() image: Express.Multer.File
  ) {
    return this.challengeService.create(dto, image);
  }

  @Get()
  async findAll() {
    return this.challengeService.findAll();
  }

  @Post(':id/join')
  join(
    @Param('id') challengeId: string,
    @Body('userId') userId: string
  ) {
    return this.challengeService.joinChallenge(challengeId, userId);
  }

  @Post(':id/leave')
  leave(
    @Param('id') challengeId: string,
    @Body('userId') userId: string // O Flutter envia o userId no corpo da requisição
  ) {
    return this.challengeService.leaveChallenge(challengeId, userId);
  }
}