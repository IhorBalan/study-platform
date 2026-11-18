/** What the relay hands to publish() and what a consumer receives. */
export interface Message {
  /** The outbox row id, as a string. Stable across re-publishing. */
  id: string;
  topic: string;
  payload: unknown;
}

export type Publish = (message: Message) => Promise<void>;
