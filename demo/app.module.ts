import { Module } from '../mod.ts';

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
  routePrefix: 'v1',
})
export class AppModule {}
