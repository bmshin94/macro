import { useCodexAgentsAccess } from '@core/codex/flag';
import { isCodexBotId } from '@core/constant/codexAgent';
import { isCursorBotId } from '@core/constant/cursorAgent';
import {
  enableChatV3Agents,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useCursorAgentsAccess } from '@core/cursor/flag';
import type { IUser } from '@core/user/types';
import { uniqueByKey } from '@core/util/compareUtils';
import { useCodexStatusQuery } from '@queries/auth/codex';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import type { Accessor } from 'solid-js';
import {
  codexMentionUser,
  cursorMentionUser,
  isMacroAiId,
  isMacroCoderId,
  isMacroNewId,
  macroAiMentionUser,
  macroCoderMentionUser,
  macroNewMentionUser,
} from './macroAi';

/** Built-in agent entries shared by every message composer. */
export function useAgentMentionUsers(
  users: Accessor<IUser[]>,
  enabled: Accessor<boolean> = () => true
): Accessor<IUser[]> {
  const canUseCursor = useCursorAgentsAccess();
  const cursorApiKey = useCursorApiKeyStatusQuery();
  const canUseCodex = useCodexAgentsAccess();
  const codexStatus = useCodexStatusQuery(canUseCodex);

  return () => {
    const cursorEnabled =
      canUseCursor() &&
      (cursorApiKey.isSuccess ? cursorApiKey.data.registered : false);
    const codexEnabled =
      canUseCodex() &&
      codexStatus.isSuccess &&
      codexStatus.data.connected &&
      !!codexStatus.data.environmentId?.trim();
    if (!enabled()) return users();
    const base = users().filter(
      (user) =>
        (cursorEnabled || !isCursorBotId(user.id)) &&
        (codexEnabled || !isCodexBotId(user.id))
    );
    if (
      isFeatureEnabled(enableChatV3Agents) &&
      !base.some((user) => isMacroCoderId(user.id))
    ) {
      base.unshift(macroCoderMentionUser());
    }
    if (
      isFeatureEnabled(enableChatV3Agents) &&
      !base.some((user) => isMacroNewId(user.id))
    ) {
      base.unshift(macroNewMentionUser());
    }
    if (
      cursorEnabled &&
      // Hiding it is not enforcement — a mention can still arrive from a
      // copied message or another client — so the harness refuses these too.
      !base.some((user) => isCursorBotId(user.id))
    ) {
      base.unshift(cursorMentionUser());
    }
    if (codexEnabled && !base.some((user) => isCodexBotId(user.id))) {
      base.unshift(codexMentionUser());
    }
    if (!base.some((user) => isMacroAiId(user.id))) {
      base.unshift(macroAiMentionUser());
    }
    return uniqueByKey(base, (user) => user.id);
  };
}
