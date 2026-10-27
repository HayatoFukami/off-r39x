/** Application contracts contain no provider SDK types or business workflows. */
export type ProviderFailure = { readonly kind: "TEMPORARY_FAILURE" | "BLOCKED" | "UNKNOWN_RESULT" };
export interface EmailPayload {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly replyTo?: string;
}
export interface EmailRequest {
  readonly key: string;
  readonly payload: EmailPayload;
}
export type EmailSendResult =
  | { readonly kind: "ACCEPTED"; readonly messageId: string }
  | ProviderFailure;
export interface EmailSender {
  send(request: EmailRequest): Promise<EmailSendResult>;
}
export interface EmailLookup {
  lookup(
    messageId: string,
  ): Promise<
    | { readonly kind: "FOUND"; readonly messageId: string; readonly status: string }
    | ProviderFailure
  >;
}
export interface PaymentLookup {
  checkout(id: string): Promise<
    | {
        readonly kind: "FOUND";
        readonly id: string;
        readonly status: string | null;
        readonly paymentStatus: string;
      }
    | ProviderFailure
  >;
  refund(
    id: string,
  ): Promise<
    | { readonly kind: "FOUND"; readonly id: string; readonly status: string | null }
    | ProviderFailure
  >;
}
export interface VerifiedWebhook {
  readonly id: string;
  readonly type: string;
  readonly created: number;
  readonly livemode: boolean;
}
export interface PaymentWebhookVerifier {
  verify(rawBody: Uint8Array, signature: string): VerifiedWebhook | null;
}
