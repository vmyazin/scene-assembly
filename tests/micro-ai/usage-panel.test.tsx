// tests/micro-ai/usage-panel.test.tsx
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import MicroAiUsagePanel from '@/components/MicroAiUsagePanel';
import { useMicroAiUsageStore } from '@/store/useMicroAiUsageStore';

describe('MicroAiUsagePanel', () => {
  afterEach(() => {
    useMicroAiUsageStore.getState().reset();
  });

  it('does not name one model as the one running every helper', () => {
    useMicroAiUsageStore.setState({
      requests: 1,
      promptTokens: 10,
      completionTokens: 4,
      costUsd: 0.01,
      lastModel: 'Qwen/Qwen2.5-VL-7B-Instruct',
    });

    render(<MicroAiUsagePanel />);

    expect(screen.getByText(/running on the shared fast tier/)).toBeInTheDocument();
    expect(screen.queryByText(/Qwen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Llama/)).not.toBeInTheDocument();
  });
});
