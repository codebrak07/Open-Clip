import React from 'react';

export interface DirectorState {
  qualityPasses: 'preview' | 'normal' | 'production' | 'cinematic';
  targetAudience: string;
  platform: string;
  emotion: string;
  editingStyle: string;
  captionStyle: string;
  humor: string;
  energy: string;
  pacing: string;
  clipLength: string;
  minScore: number;
}

interface DirectorControlsProps {
  config: DirectorState;
  onChange: (updated: DirectorState) => void;
}

export const DirectorControls: React.FC<DirectorControlsProps> = ({ config, onChange }) => {
  const updateField = (field: keyof DirectorState, value: any) => {
    onChange({ ...config, [field]: value });
  };

  return (
    <div className="bg-[#0D0F17] border border-[#1F2436] rounded-xl p-5 text-white space-y-5">
      <div className="flex items-center justify-between border-b border-[#1F2436] pb-3">
        <h3 className="text-base font-bold text-indigo-400 flex items-center gap-2">
          <span>🎬</span> AI Director Studio Controls
        </h3>
        <span className="text-xs bg-indigo-950 text-indigo-300 border border-indigo-700 px-2 py-0.5 rounded font-mono">
          V6 Active
        </span>
      </div>

      {/* Adaptive Quality Passes */}
      <div>
        <label className="text-xs font-mono text-gray-400 block mb-2">ADAPTIVE AI QUALITY PASSES</label>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {[
            { id: 'preview', label: 'Fast Preview (1 Pass)' },
            { id: 'normal', label: 'Normal (5 Passes)' },
            { id: 'production', label: 'Production (10 Passes)' },
            { id: 'cinematic', label: 'Cinematic (15 Passes)' }
          ].map((pass) => (
            <button
              key={pass.id}
              onClick={() => updateField('qualityPasses', pass.id)}
              className={`p-2 rounded border font-medium transition-all ${
                config.qualityPasses === pass.id
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-900/40'
                  : 'bg-[#141824] border-[#23293D] text-gray-400 hover:text-white hover:border-gray-600'
              }`}
            >
              {pass.label}
            </button>
          ))}
        </div>
      </div>

      {/* Parameter Matrix */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
        <div>
          <label className="text-gray-400 block mb-1">Target Audience</label>
          <select
            value={config.targetAudience}
            onChange={(e) => updateField('targetAudience', e.target.value)}
            className="w-full bg-[#141824] border border-[#23293D] rounded p-2 text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="gen-z">Gen-Z Creators</option>
            <option value="tech-founders">Tech Founders & Engineers</option>
            <option value="general">General Audience</option>
            <option value="business">Business & Enterprise</option>
          </select>
        </div>

        <div>
          <label className="text-gray-400 block mb-1">Target Platform</label>
          <select
            value={config.platform}
            onChange={(e) => updateField('platform', e.target.value)}
            className="w-full bg-[#141824] border border-[#23293D] rounded p-2 text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="tiktok">TikTok / Shorts (9:16)</option>
            <option value="reels">Instagram Reels (9:16)</option>
            <option value="youtube">YouTube Longform (16:9)</option>
            <option value="linkedin">LinkedIn Video (1:1 / 4:5)</option>
          </select>
        </div>

        <div>
          <label className="text-gray-400 block mb-1">Editing Style</label>
          <select
            value={config.editingStyle}
            onChange={(e) => updateField('editingStyle', e.target.value)}
            className="w-full bg-[#141824] border border-[#23293D] rounded p-2 text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="mrbeast">Fast Paced / MrBeast Style</option>
            <option value="documentary">Cinematic Documentary</option>
            <option value="podcast">Clean Podcast Highlight</option>
            <option value="minimal">Minimal / Academic</option>
          </select>
        </div>

        <div>
          <label className="text-gray-400 block mb-1">Caption & Subtitle Style</label>
          <select
            value={config.captionStyle}
            onChange={(e) => updateField('captionStyle', e.target.value)}
            className="w-full bg-[#141824] border border-[#23293D] rounded p-2 text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="bold-yellow">Bold Animated Yellow Hook</option>
            <option value="hormozi">Alex Hormozi Word Highlight</option>
            <option value="clean-white">Minimal White Bottom</option>
            <option value="none">No Subtitles</option>
          </select>
        </div>

        <div>
          <label className="text-gray-400 block mb-1">Energy & Pacing</label>
          <select
            value={config.energy}
            onChange={(e) => updateField('energy', e.target.value)}
            className="w-full bg-[#141824] border border-[#23293D] rounded p-2 text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="high">High Velocity (Fast Cuts)</option>
            <option value="balanced">Balanced Dynamic Flow</option>
            <option value="calm">Calm & Thoughtful</option>
          </select>
        </div>

        <div>
          <label className="text-gray-400 block mb-1">Min Virality Score Threshold</label>
          <input
            type="range"
            min="50"
            max="95"
            value={config.minScore}
            onChange={(e) => updateField('minScore', Number(e.target.value))}
            className="w-full mt-2 accent-indigo-500"
          />
          <div className="text-right text-[10px] font-mono text-indigo-400">{config.minScore} / 100</div>
        </div>
      </div>
    </div>
  );
};
