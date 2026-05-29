import * as dotenv from 'dotenv';
// Carrega o .env antes de qualquer outro import interno da aplicação
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { initializeFirebaseAdmin } from './auth/firebase-admin.config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Inicializa o Firebase Admin (agora preparado para o bypass local)
  initializeFirebaseAdmin();

  // Permite receber requisições do Postman/Flutter sem bloqueio de CORS
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Rumo ao Shape API')
    .setDescription('Documentação oficial do ecossistema financeiro e de desafios do Rumo ao Shape')
    .setVersion('1.0')
    .addBearerAuth() // Adiciona o campo para colar o Token JWT se precisar testar rotas travadas
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT || 3000, '0.0.0.0');
  console.log(`🚀 API a rodar na porta: ${process.env.PORT || 3000}`);
}
bootstrap();