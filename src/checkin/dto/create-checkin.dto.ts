export class CreateCheckInDto {
  userId: string;
  challengeId: string;
  latitude: string | number;
  longitude: string | number;
  deviceUuid: string;
}