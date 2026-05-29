import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseStorageService {
  async uploadPhoto(file: Express.Multer.File, userId: string): Promise<string> {
    try {
      const serviceAccountPath = path.resolve(process.cwd(), 'firebase-service-account.json');
      
      // Se NÃO existir a chave real (Modo teste isolado)
      if (!fs.existsSync(serviceAccountPath) && process.env.NODE_ENV === 'development') {
        console.log('🧪 Ignorando upload real. Gerando URL fake de imagem...');
        return `https://mockstorage.local/uploads/checkins/${uuidv4()}.jpg`;
      }

      const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || 'rumo-ao-shape');
      const token = uuidv4(); 
      const fileName = `checkins/${userId}/${uuidv4()}-${file.originalname}`;
      const blob = bucket.file(fileName);

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
          console.error('❌ Erro na Stream de Upload do Firebase:', error);
          reject(error);
        });
        
        blobStream.on('finish', () => {
          const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
          resolve(publicUrl);
        });
        
        blobStream.end(file.buffer);
      });
    } catch (error) {
      // PRINT CRUCIAL: Mostra o erro real do Google no seu terminal
      console.error('❌ Erro detalhado no upload do Firebase Storage:', error);
      throw new InternalServerErrorException('Falha ao enviar imagem para o servidor de arquivos.');
    }
  }
}