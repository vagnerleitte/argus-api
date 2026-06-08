import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import AdmZip from 'adm-zip';
import OpenAI from 'openai';
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
  private readonly reportsDir = path.join(process.cwd(), 'reports');
  private readonly aiResponsesDir = path.join(process.cwd(), 'ai-responses');
  private readonly applicationsFile = path.join(process.cwd(), 'data', 'applications.json');
  private readonly argusEngineVersion = '0.1.0';

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

  private isAxeReport(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const report = value as Record<string, unknown>;
    return Array.isArray(report.violations) || Array.isArray(report.passes) || Array.isArray(report.incomplete);
  }

  private selectAxeJsonFromZip(buffer: Buffer) {
    let zip: AdmZip;

    try {
      zip = new AdmZip(buffer);
    } catch (error) {
      throw new BadRequestException('Não foi possível ler o ZIP enviado.');
    }

    const jsonEntries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.json'));

    const sortedEntries = [...jsonEntries].sort((left, right) => {
      const leftName = left.entryName.toLowerCase();
      const rightName = right.entryName.toLowerCase();

      const score = (name: string) => {
        if (name.includes('axe') && path.basename(name) === 'home.json') {
          return 0;
        }

        if (path.basename(name) === 'home.json') {
          return 1;
        }

        if (name.includes('axe')) {
          return 2;
        }

        return 3;
      };

      return score(leftName) - score(rightName);
    });

    for (const entry of sortedEntries) {
      try {
        const content = entry.getData().toString('utf8');
        const parsed = JSON.parse(content) as unknown;

        if (this.isAxeReport(parsed)) {
          return {
            entryName: entry.entryName,
            report: parsed,
          };
        }
      } catch (error) {
        continue;
      }
    }

    throw new BadRequestException('Nenhum JSON de axe-core foi encontrado no ZIP enviado.');
  }

  private selectDomHtmlFromZip(buffer: Buffer, screen: string) {
    let zip: AdmZip;

    try {
      zip = new AdmZip(buffer);
    } catch (error) {
      throw new BadRequestException('Não foi possível ler o ZIP enviado.');
    }

    const htmlEntries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.html'));

    const sortedEntries = [...htmlEntries].sort((left, right) => {
      const leftName = left.entryName.toLowerCase();
      const rightName = right.entryName.toLowerCase();
      const targetFileName = `${screen.toLowerCase()}.html`;

      const score = (name: string) => {
        if (name.includes('dom') && path.basename(name) === targetFileName) {
          return 0;
        }

        if (path.basename(name) === targetFileName) {
          return 1;
        }

        if (name.includes('dom')) {
          return 2;
        }

        return 3;
      };

      return score(leftName) - score(rightName);
    });

    const selectedEntry = sortedEntries[0];

    if (!selectedEntry) {
      throw new BadRequestException('Nenhum HTML de DOM renderizado foi encontrado no ZIP enviado.');
    }

    return {
      entryName: selectedEntry.entryName,
      html: selectedEntry.getData().toString('utf8'),
    };
  }

  private selectAccessibilityTreeFromZip(buffer: Buffer, screen: string) {
    let zip: AdmZip;

    try {
      zip = new AdmZip(buffer);
    } catch (error) {
      throw new BadRequestException('Não foi possível ler o ZIP enviado.');
    }

    const jsonEntries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.json'));

    const sortedEntries = [...jsonEntries].sort((left, right) => {
      const leftName = left.entryName.toLowerCase();
      const rightName = right.entryName.toLowerCase();
      const targetFileName = `${screen.toLowerCase()}.json`;

      const score = (name: string) => {
        if (name.includes('accessibility-tree') && path.basename(name) === targetFileName) {
          return 0;
        }

        if (name.includes('accessibility') && path.basename(name) === targetFileName) {
          return 1;
        }

        if (name.includes('accessibility-tree')) {
          return 2;
        }

        if (name.includes('accessibility')) {
          return 3;
        }

        return 4;
      };

      return score(leftName) - score(rightName);
    });

    for (const entry of sortedEntries) {
      try {
        const content = entry.getData().toString('utf8');
        const parsed = JSON.parse(content) as unknown;

        if (entry.entryName.toLowerCase().includes('axe') || this.isAxeReport(parsed)) {
          continue;
        }

        return {
          entryName: entry.entryName,
          tree: parsed,
        };
      } catch (error) {
        continue;
      }
    }

    throw new BadRequestException('Nenhum JSON de accessibility tree foi encontrado no ZIP enviado.');
  }

  private reduceDomHtml(html: string) {
    const maxLength = 60000;
    const cleaned = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    const htmlOpen = cleaned.match(/<html\b[^>]*>/i)?.[0] ?? '';
    const title = cleaned.match(/<title\b[^>]*>[\s\S]*?<\/title>/i)?.[0] ?? '';
    const body = cleaned.match(/<body\b[^>]*>[\s\S]*?<\/body>/i)?.[0] ?? cleaned;
    const relevantMatches = body.match(
      /<(main|header|nav|section|article|aside|footer|form|label|input|select|textarea|button|a|img|h[1-6])\b[^>]*>[\s\S]*?<\/\1>|<(input|img)\b[^>]*>/gi,
    );
    const relevantHtml = relevantMatches?.join('\n') ?? body.slice(0, maxLength);
    const reduced = [htmlOpen, title, relevantHtml].filter(Boolean).join('\n');

    return reduced.length <= maxLength ? reduced : `${reduced.slice(0, maxLength)}\n<!-- DOM truncated -->`;
  }

  private reduceAccessibilityTree(tree: unknown) {
    const maxLength = 60000;
    const serialized = JSON.stringify(tree, null, 2);

    if (serialized.length <= maxLength) {
      return tree;
    }

    const prune = (value: unknown, depth = 0): unknown => {
      if (!value || typeof value !== 'object') {
        return value;
      }

      if (Array.isArray(value)) {
        return value.slice(0, 40).map((item) => prune(item, depth + 1));
      }

      const node = value as Record<string, unknown>;
      const reduced: Record<string, unknown> = {};

      for (const key of ['role', 'name', 'value', 'level', 'checked', 'disabled', 'expanded', 'selected']) {
        if (node[key] !== undefined) {
          reduced[key] = node[key];
        }
      }

      if (Array.isArray(node.children) && depth < 8) {
        reduced.children = node.children.slice(0, 40).map((child) => prune(child, depth + 1));
      }

      return reduced;
    };

    return prune(tree);
  }

  private buildArgusPrompt(
    axeReport: unknown,
    domHtml: string,
    accessibilityTree: unknown,
    screen: string,
    generatedAt: string,
  ) {
    return `
You are Argus, an accessibility and human experience evaluator.

Analyze the following runtime artifacts and produce an accessibility and human experience report.

Artifacts provided:
1. axe-core JSON
2. rendered DOM HTML
3. accessibility tree

Rules:
Return ONLY the requested structured JSON.
Base findings primarily on axe-core violations.
Use the rendered DOM to provide structural and semantic context.
Use the Accessibility Tree to improve screen reader analysis, landmark analysis, heading hierarchy analysis, accessible name analysis, and navigation analysis.
Do not invent issues that are not supported by the axe-core evidence.
If the DOM clarifies the purpose of an element, use that context.
If the DOM suggests an issue is decorative or redundant, mention uncertainty instead of assuming.
Use numeric score and confidence values.
Use reportMetadata.screen="${screen}".
Use reportMetadata.source="axe-core+dom+accessibility-tree".
Use reportMetadata.generatedAt="${generatedAt}".
Use reportMetadata.engineVersion="${this.argusEngineVersion}".

axe-core JSON artifact:
${JSON.stringify(axeReport, null, 2)}

rendered DOM HTML:
${domHtml}

accessibility tree JSON:
${JSON.stringify(accessibilityTree, null, 2)}
`.trim();
  }

  private buildArgusReportSchema(screen: string, generatedAt: string) {
    const severityValues = ['low', 'medium', 'high', 'critical'];
    const categoryValues = ['accessibility', 'usability', 'semantics', 'forms', 'navigation', 'visual'];
    const affectedUserValues = [
      'screen_reader_users',
      'keyboard_users',
      'low_vision_users',
      'motor_impaired_users',
      'cognitive_load_sensitive_users',
    ];
    const experienceRatingValues = ['good', 'needs_attention', 'poor'];

    return {
      type: 'object',
      additionalProperties: false,
      required: [
        'reportMetadata',
        'summary',
        'findings',
        'positiveFindings',
        'experienceAssessment',
        'insight',
        'recommendationSummary',
      ],
      properties: {
        reportMetadata: {
          type: 'object',
          additionalProperties: false,
          required: ['screen', 'source', 'generatedAt', 'engineVersion'],
          properties: {
            screen: { type: 'string', enum: [screen] },
            source: { type: 'string', enum: ['axe-core+dom+accessibility-tree'] },
            generatedAt: { type: 'string', enum: [generatedAt] },
            engineVersion: { type: 'string', enum: [this.argusEngineVersion] },
          },
        },
        summary: {
          type: 'object',
          additionalProperties: false,
          required: ['score', 'riskLevel', 'executiveSummary'],
          properties: {
            score: { type: 'number', minimum: 0, maximum: 100 },
            riskLevel: { type: 'string', enum: severityValues },
            executiveSummary: { type: 'string' },
          },
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'title',
              'severity',
              'category',
              'confidence',
              'evidence',
              'technicalDescription',
              'humanImpact',
              'recommendation',
              'affectedUsers',
            ],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              severity: { type: 'string', enum: severityValues },
              category: { type: 'string', enum: categoryValues },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              evidence: {
                type: 'object',
                additionalProperties: false,
                required: ['axeRuleId', 'impact', 'selector', 'snippet'],
                properties: {
                  axeRuleId: { type: 'string' },
                  impact: { type: 'string' },
                  selector: { type: 'string' },
                  snippet: { type: 'string' },
                },
              },
              technicalDescription: { type: 'string' },
              humanImpact: { type: 'string' },
              recommendation: { type: 'string' },
              affectedUsers: {
                type: 'array',
                items: { type: 'string', enum: affectedUserValues },
              },
            },
          },
        },
        positiveFindings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'description', 'impact'],
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              impact: { type: 'string' },
            },
          },
        },
        experienceAssessment: {
          type: 'object',
          additionalProperties: false,
          required: ['cognitiveLoad', 'discoverability', 'nonVisualExperience'],
          properties: {
            cognitiveLoad: {
              type: 'object',
              additionalProperties: false,
              required: ['rating', 'reason'],
              properties: {
                rating: { type: 'string', enum: experienceRatingValues },
                reason: { type: 'string' },
              },
            },
            discoverability: {
              type: 'object',
              additionalProperties: false,
              required: ['rating', 'reason'],
              properties: {
                rating: { type: 'string', enum: experienceRatingValues },
                reason: { type: 'string' },
              },
            },
            nonVisualExperience: {
              type: 'object',
              additionalProperties: false,
              required: ['rating', 'reason'],
              properties: {
                rating: { type: 'string', enum: experienceRatingValues },
                reason: { type: 'string' },
              },
            },
          },
        },
        insight: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description'],
          properties: {
            title: { type: 'string', enum: ['Argus Insight'] },
            description: { type: 'string' },
          },
        },
        recommendationSummary: {
          type: 'object',
          additionalProperties: false,
          required: ['estimatedScoreAfterFixes', 'priorityActions'],
          properties: {
            estimatedScoreAfterFixes: {
              type: 'object',
              additionalProperties: false,
              required: ['min', 'max'],
              properties: {
                min: { type: 'number', minimum: 0, maximum: 100 },
                max: { type: 'number', minimum: 0, maximum: 100 },
              },
            },
            priorityActions: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    };
  }

  private async analyzeAxeReportWithOpenAI(
    axeReport: unknown,
    domHtml: string,
    accessibilityTree: unknown,
    screen: string,
    generatedAt: string,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
      throw new InternalServerErrorException('OPENAI_API_KEY não está configurada no ambiente.');
    }

    const openai = new OpenAI({ apiKey });

    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are Argus, an accessibility and human experience evaluator. Return only the requested structured JSON.',
          },
          {
            role: 'user',
            content: this.buildArgusPrompt(axeReport, domHtml, accessibilityTree, screen, generatedAt),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'argus_accessibility_report',
            strict: true,
            schema: this.buildArgusReportSchema(screen, generatedAt),
          },
        },
      });
      const responseText = response.choices[0]?.message.content;

      if (!responseText) {
        throw new Error('OpenAI retornou uma resposta vazia.');
      }

      return {
        model,
        response,
        responseText,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido ao chamar OpenAI.';
      throw new InternalServerErrorException(`Falha ao chamar OpenAI: ${message}`);
    }
  }

  private parseOpenAIReport(responseText: string) {
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch (error) {
      throw new InternalServerErrorException('OpenAI retornou uma resposta que não é JSON válido.');
    }
  }

  private writeReportFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  private formatTimestampForPath(isoDate: string) {
    return isoDate.replace(/[:.]/g, '-');
  }

  private async createArgusReportFromZip(buffer: Buffer, artifactId: string) {
    const selectedAxeArtifact = this.selectAxeJsonFromZip(buffer);
    const generatedAt = new Date().toISOString();
    const analysisTimestamp = this.formatTimestampForPath(generatedAt);
    const reportVersionId = `${artifactId}-${analysisTimestamp}`;
    const screen = path.basename(selectedAxeArtifact.entryName, '.json') || 'home';
    const selectedDomArtifact = this.selectDomHtmlFromZip(buffer, screen);
    const reducedDomHtml = this.reduceDomHtml(selectedDomArtifact.html);
    const selectedAccessibilityTreeArtifact = this.selectAccessibilityTreeFromZip(buffer, screen);
    const reducedAccessibilityTree = this.reduceAccessibilityTree(selectedAccessibilityTreeArtifact.tree);
    const artifactReportDir = path.join(this.reportsDir, reportVersionId);
    const aiResponseDir = path.join(this.aiResponsesDir, reportVersionId);
    const sourceAxeFileName = `${screen}.axe.json`;
    const sourceAxePath = path.join(artifactReportDir, sourceAxeFileName);
    const sourceDomFileName = `${screen}.dom.html`;
    const sourceDomPath = path.join(artifactReportDir, sourceDomFileName);
    const sourceAccessibilityTreeFileName = `${screen}.accessibility-tree.json`;
    const sourceAccessibilityTreePath = path.join(artifactReportDir, sourceAccessibilityTreeFileName);

    this.writeReportFile(sourceAxePath, JSON.stringify(selectedAxeArtifact.report, null, 2));
    this.writeReportFile(sourceDomPath, reducedDomHtml);
    this.writeReportFile(sourceAccessibilityTreePath, JSON.stringify(reducedAccessibilityTree, null, 2));

    const analysis = await this.analyzeAxeReportWithOpenAI(
      selectedAxeArtifact.report,
      reducedDomHtml,
      reducedAccessibilityTree,
      screen,
      generatedAt,
    );
    const rawResponseFileName = `${screen}.openai-response.json`;
    const rawResponsePath = path.join(aiResponseDir, rawResponseFileName);
    const rawResponseJson = JSON.stringify(
      {
        artifactId,
        analysisTimestamp,
        reportVersionId,
        artifactReportDir,
        aiResponseDir,
        provider: 'openai',
        model: analysis.model,
        generatedAt,
        sourceArtifacts: {
          axe: selectedAxeArtifact.entryName,
          dom: selectedDomArtifact.entryName,
          accessibilityTree: selectedAccessibilityTreeArtifact.entryName,
        },
        responseText: analysis.responseText,
        response: analysis.response,
      },
      null,
      2,
    );

    this.writeReportFile(rawResponsePath, rawResponseJson);

    const report = this.parseOpenAIReport(analysis.responseText);
    const reportFileName = `${screen}.argus.json`;
    const reportPath = path.join(artifactReportDir, reportFileName);
    const summary = report.summary as { score?: unknown; riskLevel?: unknown } | undefined;
    const findings = report.findings as unknown;

    const reportJson = JSON.stringify(report, null, 2);
    this.writeReportFile(reportPath, reportJson);

    return {
      artifactId,
      analysisTimestamp,
      reportVersionId,
      artifactReportDir,
      sourceArtifacts: {
        axe: selectedAxeArtifact.entryName,
        dom: selectedDomArtifact.entryName,
        accessibilityTree: selectedAccessibilityTreeArtifact.entryName,
      },
      sourceAxePath,
      sourceAxeFileName,
      sourceDomPath,
      sourceDomFileName,
      sourceAccessibilityTreePath,
      sourceAccessibilityTreeFileName,
      reportPath,
      reportFileName,
      aiResponseDir,
      rawResponsePath,
      rawResponseFileName,
      provider: 'openai',
      model: analysis.model,
      score: summary?.score ?? null,
      riskLevel: summary?.riskLevel ?? null,
      findings: Array.isArray(findings) ? findings.length : null,
    };
  }

  async uploadArchive(file: any) {
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
      const uploadId = `${Date.now()}`;
      const destination = path.join(this.uploadsDir, `${uploadId}-${safeName}`);
      fs.writeFileSync(destination, file.buffer);
      const argusAnalysis = safeName.toLowerCase().endsWith('.zip')
        ? await this.createArgusReportFromZip(file.buffer, uploadId)
        : null;

      return {
        ok: true,
        message: 'Arquivo enviado com sucesso.',
        fileName: safeName,
        storedAt: destination,
        size: file.size ?? file.buffer.length,
        mimetype: file.mimetype || 'application/octet-stream',
        argusAnalysis,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Erro desconhecido.';
      console.error('Falha no upload/análise Argus:', error);

      throw new InternalServerErrorException(
        `Não foi possível processar o upload/análise Argus: ${message}`,
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
