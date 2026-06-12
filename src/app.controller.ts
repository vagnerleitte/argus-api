import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { AppService } from './app.service';

class CreateApplicationDto {
  @ApiProperty({
    description: 'Nome da aplicação.',
    example: 'Music Catalog',
  })
  @IsString({ message: 'O campo name deve ser uma string.' })
  name!: string;

  @ApiPropertyOptional({
    description: 'Versão da aplicação.',
    example: '1.0.0',
  })
  @IsOptional()
  @IsString({ message: 'O campo version deve ser uma string.' })
  version?: string;

  @ApiPropertyOptional({
    description: 'Descrição curta da aplicação.',
    example: 'Aplicação demo com issues de acessibilidade.',
  })
  @IsOptional()
  @IsString({ message: 'O campo description deve ser uma string.' })
  description?: string;

  @ApiPropertyOptional({
    description: 'Caminho do arquivo associado à aplicação.',
    example: '/path/to/uploads/app.zip',
  })
  @IsOptional()
  @IsString({ message: 'O campo filePath deve ser uma string.' })
  filePath?: string;

  @ApiPropertyOptional({
    description: 'Nome do arquivo associado à aplicação.',
    example: 'app.zip',
  })
  @IsOptional()
  @IsString({ message: 'O campo fileName deve ser uma string.' })
  fileName?: string;
}

@ApiTags('applications')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('applications/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload de artefatos Argus',
    description:
      'Recebe um ZIP com artefatos de acessibilidade, como axe JSON, DOM renderizado e accessibility tree, processa com IA e retorna metadados do relatório gerado.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Arquivo ZIP contendo os artefatos Argus.',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Upload processado com sucesso.',
    schema: {
      example: {
        ok: true,
        message: 'Arquivo enviado com sucesso.',
        fileName: 'argus-artifacts.zip',
        storedAt: '/path/to/uploads/1780000000000-argus-artifacts.zip',
        size: 3002616,
        mimetype: 'application/zip',
        argusAnalysis: {
          artifactId: '1780000000000',
          analysisTimestamp: '2026-06-11T15-00-00-000Z',
          reportVersionId: '1780000000000-2026-06-11T15-00-00-000Z',
          artifactReportDir: '/path/to/reports/1780000000000-2026-06-11T15-00-00-000Z',
          aiResponseDir: '/path/to/ai-responses/1780000000000-2026-06-11T15-00-00-000Z',
          reportPath: '/path/to/reports/1780000000000-2026-06-11T15-00-00-000Z/home.argus.json',
          rawResponsePath:
            '/path/to/ai-responses/1780000000000-2026-06-11T15-00-00-000Z/home.openai-response.json',
          provider: 'openai',
          model: 'gpt-5.5-2026-04-23',
          score: 88,
          riskLevel: 'high',
          findings: 1,
        },
      },
    },
  })
  uploadArchive(@UploadedFile() file: any) {
    return this.appService.uploadArchive(file);
  }

  @Post('applications')
  @ApiOperation({ summary: 'Cadastrar aplicação analisável pelo Argus' })
  @ApiCreatedResponse({
    description: 'Aplicação cadastrada com sucesso.',
    schema: {
      example: {
        id: '1780000000000',
        name: 'Music Catalog',
        version: '1.0.0',
        description: 'Aplicação demo com issues de acessibilidade.',
        filePath: '/path/to/uploads/app.zip',
        fileName: 'app.zip',
        createdAt: '2026-06-11T15:00:00.000Z',
      },
    },
  })
  createApplication(@Body() dto: CreateApplicationDto): any {
    return this.appService.createApplication(dto);
  }

  @Get('applications')
  @ApiOperation({ summary: 'Listar aplicações cadastradas' })
  @ApiOkResponse({
    description: 'Lista de aplicações cadastradas.',
    schema: {
      example: [
        {
          id: '1780000000000',
          name: 'Music Catalog',
          version: '1.0.0',
          description: 'Aplicação demo com issues de acessibilidade.',
          filePath: '/path/to/uploads/app.zip',
          fileName: 'app.zip',
          createdAt: '2026-06-11T15:00:00.000Z',
        },
      ],
    },
  })
  listApplications(): any {
    return this.appService.listApplications();
  }

  @Get('applications/:id')
  @ApiOperation({ summary: 'Buscar aplicação por id' })
  @ApiParam({
    name: 'id',
    description: 'Identificador da aplicação cadastrada.',
    example: '1780000000000',
  })
  @ApiOkResponse({
    description: 'Aplicação encontrada.',
    schema: {
      example: {
        id: '1780000000000',
        name: 'Music Catalog',
        version: '1.0.0',
        description: 'Aplicação demo com issues de acessibilidade.',
        filePath: '/path/to/uploads/app.zip',
        fileName: 'app.zip',
        createdAt: '2026-06-11T15:00:00.000Z',
        fileExists: true,
      },
    },
  })
  getApplication(@Param('id') id: string): any {
    return this.appService.getApplication(id);
  }
}
