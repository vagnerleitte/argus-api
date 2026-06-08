import 'dotenv/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

const [axeJsonPath, domHtmlPath, accessibilityTreeJsonPath, outputPathArg] = process.argv.slice(2);
const engineVersion = '0.1.0';
const screen = 'home';
const source = 'axe-core+dom+accessibility-tree';
const generatedAt = new Date().toISOString();

function formatTimestampForPath(isoDate: string) {
  return isoDate.replace(/[:.]/g, '-');
}

function getReportsRoot(outputPath: string) {
  return path.extname(outputPath) === '.json' ? path.dirname(outputPath) : outputPath;
}

function fail(message: string): never {
  console.error(`Argus analysis failed: ${message}`);
  process.exit(1);
}

function reduceDomHtml(html: string) {
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

function reduceAccessibilityTree(tree: unknown) {
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

function buildArgusPrompt(axeReport: unknown, domHtml: string, accessibilityTree: unknown) {
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
Use reportMetadata.source="${source}".
Use reportMetadata.generatedAt="${generatedAt}".
Use reportMetadata.engineVersion="${engineVersion}".

axe-core JSON artifact:
${JSON.stringify(axeReport, null, 2)}

rendered DOM HTML:
${domHtml}

accessibility tree JSON:
${JSON.stringify(accessibilityTree, null, 2)}
`.trim();
}

function buildArgusReportSchema() {
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
          source: { type: 'string', enum: [source] },
          generatedAt: { type: 'string', enum: [generatedAt] },
          engineVersion: { type: 'string', enum: [engineVersion] },
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

if (!axeJsonPath || !domHtmlPath || !accessibilityTreeJsonPath || !outputPathArg) {
  fail(
    'Usage: tsx scripts/analyze-with-llm.ts <axe-json-path> <dom-html-path> <accessibility-tree-json-path> <reports-dir-or-output-json-path>',
  );
}

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!apiKey) {
  fail('OPENAI_API_KEY is not set.');
}

if (!fs.existsSync(axeJsonPath)) {
  fail(`Input axe JSON file not found: ${axeJsonPath}`);
}

if (!fs.existsSync(domHtmlPath)) {
  fail(`Input DOM HTML file not found: ${domHtmlPath}`);
}

if (!fs.existsSync(accessibilityTreeJsonPath)) {
  fail(`Input accessibility tree JSON file not found: ${accessibilityTreeJsonPath}`);
}

let axeReport: unknown;
let accessibilityTree: unknown;

try {
  axeReport = JSON.parse(fs.readFileSync(axeJsonPath, 'utf8'));
} catch (error) {
  fail(`Input axe file is not valid JSON: ${axeJsonPath}`);
}

try {
  accessibilityTree = JSON.parse(fs.readFileSync(accessibilityTreeJsonPath, 'utf8'));
} catch (error) {
  fail(`Input accessibility tree file is not valid JSON: ${accessibilityTreeJsonPath}`);
}

const reducedDomHtml = reduceDomHtml(fs.readFileSync(domHtmlPath, 'utf8'));
const reducedAccessibilityTree = reduceAccessibilityTree(accessibilityTree);
const artifactId = process.env.ARGUS_ARTIFACT_ID || path.basename(axeJsonPath, path.extname(axeJsonPath)) || screen;
const analysisTimestamp = formatTimestampForPath(generatedAt);
const reportVersionId = `${artifactId}-${analysisTimestamp}`;
const reportsRoot = getReportsRoot(outputPathArg);
const aiResponsesRoot = process.env.ARGUS_AI_RESPONSES_DIR || 'ai-responses';
const artifactReportDir = path.join(reportsRoot, reportVersionId);
const aiResponseDir = path.join(aiResponsesRoot, reportVersionId);
const sourceAxePath = path.join(artifactReportDir, `${screen}.axe.json`);
const sourceDomPath = path.join(artifactReportDir, `${screen}.dom.html`);
const sourceAccessibilityTreePath = path.join(artifactReportDir, `${screen}.accessibility-tree.json`);
const rawResponsePath = path.join(aiResponseDir, `${screen}.openai-response.json`);
const reportPath = path.join(artifactReportDir, `${screen}.argus.json`);
const openai = new OpenAI({ apiKey });

async function main() {
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
        content: buildArgusPrompt(axeReport, reducedDomHtml, reducedAccessibilityTree),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'argus_accessibility_report',
        strict: true,
        schema: buildArgusReportSchema(),
      },
    },
  });
  const responseText = response.choices[0]?.message.content;

  if (!responseText) {
    fail('OpenAI returned an empty response.');
  }

  let result: unknown;

  try {
    result = JSON.parse(responseText);
  } catch (error) {
    fail('OpenAI returned invalid JSON.');
  }

  fs.mkdirSync(artifactReportDir, { recursive: true });
  fs.mkdirSync(aiResponseDir, { recursive: true });
  fs.writeFileSync(sourceAxePath, JSON.stringify(axeReport, null, 2), 'utf8');
  fs.writeFileSync(sourceDomPath, reducedDomHtml, 'utf8');
  fs.writeFileSync(sourceAccessibilityTreePath, JSON.stringify(reducedAccessibilityTree, null, 2), 'utf8');
  fs.writeFileSync(
    rawResponsePath,
    JSON.stringify(
      {
        artifactId,
        analysisTimestamp,
        reportVersionId,
        artifactReportDir,
        aiResponseDir,
        provider: 'openai',
        model,
        generatedAt,
        sourceArtifacts: {
          axe: axeJsonPath,
          dom: domHtmlPath,
          accessibilityTree: accessibilityTreeJsonPath,
        },
        responseText,
        response,
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8');

  const summary = (result as { summary?: { score?: unknown; riskLevel?: unknown } }).summary;
  const findings = (result as { findings?: unknown[] }).findings;
  const metadata = (result as { reportMetadata?: { source?: unknown } }).reportMetadata;

  console.log(`Argus report version saved to: ${artifactReportDir}`);
  console.log(`OpenAI response saved to: ${rawResponsePath}`);
  console.log(`Argus report saved to: ${reportPath}`);
  console.log(`Source: ${metadata?.source ?? 'unknown'}`);
  console.log(`Score: ${summary?.score ?? 'unknown'}`);
  console.log(`Risk level: ${summary?.riskLevel ?? 'unknown'}`);
  console.log(`Findings: ${Array.isArray(findings) ? findings.length : 'unknown'}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'Unexpected OpenAI analysis error.');
});
