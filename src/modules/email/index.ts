export {
  assertSmtpConnection,
  getSmtpConnectionFromEnv,
  resolveMailFrom,
  sendSmtpMessage,
  type SmtpConnection,
} from "./smtp";
export { buildCustomerConfirmation, buildCustomerDecisionEmail, buildOperatorEmail } from "./formatLeadEmail";
export {
  sendCustomerDecisionMail,
  buildDecisionSummaryLines,
  type CustomerDecisionMailResult,
  type CustomerDecisionMailSkippedReason,
} from "./customerDecisionMail";
export {
  sendContactLeadEmail,
  sendDevisLeadEmails,
  sendReservationLeadEmails,
} from "./sendLeadEmails";
export {
  pickVtcPhoneFromTenantSettings,
  resolveClientEmailForPaymentMail,
  sendPaymentLinkToCustomer,
  type SendPaymentLinkMailResult,
} from "./paymentLinkMail";
export { buildPaymentLinkCustomerEmail } from "./formatLeadEmail";
export {
  buildPaymentConfirmationCustomerEmail,
  buildPaymentConfirmationOperatorEmail,
} from "./formatLeadEmail";
export {
  notifyPaymentConfirmedAfterWebhookTransition,
  sendPaymentConfirmationToCustomer,
  sendPaymentConfirmationToOperator,
} from "./paymentConfirmationMail";
