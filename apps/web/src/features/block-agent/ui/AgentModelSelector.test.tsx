/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { AgentModelSelector } from './AgentModelSelector';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));
vi.mock('@phosphor-icons/core/regular/caret-down.svg?component-solid', () => ({
  default: () => <span />,
}));
vi.mock('@phosphor/check.svg', () => ({ default: () => <span /> }));
vi.mock('@phosphor/magnifying-glass.svg', () => ({ default: () => <span /> }));
vi.mock('@phosphor/caret-left.svg', () => ({ default: () => <span /> }));
vi.mock('@phosphor/caret-right.svg', () => ({ default: () => <span /> }));

const OPTIONS = [
  { id: 'fast', name: 'Fast', description: null, group: null },
  { id: 'good', name: 'Good', description: null, group: null },
];

describe('AgentModelSelector', () => {
  it('pulses the trigger while a model change is on the wire', () => {
    const view = render(() => (
      <AgentModelSelector
        model="fast"
        changingTo="good"
        options={OPTIONS}
        onSelect={() => {}}
      />
    ));
    const trigger = view.getByRole('button');
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(trigger.className).toContain('animate-pulse');
    expect(trigger.textContent).toContain('Good');
  });

  it('pulses the catalog trigger Cursor uses for a long model list', () => {
    const options = Array.from({ length: 12 }, (_, index) => ({
      id: `model-${index}`,
      name: `Model ${index}`,
      description: null,
      group: null,
    }));
    const view = render(() => (
      <AgentModelSelector
        model="model-0"
        changingTo="model-1"
        options={options}
        onSelect={() => {}}
      />
    ));
    const trigger = view.getByRole('button', { name: 'Agent model' });
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(trigger.className).toContain('animate-pulse');
  });

  it('stays still once the fold has the requested model', () => {
    const view = render(() => (
      <AgentModelSelector model="good" options={OPTIONS} onSelect={() => {}} />
    ));
    const trigger = view.getByRole('button');
    expect(trigger.getAttribute('aria-busy')).toBeNull();
    expect(trigger.className).not.toContain('animate-pulse');
  });
});
