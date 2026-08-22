import { Controller, Get, headers, inject } from '../mod.ts';

import { SharedService } from './shared/shared.service.ts';

@Controller()
export class AppController {
  constructor(private readonly _sharedService = inject(SharedService)) {}

  @Get([headers<string>('user-agent')])
  get(userAgent: string) {
    return { status: 'ok', userAgent };
  }

  @Get('shared')
  getShared() {
    return this._sharedService.content;
  }
}
