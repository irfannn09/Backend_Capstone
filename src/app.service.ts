import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'inventarisMuhamka Backend API is running';
  }
}
