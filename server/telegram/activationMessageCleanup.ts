export const GROUP_ACTIVATION_AUTO_DELETE_DELAY_MS = 10 * 60 * 1_000;

export function groupActivationAutoDeleteAt(sentAt = new Date()) {
  return new Date(sentAt.getTime() + GROUP_ACTIVATION_AUTO_DELETE_DELAY_MS);
}

export async function scheduleGroupActivationMessageAutoDelete(input: {
  groupId: number;
  messageId: number;
  sentAt?: Date;
  persist: (record: { groupId: number; messageId: number; autoDeleteAt: Date }) => Promise<void>;
}) {
  const autoDeleteAt = groupActivationAutoDeleteAt(input.sentAt);
  await input.persist({ groupId: input.groupId, messageId: input.messageId, autoDeleteAt });
  return autoDeleteAt;
}
