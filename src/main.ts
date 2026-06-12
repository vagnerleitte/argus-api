import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Argus API')
    .setDescription('API para receber artefatos de acessibilidade, processar com IA e retornar relatórios Argus.')
    .setVersion('0.1.0')
    .addTag('applications', 'Cadastro, upload e consulta de aplicações analisadas pelo Argus')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(3000);
  console.log('API disponível em http://localhost:3000');
  console.log('Swagger disponível em http://localhost:3000/docs');
}

bootstrap();
