import { sourceLocation } from './wgsl/composer.ts';
import type { ComposedWGSL } from './wgsl/composer.ts';
export interface ShaderDiagnostic {
  type: GPUCompilationMessageType;
  message: string;
  chunk: string;
  line: number;
  column: number;
}
export async function compileShader(device: GPUDevice, source: ComposedWGSL, label: string) {
  const module = device.createShaderModule({ label, code: source.code });
  const info = await module.getCompilationInfo();
  const diagnostics: ShaderDiagnostic[] = info.messages.map((m) => ({
    ...sourceLocation(source, m.lineNum),
    type: m.type,
    message: m.message,
    column: m.linePos,
  }));
  if (diagnostics.some((m) => m.type === 'error' || m.type === 'warning'))
    throw new ShaderCompileError(diagnostics);
  return { module, diagnostics };
}
export class ShaderCompileError extends Error {
  readonly diagnostics: readonly ShaderDiagnostic[];
  constructor(diagnostics: ShaderDiagnostic[]) {
    super(diagnostics.map((m) => `${m.chunk}:${m.line}:${m.column}: ${m.message}`).join('\n'));
    this.name = 'ShaderCompileError';
    this.diagnostics = diagnostics;
  }
}
