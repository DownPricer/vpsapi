export const PLATFORM_EVENT_TYPES = [
  "page_view",
  "calculator_opened",
  "calculator_started",
  "calculator_quote_success",
  "calculator_quote_failed",
  "quote_request_created",
  "booking_created",
  "pro_login_success",
  "pro_login_failed",
  "pro_settings_saved",
  "payment_checkout_created",
  "payment_succeeded",
  "payment_failed",
  "stripe_webhook_received",
  "email_sent",
  "email_failed",
  "api_error",
  "admin_error",
  "platform_admin_login_success",
  "platform_admin_login_failed",
] as const;

export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[number];

