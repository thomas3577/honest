import { Module } from '../../mod.ts';

import { SharedModule } from '../shared/shared.module.ts';
import { SampleController } from './sample.controller.ts';
import { SampleService } from './sample.service.ts';

@Module({
  modules: [
    SharedModule,
  ],
  controllers: [
    SampleController,
  ],
  providers: [
    SampleService,
  ],
  routePrefix: 'sample',
})
export class SampleModule {}
