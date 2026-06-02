import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterManualDto } from './dto/register-manual.dto';
import { LoginSocialDto } from './dto/login-social.dto';
import { Public } from './decorators/public.decorator';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('firebase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login com Firebase' })
  @ApiResponse({ status: 200, description: 'Login realizado com sucesso' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado.' })
  async firebaseLogin(@Body('token') token: string) {
    return this.authService.loginWithFirebase(token);
  }

  @Public()
  @Post('register/manual')
  @ApiOperation({ summary: 'Registrar usuário manualmente' })
  @ApiResponse({ status: 201, description: 'Usuário registrado com sucesso' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado.' })
  registerManual(@Body() dto: RegisterManualDto) {
    return this.authService.registerManual(dto);
  }

  @Public()
  @Post('login/manual')
  @ApiOperation({ summary: 'Login manual' })
  @ApiResponse({ status: 200, description: 'Login realizado com sucesso' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas.' })
  loginManual(@Body() body: any) {
    return this.authService.loginManual(body.email, body.password);
  }

  @Public()
  @Post('login/social')
  @ApiOperation({ summary: 'Login com redes sociais' })
  @ApiResponse({ status: 200, description: 'Login realizado com sucesso' })
  @ApiResponse({ status: 409, description: 'Usuário não encontrado.' })
  loginSocial(@Body() dto: LoginSocialDto) {
    return this.authService.loginOrRegisterSocial(dto);
  }
}