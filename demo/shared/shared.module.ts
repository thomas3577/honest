import { Module } from '../../mod.ts';

import { SharedService } from './shared.service.ts';

@Module({
  providers: [
    SharedService,
  ],
})
export class SharedModule {}
