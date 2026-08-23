import { Module } from '../mod.ts';

import { AppConfig } from './app.config.ts';
import { AppController } from './app.controller.ts';
import { SampleModule } from './sample/sample.module.ts';
import { SharedModule } from './shared/shared.module.ts';

@Module({
  modules: [
    SampleModule,
    SharedModule,
  ],
  controllers: [
    AppController,
  ],
  providers: [
    AppConfig,
  ],
  routePrefix: 'v1',
})
export class AppModule {}
