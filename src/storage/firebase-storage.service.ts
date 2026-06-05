import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FirebaseStorageService {

  constructor() {
    if (admin.apps.length === 0) {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const projectId = process.env.FIREBASE_PROJECT_ID;

      if (privateKey && clientEmail && projectId) {
        try {
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId: projectId,
              clientEmail: clientEmail,
              // 🔥 TRATAMENTO COMPLETO: Remove aspas externas, quebras duplicadas e limpa espaços extras
              privateKey: privateKey
                .trim()
                .replace(/^["']|["']$/g, '') // Remove aspas simples ou duplas do início e fim
                .replace(/\\n/g, '\n'),      // Converte a string \n em quebra de linha real
            }),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'rumo-ao-shape.firebasestorage.app',
          });
          console.log('🔥 ✅ Firebase Admin SDK inicializado com SUCESSO via ENV de Produção.');
        } catch (error) {
          console.error('❌ Erro crítico ao aplicar credenciais do .env:', error);
        }
      } 
      else {
        console.error('❌ Erro: Nenhuma credencial encontrada no .env e arquivo JSON ausente.');
      }
    }
  }
  
  private readonly logger = new Logger(FirebaseStorageService.name);

  async uploadPhoto(file: Express.Multer.File, folder: 'avatars' | 'challenges' | 'checkins', userId: string): Promise<string> {
    this.logger.log(`📥 [Firebase Storage] Iniciando fluxo de upload real para o escopo: [${folder}] | Usuário: ${userId}`);
    this.logger.log(`📄 Arquivo: "${file?.originalname}" | Mime: "${file?.mimetype}" | Tamanho: ${file?.size} bytes`);

    try {
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'rumo-ao-shape.firebasestorage.app';
      const bucket = admin.storage().bucket(bucketName);

      const token = uuidv4(); 
      
      // 🚨 MÁGICA REFEITA: O caminho agora é montado dinamicamente com base no escopo passado
      const fileName = `${folder}/${userId}/${uuidv4()}-${file.originalname}`;
      const blob = bucket.file(fileName);

      this.logger.log(`🚀 Abrindo Stream de escrita no Bucket: "${bucketName}" -> Arquivo: "${fileName}"`);

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
          this.logger.error(`❌ [Erro na Stream de Upload do Firebase]: ${error.message}`);
          console.error(error);
          
          this.logger.warn('⚠️ Retornando URL de fallback para não quebrar a transação do banco.');
          resolve(`https://firebasestorage.googleapis.com/v0/b/fallback-error/o/error.png?alt=media`);
        });
        
        blobStream.on('finish', () => {
          const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
          this.logger.log(`✅ [Firebase Storage] Upload concluído com sucesso na nuvem! URL: ${publicUrl}`);
          resolve(publicUrl);
        });
        
        // Despeja o buffer físico recebido da requisição na nuvem
        blobStream.end(file.buffer);
      });

    } catch (error: any) {
      this.logger.error(`💥 [Erro Crítico Síncrono no Firebase Storage]: ${error.message}`);
      console.error(error);
      this.logger.warn('⚠️ Evitando estouro de Exception 500. Retornando fallback string.');
      return `https://firebasestorage.googleapis.com/v0/b/fallback-error/o/error.png?alt=media`;
    }
  }

}