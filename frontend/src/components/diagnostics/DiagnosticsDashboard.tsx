import React from 'react';
import { DiagnosticsStudio } from '../DiagnosticsStudio';

export interface DependencyItem {
  id: string;
  name: string;
  category: string;
  installed: boolean;
  version: string;
  gpuSupport: boolean;
  required: boolean;
  health: 'healthy' | 'warning' | 'missing';
}

export const DiagnosticsDashboard: React.FC = () => {
  return (
    <div className="flex-1 bg-[#08090C] p-6 space-y-6 overflow-y-auto">
      <DiagnosticsStudio />

      {/* Failover Chain Info */}
      <div className="bg-[#0D0F17] border border-[#1F2436] rounded-xl p-5 text-white space-y-4">
        <div className="flex items-center justify-between border-b border-[#1F2436] pb-3">
          <h3 className="text-sm font-bold text-indigo-400">Automatic LLM Provider Failover Chain</h3>
          <span className="text-xs text-emerald-400 font-mono">Zero Interruptions Active</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span className="bg-indigo-900/60 border border-indigo-500 text-indigo-200 px-3 py-1.5 rounded-lg font-bold">1. Groq (Llama-3.1 8B Instant)</span>
          <span className="text-gray-500">➔</span>
          <span className="bg-[#141824] border border-[#23293D] text-gray-300 px-3 py-1.5 rounded-lg">2. OpenRouter</span>
          <span className="text-gray-500">➔</span>
          <span className="bg-[#141824] border border-[#23293D] text-gray-300 px-3 py-1.5 rounded-lg">3. Gemini 1.5 Flash</span>
          <span className="text-gray-500">➔</span>
          <span className="bg-[#141824] border border-[#23293D] text-gray-300 px-3 py-1.5 rounded-lg">4. OpenAI GPT-4o-mini</span>
          <span className="text-gray-500">➔</span>
          <span className="bg-[#141824] border border-[#23293D] text-gray-300 px-3 py-1.5 rounded-lg">5. Claude 3.5 Sonnet</span>
          <span className="text-gray-500">➔</span>
          <span className="bg-[#141824] border border-[#23293D] text-gray-300 px-3 py-1.5 rounded-lg">6. Ollama Local</span>
        </div>
      </div>
    </div>
  );
};
