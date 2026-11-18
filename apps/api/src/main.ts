import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './config/env.js';
import { JSON_BODY_LIMIT } from './common/body-limit.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
const env = app.get<Env>(ENV);

app.setGlobalPrefix('api');
app.enableCors({ origin: env.WEB_ORIGIN });
app.enableShutdownHooks();

// Local-first: bind to loopback only so the API is never reachable from the network.
await app.listen(env.API_PORT, env.API_HOST);
new Logger('Bootstrap').log(`API listening on http://localhost:${env.API_PORT}/api`);
