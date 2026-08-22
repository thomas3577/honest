import { body, Controller, Get, inject, ip, param, Post, query, scoped, validatedBody } from '../../mod.ts';
import type { StandardSchema } from '../../mod.ts';

import { SharedService } from '../shared/shared.service.ts';
import { RequestId } from './request-id.ts';
import { SampleService } from './sample.service.ts';

type CreateItem = { name: string };

// A minimal, hand-rolled Standard Schema (https://standardschema.dev) — in a
// real app, use Zod/Valibot/ArkType instead of writing this by hand.
const CreateItemSchema: StandardSchema<unknown, CreateItem> = {
  '~standard': {
    version: 1,
    vendor: 'honest-demo',
    validate: (value) => {
      if (typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string') {
        return { value: value as CreateItem };
      }

      return { issues: [{ message: 'name is required and must be a string' }] };
    },
  },
};

@Controller()
export class SampleController {
  constructor(
    private readonly _sampleService = inject(SampleService),
    private readonly _sharedService = inject(SharedService),
  ) {}

  @Get()
  get() {
    return this._sampleService.get();
  }

  @Post([body<Record<string, unknown>>()])
  post(body: Record<string, unknown>) {
    return body;
  }

  @Post('validated', [validatedBody(CreateItemSchema)])
  postValidated(item: CreateItem) {
    return { status: 'ok', item };
  }

  @Get('test/:id', [param<string>('id'), query<URLSearchParams>(), ip()])
  test(id: string, test: URLSearchParams, ipAddress: string) {
    return { id, ...Object.fromEntries(test), ip: ipAddress };
  }

  @Get('request-id', [scoped(RequestId)])
  getRequestId(requestId: RequestId) {
    return { requestId: requestId.value };
  }

  @Get('shared')
  getShared() {
    return this._sharedService.content;
  }
}
