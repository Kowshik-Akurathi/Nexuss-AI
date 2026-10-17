import { useLocalModelStore } from "@/store/localModelStore";
import { useChatStore } from "@/store/chatStore";

/**
 * Selects a local model through the same path Settings → Models uses:
 * persists it (best effort) and updates the chat provider/model state.
 */
export async function selectLocalModel(modelId: string): Promise<void> {
  const local = useLocalModelStore.getState();
  const owner = local.providers.find((p) =>
    local.models.some((m) => m.providerId === p.id && m.modelId === modelId)
  );

  const chat = useChatStore.getState();
  if (chat.provider !== "local") chat.setProvider("local");
  chat.setModel(modelId);
  local.setSelectedModel(modelId);

  if (owner) local.setActiveProviderId(owner.id);
}
