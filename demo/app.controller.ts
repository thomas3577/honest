import { Controller, Get, headers, inject, UseGuard } from '../mod.ts';

import { AppConfig } from './app.config.ts';
import { AuthGuard } from './auth.guard.ts';
import { SharedService } from './shared/shared.service.ts';

@Controller()
export class AppController {
  constructor(
    private readonly _sharedService = inject(SharedService),
    private readonly _config = inject(AppConfig),
  ) {}

  @Get([headers<string>('user-agent')])
  get(userAgent: string) {
    return { status: 'ok', userAgent };
  }

  @Get('shared')
  getShared() {
    return this._sharedService.content;
  }

  @Get('config')
  getConfig() {
    return this._config.value;
  }

  @UseGuard(AuthGuard)
  @Get('admin')
  admin() {
    return { status: 'ok', secret: true };
  }
}
