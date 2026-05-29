import * as dotenv from 'dotenv';
// Carrega o .env antes de qualquer outro import interno da aplicação
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { initializeFirebaseAdmin } from './auth/firebase-admin.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Inicializa o Firebase Admin (agora preparado para o bypass local)
  initializeFirebaseAdmin();

  // Permite receber requisições do Postman/Flutter sem bloqueio de CORS
  app.enableCors();

  await app.listen(process.env.PORT || 3000, '0.0.0.0');
  console.log(`🚀 API a rodar na porta: ${process.env.PORT || 3000}`);
}
bootstrap();