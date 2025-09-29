import { describe, expect, it } from 'vitest';

import { formatAgentLabel } from './api';

describe('formatAgentLabel', () => {
  it('maps known agents to friendly labels', () => {
    expect(formatAgentLabel('greeting')).toBe('Greeting Agent');
    expect(formatAgentLabel('summarizer')).toBe('Summarizer Agent');
    expect(formatAgentLabel('time_helper')).toBe('Time Helper Agent');
    expect(formatAgentLabel('input_coach')).toBe('Input Coach Agent');
    expect(formatAgentLabel('manager')).toBe('Manager Notes');
  });

  it('falls back to Assistant for unknown values', () => {
    expect(formatAgentLabel('unknown' as never)).toBe('Assistant');
  });
});
