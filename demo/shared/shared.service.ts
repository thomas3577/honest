import * as log from '@std/log';
import { Injectable } from '../../mod.ts';
import type { OnModuleDestroy, OnModuleInit } from '../../mod.ts';

@Injectable()
export class SharedService implements OnModuleInit, OnModuleDestroy {
  public get content(): string {
    return 'TEST';
  }

  onModuleInit(): void {
    log.info('SharedService: initialized');
  }

  onModuleDestroy(): void {
    log.info('SharedService: destroyed');
  }
}
