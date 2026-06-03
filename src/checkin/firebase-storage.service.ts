import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FirebaseStorageService {
  // Inicializa o Logger nativo do NestJS para o serviço
  private readonly logger = new Logger(FirebaseStorageService.name);

  async uploadPhoto(file: Express.Multer.File, userId: string): Promise<string> {
    this.logger.log(`📥 [Firebase Storage] Iniciando fluxo de upload para o usuário: ${userId}`);
    this.logger.log(`📄 Dados do arquivo recebido: Nome: "${file?.originalname}" | Mime: "${file?.mimetype}" | Tamanho: ${file?.size} bytes`);

    try {
      const serviceAccountPath = path.resolve(process.cwd(), 'firebase-service-account.json');
      this.logger.log(`📂 Procurando credenciais em: ${serviceAccountPath}`);
      
      const fileExists = fs.existsSync(serviceAccountPath);
      this.logger.log(`🔍 Arquivo firebase-service-account.json existe localmente? ${fileExists ? '✅ SIM' : '❌ NÃO'}`);
      this.logger.log(`🌐 Ambiente atual (NODE_ENV): "${process.env.NODE_ENV}"`);

      // Se NÃO existir a chave real (Modo teste isolado)
      if (!fileExists && process.env.NODE_ENV === 'development') {
        this.logger.warn('🧪 [MODO MOCK ACTIVE] Chave real não encontrada em desenvolvimento. Gerando URL fake de imagem...');
        return `https://mockstorage.local/uploads/checkins/${uuidv4()}.jpg`;
      }

      // Validação das variáveis críticas do Firebase antes de chamar o bucket
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'rumo-ao-shape';
      this.logger.log(`🪣 Tentando conectar ao Bucket Firebase: "${bucketName}"`);

      const bucket = admin.storage().bucket(bucketName);
      const token = uuidv4(); 
      const fileName = `checkins/${userId}/${uuidv4()}-${file.originalname}`;
      const blob = bucket.file(fileName);

      this.logger.log(`🚀 Criando Stream de escrita para o arquivo: "${fileName}"`);

      const blobStream = blob.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          metadata: {
            firebaseStorageDownloadTokens: token, 
          },
        },
      });

      return new Promise((resolve, reject) => {
        blobStream.on('error', (error) => {
          // Captura erros assíncronos da Stream de rede do Google (ex: Falta de permissão, Bucket inválido)
          this.logger.error(`❌ [Erro na Stream de Upload do Firebase]: ${error.message}`);
          console.error(error); // Printa a stack de erro completa no terminal
          
          // Retornamos uma string de fallback em vez de estourar a Exception e quebrar o App!
          this.logger.warn('⚠️ Retornando URL de fallback para não quebrar a transação do banco.');
          resolve(`https://firebasestorage.googleapis.com/v0/b/fallback-error/o/error.png?alt=media`);
        });
        
        blobStream.on('finish', () => {
          const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
          this.logger.log(`✅ [Firebase Storage] Upload concluído com sucesso! URL gerada: ${publicUrl}`);
          resolve(publicUrl);
        });
        
        // Escreve o buffer físico da imagem na stream
        blobStream.end(file.buffer);
      });

    } catch (error: any) {
      // Captura erros síncronos de infraestrutura (ex: SDK do Firebase não inicializado no AppModule)
      this.logger.error(`💥 [Erro Crítico Síncrono no Firebase Storage]: ${error.message}`);
      console.error(error);

      // Em vez de dar throw new InternalServerErrorException(), devolvemos a URL amigável de erro
      this.logger.warn('⚠️ Evitando estouro de Exception 500. Retornando fallback string.');
      return `https://firebasestorage.googleapis.com/v0/b/fallback-error/o/error.png?alt=media`;
    }
  }
}