import { Injectable } from '../../mod.ts';

@Injectable()
export class SharedService {
  public get content(): string {
    return 'TEST';
  }
}
