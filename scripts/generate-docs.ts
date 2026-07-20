import fs from 'fs';
import path from 'path';

function generateArchitectureDoc() {
  const rootDir = process.cwd();
  const pipelineConfigPath = path.resolve(rootDir, 'backend/src/config/pipeline.json');
  let pipelineManifest: any = { pipeline: [] };

  if (fs.existsSync(pipelineConfigPath)) {
    pipelineManifest = JSON.parse(fs.readFileSync(pipelineConfigPath, 'utf-8'));
  }

  let doc = `# OpenClip AI Platform - Generated System Documentation\n\n`;
  doc += `*Generated automatically on: ${new Date().toISOString()}*\n\n`;

  doc += `## Active Declarative Pipeline Manifest\n\n`;
  doc += `| Stage ID | Stage Class | Dependencies | Parallel Safe |\n`;
  doc += `| :--- | :--- | :--- | :---: |\n`;

  pipelineManifest.pipeline.forEach((p: any) => {
    const deps = p.dependencies.join(', ') || 'None';
    doc += `| \`${p.id}\` | \`${p.stage}\` | ${deps} | ${p.parallelSafe ? 'Yes' : 'No'} |\n`;
  });

  doc += `\n## Execution Graph Flow\n\n\`\`\`mermaid\ngraph TD\n`;
  pipelineManifest.pipeline.forEach((p: any) => {
    if (p.dependencies.length === 0) {
      doc += `    ${p.id}\n`;
    } else {
      p.dependencies.forEach((dep: string) => {
        doc += `    ${dep} --> ${p.id}\n`;
      });
    }
  });
  doc += `\`\`\`\n`;

  const outputPath = path.resolve(rootDir, 'ARCHITECTURE.md');
  fs.writeFileSync(outputPath, doc, 'utf-8');
  console.log(`[GenerateDocs] Successfully generated documentation at ${outputPath}`);
}

generateArchitectureDoc();
