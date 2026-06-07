import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface ApplicationRecord {
  id: string;
  name: string;
  version?: string;
  description?: string;
  filePath?: string;
  fileName?: string;
  createdAt: string;
}

@Injectable()
export class AppService {
  private readonly uploadsDir = path.join(process.cwd(), 'uploads');
  private readonly applicationsFile = path.join(process.cwd(), 'data', 'applications.json');

  private readApplications(): ApplicationRecord[] {
    fs.mkdirSync(path.dirname(this.applicationsFile), { recursive: true });

    if (!fs.existsSync(this.applicationsFile)) {
      return [];
    }

    return JSON.parse(fs.readFileSync(this.applicationsFile, 'utf8')) as ApplicationRecord[];
  }

  private writeApplications(applications: ApplicationRecord[]) {
    fs.mkdirSync(path.dirname(this.applicationsFile), { recursive: true });
    fs.writeFileSync(this.applicationsFile, JSON.stringify(applications, null, 2), 'utf8');
  }

  uploadArchive(file: any) {
    if (!file || !file.originalname) {
      throw new BadRequestException('Arquivo não enviado. Envie o arquivo no campo multipart "file".');
    }

    const originalName = String(file.originalname || '').trim();
    const allowedExtensions = ['.zip', '.tgz', '.tar', '.gz'];
    const hasAllowedExtension = allowedExtensions.some((ext) =>
      originalName.toLowerCase().endsWith(ext) || originalName.toLowerCase().endsWith('.tar.gz'),
    );

    if (!hasAllowedExtension) {
      throw new BadRequestException(
        'Formato de arquivo não suportado. Envie um ZIP, TGZ, TAR ou GZ.',
      );
    }

    if (!file.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException('Arquivo vazio ou ilegível. Envie um arquivo com conteúdo válido.');
    }

    if (file.size !== undefined && file.size <= 0) {
      throw new BadRequestException('Arquivo vazio. O tamanho do arquivo deve ser maior que zero.');
    }

    try {
      fs.mkdirSync(this.uploadsDir, { recursive: true });

      const safeName = originalName.replace(/\s+/g, '-').replace(/[\\/]+/g, '-');
      const destination = path.join(this.uploadsDir, `${Date.now()}-${safeName}`);
      fs.writeFileSync(destination, file.buffer);

      return {
        ok: true,
        message: 'Arquivo enviado com sucesso.',
        fileName: safeName,
        storedAt: destination,
        size: file.size ?? file.buffer.length,
        mimetype: file.mimetype || 'application/octet-stream',
      };
    } catch (error) {
      throw new InternalServerErrorException(
        'Não foi possível salvar o arquivo no servidor. Verifique as permissões da pasta uploads.',
      );
    }
  }

  createApplication(dto: Omit<ApplicationRecord, 'id' | 'createdAt'>) {
    const applications = this.readApplications();
    const record: ApplicationRecord = {
      id: `${Date.now()}`,
      name: dto.name,
      version: dto.version,
      description: dto.description,
      filePath: dto.filePath,
      fileName: dto.fileName,
      createdAt: new Date().toISOString(),
    };

    applications.push(record);
    this.writeApplications(applications);

    return record;
  }

  listApplications() {
    return this.readApplications();
  }

  getApplication(id: string) {
    const applications = this.readApplications();
    const record = applications.find((item) => item.id === id);

    if (!record) {
      throw new NotFoundException(`Aplicação com id "${id}" não encontrada.`);
    }

    return {
      ...record,
      fileExists: record.fileName ? fs.existsSync(path.join(this.uploadsDir, record.fileName)) : false,
    };
  }
}
