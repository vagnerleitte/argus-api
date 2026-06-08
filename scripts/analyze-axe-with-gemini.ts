import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

const [inputPath, outputPath] = process.argv.slice(2);
const engineVersion = '0.1.0';
const screen = 'home';
const generatedAt = new Date().toISOString();

function fail(message: string): never {
  console.error(`Argus analysis failed: ${message}`);
  process.exit(1);
}

if (!inputPath || !outputPath) {
  fail('Usage: tsx scripts/analyze-axe-with-gemini.ts <axe-json-path> <output-json-path>');
}

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  fail('GEMINI_API_KEY is not set.');
}

const geminiApiKey = apiKey;

if (!fs.existsSync(inputPath)) {
  fail(`Input axe JSON file not found: ${inputPath}`);
}

let axeReport: unknown;

try {
  axeReport = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (error) {
  fail(`Input file is not valid JSON: ${inputPath}`);
}

const prompt = `
You are Argus, an accessibility and human experience evaluator.

Analyze the following axe-core JSON artifact and produce an accessibility and human experience report.

Return ONLY valid JSON.
Do not return markdown.
Do not return prose outside JSON.
Do not use code fences.

The JSON response must follow this exact structure:

{
  "reportMetadata": {
    "screen": "${screen}",
    "source": "axe-core",
    "generatedAt": "${generatedAt}",
    "engineVersion": "${engineVersion}"
  },
  "summary": {
    "score": 0,
    "riskLevel": "low | medium | high | critical",
    "executiveSummary": ""
  },
  "findings": [
    {
      "id": "",
      "title": "",
      "severity": "low | medium | high | critical",
      "category": "accessibility | usability | semantics | forms | navigation | visual",
      "confidence": 0,
      "evidence": {
        "axeRuleId": "",
        "impact": "",
        "selector": "",
        "snippet": ""
      },
      "technicalDescription": "",
      "humanImpact": "",
      "recommendation": "",
      "affectedUsers": [
        "screen_reader_users",
        "keyboard_users",
        "low_vision_users",
        "motor_impaired_users",
        "cognitive_load_sensitive_users"
      ]
    }
  ],
  "positiveFindings": [
    {
      "title": "",
      "description": "",
      "impact": ""
    }
  ],
  "experienceAssessment": {
    "cognitiveLoad": {
      "rating": "good | needs_attention | poor",
      "reason": ""
    },
    "discoverability": {
      "rating": "good | needs_attention | poor",
      "reason": ""
    },
    "nonVisualExperience": {
      "rating": "good | needs_attention | poor",
      "reason": ""
    }
  },
  "insight": {
    "title": "Argus Insight",
    "description": ""
  },
  "recommendationSummary": {
    "estimatedScoreAfterFixes": {
      "min": 0,
      "max": 100
    },
    "priorityActions": []
  }
}

Use numeric score and confidence values.
Use one concrete enum value instead of pipe-separated examples.
Base findings only on the axe-core evidence provided.
If there are no violations, return an empty findings array and include useful positiveFindings.

axe-core JSON artifact:
${JSON.stringify(axeReport, null, 2)}
`.trim();

async function main() {
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const response = await model.generateContent(prompt);
  const responseText = response.response.text();

  let result: unknown;

  try {
    result = JSON.parse(responseText);
  } catch (error) {
    fail('Gemini returned invalid JSON. Raw response was not saved.');
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

  const summary = (result as { summary?: { score?: unknown; riskLevel?: unknown } }).summary;
  const findings = (result as { findings?: unknown[] }).findings;

  console.log(`Argus report saved to: ${outputPath}`);
  console.log(`Score: ${summary?.score ?? 'unknown'}`);
  console.log(`Risk level: ${summary?.riskLevel ?? 'unknown'}`);
  console.log(`Findings: ${Array.isArray(findings) ? findings.length : 'unknown'}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'Unexpected Gemini analysis error.');
});
