import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
// TODO: take the port from the typed config (app.get(ENV)) instead of process.env.
// Loopback only: this API is for local practice.
await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
