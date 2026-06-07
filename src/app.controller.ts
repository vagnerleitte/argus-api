import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

class CreateApplicationDto {
  @IsString({ message: 'O campo name deve ser uma string.' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'O campo version deve ser uma string.' })
  version?: string;

  @IsOptional()
  @IsString({ message: 'O campo description deve ser uma string.' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'O campo filePath deve ser uma string.' })
  filePath?: string;

  @IsOptional()
  @IsString({ message: 'O campo fileName deve ser uma string.' })
  fileName?: string;
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('applications/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadArchive(@UploadedFile() file: any) {
    return this.appService.uploadArchive(file);
  }

  @Post('applications')
  createApplication(@Body() dto: CreateApplicationDto): any {
    return this.appService.createApplication(dto);
  }

  @Get('applications')
  listApplications(): any {
    return this.appService.listApplications();
  }
}
