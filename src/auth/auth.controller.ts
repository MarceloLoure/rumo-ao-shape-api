import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterManualDto } from './dto/register-manual.dto';
import { LoginSocialDto } from './dto/login-social.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('firebase')
  @HttpCode(HttpStatus.OK)
  async firebaseLogin(@Body('token') token: string) {
    return this.authService.loginWithFirebase(token);
  }

  @Post('register/manual')
  registerManual(@Body() dto: RegisterManualDto) {
    return this.authService.registerManual(dto);
  }

  @Post('login/manual')
  loginManual(@Body() body: any) {
    return this.authService.loginManual(body.email, body.password);
  }

  @Post('login/social')
  loginSocial(@Body() dto: LoginSocialDto) {
    return this.authService.loginOrRegisterSocial(dto);
  }
}