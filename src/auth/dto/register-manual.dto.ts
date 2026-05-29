export class RegisterManualDto {
  email: string;
  name: string;
  password?: string; // Opcional se vier do fluxo social posteriormente
  firebaseUid?: string; // Opcional se for puramente manual de início
}