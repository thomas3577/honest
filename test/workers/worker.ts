import { env } from 'cloudflare:workers';

import { assignModule, Config, Controller, errorHandler, Get, inject, Injectable, ip, Module } from '../../mod.ts';
import type { StandardSchema } from '../../mod.ts';

const greetingSchema: StandardSchema<unknown, { GREETING: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => {
      const greeting = (value as Record<string, unknown>).GREETING;

      return typeof greeting === 'string' ? { value: { GREETING: greeting } } : { issues: [{ message: 'GREETING is required' }] };
    },
  },
};

@Injectable()
class AppConfig extends Config(greetingSchema, () => env as unknown as Record<string, unknown>) {}

@Controller('hello')
class HelloController {
  constructor(private readonly config = inject(AppConfig)) {}

  @Get()
  hello() {
    return { greeting: this.config.value.GREETING };
  }

  @Get('ip', [ip()])
  ip(address: string) {
    return { ip: address };
  }
}

@Module({ controllers: [HelloController], providers: [AppConfig] })
class AppModule {}

const app = assignModule(AppModule);
app.onError(errorHandler());

export default app;
