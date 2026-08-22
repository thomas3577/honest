import { Injectable } from '../../mod.ts';

@Injectable()
export class SampleService {
  get() {
    return { value: 123, status: 'ok' };
  }
}
