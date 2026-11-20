import { SpeechSynthesisManager } from '../core/story/audio/SpeechSynthesisManager';

async function main() {
  console.log('\n======================================================');
  console.log('🩺  OpenClip Story Studio — TTS Engine Doctor & Probe');
  console.log('======================================================\n');

  const manager = new SpeechSynthesisManager();
  const results = await manager.runDoctor();

  for (const r of results) {
    const icon = r.ready ? '✅ READY' : '❌ NOT READY';
    console.log(`[${icon}] ${r.providerName} (${r.providerId})`);
    console.log(`  - Latency: ${r.latencyMs}ms`);
    if (r.ready) {
      console.log(`  - Voices: ${r.voicesCount} active voices`);
      console.log(`  - Sample Audio Duration: ${r.sampleDurationSec?.toFixed(2)}s`);
    } else {
      console.log(`  - Issue: ${r.error}`);
    }
    console.log('');
  }

  const anyReady = results.some(r => r.ready);
  if (anyReady) {
    console.log('🎉 At least one TTS provider is operational. Synthesis chain is ready.\n');
    process.exit(0);
  } else {
    console.error('⚠️  No TTS providers are operational. Please check setup.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal doctor error:', err);
  process.exit(1);
});
