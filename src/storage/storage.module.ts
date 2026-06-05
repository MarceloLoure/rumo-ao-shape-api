import { Module, Global } from '@nestjs/common';
import { FirebaseStorageService } from './firebase-storage.service';

@Global() 
@Module({
  providers: [FirebaseStorageService],
  exports: [FirebaseStorageService],
})
export class StorageModule {}