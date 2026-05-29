import { Controller, Post, Patch, Param, Body, ParseFloatPipe } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post(':id/deposit')
  async deposit(
    @Param('id') userId: string,
    @Body('amount', ParseFloatPipe) amount: number,
  ) {
    return this.userService.deposit(userId, amount);
  }

  @Patch('fcm-token')
  updateFcmToken(@Body() dto: UpdateFcmTokenDto) {
    return this.userService.updateFcmToken(dto);
  }
}