import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSettings: vi.fn(),
  requestConnectApp: vi.fn(),
  pipedreamSlugs: new Set<string>(),
  cursor: { isSuccess: true, data: { registered: false } },
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: mocks.openSettings }),
}));
vi.mock('@core/pipedream/pendingConnect', () => ({
  requestConnectApp: mocks.requestConnectApp,
}));
vi.mock('@core/pipedream/ConnectorIcon', () => ({
  PipedreamConnectorIcon: () => <span data-pipedream-icon />,
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectedSlugs: () => ({
    ready: () => true,
    slugs: () => mocks.pipedreamSlugs,
  }),
}));
vi.mock('@queries/auth/cursor-api-key', () => ({
  useCursorApiKeyStatusQuery: () => mocks.cursor,
}));
// Reached through LexicalWrapperContext; the plugin barrel is far heavier
// than the context object this chip reads its selection from.
vi.mock('../../plugins', () => ({}));

import { ConnectApp } from './ConnectApp';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pipedreamSlugs.clear();
  mocks.cursor.data = { registered: false };
});

describe('connect-app chip', () => {
  it('sends a Pipedream chip to Connections with the app queued', () => {
    render(() => (
      <ConnectApp
        appSlug="linear"
        name="Linear"
        target="connections"
        key="node"
        theme={{}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
    expect(mocks.requestConnectApp).toHaveBeenCalledWith('linear');
    expect(mocks.openSettings).toHaveBeenCalledWith('Connected');
  });

  it('sends a harness chip to the Harness page without touching Pipedream', () => {
    render(() => (
      <ConnectApp
        appSlug="cursor"
        name="Cursor"
        target="harness"
        key="node"
        theme={{}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Cursor' }));
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');
    expect(mocks.requestConnectApp).not.toHaveBeenCalled();
  });

  it('reads as connected once the reader has a Cursor key, and stops navigating', () => {
    mocks.cursor.data = { registered: true };
    render(() => (
      <ConnectApp
        appSlug="cursor"
        name="Cursor"
        target="harness"
        key="node"
        theme={{}}
      />
    ));
    const chip = screen.getByRole('button', { name: 'Cursor connected' });
    fireEvent.click(chip);
    expect(mocks.openSettings).not.toHaveBeenCalled();
  });

  it('does not let a Cursor key satisfy a Pipedream chip for an app of the same name', () => {
    mocks.cursor.data = { registered: true };
    render(() => (
      <ConnectApp
        appSlug="cursor"
        name="Cursor"
        target="connections"
        key="node"
        theme={{}}
      />
    ));
    expect(screen.getByRole('button', { name: 'Connect Cursor' })).toBeTruthy();
  });
});
