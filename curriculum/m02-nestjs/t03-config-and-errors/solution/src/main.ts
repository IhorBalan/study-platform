import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './config/env.js';

const app = await NestFactory.create(AppModule);
const env = app.get<Env>(ENV);
// Loopback only: this API is for local practice.
await app.listen(env.PORT, '127.0.0.1');
