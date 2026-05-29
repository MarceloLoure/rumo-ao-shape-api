import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

export const initializeFirebaseAdmin = () => {
  if (admin.apps.length > 0) return;

  const serviceAccountPath = path.resolve(process.cwd(), 'firebase-service-account.json');

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'rumo-ao-shape-mock.appspot.com';

  // Se o arquivo real existir, usa ele (Produção / Homologação)
  if (fs.existsSync(serviceAccountPath)) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
      });
      console.log('🔥 Firebase Admin SDK inicializado com as credenciais reais.');
    } catch (error) {
      console.error('❌ Erro ao inicializar o Firebase Real:', error);
    }
  } else if (process.env.NODE_ENV === 'development') {
    // Se não existir mas estiver em desenvolvimento, inicializa em modo Mock para não quebrar a API
    try {
      admin.initializeApp({
        projectId: 'rumo-ao-shape-mock', // Nome fictício para passar na validação local
      });
      console.log('🧪 Firebase Admin SDK inicializado em MODO MOCK para testes locais.');
    } catch (error) {
      console.error('❌ Erro ao inicializar o Firebase Mock:', error);
    }
  } else {
    console.error('❌ Arquivo firebase-service-account.json não encontrado e NODE_ENV não é development.');
  }
};